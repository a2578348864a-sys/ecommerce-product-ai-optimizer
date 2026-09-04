"use client";

import { Play, Film, Clock } from "lucide-react";
import type { ShowcaseVideoConfig } from "@/content/showcase";

interface ShowcaseVideoProps {
  video: ShowcaseVideoConfig;
}

export function ShowcaseVideo({ video }: ShowcaseVideoProps) {
  const isReady = Boolean(video.src && video.status === "ready");

  return (
    <section
      id="demo-video"
      className="scroll-mt-16 w-full py-12 sm:py-16"
      aria-labelledby="video-heading"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
            Video Demonstration
          </p>
          <h2
            id="video-heading"
            className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
          >
            {video.title}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            {video.subtitle}
          </p>
        </div>

        {/* 16:9 视频展示容器 */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-900 shadow-soft">
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
                {/* 装饰性背景微网格 */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-10"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
                    backgroundSize: "24px 24px",
                  }}
                  aria-hidden="true"
                />

                <div className="relative z-10 flex flex-col items-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-teal-400 backdrop-blur-md sm:size-20">
                    <Play className="size-8 translate-x-0.5 fill-current sm:size-10" aria-hidden="true" />
                  </div>

                  <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-950/60 px-3 py-1 text-xs font-medium text-teal-300">
                    <Film className="size-3.5" aria-hidden="true" />
                    <span>{video.badge}</span>
                    <span className="text-teal-600" aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" aria-hidden="true" />
                      {video.durationLabel}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-medium text-slate-300 sm:text-base">
                    {video.title}
                  </p>
                  <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
                    {video.subtitle}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
