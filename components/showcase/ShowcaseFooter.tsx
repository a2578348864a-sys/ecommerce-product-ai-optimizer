"use client";

import { ExternalLink } from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";

interface ShowcaseFooterProps {
  footer: ShowcaseContent["footer"];
}

export function ShowcaseFooter({ footer }: ShowcaseFooterProps) {
  return (
    <footer className="w-full border-t border-slate-200/80 bg-white py-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 px-4 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
        <div>
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <div className="flex size-6 items-center justify-center rounded-md bg-teal-600 text-white">
              <span className="text-[10px] font-bold">QX</span>
            </div>
            <span className="text-sm font-bold text-slate-900">{footer.title}</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 max-w-md">
            {footer.description}
          </p>
        </div>

        <div>
          <a
            href={footer.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            aria-label="查看 GitHub 仓库源代码与文档（在新标签页打开）"
          >
            <span>查看 GitHub 仓库</span>
            <ExternalLink className="size-3.5 opacity-70" aria-hidden="true" />
          </a>
        </div>
      </div>
    </footer>
  );
}
