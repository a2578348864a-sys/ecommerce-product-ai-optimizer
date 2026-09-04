"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, ShieldCheck, GitBranch, Layers, Sparkles, UserCheck } from "lucide-react";
import type { ShowcaseSlideItem } from "@/content/showcase";

interface ShowcaseSliderProps {
  slides: ShowcaseSlideItem[];
}

const SLIDE_ICONS: Record<string, React.ElementType> = {
  problem: ShieldCheck,
  workflow: GitBranch,
  sources: Layers,
  facts: Sparkles,
  review: UserCheck,
};

export function ShowcaseSlider({ slides }: ShowcaseSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToSlide = useCallback((index: number) => {
    if (!scrollRef.current) return;
    const children = scrollRef.current.children;
    if (children[index]) {
      const target = children[index] as HTMLElement;
      scrollRef.current.scrollTo({
        left: target.offsetLeft - scrollRef.current.offsetLeft,
        behavior: "smooth",
      });
      setActiveIndex(index);
    }
  }, []);

  const handlePrev = () => {
    const next = Math.max(0, activeIndex - 1);
    scrollToSlide(next);
  };

  const handleNext = () => {
    const next = Math.min(slides.length - 1, activeIndex + 1);
    scrollToSlide(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      handlePrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      handleNext();
    }
  };

  // 监听原生滚动，同步当前活跃卡片索引
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let timeoutId: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const scrollLeft = container.scrollLeft;
        const width = container.clientWidth;
        const newIndex = Math.round(scrollLeft / width);
        if (newIndex >= 0 && newIndex < slides.length && newIndex !== activeIndex) {
          setActiveIndex(newIndex);
        }
      }, 60);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(timeoutId);
    };
  }, [slides.length, activeIndex]);

  return (
    <section
      id="project-slides"
      className="scroll-mt-16 w-full bg-slate-50/60 py-16 sm:py-20 border-y border-slate-200/60"
      aria-labelledby="slider-heading"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* 顶部标题与左右切换按钮 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
              Project Highlights
            </p>
            <h2
              id="slider-heading"
              className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
            >
              五项核心产品亮点
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              左右滑动浏览从问题定位、多源证据治理到人工复核的完整思考。
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeIndex === 0}
              className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              aria-label="查看上一张亮点卡片"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>

            <span className="text-xs font-semibold tabular-nums text-slate-500 px-1">
              {activeIndex + 1} / {slides.length}
            </span>

            <button
              type="button"
              onClick={handleNext}
              disabled={activeIndex === slides.length - 1}
              className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              aria-label="查看下一张亮点卡片"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 轮播滑动容器 */}
        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="mt-8 flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth pb-4 outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-4 rounded-2xl no-scrollbar"
          role="region"
          aria-roledescription="carousel"
          aria-label="项目五张核心亮点幻灯片，可通过左右箭头或滑动切换"
          style={{ scrollbarWidth: "none" }}
        >
          {slides.map((slide, index) => {
            const Icon = SLIDE_ICONS[slide.id] || ImageIcon;
            const hasImage = Boolean(slide.image);

            return (
              <div
                key={slide.id}
                className="w-full shrink-0 snap-start px-0.5"
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${slides.length}: ${slide.title}`}
              >
                <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-soft transition-all duration-200">
                  {/* 文案区 */}
                  <div className="p-6 sm:p-8">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
                        {slide.eyebrow}
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        0{index + 1}
                      </span>
                    </div>

                    <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                      {slide.title}
                    </h3>

                    <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                      {slide.description}
                    </p>
                  </div>

                  {/* 媒体展示区 (16:10 比例) */}
                  <div className="relative aspect-[16/10] w-full border-t border-slate-100 bg-slate-100/70 sm:aspect-[16/9]">
                    {hasImage ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={slide.image as string}
                        alt={slide.alt}
                        className="size-full object-contain"
                        loading={index === 0 ? "eager" : "lazy"}
                      />
                    ) : (
                      /* 高质感占位图形设计（非灰块、非破图、非大红字） */
                      <div
                        className="flex size-full flex-col items-center justify-center p-6 text-center"
                        role="img"
                        aria-label={`插图占位：${slide.title}，视觉素材准备中`}
                      >
                        {/* 几何线框图示 */}
                        <div className="relative flex size-20 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sm sm:size-24">
                          <Icon className="size-9 text-slate-400 sm:size-11" aria-hidden="true" />
                          <div className="absolute -bottom-2 -right-2 flex size-7 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
                            <span className="text-xs font-bold">{index + 1}</span>
                          </div>
                        </div>

                        <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-xs">
                          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                          <span>Visual coming soon</span>
                        </div>

                        <p className="mt-2 text-xs text-slate-600 max-w-sm">
                          预留插槽：{slide.futureImagePath}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部 5 个圆点指示器 */}
        <div
          className="mt-6 flex items-center justify-center gap-2"
          role="tablist"
          aria-label="选择要查看的幻灯片"
        >
          {slides.map((slide, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => scrollToSlide(index)}
                className={`h-2 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${
                  isActive
                    ? "w-8 bg-teal-600"
                    : "w-2 bg-slate-300 hover:bg-slate-400"
                }`}
                aria-label={`跳转到第 ${index + 1} 张：${slide.title}`}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
