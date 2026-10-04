// Client-side e621 access. Requests go directly from the user's browser
// (residential IP, not blocked) to e621's API. Images load straight from
// e621's CDN via <img> (no CORS needed for display). A small concurrency
// queue keeps us within e621's anonymous rate limits.

const E621 = "https://e621.net";
// e621 requires a non-empty User-Agent. Browsers send their own, but e621's
// policy blocks requests that impersonate a browser without identifying the
// app. For browser apps that can't set the User-Agent header (it's forbidden),
// e621 documents the `_client` query param as the workaround — we send it on
// every API request.
const CLIENT_UA = "eCOMICS/1.0";
// e621's hard rate limit is two requests per second (503 above that), and they
// ask for <=1/sec sustained. We stagger request starts by MIN_INTERVAL so we
// never exceed ~1.6/sec, which keeps covers/pages loading without 503s.
const MAX_CONCURRENT = 2;
const MIN_INTERVAL = 600;

let active = 0;
const queue = [];
let lastStart = 0;

function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const { task, resolve, reject } = queue.shift();
    active++;
    const now = Date.now();
    const wait = Math.max(0, lastStart + MIN_INTERVAL - now);
    lastStart = now + wait;
    setTimeout(() => {
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    }, wait);
  }
}

async function e621Get(path) {
  return enqueue(async () => {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${E621}${path}${sep}_client=${encodeURIComponent(CLIENT_UA)}`;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        if (data && data.success === false) throw new Error(data.code || "error");
        if (!res.ok) throw new Error(`e621 ${res.status}`);
        // A 200 with non-JSON (e.g. a Cloudflare interstitial) means the API
        // isn't usable — fail loudly so callers show an error instead of
        // crashing on null downstream (which silently broke covers/pages).
        if (data === null) throw new Error("non-json");
        return data;
      } catch (e) {
        lastErr = e;
        // Rate limits (503/429) and maintenance won't recover in milliseconds —
        // back off longer before retrying.
        if (e?.message === "maintenance") break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw lastErr;
  });
}

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// List comic pools (browse mode). Pools themselves carry no tags, so tag
// filters and "most popular" are handled by listPoolsFromPosts below.
export async function listPools(page = 1, limit = 24, query = "") {
  let path = `/pools.json?limit=${limit}&page=${page}`;
  if (query) path += `&search[name_matches]=${encodeURIComponent(query)}`;
  return e621Get(path).then((list) => (Array.isArray(list) ? list : []).map(mapPool));
}

// Gather every pool whose posts carry the given tags (used for tag filters and
// "most popular"). Fetches a large batch of posts, collects unique pool ids,
// then fetches the pools in chunks. Covers come from the posts themselves.
export async function listPoolsFromPosts(tags, maxPosts = 300) {
  const perPage = 75;
  const pages = Math.ceil(maxPosts / perPage);
  const poolIds = [];
  const seen = new Set();
  const coverByPool = {};
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      e621Get(`/posts.json?tags=${encodeURIComponent(tags)}&limit=${perPage}&page=${i + 1}`).catch(() => [])
    )
  );
  for (const data of results) {
    const posts = Array.isArray(data) ? data : data.posts || [];
    for (const p of posts) {
      for (const pid of p.pools || []) {
        if (!seen.has(pid)) { seen.add(pid); poolIds.push(pid); }
        if (!coverByPool[pid]) coverByPool[pid] = mapPost(p);
      }
    }
  }
  if (!poolIds.length) return [];
  const pools = [];
  for (let i = 0; i < poolIds.length; i += 40) {
    const batch = poolIds.slice(i, i + 40);
    const data = await e621Get(`/pools.json?search[id]=${batch.join(",")}`).catch(() => []);
    const arr = Array.isArray(data) ? data : [];
    pools.push(...arr);
  }
  const map = new Map(pools.map((p) => [p.id, p]));
  return poolIds
    .map((pid) => {
      const pool = map.get(pid);
      if (!pool) return null;
      const mp = mapPool(pool);
      const cover = coverByPool[pid];
      if (cover) {
        mp.cover_url = cover.preview_url || cover.sample_url || cover.file_url;
        mp.cover_rating = cover.rating;
        mp.cover_urls = [cover.preview_url, cover.sample_url, cover.file_url].filter(Boolean);
      }
      return mp;
    })
    .filter(Boolean);
}

// Fetch many posts by id in a single request (used to load covers in bulk).
export async function getPostsByIds(ids) {
  if (!ids.length) return [];
  const data = await e621Get(`/posts.json?tags=id:${ids.join(",")}&limit=${Math.min(ids.length, 75)}`);
  return Array.isArray(data) ? data : data.posts || [];
}

// Fetch the first post of each pool to attach a cover + rating in one batch.
export async function attachCovers(list) {
  const firstIds = list.map((c) => c.post_ids && c.post_ids[0]).filter(Boolean);
  if (!firstIds.length) return list;
  try {
    const posts = await getPostsByIds(firstIds);
    const postMap = new Map(posts.map((p) => [p.id, p]));
    return list.map((c) => {
      const fid = c.post_ids && c.post_ids[0];
      const post = fid && postMap.get(fid);
      const mp = post ? mapPost(post) : null;
      return {
        ...c,
        cover_url: mp ? (mp.preview_url || mp.sample_url || mp.file_url) : c.cover_url,
        cover_rating: mp ? mp.rating : c.cover_rating,
        cover_urls: mp ? [mp.preview_url, mp.sample_url, mp.file_url].filter(Boolean) : c.cover_urls,
      };
    });
  } catch {
    return list;
  }
}

// Merge the most recent pools from a set of followed creators, newest first.
export async function listRecentFromFollows(creatorIds) {
  if (!creatorIds.length) return [];
  const results = await Promise.all(
    creatorIds.map((cid) =>
      e621Get(`/pools.json?limit=50&page=1&search[creator_id]=${cid}`).catch(() => [])
    )
  );
  const map = new Map();
  for (const data of results) {
    const arr = Array.isArray(data) ? data : [];
    for (const p of arr) map.set(p.id, p);
  }
  const sorted = [...map.values()].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  return sorted.map(mapPool);
}

export async function listPoolsByCreator(creatorId, page = 1, limit = 24) {
  return e621Get(`/pools.json?limit=${limit}&page=${page}&search[creator_id]=${creatorId}`);
}

export async function getPool(id) {
  return e621Get(`/pools/${id}.json`);
}

export async function getPostsByPool(id, totalCount = 100) {
  const pages = Math.min(Math.max(Math.ceil(totalCount / 100), 1), 10);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      e621Get(`/posts.json?tags=pool:${id}&limit=100&page=${i + 1}`).catch(() => [])
    )
  );
  const all = [];
  for (const data of results) {
    const batch = Array.isArray(data) ? data : data.posts || [];
    all.push(...batch);
  }
  return all;
}

export async function getPost(id) {
  const data = await e621Get(`/posts/${id}.json`);
  return data.post || data;
}

export async function getUser(id) {
  return e621Get(`/users/${id}.json`);
}

export function mapPost(p) {
  const file = p.file || {};
  const preview = p.preview || {};
  const sample = p.sample || {};
  const tags = p.tags || {};
  return {
    id: p.id,
    width: file.width,
    height: file.height,
    ext: file.ext,
    file_url: file.url,
    preview_url: preview.url,
    sample_url: sample.url,
    rating: p.rating,
    artist: Array.isArray(tags.artist) ? tags.artist : [],
    tags: Array.isArray(tags.general) ? tags.general : [],
  };
}

export function mapPool(p) {
  return {
    id: p.id,
    name: p.name,
    post_count: p.post_count,
    description: p.description || "",
    category: p.category,
    post_ids: p.post_ids || [],
    creator_id: p.creator_id,
    creator_name: p.creator_name,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
