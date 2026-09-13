"use client";

import { ArrowUp } from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";

interface ShowcaseFooterProps {
  footer: ShowcaseContent["footer"];
}

export function ShowcaseFooter({ footer }: ShowcaseFooterProps) {
  const scrollToTop = () => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <footer className="w-full border-t border-slate-200/80 bg-white py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 px-4 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
        <div>
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <div className="flex size-6 items-center justify-center rounded-lg bg-grass-600 text-white shadow-grass-sm">
              <span className="font-mono text-[10px] font-bold">QX</span>
            </div>
            <span className="text-sm font-extrabold text-slate-900">{footer.title}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500">
              MIT License
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 max-w-md">
            {footer.description}
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={scrollToTop}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs transition-all hover:border-grass-300 hover:bg-grass-50/50 hover:text-grass-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-500"
            aria-label="返回页面顶部"
          >
            <span>返回顶部</span>
            <ArrowUp className="size-3.5 text-slate-400" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}
