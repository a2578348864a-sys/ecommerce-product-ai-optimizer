"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  GitBranch,
  Layers,
  Sparkles,
  UserCheck,
  CheckCircle2,
  XCircle,
  Lock,
  ArrowRight,
  Database,
  FileText,
  AlertTriangle,
  Maximize2,
  X,
} from "lucide-react";
import type { ShowcaseSlideItem } from "@/content/showcase";
import { Magnet } from "./Magnet";

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

// 为 5 张幻灯片提供专属高精度白瓷轻质感产品蓝图设计（用户视角、纯正中文、高阶专业）
function SlideBlueprint({ slideId }: { slideId: string }) {
  switch (slideId) {
    case "problem":
      return (
        <div className="flex size-full flex-col justify-center rounded-xl bg-white/90 p-4 sm:p-6 shadow-xs border border-slate-200/80 backdrop-blur-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-grass-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-800">核心边界 · 传统通用 AI vs 轻选事实治理</span>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
              防幻觉治理红线
            </span>
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 拦截侧 */}
            <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-rose-700 font-bold text-xs">
                  <XCircle className="size-4 shrink-0 text-rose-500" />
                  <span>通用大模型推测（直接拦截）</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-[11px] text-slate-600">
                  <li className="flex items-start gap-1">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>生搬硬套竞品卖点，极易造成侵权与违规</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>凭空捏造产品技术参数（严重虚假宣传）</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>缺乏供应链出厂底价，选品毛利测算失真</span>
                  </li>
                </ul>
              </div>
              <div className="mt-3 rounded-lg bg-rose-100/80 px-2 py-1 text-[11px] font-bold text-rose-700 text-center">
                门禁判决：无事实依据 · 坚决拦截
              </div>
            </div>

            {/* 治理放行侧 */}
            <div className="rounded-xl border border-grass-300/90 bg-grass-50/50 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-grass-800 font-bold text-xs">
                  <CheckCircle2 className="size-4 shrink-0 text-grass-600" />
                  <span>轻选 Evidence 证据治理（放行）</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-[11px] text-slate-700">
                  <li className="flex items-start gap-1">
                    <span className="text-grass-600 font-bold">•</span>
                    <span>1688 工厂货源出厂真实规格与毛利核验</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-grass-600 font-bold">•</span>
                    <span>Amazon 真实买家原声 (VOC) 负评痛点归纳</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-grass-600 font-bold">•</span>
                    <span>保留完整资料出处与证据链，杜绝凭空编造</span>
                  </li>
                </ul>
              </div>
              <div className="mt-3 rounded-lg bg-grass-200/80 px-2 py-1 text-[11px] font-bold text-grass-800 text-center">
                门禁判决：多源事实证据就绪 · 准予放行
              </div>
            </div>
          </div>
        </div>
      );

    case "workflow":
      return (
        <div className="flex size-full flex-col justify-center rounded-xl bg-white/90 p-4 sm:p-6 shadow-xs border border-slate-200/80 backdrop-blur-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-grass-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-800">全流程主链 · 四阶确定性状态流</span>
            </div>
            <span className="rounded-full bg-grass-50 border border-grass-200 px-2.5 py-0.5 text-[10px] font-bold text-grass-700">
              全流程无缝闭环
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-center transition-all hover:bg-grass-50/30">
              <div className="text-[11px] font-bold text-slate-400">第一阶段</div>
              <div className="mt-1 text-xs font-bold text-slate-800">多源资料调研</div>
              <div className="mt-1 text-[11px] text-slate-500">1688 / 竞品 / 买家原声</div>
            </div>
            <div className="rounded-xl border border-grass-200 bg-grass-50/50 p-3 text-center">
              <div className="text-[11px] font-bold text-grass-700">第二阶段</div>
              <div className="mt-1 text-xs font-bold text-grass-900">证据清洗治理</div>
              <div className="mt-1 text-[11px] text-grass-700">交叉比对与溯源标注</div>
            </div>
            <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-center shadow-xs">
              <div className="text-[11px] font-bold text-amber-800">第三阶段</div>
              <div className="mt-1 text-xs font-bold text-amber-950">人工事实核准</div>
              <div className="mt-1 text-[11px] font-semibold text-amber-800">运营确认 · 核心防错</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-center transition-all hover:bg-grass-50/30">
              <div className="text-[11px] font-bold text-slate-400">第四阶段</div>
              <div className="mt-1 text-xs font-bold text-slate-800">受控成稿输出</div>
              <div className="mt-1 text-[11px] text-slate-500">文案 / 图片工作台</div>
            </div>
          </div>
        </div>
      );

    case "sources":
      return (
        <div className="flex size-full flex-col justify-center rounded-xl bg-white/90 p-4 sm:p-6 shadow-xs border border-slate-200/80 backdrop-blur-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-grass-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-800">多源交叉核验 · 拒绝单一数据孤料</span>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
              5 路独立数据源驱动
            </span>
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 hover:border-grass-300 transition-colors">
              <div className="text-xs font-bold text-grass-700">标杆竞品与行业大盘</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                类目核心出单词频、标杆竞品上架参数、真实排位表现与卖点拆解。
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 hover:border-grass-300 transition-colors">
              <div className="text-xs font-bold text-grass-700">真实买家原声 (VOC)</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                深度提炼 1~3 星真实差评痛点，归纳产品缺陷与关键改良机会。
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 hover:border-grass-300 transition-colors">
              <div className="text-xs font-bold text-grass-700">1688 货源与毛利模型</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                工厂真实出厂价格、外箱体积包装与跨境头程关税实时毛利算账。
              </div>
            </div>
          </div>
        </div>
      );

    case "facts":
      return (
        <div className="flex size-full flex-col justify-center rounded-xl bg-white/90 p-4 sm:p-6 shadow-xs border border-slate-200/80 backdrop-blur-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-800">事实隔离层 · 证据 (Evidence) ≠ 事实 (Fact)</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              <Lock className="size-3 text-amber-600" />
              <span>严苛防错门禁</span>
            </div>
          </div>
          <div className="mt-3.5 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="w-full rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 sm:w-5/12">
              <div className="text-xs font-bold text-slate-800">外部证据包 (Evidence)</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                多源采集只是候选参考，混杂着竞品营销夸大与买家主观情绪，严禁直接作为本品事实。
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-1 text-grass-600">
              <ArrowRight className="size-5 rotate-90 sm:rotate-0" />
              <span className="text-[10px] font-bold bg-grass-50 px-2 py-0.5 rounded-full border border-grass-200">人工确认放行</span>
            </div>
            <div className="w-full rounded-xl border border-grass-300 bg-grass-50/60 p-3.5 sm:w-5/12">
              <div className="text-xs font-bold text-grass-900">权威事实库 (Confirmed Facts)</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-700">
                经运营人员严格逐条复核确认，作为后续 Listing 与图片创作的唯一可信事实来源。
              </p>
            </div>
          </div>
        </div>
      );

    case "review":
      return (
        <div className="flex size-full flex-col justify-center rounded-xl bg-white/90 p-4 sm:p-6 shadow-xs border border-slate-200/80 backdrop-blur-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-grass-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-800">受控成稿 · Listing 与生图工作台</span>
            </div>
            <span className="rounded-full bg-grass-50 border border-grass-200 px-2.5 py-0.5 text-[10px] font-bold text-grass-700">
              人在回路 · 运营把关
            </span>
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 hover:border-grass-300 transition-colors">
              <div className="text-xs font-bold text-slate-900">Listing 文案创作工作台</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                五点描述严格比对已确认事实清单，自动阻断夸大词、绝对化违规词与虚假卖点。
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 hover:border-grass-300 transition-colors">
              <div className="text-xs font-bold text-slate-900">Image 生图受控工作台</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                基于确证商品材质与构图参数受控注入，杜绝主体形变与结构性漂移。
              </p>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

// 3D 物理悬浮微倾斜视窗容器（纯 CSS 3D 计算，GPU 硬件加速，桌面端灵动 3D 拟物感，移动端原生轻滑）
function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("");
  const [isHovered, setIsHovered] = useState(false);
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || typeof window === "undefined" || window.innerWidth < 768) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    // 灵动肉眼可见的 3D 物理空间倾角（±6.0deg），配合微升浮与白瓷玻璃高光反光
    const rotateX = ((y - centerY) / centerY) * -6.0;
    const rotateY = ((x - centerX) / centerX) * 6.0;

    setIsHovered(true);
    setTransform(`perspective(950px) scale3d(1.012, 1.012, 1.012) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`);
    setGlarePos({
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
      opacity: 0.35,
    });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    // 鼠标移出时恢复完全原生 2D 亚像素高清渲染
    setTransform("");
    setGlarePos((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: transform || undefined,
        transition: isHovered ? "transform 0.12s ease-out" : "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)",
        willChange: isHovered ? "transform" : "auto",
        transformStyle: "preserve-3d",
      }}
      className={`relative ${className}`}
    >
      {/* 表面柔和高光玻璃折射反光 (Glass Glare & Specular Reflection) */}
      <div
        className="pointer-events-none absolute inset-0 z-30 rounded-2xl transition-opacity duration-300 hidden md:block"
        style={{
          opacity: glarePos.opacity,
          background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255, 255, 255, 0.75) 0%, rgba(44, 201, 107, 0.18) 35%, transparent 65%)`,
        }}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

export function ShowcaseSlider({ slides }: ShowcaseSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const handleGalleryPrev = useCallback(() => {
    setPreviewIndex((curr) => (curr !== null ? Math.max(0, curr - 1) : null));
  }, []);

  const handleGalleryNext = useCallback(() => {
    setPreviewIndex((curr) =>
      curr !== null ? Math.min(slides.length - 1, curr + 1) : null
    );
  }, [slides.length]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const touchEndX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const deltaX = touchEndX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (deltaX > 45) {
      handleGalleryPrev();
    } else if (deltaX < -45) {
      handleGalleryNext();
    }
  };

  // 监听键盘 ESC/ArrowLeft/ArrowRight 键控制连续画廊
  useEffect(() => {
    if (previewIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewIndex(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleGalleryPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleGalleryNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = origOverflow;
    };
  }, [previewIndex, handleGalleryPrev, handleGalleryNext]);

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
      className="scroll-mt-16 w-full bg-slate-50/50 py-12 sm:py-20 border-y border-slate-200/60"
      aria-labelledby="slider-heading"
    >
      <div className="mx-auto max-w-5xl px-2.5 sm:px-6 lg:px-8">
        {/* 顶部标题与左右切换按钮 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-grass-200 bg-grass-50 px-3 py-1 text-xs font-semibold tracking-wide text-grass-700 shadow-xs">
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>核心产品亮点</span>
            </div>
            <h2
              id="slider-heading"
              className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-4xl"
            >
              五大核心亮点一览
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
              点击图片两边的大箭头翻看大图，看懂我们如何帮您查资料、防瞎编、出好图好文案。
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-xs font-bold tabular-nums text-slate-600 shadow-xs">
              <span className="text-grass-700 font-extrabold">{activeIndex + 1}</span> / {slides.length}
            </span>
          </div>
        </div>

        {/* 顶部快捷导航芯片栏 */}
        <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {slides.map((slide, idx) => {
            const isCurrent = idx === activeIndex;
            return (
              <button
                key={slide.id}
                type="button"
                onClick={() => scrollToSlide(idx)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  isCurrent
                    ? "bg-grass-600 text-white shadow-grass-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-grass-200 hover:bg-grass-50/50"
                }`}
              >
                {slide.eyebrow}
              </button>
            );
          })}
        </div>

        {/* 轮播滑动容器（左右两侧悬浮切换长方形大按键） */}
        <div className="relative mt-6 group/slider">
          {/* 左切换长方形大按键（Magnet 磁力咬合吸附） */}
          <div className="absolute -left-2 sm:-left-5 lg:-left-7 xl:-left-9 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <Magnet padding={80} magnetStrength={3.0} className="pointer-events-auto">
              <button
                type="button"
                onClick={handlePrev}
                disabled={activeIndex === 0}
                aria-label="查看上一张大图"
                className="group/btn flex w-10 sm:w-14 h-24 sm:h-36 items-center justify-center rounded-2xl border-2 border-slate-200/90 bg-white/95 text-slate-700 shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-grass-400 hover:bg-grass-50/90 hover:text-grass-800 hover:shadow-grass-glow disabled:opacity-0 disabled:pointer-events-none active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-500"
              >
                <ChevronLeft className="size-7 sm:size-9 transition-transform duration-200 group-hover/btn:-translate-x-1 stroke-[2.5]" aria-hidden="true" />
              </button>
            </Magnet>
          </div>

          {/* 右切换长方形大按键（Magnet 磁力咬合吸附） */}
          <div className="absolute -right-2 sm:-right-5 lg:-right-7 xl:-right-9 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <Magnet padding={80} magnetStrength={3.0} className="pointer-events-auto">
              <button
                type="button"
                onClick={handleNext}
                disabled={activeIndex === slides.length - 1}
                aria-label="查看下一张大图"
                className="group/btn flex w-10 sm:w-14 h-24 sm:h-36 items-center justify-center rounded-2xl border-2 border-slate-200/90 bg-white/95 text-slate-700 shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-grass-400 hover:bg-grass-50/90 hover:text-grass-800 hover:shadow-grass-glow disabled:opacity-0 disabled:pointer-events-none active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-500"
              >
                <ChevronRight className="size-7 sm:size-9 transition-transform duration-200 group-hover/btn:translate-x-1 stroke-[2.5]" aria-hidden="true" />
              </button>
            </Magnet>
          </div>

          <div
            ref={scrollRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth pb-4 outline-none focus-visible:ring-2 focus-visible:ring-grass-500 focus-visible:ring-offset-4 rounded-2xl no-scrollbar"
            role="region"
            aria-roledescription="carousel"
            aria-label="项目五张核心亮点幻灯片，可通过左右箭头或滑动切换"
            style={{ scrollbarWidth: "none" }}
          >
          {slides.map((slide, index) => {
            const hasImage = Boolean(slide.image);

            return (
              <div
                key={slide.id}
                className="w-full shrink-0 snap-start px-0 sm:px-0.5"
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${slides.length}: ${slide.title}`}
              >
                <TiltCard className="group">
                  <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-soft transition-all duration-300 group-hover:border-grass-400 group-hover:shadow-grass-sm">
                    {/* 文案区：手机端紧凑高质感，压缩垂直高度以优先突出高清大图 */}
                    <div className="px-3.5 pt-3 pb-2 sm:p-8">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-grass-700 sm:text-xs">
                          {slide.eyebrow}
                        </span>
                        <span className="rounded-md bg-grass-50 px-2 py-0.5 font-mono text-[10px] font-bold text-grass-700 border border-grass-200 sm:text-[11px]">
                          0{index + 1}
                        </span>
                      </div>

                      <h3 className="mt-1 text-base font-extrabold tracking-tight text-slate-900 sm:mt-3 sm:text-2xl">
                        {slide.title}
                      </h3>

                      <p className="mt-1 text-xs leading-relaxed text-slate-600 sm:mt-2.5 sm:text-base">
                        {slide.description}
                      </p>
                    </div>

                    {/* 媒体展示区：白瓷极简浏览器视窗外壳（拟物化） */}
                    <div className="group relative w-full border-t border-slate-200/80 bg-gradient-to-b from-slate-50/70 via-grass-50/10 to-slate-100/50 p-0 sm:p-4 md:px-7 overflow-hidden">
                      {hasImage ? (
                        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-soft transition-all duration-200 group-hover:border-grass-300">
                          {/* 白瓷极简浏览器视窗标题栏 */}
                          <div className="flex h-8 sm:h-9 items-center justify-between border-b border-slate-200/80 bg-slate-100/80 px-3 backdrop-blur-xs">
                            {/* 左侧：微缩白瓷科技三圆点 */}
                            <div className="flex items-center gap-1.5" aria-hidden="true">
                              <span className="size-2 sm:size-2.5 rounded-full bg-rose-400/80 border border-rose-500/20" />
                              <span className="size-2 sm:size-2.5 rounded-full bg-amber-400/80 border border-amber-500/20" />
                              <span className="size-2 sm:size-2.5 rounded-full bg-emerald-400/80 border border-emerald-500/20" />
                            </div>

                            {/* 中间：微型半透明地址胶囊 */}
                            <div className="flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-white/90 px-2.5 py-0.5 text-[10px] sm:text-[11px] font-mono text-slate-600 shadow-2xs">
                              <Lock className="size-2.5 sm:size-3 text-grass-600 shrink-0" aria-hidden="true" />
                              <span className="truncate max-w-[180px] sm:max-w-[320px]">
                                app.qingxuan.io / {slide.eyebrow}
                              </span>
                            </div>

                            {/* 右侧：微型绿光受控标记 */}
                            <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-semibold text-grass-800">
                              <span className="size-1.5 rounded-full bg-grass-500 animate-pulse" aria-hidden="true" />
                              <span className="hidden sm:inline">事实受控模式</span>
                            </div>
                          </div>

                          {/* 浏览器主体视窗图片 */}
                          <div
                            className="relative aspect-[16/9] w-full cursor-zoom-in bg-slate-950/5"
                            onClick={() => setPreviewIndex(index)}
                            role="button"
                            tabIndex={0}
                            aria-label={`点击放大查看第 ${index + 1} 张高清大图`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setPreviewIndex(index);
                              }
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={slide.image as string}
                              alt={slide.alt}
                              className="size-full object-contain select-none"
                              style={{ imageRendering: "-webkit-optimize-contrast" }}
                              loading={index === 0 ? "eager" : "lazy"}
                            />
                            {/* 点击放大微提示 */}
                            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-slate-900/75 px-2 py-0.5 text-[10px] font-medium text-white shadow-xs backdrop-blur-xs transition-opacity hover:bg-slate-900 sm:bottom-3 sm:right-3 sm:text-xs sm:px-2.5 sm:py-1">
                              <Maximize2 className="size-3 text-grass-400" />
                              <span>点击放大</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* 高精度白瓷产品蓝图 Blueprint 渲染 */
                        <div className="relative size-full p-2 sm:p-0">
                          <SlideBlueprint slideId={slide.id} />
                          <div className="absolute bottom-2 right-3 font-sans text-[10px] text-slate-500 bg-white/95 px-2.5 py-0.5 rounded-md border border-slate-200 shadow-xs backdrop-blur-xs">
                            插槽就绪：{slide.futureImagePath}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </TiltCard>
              </div>
            );
          })}
          </div>
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
                className={`h-2 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-500 focus-visible:ring-offset-2 ${
                  isActive
                    ? "w-8 bg-grass-600 shadow-grass-sm"
                    : "w-2 bg-slate-300 hover:bg-slate-400"
                }`}
                aria-label={`跳转到第 ${index + 1} 张：${slide.title}`}
              />
            );
          })}
        </div>
      </div>

      {/* 全屏连续沉浸式画廊 Lightbox */}
      {previewIndex !== null && slides[previewIndex] && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-slate-950/95 p-3 sm:p-6 backdrop-blur-md transition-all select-none"
          onClick={() => setPreviewIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          role="dialog"
          aria-modal="true"
          aria-label="查看高清设计大图连续画廊"
        >
          {/* 画廊顶部工具栏 */}
          <div
            className="flex w-full max-w-6xl items-center justify-between py-1 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-mono font-bold text-grass-400 backdrop-blur-md">
                {previewIndex + 1} / {slides.length}
              </span>
              <span className="text-xs sm:text-sm font-semibold text-slate-200 truncate max-w-[200px] sm:max-w-md">
                {slides[previewIndex].eyebrow} · {slides[previewIndex].title}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setPreviewIndex(null)}
              className="flex size-9 sm:size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-all hover:bg-white/25 active:scale-95 focus-visible:outline-none"
              aria-label="关闭预览"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* 画廊核心大图与左右翻页箭头 */}
          <div
            className="relative flex flex-1 w-full max-w-6xl items-center justify-center overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 左翻页长方形大按键 */}
            <button
              type="button"
              onClick={handleGalleryPrev}
              disabled={previewIndex === 0}
              className="absolute left-2 sm:left-6 z-20 flex w-10 sm:w-14 h-24 sm:h-36 items-center justify-center rounded-2xl bg-slate-900/80 text-white shadow-2xl backdrop-blur-md transition-all hover:bg-slate-800 hover:border-grass-400 hover:scale-105 disabled:opacity-20 disabled:pointer-events-none active:scale-95 border-2 border-white/20"
              aria-label="查看上一张图片 (亦可按键盘左方向键)"
            >
              <ChevronLeft className="size-7 sm:size-9 stroke-[2.5]" />
            </button>

            {/* 当前高清大图 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={slides[previewIndex].id}
              src={slides[previewIndex].image as string}
              alt={slides[previewIndex].alt}
              className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain shadow-2xl transition-all duration-200 select-none animate-in fade-in zoom-in-95"
              style={{ imageRendering: "-webkit-optimize-contrast" }}
            />

            {/* 右翻页长方形大按键 */}
            <button
              type="button"
              onClick={handleGalleryNext}
              disabled={previewIndex === slides.length - 1}
              className="absolute right-2 sm:right-6 z-20 flex w-10 sm:w-14 h-24 sm:h-36 items-center justify-center rounded-2xl bg-slate-900/80 text-white shadow-2xl backdrop-blur-md transition-all hover:bg-slate-800 hover:border-grass-400 hover:scale-105 disabled:opacity-20 disabled:pointer-events-none active:scale-95 border-2 border-white/20"
              aria-label="查看下一张图片 (亦可按键盘右方向键)"
            >
              <ChevronRight className="size-7 sm:size-9 stroke-[2.5]" />
            </button>
          </div>

          {/* 底部缩略圆点指示条与提示 */}
          <div
            className="flex flex-col items-center gap-2 pb-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPreviewIndex(idx)}
                  className={`h-2 rounded-full transition-all duration-200 ${
                    idx === previewIndex
                      ? "w-6 bg-grass-400"
                      : "w-2 bg-white/40 hover:bg-white/70"
                  }`}
                  aria-label={`画廊跳转到第 ${idx + 1} 张`}
                />
              ))}
            </div>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              支持键盘左右方向键 ← / → 快速翻页，ESC 键退出
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

