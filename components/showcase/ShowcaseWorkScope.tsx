"use client";

import { Check, Compass, Cpu, Lock, TestTube2, Award, Sparkles, ExternalLink } from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";
import { SpotlightCard } from "./SpotlightCard";
import { CountUp } from "./CountUp";

interface ShowcaseWorkScopeProps {
  projectWork: ShowcaseContent["projectWork"];
}

const WORK_ICONS = [Compass, Cpu, Lock, TestTube2];

export function ShowcaseWorkScope({ projectWork }: ShowcaseWorkScopeProps) {

  return (
    <section className="w-full bg-slate-50/50 py-16 sm:py-24 border-t border-slate-200/60" aria-labelledby="work-heading">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-grass-200 bg-grass-50 px-3 py-1 text-xs font-semibold tracking-wide text-grass-700 shadow-xs">
            <Award className="size-3.5" aria-hidden="true" />
            <span>项目总结与开发沉淀</span>
          </div>
          <h2
            id="work-heading"
            className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-4xl"
          >
            {projectWork.sectionTitle}
          </h2>
          <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-grass-200/80 bg-white p-4 text-center shadow-xs">
            <p className="text-xs sm:text-sm font-semibold leading-relaxed text-slate-800">
              {projectWork.roleStatement}
            </p>
          </div>
        </div>

        {/* 核心交付数字面板（SpotlightCard 聚光灯跟随 + CountUp 跑表） */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <SpotlightCard
            spotlightColor="rgba(44, 201, 107, 0.22)"
            spotlightSize={260}
            className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 text-center shadow-soft transition-all duration-300 hover:border-grass-300 hover:-translate-y-1"
          >
            <div className="relative z-10">
              <div className="font-mono text-2xl sm:text-3xl font-black text-grass-700">
                <CountUp to={0} suffix=" 违规" />
              </div>
              <div className="mt-1 text-xs font-bold text-slate-800">不合规词汇</div>
              <div className="mt-0.5 text-[11px] text-slate-500">提前识别并过滤拦截</div>
            </div>
          </SpotlightCard>

          <SpotlightCard
            spotlightColor="rgba(44, 201, 107, 0.22)"
            spotlightSize={260}
            className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 text-center shadow-soft transition-all duration-300 hover:border-grass-300 hover:-translate-y-1"
          >
            <div className="relative z-10">
              <div className="font-mono text-2xl sm:text-3xl font-black text-grass-700">
                <CountUp to={100} suffix="%" />
              </div>
              <div className="mt-1 text-xs font-bold text-slate-800">真实资料出处</div>
              <div className="mt-0.5 text-[11px] text-slate-500">每一句都能查根溯源</div>
            </div>
          </SpotlightCard>

          <SpotlightCard
            spotlightColor="rgba(44, 201, 107, 0.22)"
            spotlightSize={260}
            className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 text-center shadow-soft transition-all duration-300 hover:border-grass-300 hover:-translate-y-1"
          >
            <div className="relative z-10">
              <div className="font-mono text-2xl sm:text-3xl font-black text-grass-700">
                <CountUp to={4} suffix=" 路" />
              </div>
              <div className="mt-1 text-xs font-bold text-slate-800">核心数据对比</div>
              <div className="mt-0.5 text-[11px] text-slate-500">同行竞品与工厂底价</div>
            </div>
          </SpotlightCard>

          <SpotlightCard
            spotlightColor="rgba(44, 201, 107, 0.22)"
            spotlightSize={260}
            className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 text-center shadow-soft transition-all duration-300 hover:border-grass-300 hover:-translate-y-1"
          >
            <div className="relative z-10">
              <div className="font-mono text-2xl sm:text-3xl font-black text-grass-700">
                <CountUp to={134} suffix=" 项" />
              </div>
              <div className="mt-1 text-xs font-bold text-slate-800">自动化防错测试</div>
              <div className="mt-0.5 text-[11px] text-slate-500">功能与界面 100% 绿灯</div>
            </div>
          </SpotlightCard>
        </div>

        {/* Bento Grid 架构格（SpotlightCard 聚光灯跟随） */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {projectWork.items.map((item, index) => {
            const Icon = WORK_ICONS[index] || Check;
            return (
              <SpotlightCard
                key={item.title}
                spotlightColor="rgba(44, 201, 107, 0.16)"
                spotlightSize={380}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-soft transition-all duration-200 hover:border-grass-300 hover:shadow-grass-sm"
              >
                <div className="relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-grass-50 text-grass-700 transition-colors group-hover:bg-grass-600 group-hover:text-white">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <span className="font-mono text-xs font-bold text-slate-400">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-extrabold tracking-tight text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 sm:text-sm">
                    {item.desc}
                  </p>
                </div>
              </SpotlightCard>
            );
          })}
        </div>

        {/* 状态徽章与基线标定区 */}
        <div className="mt-10 rounded-2xl border border-grass-200/80 bg-white p-6 shadow-soft">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div>
              <p className="text-xs font-bold tracking-wide text-slate-500">
                工程交付质量基线
              </p>
              <p className="mt-0.5 text-base font-extrabold text-slate-950 flex items-center gap-2">
                <span className="size-2 rounded-full bg-grass-500 animate-pulse" />
                {projectWork.baseline}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {projectWork.badges.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/80 px-3 py-1 font-mono text-xs font-medium text-slate-700 hover:border-grass-200 hover:bg-grass-50"
                >
                  <span className="size-1.5 rounded-full bg-grass-500" aria-hidden="true" />
                  <span>{badge}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 方案 C：GitHub 源码与架构查验大横幅卡片 */}
        <div className="mt-8">
          <SpotlightCard
            spotlightColor="rgba(44, 201, 107, 0.2)"
            spotlightSize={450}
            className="group relative overflow-hidden rounded-2xl border border-slate-900/15 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-6 sm:p-8 text-white shadow-xl transition-all duration-300 hover:border-slate-700 hover:shadow-2xl"
          >
            <div className="relative z-10 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white shadow-inner backdrop-blur-xs ring-1 ring-white/20 transition-transform duration-300 group-hover:scale-105">
                  <svg className="size-7 fill-current text-white" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-grass-500/20 px-2.5 py-0.5 text-[11px] font-bold text-grass-400 ring-1 ring-grass-500/30">
                      <span className="size-1.5 rounded-full bg-grass-400 animate-pulse" />
                      代码开源 · 真实可证
                    </span>
                    <span className="text-xs text-slate-400 hidden sm:inline">TypeScript / Next.js 全栈工程</span>
                  </div>
                  <h3 className="mt-1.5 text-lg font-bold text-white sm:text-xl">
                    查验完整开源代码与工程实现
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
                    全站包含 134 项防错自动化测试、真实多 Agent 协作工作流与防幻觉治理规范，均已同步提交至 GitHub 仓库，欢迎查阅源码与架构沉淀。
                  </p>
                </div>
              </div>

              <div className="shrink-0 w-full sm:w-auto">
                <a
                  href="https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-grass-600 px-6 text-sm font-bold text-white shadow-grass-glow transition-all hover:bg-grass-500 hover:shadow-grass-glow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:w-auto"
                  aria-label="前往 GitHub 查看项目完整开源仓库（在新标签页打开）"
                >
                  <span>查阅 GitHub 仓库</span>
                  <ExternalLink className="size-4 text-grass-200" aria-hidden="true" />
                </a>
              </div>
            </div>
          </SpotlightCard>
        </div>
      </div>
    </section>
  );
}
