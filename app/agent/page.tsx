import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  History,
  Sparkles,
  Target,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const metadata: Metadata = {
  title: "Agent 路线图已归档 - 轻选 Agent",
  description: "Agent 能力路线图已归档。当前主入口为 Agent 单品分析（/workflow），旧路线图能力已合并进主链路。",
};

const archiveNotes = [
  "候选发现 — 已并入 /opportunities 候选池",
  "Agent 分析 — 已并入 /workflow Agent 单品分析",
  "风险 / 利润 / Listing 准备包 — 已并入主链路分析结果",
  "人工确认 — 所有 AI 结论必须人工复核后保存",
  "任务沉淀 — 已并入 /tasks 任务中心与复盘",
];

export default function AgentPage() {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">已归档</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Agent 路线图已归档
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                当前正式主入口为 Agent 单品分析（/workflow）。以下是旧路线图中已并入主链路的能力说明。
              </p>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* ── 归档说明 ── */}
          <section className="surface-card p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="linear-icon size-10 shrink-0 rounded-xl bg-slate-100 text-slate-500">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="text-base font-semibold text-slate-800">
                  本页是旧版 Agent 能力路线图，已停止维护
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  旧路线图中标注的「规划中」能力不会在当前版本执行，也不会自动下单、自动铺货、自动投流。
                  所有 AI 结论必须人工复核。以下能力已合并进主链路：
                </p>
              </div>
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {archiveNotes.map((note) => (
                <li key={note} className="flex items-start gap-2 text-sm leading-6 text-slate-600">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-400" />
                  {note}
                </li>
              ))}
            </ul>
          </section>

          {/* ── 跳转 CTA ── */}
          <section className="surface-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-950">当前正式主链路入口</h2>
            <p className="mt-1 text-sm text-slate-500">
              旧路线图中的能力已合并进以下主链路入口。Agent 单品分析（/workflow）是当前唯一对外单品分析入口。
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Link
                href="/workflow"
                className="group rounded-2xl border border-teal-200 bg-teal-50/60 p-4 transition hover:border-teal-300 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5 text-teal-600" />
                  <h3 className="text-base font-semibold text-teal-900">Agent 单品分析</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-teal-700">
                  输入商品，走完整 8 步分析链路：数据清洗 → 市场机会 → 供货可行性 → 成本利润 → 合规预筛 → Listing 准备 → 最终结论 → 人工确认保存。
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-600 group-hover:text-teal-800">
                  进入 Agent 单品分析
                  <ArrowRight className="size-4" />
                </span>
              </Link>

              <Link
                href="/opportunities"
                className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <Target className="size-5 text-slate-600" />
                  <h3 className="text-base font-semibold text-slate-900">查看候选池</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  从公开线索中发现候选商品，放入候选池标记状态，再选择进入 Agent 主流程深挖。
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-500 group-hover:text-teal-600">
                  进入候选池
                  <ArrowRight className="size-4" />
                </span>
              </Link>

              <Link
                href="/tasks"
                className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <History className="size-5 text-slate-600" />
                  <h3 className="text-base font-semibold text-slate-900">查看任务中心</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  所有分析结果归档、人工决策状态标记、历史复盘追踪。
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-500 group-hover:text-teal-600">
                  进入任务中心
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            </div>
          </section>

          {/* ── 返回工作台 ── */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="linear-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold"
            >
              返回工作台
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
