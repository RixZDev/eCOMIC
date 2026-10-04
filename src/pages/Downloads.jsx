import React, { useCallback, useEffect, useRef, useState } from "react";
import { getDownloads, getDownloadedCoverUrl } from "@/lib/storage";
import ComicCard from "@/components/ComicCard";
import AppBackground from "@/components/AppBackground";
import { useI18n } from "@/hooks/useI18n";

export default function Downloads() {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const coversRef = useRef([]);

  // Load the download index and resolve each comic's cover from local storage
  // (IndexedDB blobs) so covers render offline instead of hitting the e621 CDN.
  const load = useCallback(async () => {
    const dls = getDownloads();
    const created = [];
    const resolved = await Promise.all(
      dls.map(async (c) => {
        const url = await getDownloadedCoverUrl(c);
        if (url) created.push(url);
        return { ...c, cover_url: url || c.cover_url };
      })
    );
    coversRef.current.forEach((u) => URL.revokeObjectURL(u));
    coversRef.current = created;
    setItems(resolved);
  }, []);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("e621-library-change", h);
    return () => {
      window.removeEventListener("e621-library-change", h);
      coversRef.current.forEach((u) => URL.revokeObjectURL(u));
      coversRef.current = [];
    };
  }, [load]);

  return (
    <div className="relative min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <AppBackground />
      <div className="relative z-10">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl safe-pt">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <h1 className="text-xl font-bold tracking-tight">{t("downloads")}</h1>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-5 pb-24">
          {items.length === 0 ? (
            <div className="py-20 text-center text-sm text-zinc-500">{t("no_downloads")}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((c) => (
                <ComicCard key={c.id} pool={c} coverUrl={c.cover_url} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
