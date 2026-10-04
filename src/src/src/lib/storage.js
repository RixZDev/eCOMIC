// Client-side storage: favorites with folders (localStorage) + downloads (IndexedDB blobs).
import { base44 } from "@/api/base44Client";
import { getPostsByPool, getPool } from "@/lib/e621";

const FAV_KEY = "e621_favorites";
const DL_KEY = "e621_downloads";
const DB_NAME = "e621_comics";
const STORE = "pages";

function notify() {
  try { window.dispatchEvent(new CustomEvent("e621-library-change")); } catch {}
}

// ---------------- Favorites ----------------
export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; }
}
export function isFavorite(id) {
  return getFavorites().some((f) => f.id === id);
}
export function getFolders() {
  const set = new Set();
  for (const f of getFavorites()) if (f.folder) set.add(f.folder);
  return [...set];
}
export function addFavorite(pool, folder = "") {
  const favs = getFavorites();
  if (favs.some((f) => f.id === pool.id)) return false;
  favs.push({ ...poolMeta(pool), folder });
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {}
  notify();
  return true;
}
export function removeFavorite(id) {
  const favs = getFavorites().filter((f) => f.id !== id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {}
  notify();
}
export function moveFavorite(id, folder) {
  const favs = getFavorites();
  const i = favs.findIndex((f) => f.id === id);
  if (i >= 0) {
    favs[i].folder = folder;
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {}
    notify();
  }
}

// ---------------- Follows (creators) ----------------
const FOLLOW_KEY = "e621_follows";
export function getFollows() {
  try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) || "[]"); } catch { return []; }
}
export function isFollowing(creatorId) {
  return getFollows().some((f) => f.id === creatorId);
}
export function toggleFollow(creatorId, name) {
  const follows = getFollows();
  const i = follows.findIndex((f) => f.id === creatorId);
  let nowFollowing;
  if (i >= 0) { follows.splice(i, 1); nowFollowing = false; }
  else { follows.push({ id: creatorId, name: name || null, added_at: Date.now() }); nowFollowing = true; }
  try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(follows)); } catch {}
  notify();
  return nowFollowing;
}

// ---------------- Likes (comics) ----------------
const LIKE_KEY = "e621_likes";
export function getLikes() {
  try { return JSON.parse(localStorage.getItem(LIKE_KEY) || "[]"); } catch { return []; }
}
export function isLiked(id) {
  return getLikes().some((l) => l.id === id);
}
export function addLike(id, data) {
  const likes = getLikes();
  if (likes.some((l) => l.id === id)) return false;
  likes.push({ id, ...data, liked_at: Date.now() });
  try { localStorage.setItem(LIKE_KEY, JSON.stringify(likes)); } catch {}
  notify();
  return true;
}
export function removeLike(id) {
  const likes = getLikes().filter((l) => l.id !== id);
  try { localStorage.setItem(LIKE_KEY, JSON.stringify(likes)); } catch {}
  notify();
}

// Build an e621 OR query (~tag1 ~tag2 ~tag3) from the most frequent tags among
// liked comics, used to feed the "For you" recommendations.
export function getRecommendedQuery() {
  const likes = getLikes();
  if (!likes.length) return null;
  const counts = {};
  likes.forEach((l) => (l.tags || []).forEach((tg) => { counts[tg] = (counts[tg] || 0) + 1; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
  if (!top.length) return null;
  return top.map((t) => `~${t}`).join(" ");
}

// ---------------- Downloads index ----------------
export function getDownloads() {
  try { return JSON.parse(localStorage.getItem(DL_KEY) || "[]"); } catch { return []; }
}
export function isDownloaded(id) {
  return getDownloads().some((d) => d.id === id);
}
function saveDownloads(dls) {
  try { localStorage.setItem(DL_KEY, JSON.stringify(dls)); } catch {}
}

function poolMeta(pool) {
  return {
    id: pool.id,
    name: pool.name,
    post_count: pool.post_count,
    creator_id: pool.creator_id,
    creator_name: pool.creator_name,
    cover_url: pool.cover_url || null,
  };
}

// ---------------- IndexedDB ----------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function idbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function idbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function base64ToBlob(b64, contentType) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType || "application/octet-stream" });
}

// Download every page of a comic via the server proxy (needed because the
// e621 image CDN blocks cross-origin fetches). onProgress(done, total).
export async function downloadComic(pool, onProgress) {
  let postIds = (pool.post_ids || []).filter(Boolean);
  let creatorName = pool.creator_name;
  if (postIds.length === 0) {
    try {
      const p = await getPool(pool.id);
      postIds = (p.post_ids || []).filter(Boolean);
      creatorName = creatorName || p.creator_name;
    } catch {}
  }
  const posts = await getPostsByPool(pool.id, pool.post_count || postIds.length || 100);
  const map = new Map(posts.map((p) => [p.id, p]));
  const ordered = (postIds.length ? postIds.map((pid) => map.get(pid)) : posts).filter(Boolean);

  let coverUrl = null;
  let done = 0;
  const total = ordered.length;
  const CONCURRENCY = 6;
  const results = [];

  async function fetchOne(p) {
    const url = (p.file && p.file.url) || (p.sample && p.sample.url) || (p.preview && p.preview.url);
    if (!url) { done++; onProgress?.(done, total); return null; }
    try {
      const res = await base44.functions.invoke("proxyComicPage", { url });
      const b64 = res?.data?.base64;
      const ct = res?.data?.contentType;
      if (!b64) throw new Error("sin datos");
      const blob = base64ToBlob(b64, ct);
      await idbPut({ id: p.id, blob, url });
      if (!coverUrl && p.preview && p.preview.url) coverUrl = p.preview.url;
      return p.id;
    } catch (e) {
      return null;
    } finally {
      done++;
      onProgress?.(done, total);
    }
  }

  const queue = [...ordered];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (p) results.push(await fetchOne(p));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ordered.length) }, worker));

  const pageIds = results.filter(Boolean);
  if (pageIds.length === 0) throw new Error("No se pudo descargar ninguna página.");

  const dls = getDownloads();
  const idx = dls.findIndex((d) => d.id === pool.id);
  const entry = {
    id: pool.id,
    name: pool.name,
    post_count: pageIds.length,
    creator_id: pool.creator_id,
    creator_name: creatorName || pool.creator_name,
    cover_url: coverUrl,
    page_ids: pageIds,
    downloaded_at: Date.now(),
  };
  if (idx >= 0) dls[idx] = entry; else dls.push(entry);
  saveDownloads(dls);
  notify();
  return entry;
}

export async function deleteDownload(id) {
  const dls = getDownloads();
  const dl = dls.find((d) => d.id === id);
  if (dl) for (const pid of dl.page_ids || []) { try { await idbDelete(pid); } catch {} }
  saveDownloads(dls.filter((d) => d.id !== id));
  notify();
}

export async function getDownloadedPageUrl(postId) {
  const rec = await idbGet(postId);
  if (!rec) return null;
  return URL.createObjectURL(rec.blob);
}

export async function getDownloadedComic(id) {
  return getDownloads().find((d) => d.id === id) || null;
}

// Local cover URL for a downloaded comic (first stored page), so covers render
// offline instead of relying on the e621 CDN.
export async function getDownloadedCoverUrl(dl) {
  if (!dl || !dl.page_ids || !dl.page_ids.length) return null;
  try {
    return await getDownloadedPageUrl(dl.page_ids[0]);
  } catch {
    return null;
  }
} 
