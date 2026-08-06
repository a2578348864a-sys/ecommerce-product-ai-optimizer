"use client";

/**
 * 任务详情 · 步骤工作台（E：把信息墙重排为步骤条）。
 *
 * 5 步：研究结论 → 人工确认 → 创作交接 → Listing 草稿 → 产品图片。
 * 默认只展开「当前步骤」，其余折叠；点击步骤头展开。
 * 只做外层排版，不改变任何子组件（ProductResearchDecisionPanel /
 * CreativeHandoffPanel / ListingHandoffSection / ImageHandoffSection）内部逻辑。
 */

import { useState, type ReactNode } from "react";

export type WorkflowStepKey = "conclusion" | "confirmation" | "handoff" | "listing" | "image";

export type WorkflowStep = {
  key: WorkflowStepKey;
  label: string;
  /** 当前步骤标识（默认展开该步骤；null = 全部折叠） */
  content: ReactNode;
};

export function deriveCurrentStepKey(input: {
  /** 最近生成过什么产物，决定当前推进到第几步 */
  hasHandoff: boolean;
  hasListing: boolean;
  hasImage: boolean;
}): WorkflowStepKey {
  if (input.hasImage) return "image";
  if (input.hasListing) return "listing";
  if (input.hasHandoff) return "handoff";
  return "conclusion";
}

export function WorkflowStepWorkspace({
  steps,
  currentKey,
}: {
  steps: WorkflowStep[];
  currentKey: WorkflowStepKey;
}) {
  const [openKey, setOpenKey] = useState<WorkflowStepKey | null>(currentKey);

  return (
    <div className="mt-5 space-y-3" data-testid="workflow-step-workspace">
      {/* 步骤条 */}
      <nav className="flex flex-wrap items-center gap-1.5" aria-label="任务步骤">
        {steps.map((step, index) => {
          const isOpen = openKey === step.key;
          const isCurrent = currentKey === step.key;
          return (
            <button
              key={step.key}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenKey(isOpen ? null : step.key)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                isOpen
                  ? "border-teal-300 bg-teal-50 text-teal-800"
                  : isCurrent
                    ? "border-teal-200 bg-white text-teal-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-teal-200"
              }`}
            >
              <span className={`flex size-5 items-center justify-center rounded-full text-[10px] ${
                isOpen || isCurrent ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-500"
              }`}>
                {index + 1}
              </span>
              {step.label}
              {isCurrent ? <span className="text-[10px] text-teal-500">当前</span> : null}
            </button>
          );
        })}
      </nav>

      {/* 内容区：默认只展开当前步骤 */}
      {steps.map((step) => (
        <section
          key={step.key}
          className={`overflow-hidden rounded-2xl border transition-all ${
            openKey === step.key ? "border-teal-200 bg-white" : "border-slate-100 bg-slate-50/40"
          }`}
        >
          <button
            type="button"
            aria-expanded={openKey === step.key}
            onClick={() => setOpenKey(openKey === step.key ? null : step.key)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="text-sm font-bold text-slate-800">
              {step.label}
              {openKey === step.key ? (
                <span className="ml-2 text-xs font-normal text-slate-400">收起</span>
              ) : (
                <span className="ml-2 text-xs font-normal text-teal-600">展开查看</span>
              )}
            </span>
            {openKey !== step.key ? (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                点击展开
              </span>
            ) : null}
          </button>
          {openKey === step.key ? (
            <div className="border-t border-slate-100 p-4 sm:p-5">{step.content}</div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
