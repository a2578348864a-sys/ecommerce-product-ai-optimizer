"use client";

import { Play, Film, Clock, MonitorPlay, Activity } from "lucide-react";
import type { ShowcaseVideoConfig } from "@/content/showcase";

interface ShowcaseVideoProps {
  video: ShowcaseVideoConfig;
}

export function ShowcaseVideo({ video }: ShowcaseVideoProps) {
  const isReady = Boolean(video.src && video.status === "ready");

  return (
    <section
      id="demo-video"
      className="scroll-mt-16 w-full py-16 sm:py-20 bg-slate-50/40 border-t border-slate-200/60"
      aria-labelledby="video-heading"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-grass-200 bg-grass-50 px-3 py-1 text-xs font-semibold tracking-wide text-grass-700 shadow-xs">
            <MonitorPlay className="size-3.5" aria-hidden="true" />
            <span>核心功能实操演示</span>
          </div>
          <h2
            id="video-heading"
            className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-4xl"
          >
            {video.title}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            {video.subtitle}
          </p>
        </div>

        {/* 影院级悬浮取景容器（带青草绿柔和环境光） */}
        <div className="relative mt-10">
          {/* 背光发散微光 */}
          <div
            className="pointer-events-none absolute -inset-1 rounded-3xl bg-gradient-to-r from-grass-500/15 via-emerald-400/20 to-grass-600/15 opacity-60 blur-xl transition-all"
            aria-hidden="true"
          />

          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
            {/* 专业监视器状态条：中文自然语言与高阶质感 */}
            <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/90 px-4 py-2.5 text-xs text-slate-400 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 font-sans text-[11px] font-bold text-red-400">
                  <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                  实操录屏
                </span>
                <span className="hidden font-sans text-[11px] text-slate-400 sm:inline-block">
                  1080P 高清 · 60帧
                </span>
                <span className="hidden rounded-md bg-slate-800/80 px-2 py-0.5 font-sans text-[10px] text-slate-300 md:inline-block">
                  本地生产级实测
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 font-sans text-[11px] text-grass-400 font-medium">
                  <Activity className="size-3" aria-hidden="true" />
                  全流程演示
                </span>
                <span className="font-sans text-[11px] text-slate-400">
                  时长预估：{video.durationLabel}
                </span>
              </div>
            </div>

            {/* 视频显示区域 */}
            <div className="relative aspect-video w-full">
              {isReady ? (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={video.poster || undefined}
                  className="size-full object-cover"
                  aria-label={video.title}
                >
                  <source src={video.src as string} type="video/mp4" />
                  您的浏览器不支持 HTML5 视频播放。
                </video>
              ) : (
                /* 精密设计的占位状态 */
                <div
                  className="flex size-full flex-col items-center justify-center bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 px-6 text-center"
                  role="region"
                  aria-label="演示视频占位区域"
                >
                  {/* 装饰性科技微网格 */}
                  <div
                    className="pointer-events-none absolute inset-0 opacity-15"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 1px 1px, #22c55e 1px, transparent 0)",
                      backgroundSize: "28px 28px",
                    }}
                    aria-hidden="true"
                  />

                  <div className="relative z-10 flex flex-col items-center">
                    {/* 发光青草绿播放按钮 */}
                    <div className="group relative flex size-20 items-center justify-center rounded-2xl border border-grass-400/40 bg-grass-500/10 text-grass-400 shadow-grass-glow transition-all hover:scale-105 hover:bg-grass-500/25 sm:size-24 cursor-pointer">
                      <Play className="size-9 translate-x-0.5 fill-current sm:size-11" aria-hidden="true" />
                    </div>

                    <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-grass-500/30 bg-grass-950/70 px-3.5 py-1 text-xs font-semibold text-grass-300 shadow-xs">
                      <Film className="size-3.5 text-grass-400" aria-hidden="true" />
                      <span>{video.badge}</span>
                      <span className="text-grass-600" aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <Clock className="size-3" aria-hidden="true" />
                        时长预估：{video.durationLabel}
                      </span>
                    </div>

                    <p className="mt-3 text-sm sm:text-base font-semibold text-slate-200">
                      真实生产环境实操录屏 · 4 大核心环节无剪辑演示
                    </p>
                    <p className="mt-1 max-w-lg text-xs leading-relaxed text-slate-400">
                      涵盖选品调研、同行与工厂数据同屏比对、运营事实核准放行、一键生成 Listing
                    </p>

                    {/* 声波与刻度线示意 */}
                    <div className="mt-5 flex items-center gap-1 opacity-60">
                      <span className="h-2 w-1 rounded-full bg-grass-500 animate-pulse" />
                      <span className="h-4 w-1 rounded-full bg-grass-400 animate-pulse delay-75" />
                      <span className="h-6 w-1 rounded-full bg-grass-300 animate-pulse delay-150" />
                      <span className="h-3 w-1 rounded-full bg-grass-500 animate-pulse delay-100" />
                      <span className="h-5 w-1 rounded-full bg-grass-400 animate-pulse delay-200" />
                      <span className="h-2 w-1 rounded-full bg-grass-300" />
                    </div>

                    <p className="mt-3 font-mono text-[11px] text-slate-500">
                      插槽就绪：{video.futureSrcPath}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
