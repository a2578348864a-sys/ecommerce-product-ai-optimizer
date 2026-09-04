"use client";

import { ExternalLink, Play } from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";

interface ShowcaseHeroProps {
  content: ShowcaseContent["hero"];
}

export function ShowcaseHero({ content }: ShowcaseHeroProps) {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header className="relative w-full border-b border-slate-200/80 bg-white/70 backdrop-blur-md">
      {/* 顶部极简栏 */}
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
            <span className="text-xs font-bold tracking-tight">QX</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-900">
            {content.title}
          </span>
          <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-block">
            Project Showcase
          </span>
        </div>
        <a
          href={content.githubLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          aria-label="访问项目 GitHub 仓库（在新标签页打开）"
        >
          {content.githubLink.text}
          <ExternalLink className="size-3.5 opacity-70" aria-hidden="true" />
        </a>
      </div>

      {/* 首屏主体 */}
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50/80 px-3 py-1 text-xs font-medium text-teal-800 shadow-sm">
            <span className="size-1.5 rounded-full bg-teal-500" aria-hidden="true" />
            <span>{content.badge}</span>
          </div>

          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-5xl sm:leading-tight">
            {content.title}
          </h1>

          <p className="mt-2 text-base font-semibold tracking-wide text-teal-700 sm:text-xl">
            {content.subtitle}
          </p>

          <p className="mt-6 text-sm leading-relaxed text-slate-600 sm:text-base sm:leading-8">
            {content.description}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <button
              type="button"
              onClick={() => scrollTo(content.primaryCta.targetId)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-700 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 sm:w-auto"
              aria-label="观看真实项目演示视频"
            >
              <Play className="size-4 fill-current" aria-hidden="true" />
              <span>{content.primaryCta.text}</span>
            </button>

            <button
              type="button"
              onClick={() => scrollTo(content.secondaryCta.targetId)}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 sm:w-auto"
              aria-label="查看五张核心项目亮点"
            >
              <span>{content.secondaryCta.text}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
