"use client";

import { useState, useEffect } from "react";
import {
  ExternalLink,
  Play,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";
import { HeroParticles } from "./HeroParticles";
import { ShinyText } from "./ShinyText";
import { DecryptedText } from "./DecryptedText";

interface ShowcaseHeroProps {
  content: ShowcaseContent["hero"];
}

export function ShowcaseHero({ content }: ShowcaseHeroProps) {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });
  const [isHovered, setIsHovered] = useState(false);

  // 监听整页滚动进度
  useEffect(() => {
    const handleScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total > 0) {
        setScrollProgress(Math.min(100, Math.max(0, (window.scrollY / total) * 100)));
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative w-full overflow-hidden border-b border-slate-200/70 bg-gradient-to-b from-white via-grass-50/15 to-white"
    >
      {/* 青草绿量子光尘 Canvas 2D 粒子系统（微引力微动效 + 视口休眠） */}
      <HeroParticles />

      {/* 科技微点阵背景 (Subtle Matrix Grid) */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#16a34a_1px,transparent_1px)] [background-size:24px_24px] opacity-15"
        aria-hidden="true"
      />

      {/* 顶部呼吸极光光斑 (Aurora Glow) */}
      <div
        className="pointer-events-none absolute -top-28 left-1/4 -translate-x-1/2 size-[28rem] rounded-full bg-grass-300/30 blur-3xl animate-aurora-breath"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-1/3 -right-20 size-80 rounded-full bg-emerald-200/25 blur-3xl animate-aurora-breath [animation-delay:2.5s]"
        aria-hidden="true"
      />

      {/* 桌面端鼠标微光聚光灯 (Cursor Spotlight) */}
      {isHovered && (
        <div
          className="pointer-events-none absolute -inset-px transition-opacity duration-200 hidden md:block"
          style={{
            background: `radial-gradient(420px circle at ${mousePos.x}px ${mousePos.y}px, rgba(34, 197, 94, 0.12), transparent 75%)`,
          }}
          aria-hidden="true"
        />
      )}

      {/* 顶部全局阅读发光微进度条 */}
      <div
        className="fixed top-0 left-0 z-50 h-[3px] bg-gradient-to-r from-grass-500 via-emerald-400 to-grass-600 shadow-grass-sm transition-all duration-150"
        style={{ width: `${scrollProgress}%` }}
        aria-hidden="true"
      />


      {/* 顶部吸顶微玻璃导航条 */}
      <div className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-grass-600 text-white shadow-grass-sm">
              <span className="font-mono text-xs font-black tracking-tight">QX</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                {content.title}
              </span>
              <span className="hidden rounded-full border border-grass-200/80 bg-grass-50/80 px-2.5 py-0.5 text-[11px] font-medium text-grass-800 sm:inline-block">
                电商实操展示
              </span>
            </div>
          </div>

          {/* 桌面端快捷锚点导航 */}
          <nav className="hidden items-center gap-6 text-xs font-semibold text-slate-600 md:flex">
            <button
              type="button"
              onClick={() => scrollTo("demo-video")}
              className="transition-colors hover:text-grass-700"
            >
              实操演示
            </button>
            <button
              type="button"
              onClick={() => scrollTo("project-slides")}
              className="transition-colors hover:text-grass-700"
            >
              核心功能大图
            </button>
            <button
              type="button"
              onClick={() => scrollTo("workflow-heading")}
              className="transition-colors hover:text-grass-700"
            >
              使用流程
            </button>
            <button
              type="button"
              onClick={() => scrollTo("work-heading")}
              className="transition-colors hover:text-grass-700"
            >
              开发沉淀
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1 text-xs text-slate-600 lg:inline-flex">
              <span className="size-2 rounded-full bg-grass-500 animate-pulse" aria-hidden="true" />
              <span className="font-medium">交付基线</span>
            </div>
            <a
              href={content.githubLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-950/80 bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-slate-800 hover:shadow-lg hover:ring-2 hover:ring-grass-400/40 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-500 focus-visible:ring-offset-2"
              aria-label="访问项目 GitHub 仓库（在新标签页打开）"
            >
              <svg className="size-4 fill-current text-white shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span>GitHub 源码</span>
              <ExternalLink className="size-3 text-slate-400" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      {/* 首屏主体：极简大气居中单栏排版（纯净呼吸感，彻底移除右侧卡片） */}
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 text-center">
        {/* 灵动微光小标签 */}
        <div className="inline-flex items-center gap-2 rounded-full border border-grass-200/80 bg-white/95 px-4 py-1.5 text-xs font-medium text-grass-800 shadow-xs backdrop-blur-xs">
          <span className="relative flex size-2 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-grass-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-grass-600" />
          </span>
          <span>专为跨境卖家打造 · 智能商品研究与创作</span>
        </div>

        {/* 大标题 */}
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-6xl lg:text-[3.75rem] lg:leading-[1.15]">
          {content.title}
        </h1>

        {/* 中文核心定位：大白话一秒懂（黑客解密还原动效） */}
        <h2 className="mt-4 text-xl font-bold tracking-tight text-grass-700 sm:text-3xl">
          <DecryptedText
            text="让 AI 帮你做电商：查得准、写得真、绝不瞎编"
            speed={40}
            maxIterations={12}
            className="text-grass-700"
            encryptedClassName="text-grass-500 font-mono tracking-wider opacity-90"
          />
        </h2>

        {/* 解决什么问题：通俗接地气 */}
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base sm:leading-8">
          很多卖家用普通 AI 写文案，经常瞎编乱造虚假参数，导致退货或被平台处罚。<br className="hidden sm:inline" />
          轻选工作台先把同行卖点、买家差评吐槽、1688 源头工厂实测数据找齐；你点一下确认真实卖点，AI 再根据真材实料写文案、做图片，彻底杜绝虚假宣传！
        </p>

        {/* 操作按钮组 */}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => scrollTo(content.primaryCta.targetId)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-grass-600 px-7 text-sm font-bold text-white shadow-grass-glow transition-all hover:bg-grass-500 hover:shadow-grass-glow-lg active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-500 focus-visible:ring-offset-2 sm:w-auto"
            aria-label="观看真实项目演示视频"
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
            <ShinyText>
              <span>观看 90 秒完整演示</span>
            </ShinyText>
          </button>

          <button
            type="button"
            onClick={() => scrollTo(content.secondaryCta.targetId)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 shadow-xs transition-all hover:border-grass-300 hover:bg-grass-50/50 hover:text-grass-800 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 sm:w-auto"
            aria-label="查看核心功能大图"
          >
            <span>浏览核心功能大图</span>
          </button>
        </div>

        {/* 3 点朴素保障 */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-2.5 text-xs sm:text-sm font-medium text-slate-600">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-grass-600" aria-hidden="true" />
            <span>杜绝 AI 凭空编造卖点</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-grass-600" aria-hidden="true" />
            <span>4 路真实数据同屏核对</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-grass-600" aria-hidden="true" />
            <span>运营确认后再一键出稿</span>
          </div>
        </div>
      </div>
    </header>
  );
}

