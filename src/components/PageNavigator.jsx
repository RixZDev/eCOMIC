import React, { useState } from "react";
import { Grid3x3, X } from "lucide-react";
import Portal from "@/components/Portal";
import { useI18n } from "@/hooks/useI18n";

// A compact "current / total" button that opens a grid picker to jump to any
// page of the comic. Shown in the reader footer between prev/next.
export default function PageNavigator({ total, current, onJump }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  if (total <= 1) {
    return <span className="text-xs text-zinc-400">{current + 1} / {total}</span>;
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700"
      >
        <Grid3x3 className="h-3.5 w-3.5" />
        {current + 1} / {total}
      </button>
      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">{t("go_to_page")}</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                  aria-label={t("cancel")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid max-h-[60vh] grid-cols-5 gap-2 overflow-y-auto">
                {Array.from({ length: total }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      onJump(i);
                      setOpen(false);
                    }}
                    className={`aspect-square rounded-lg text-sm font-medium transition ${
                      i === current
                        ? "bg-emerald-500 text-zinc-950"
                        : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
