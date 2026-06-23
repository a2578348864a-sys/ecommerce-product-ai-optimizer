"use client";

import Link from "next/link";
import { ArrowRight, ClipboardList, History, ListChecks, Target } from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

const primaryEntries = [
  {
    eyebrow: "我还没有产品",
    title: "先找机会",
    description: "从公开线索或手动候选品里整理机会，先筛出值得继续看的商品。",
    href: "/opportunities",
    cta: "去找机会",
    icon: Target,
    tone: "teal",
  },
  {
    eyebrow: "我已有产品 / 清单",
    title: "开始分析产品",
    description: "支持单个商品，也支持最多 3 个商品清单；分析后保存到任务中心等待人工复核。",
    href: "/workflow/batch",
    cta: "开始分析",
    icon: ListChecks,
    tone: "indigo",
  },
  {
    eyebrow: "我想看之前结果",
    title: "打开任务中心",
    description: "查看历史分析、复核状态、Agent 状态和下一步建议，不触发新的 AI 分析。",
    href: "/tasks",
    cta: "看结果",
    icon: History,
    tone: "amber",
  },
] as const;

function entryToneClass(tone: (typeof primaryEntries)[number]["tone"]) {
  if (tone === "indigo") {
    return {
      card: "border-indigo-200 bg-indigo-50/65",
      icon: "bg-indigo-100 text-indigo-700",
      eyebrow: "text-indigo-700",
      button: "linear-button-primary",
    };
  }

  if (tone === "amber") {
    return {
      card: "border-amber-200 bg-amber-50/70",
      icon: "bg-amber-100 text-amber-700",
      eyebrow: "text-amber-700",
      button: "linear-button",
    };
  }

  return {
    card: "border-teal-200 bg-teal-50/70",
    icon: "bg-teal-100 text-teal-700",
    eyebrow: "text-teal-700",
    button: "linear-button-primary",
  };
}

export default function Home() {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Qingxuan Agent Alpha</p>
                <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                  帮你判断一个跨境商品值不值得做
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  先找机会，再分析产品，最后在任务中心复盘下一步。AI 给建议，关键动作你确认。
                </p>
              </div>
              <span className="linear-pill linear-pill-brand px-3 py-1 text-sm">受控自动化 · Alpha MVP</span>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="linear-kicker">你现在有什么？</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">选一个入口开始</h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                <ClipboardList className="size-3.5" />
                不自动下单、不自动上架、不自动投广告
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-3">
              {primaryEntries.map((entry) => {
                const Icon = entry.icon;
                const tone = entryToneClass(entry.tone);

                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    className={`group flex min-h-0 items-center gap-3 rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-sm sm:min-h-[280px] sm:flex-col sm:items-stretch sm:gap-0 sm:p-5 ${tone.card}`}
                  >
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-12 sm:rounded-2xl ${tone.icon}`}>
                      <Icon className="size-6" />
                    </div>
                    <div className="min-w-0 flex-1 sm:flex sm:min-h-0 sm:flex-1 sm:flex-col">
                      <p className={`text-xs font-bold sm:mt-5 sm:text-sm ${tone.eyebrow}`}>{entry.eyebrow}</p>
                      <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:mt-2 sm:text-2xl">{entry.title}</h3>
                      <p className="mt-3 hidden flex-1 text-sm leading-6 text-slate-600 sm:block">{entry.description}</p>
                    </div>
                    <span className={`${tone.button} inline-flex size-10 shrink-0 items-center justify-center gap-2 px-0 text-sm font-semibold sm:mt-5 sm:h-11 sm:w-full sm:px-5`}>
                      <span className="sr-only sm:not-sr-only">{entry.cta}</span>
                      <ArrowRight className="size-4" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-500">
            <p>
              当前版本是 Alpha MVP：系统只做分析、整理和建议；采购、上架、联系供应商、投广告等动作都需要你人工确认后手动执行。
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
