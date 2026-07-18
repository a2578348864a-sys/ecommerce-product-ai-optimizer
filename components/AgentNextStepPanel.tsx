"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Copy, Lock, ShieldAlert } from "lucide-react";
import { getDecisionStatusOption, type DecisionStatus } from "@/lib/tasks/decisionStatus";
import { deriveAgentNextStepPanelState } from "@/components/agentNextStepPanelModel";

const blockedActions = [
  "自动采购",
  "自动下单",
  "自动上架",
  "自动发布 Listing",
  "自动投广告",
  "自动联系供应商",
] as const;

function riskClassName(riskLevel: string) {
  if (riskLevel === "red") return "border-rose-200 bg-rose-50 text-rose-700";
  if (riskLevel === "green") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (riskLevel === "yellow") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function buildCopyText(state: ReturnType<typeof deriveAgentNextStepPanelState>) {
  const lines: string[] = [];
  lines.push("# Agent 下一步推进建议");
  lines.push("");
  lines.push(`- 当前阶段：${state.stageLabel}`);
  lines.push(`- 复核进度：${state.reviewState.exists ? `${state.reviewState.reviewedCount}/${state.reviewState.totalReviewSteps}` : "缺少复核状态"}`);
  lines.push(`- 人工决策：${state.decisionLabel}`);
  lines.push(`- 风险等级：${state.riskLabel}`);
  lines.push("");
  lines.push("## 下一步建议");
  state.nextActions.forEach((item) => lines.push(`- ${item}`));
  if (state.manualReviewChecklist.length) {
    lines.push("");
    lines.push("## 风险复核清单");
    state.manualReviewChecklist.forEach((item) => lines.push(`- [ ] ${item}`));
  }
  lines.push("");
  lines.push("## 边界");
  lines.push("- 当前只提供分析建议，不会自动采购、下单、上架、投广告或联系供应商。");
  return lines.join("\n");
}

export function AgentNextStepPanel({
  taskType,
  decisionStatus,
  result,
  className,
}: {
  taskType?: string;
  decisionStatus: DecisionStatus;
  result: unknown;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const state = useMemo(
    () => deriveAgentNextStepPanelState({ taskType, decisionStatus, result }),
    [taskType, decisionStatus, result],
  );
  const decisionOption = getDecisionStatusOption(decisionStatus);
  const reviewComplete = state.reviewState.exists && state.reviewState.allReviewed;

  function handleCopy() {
    const text = buildCopyText(state);
    navigator.clipboard.writeText(text).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className={`rounded-2xl border border-teal-200 bg-teal-50/50 p-4 sm:p-5${className ? ` ${className}` : ""}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="linear-kicker">Phase 2-G</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Agent 下一步推进</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            受控自动化建议，不会自动执行商业动作。当前面板只根据已有任务结果前端派生，不写回数据库。
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="linear-button-soft inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm font-semibold"
        >
          <Copy className="size-4" />
          {copied ? "已复制" : "复制建议"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${state.stageClassName}`}>
          {state.stageLabel}
        </span>
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${reviewComplete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {state.reviewState.exists ? (reviewComplete ? `已复核 ${state.reviewState.reviewedCount}/${state.reviewState.totalReviewSteps}` : `待复核 ${state.reviewState.reviewedCount}/${state.reviewState.totalReviewSteps}`) : "缺少复核状态"}
        </span>
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${decisionOption.className}`}>
          {state.decisionLabel}
        </span>
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${riskClassName(state.riskLevel)}`}>
          {state.riskLabel}
        </span>
        {state.batchMeta ? (
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
            清单商品 {state.batchMeta.batchIndex}/{state.batchMeta.batchTotal}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-white/80 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <ClipboardCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-950">当前阶段判断</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">{state.stageDescription}</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-500">人工复核门槛</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {!state.reviewState.exists
                ? "当前任务缺少复核状态，请人工确认关键风险。"
                : reviewComplete
                  ? "已完成必要复核，可进行人工决策。"
                  : "请先完成人工复核，不能因为 AI 给出低风险就绕过人工确认。"}
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-500">人工决策状态</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {decisionOption.description}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${state.riskLevel === "red" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
              {state.riskLevel === "red" ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-950">下一步建议</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">{state.primarySuggestion}</p>
            </div>
          </div>

          <ul className="mt-4 space-y-2">
            {state.nextActions.map((item) => (
              <li key={item} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-teal-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
              <Lock className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-950">禁止自动执行区</h4>
              <p className="mt-1 text-sm leading-6 text-rose-800">
                系统不会自动执行以下商业动作。你可以复制建议或导出报告，再在线下确认。
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {blockedActions.map((item) => (
              <span key={item} className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ShieldAlert className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-950">风险复核清单</h4>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                {state.manualReviewChecklist.length ? "来自当前工作流最终报告，使用前仍需人工逐项确认。" : "当前任务没有结构化清单，请使用通用人工确认清单复核。"}
              </p>
            </div>
          </div>
          {state.manualReviewChecklist.length ? (
            <ul className="mt-3 space-y-2">
              {state.manualReviewChecklist.slice(0, 4).map((item) => (
                <li key={item} className="rounded-xl bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
