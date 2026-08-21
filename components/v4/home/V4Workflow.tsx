"use client";

/**
 * V4.1 — Workflow 主视觉（纯叙事，7 阶段 + 三闸门）。
 *
 * 不造假进度 / 步骤计数：仅展示产品阶段与闸门叙事，无进度条、无当前状态。
 */
import { ShieldCheck } from "lucide-react";

export const V4_WORKFLOW_STAGES = [
  { key: "opportunity", en: "Opportunity", zh: "机会与候选", desc: "从来源证据与候选输入开始。" },
  { key: "market", en: "Market Research", zh: "市场研究", desc: "分析市场、评论与竞争信息。" },
  { key: "evidence", en: "Evidence", zh: "证据整理", desc: "归纳证据，标注来源、冲突与信息缺口。" },
  { key: "gate-a", en: "Human Gate A", zh: "人工门禁 A", desc: "人工确认是否继续进入供应与产品事实。" },
  { key: "facts", en: "Supplier & Product Facts", zh: "供应与产品事实", desc: "核实供应商与产品事实，SupplierClaim 不自动成为产品事实。" },
  { key: "gate-b", en: "Commercial & Gate B", zh: "商业化与门禁 B", desc: "评估商业可行性与成本，进入门禁 B 人工确认。" },
  { key: "content", en: "Content Preparation", zh: "内容准备", desc: "基于已确认事实产出 Listing / Image 草稿。" },
] as const;

export const V4_WORKFLOW_GATES = ["Evidence Gate", "Product Fact Gate", "Human Decision"] as const;

export function V4Workflow() {
  return (
    <section
      id="workflow"
      data-testid="v4-workflow"
      aria-labelledby="v4-workflow-title"
      className="surface-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="linear-kicker">研究流程</p>
          <h2 id="v4-workflow-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            一条证据驱动的研究链路
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            从机会到内容准备的 7 个阶段；关键节点由人工决策与闸门把关，不暗示全自动或确定性盈利。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {V4_WORKFLOW_GATES.map((gate) => (
            <span
              key={gate}
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700"
            >
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {gate}
            </span>
          ))}
        </div>
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {V4_WORKFLOW_STAGES.map((stage, index) => (
          <li
            key={stage.key}
            data-testid={"v4-stage-" + stage.key}
            className="flex min-h-[180px] flex-col rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
              {stage.key === "evidence" || stage.key === "facts" || stage.key === "gate-a" ? (
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Gate</span>
              ) : null}
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">{stage.en}</p>
            <p className="mt-1 text-xs font-semibold text-teal-700">{stage.zh}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{stage.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
