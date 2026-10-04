import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useLocation, useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Radio,
  User,
  Heart,
  UserPlus,
  UserCheck,
} from "lucide-react";
import { getPool, getPost, getPostsByPool, mapPost, mapPool, isOnline } from "@/lib/e621";
import { isDownloaded, getDownloadedComic, getDownloadedPageUrl, isLiked, addLike, removeLike, isFollowing, toggleFollow } from "@/lib/storage";
import { useI18n } from "@/hooks/useI18n";
import AppBackground from "@/components/AppBackground";
import PageNavigator from "@/components/PageNavigator";
import { useCustomization } from "@/hooks/useCustomization";

const REFRESH_MS = 30000;

export default function ComicReader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const safe = location.state?.safe ?? true;
  const firstPostId = location.state?.firstPostId;
  const downloaded = isDownloaded(parseInt(id));
  const { t } = useI18n();
  const config = useCustomization();
  const prevBtn = config.buttons.previous;
  const nextBtn = config.buttons.next;

  const [pool, setPool] = useState(null);
  const [pages, setPages] = useState([]);
  const [index, setIndex] = useState(0);
  const [author, setAuthor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchComic = useCallback(
    async (silent) => {
      if (downloaded) {
        try {
          const dl = await getDownloadedComic(parseInt(id));
          if (!dl) { setError(t("downloaded_not_found")); setLoading(false); return; }
          const ordered = [];
          for (const pid of dl.page_ids || []) {
            const url = await getDownloadedPageUrl(pid);
            if (url) ordered.push({ id: pid, file_url: url, sample_url: url, preview_url: url, rating: "s", artist: [] });
          }
          setPool({ id: dl.id, name: dl.name, creator_name: dl.creator_name, creator_id: dl.creator_id, post_count: ordered.length, post_ids: dl.page_ids || [] });
          setPages(ordered);
          setAuthor(dl.creator_name || "Desconocido");
          setLastUpdate(new Date());
          setError(null);
        } catch (e) {
          setError(t("load_downloaded_error"));
        } finally {
          setLoading(false);
        }
        return;
      }
      if (!isOnline()) {
        setError(t("no_connection"));
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      let staged = false;
      try {
        // Kick off the pool and the first-post fetch in parallel so the reader
        // can paint page 1 as soon as possible.
        const poolPromise = getPool(parseInt(id));
        const firstPromise = !silent && firstPostId ? getPost(firstPostId).catch(() => null) : null;
        const p = await poolPromise;
        const order = p.post_ids || [];

        // Stage 1: show the first page instantly (skipped in safe mode if it's
        // not safe-rated), then keep loading the rest in the background.
        if (!silent) {
          let first = firstPromise ? await firstPromise : null;
          if (!first && order.length) first = await getPost(order[0]).catch(() => null);
          if (first && (!safe || first.rating === "s")) {
            setPool(mapPool(p));
            setPages([mapPost(first)]);
            setAuthor(p.creator_name || (p.creator_id ? t("user_n", { id: p.creator_id }) : t("unknown")));
            setLastUpdate(new Date());
            setError(null);
            setLoading(false);
            staged = true;
          }
        }

        // Stage 2: load every page, then swap in the full ordered list.
        const posts = await getPostsByPool(parseInt(id), p.post_count || 100);
        const map = new Map(posts.map((x) => [x.id, x]));
        let ordered = order.map((pid) => map.get(pid)).filter(Boolean).map(mapPost);
        if (safe) ordered = ordered.filter((x) => x.rating === "s");

        setPool(mapPool(p));
        setPages(ordered);
        setLastUpdate(new Date());
        setError(null);

        if (!author) {
          setAuthor(p.creator_name || (p.creator_id ? t("user_n", { id: p.creator_id }) : t("unknown")));
        }
      } catch (e) {
        if (!staged) setError(e?.message === "maintenance" ? t("load_maintenance") : t("load_error"));
      } finally {
        setLoading(false);
      }
    },
    [id, safe, author, downloaded, t]
  );

  useEffect(() => {
    fetchComic(false);
  }, [fetchComic]);

  // Sync like/follow state once the pool is loaded.
  const [liked, setLiked] = useState(false);
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    if (!pool) return;
    setLiked(isLiked(pool.id));
    if (pool.creator_id) setFollowing(isFollowing(pool.creator_id));
  }, [pool]);

  // Top general tags across the comic's pages, used to seed recommendations.
  const computeTags = () => {
    const counts = {};
    pages.forEach((p) => (p.tags || []).forEach((tg) => { counts[tg] = (counts[tg] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map((e) => e[0]);
  };

  const handleLike = () => {
    if (!pool) return;
    if (liked) { removeLike(pool.id); setLiked(false); return; }
    const cover = pages[0] && (pages[0].preview_url || pages[0].sample_url || pages[0].file_url);
    addLike(pool.id, { name: pool.name, creator_id: pool.creator_id, creator_name: author, tags: computeTags(), cover_url: cover });
    setLiked(true);
  };

  const handleFollow = () => {
    if (!pool?.creator_id) return;
    toggleFollow(pool.creator_id, pool.creator_name || author);
    setFollowing(isFollowing(pool.creator_id));
  };

  // Auto-refresh: keep pages ordered and pull new pages automatically
  useEffect(() => {
    if (downloaded) return;
    const t = setInterval(() => fetchComic(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchComic, downloaded]);

  // Clamp index when pages change
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(pages.length - 1, 0)));
  }, [pages.length]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = pages[index];
  const title = (pool?.name || t("comic")).replace(/_/g, " ");
  const artist = current?.artist?.length
    ? current.artist.map((a) => a.replace(/_/g, " ")).join(", ")
    : null;

  const go = (i) => {
    if (i < 0 || i >= pages.length) return;
    setIndex(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const prev = () => go(index - 1);
  const next = () => go(index + 1);

  const candidates = current ? [current.sample_url, current.file_url, current.preview_url].filter(Boolean) : [];
  const imgSrc = candidates[imgIdx];

  useEffect(() => {
    setImgIdx(0);
  }, [index]);

  useEffect(() => {
    if (imgSrc) setImgLoading(true);
  }, [imgSrc]);

  // Preload adjacent pages for instant navigation
  useEffect(() => {
    const preload = (p) => {
      if (!p) return;
      const src = p.sample_url || p.file_url || p.preview_url;
      if (src) { const i = new Image(); i.src = src; }
    };
    preload(pages[index + 1]);
    preload(pages[index - 1]);
  }, [index, pages]);

  return (
    <div className="flex min-h-[100dvh] flex-col text-zinc-100">
      <AppBackground />
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 backdrop-blur-xl safe-pt">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="rounded-full p-2 text-zinc-300 transition hover:bg-white/10"
              aria-label="Dejar de leer"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold">{title}</h1>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
                {t("pages_info", { count: pages.length, cur: index + 1, total: pages.length })}
                {lastUpdate && ` · ${lastUpdate.toLocaleTimeString()}`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={handleLike}
                disabled={!pool}
                className={`rounded-full p-2 transition hover:bg-white/10 ${liked ? "text-rose-400" : "text-zinc-300"}`}
                aria-label={liked ? t("liked") : t("like")}
              >
                <Heart className={`h-5 w-5 ${liked ? "fill-rose-400" : ""}`} />
              </button>
              {pool?.creator_id && (
                <button
                  onClick={handleFollow}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition ${following ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}`}
                >
                  {following ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {following ? t("following") : t("follow")}
                </button>
              )}
            </div>
          </div>
          {/* Creator info */}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400">
            <User className="h-3.5 w-3.5" />
            <span>{t("published_by")} <span className="text-zinc-200">{author || "…"}</span></span>
            {pool?.creator_id && (
              <Link
                to={`/creator/${pool.creator_id}`}
                className="ml-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-emerald-300 transition hover:bg-zinc-700"
              >
                {t("see_more")}
              </Link>
            )}
            {artist && (
              <span className="truncate">
                <span className="mx-1 text-zinc-600">·</span>{t("artist")}: <span className="text-zinc-200">{artist}</span>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Page viewer */}
      <main className="relative flex flex-1 items-center justify-center px-2 pb-20 pt-4">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-32 text-zinc-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">{t("loading_e621")}</span>
          </div>
        ) : error ? (
          <div className="mx-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : pages.length === 0 ? (
          <div className="py-32 text-center text-sm text-zinc-500">
            {safe ? t("no_safe_pages") : t("no_pages")}
          </div>
        ) : (
          <div className="relative flex w-full max-w-2xl items-center justify-center">
            {imgLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              </div>
            )}
            {imgSrc ? (
              <img
                key={current.id}
                src={imgSrc}
                alt={`Página ${index + 1}`}
                onLoad={() => setImgLoading(false)}
                onError={() => setImgIdx((i) => i + 1)}
                className="max-h-[calc(100dvh-200px)] w-auto max-w-full rounded-lg object-contain"
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-zinc-600">
                <AlertCircle className="h-6 w-6" />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom controls */}
      {!loading && !error && pages.length > 0 && (
        <footer className="sticky bottom-0 z-20 border-t border-white/10 bg-black/85 backdrop-blur-xl safe-pb">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
            <button
              onClick={prev}
              disabled={index === 0}
              className="flex items-center gap-1 rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition enabled:hover:bg-zinc-700 disabled:opacity-40"
            >
              {prevBtn?.icon ? (
                <img src={prevBtn.icon} alt="" style={{ width: prevBtn.size, height: prevBtn.size }} className="object-contain" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              {t("previous")}
            </button>
            <PageNavigator total={pages.length} current={index} onJump={go} />
            <button
              onClick={next}
              disabled={index >= pages.length - 1}
              className="flex items-center gap-1 rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition enabled:hover:bg-zinc-700 disabled:opacity-40"
            >
              {t("next")}
              {nextBtn?.icon ? (
                <img src={nextBtn.icon} alt="" style={{ width: nextBtn.size, height: nextBtn.size }} className="object-contain" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>

        </footer>
      )}
    </div>
  );
}
