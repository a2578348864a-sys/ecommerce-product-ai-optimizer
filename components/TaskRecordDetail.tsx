"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { AgentNextStepPanel } from "@/components/AgentNextStepPanel";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { platformLabels } from "@/lib/types";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import { ProfitSnapshotCard, type ProfitSnapshot } from "@/components/cross-border/ProfitSnapshotCard";
import { RiskReviewChecklistCard } from "@/components/cross-border/RiskReviewChecklistCard";
import { ListingPrepPackageCard, type ListingPrepInput } from "@/components/cross-border/ListingPrepPackageCard";
import { isAgentRunTask, extractAgentRunSnapshot, extractListingPrepSnapshot } from "@/lib/agentRunSnapshot";
import {
  decisionStatusOptions,
  getDecisionStatusOption,
  type DecisionStatus,
} from "@/lib/tasks/decisionStatus";
import { TASK_TYPE_LABEL_MAP, TASK_AGENT_LABEL_MAP } from "@/lib/taskConcepts";
import { deriveTaskWorkflowSummary, getTaskSourceMeta, toneClass } from "@/lib/taskWorkflowSummary";
import { buildDecisionCard } from "@/lib/decisionCard";
import { DecisionCard as DecisionCardUI } from "@/components/DecisionCard";
import { ListingPackCard } from "@/components/ListingPackCard";
import { AiListingDraftPreviewCard } from "@/components/AiListingDraftPreviewCard";
import type { ListingPack } from "@/lib/listingPack";
import {
  derivePipelineStatus,
  deriveNextAction,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_TONES,
  type PipelineStatus,
} from "@/lib/productPipeline";
import { deriveDisplayLifecycle, getAvailableTransitions, getLifecycleStatusLabel, getLifecycleStatusDescription, getLifecycleNextAction, transitionLifecycle, type LifecycleStatus, type ProductLifecycle } from "@/lib/workflowLifecycle";

const extendedPlatformLabels: Record<string, string> = {
  ...platformLabels,
  tiktok: "TikTok",
  "1688": "1688",
  alibaba: "阿里国际站",
};

type TaskCenterItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  decisionStatus: DecisionStatus;
  title: string | null;
  platform: string;
  productUrl: string | null;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  result: unknown;
};

type DetailResponse =
  | { ok: true; data: TaskCenterItem }
  | { ok: false; error: { code: string; message: string } };

type DeleteResponse =
  | { ok: true; data: { id: string } }
  | { ok: false; error: { code: string; message: string } };

type PatchResponse =
  | { ok: true; data: { id: string; decisionStatus: DecisionStatus } }
  | { ok: false; error: { code: string; message: string } };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(source: string) {
  return source === "ai" ? "AI 深度拆解" : source ? `系统分析 · ${source}` : "系统分析";
}

function getTitle(item: TaskCenterItem) {
  return item.title?.trim() || item.materialText.trim().slice(0, 20) || "未命名记录";
}

function getTaskTypeLabel(item: TaskCenterItem) {
  return TASK_TYPE_LABEL_MAP[item.type || ""] || item.type || "未知任务";
}

function getAgentTypeLabel(item: TaskCenterItem) {
  return TASK_AGENT_LABEL_MAP[item.type || ""] || "规划 Agent";
}

/** Map raw risk level enum to Chinese display label with tone class */
function formatRiskLevelLabel(level: string | undefined | null): { label: string; tone: string } {
  const raw = (level || "").trim().toLowerCase();
  if (raw === "red" || raw === "high") return { label: "高风险", tone: "border-rose-200 bg-rose-50 text-rose-700" };
  if (raw === "yellow" || raw === "medium" || raw === "mid") return { label: "中风险", tone: "border-amber-200 bg-amber-50 text-amber-700" };
  if (raw === "green" || raw === "low") return { label: "低风险", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return { label: raw || "未评级", tone: "border-slate-200 bg-slate-50 text-slate-600" };
}

function getStringArray(result: unknown, key: string) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const value = Reflect.get(result, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 8)
    : [];
}

function getBatchMeta(result: unknown) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  const value = Reflect.get(result, "batchMeta");
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const batchIndex = Reflect.get(value, "batchIndex");
  const batchTotal = Reflect.get(value, "batchTotal");
  if (typeof batchIndex !== "number" || typeof batchTotal !== "number") return null;
  if (!Number.isFinite(batchIndex) || !Number.isFinite(batchTotal)) return null;
  return { batchIndex, batchTotal };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <section className="rounded-2xl border border-white/80 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </section>
  );
}

function WorkflowDecisionSummary({
  result,
  fallbackTitle,
  decisionStatus,
  updatingDecision,
  decisionMessage,
  taskId,
  onDecisionChange,
  onLifecycleUpdated,
}: {
  result: Record<string, unknown>;
  fallbackTitle: string;
  decisionStatus: DecisionStatus;
  updatingDecision: boolean;
  decisionMessage: string;
  taskId: string;
  onDecisionChange: (nextDecisionStatus: DecisionStatus) => void;
  onLifecycleUpdated: () => void;
}) {
  const summary = deriveTaskWorkflowSummary({
    type: "workflow",
    title: fallbackTitle,
    materialText: fallbackTitle,
    oneLineSummary: "",
    level: "",
    decisionStatus,
    result,
  });
  const sourceMeta = getTaskSourceMeta(result);
  const decisionOption = getDecisionStatusOption(decisionStatus);
  // Phase 4-E.1: derive lifecycle status from review state + decision
  const reviewState = isRecordValue(result) && isRecordValue(result.reviewState) ? result.reviewState : null;
  // Phase 4-E.2.1: Use persisted productLifecycle, fallback to derived
  const productLifecycle = deriveDisplayLifecycle(result, reviewState, decisionStatus);
  const isWorkflow = true; // only called for workflow tasks
  const hasProfitSnapshot = isRecordValue(result) && isRecordValue(result.profitSnapshot);
  const hasRiskReviewSnapshot = isRecordValue(result) && isRecordValue(result.riskReviewSnapshot);
  const hasListingData = isRecordValue(result) && isRecordValue(result.listing);
  const listingData = hasListingData ? (result.listing as { title?: string; keywords?: string[]; complianceNotes?: string[] }) : null;

  // Phase Agent-Save-M.1: agent run snapshot
  const agentRunSnapshot = extractAgentRunSnapshot(result);
  const listingPrepSnapshot = extractListingPrepSnapshot(result) || (
    agentRunSnapshot ? null : null // will try fallback from listing data below
  );

  const decisionCard = useMemo(() => buildDecisionCard({
    resultJson: result,
    riskReviewSnapshot: hasRiskReviewSnapshot ? result.riskReviewSnapshot : undefined,
    profitSnapshot: hasProfitSnapshot ? result.profitSnapshot : undefined,
  }), [result, hasRiskReviewSnapshot, hasProfitSnapshot]);

  return (
    <section className="mt-5 rounded-2xl border border-teal-200 bg-teal-50/70 p-4">
      <DecisionCardUI card={decisionCard} compact />
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-teal-700">运营跟进面板 · AI 辅助判断，最终人工确认</p>
          <h3 className="mt-2 break-words text-xl font-semibold tracking-tight text-slate-950">
            {summary.productName}
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">
            {summary.verdictLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-teal-700">
            {summary.reason}
          </p>
          {/* Phase 4-E.1: Enhanced source context + lifecycle status */}
          {sourceMeta ? (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-teal-200 bg-white/70 px-3 py-2 text-sm text-teal-800">
              <div className="flex flex-wrap gap-2 font-semibold">
                <span>来自候选池</span>
                {sourceMeta.entry ? <span>入口：{sourceMeta.entry}</span> : null}
                {sourceMeta.candidateId ? <span>候选 ID：{sourceMeta.candidateId}</span> : null}
                {sourceMeta.opportunityScore !== undefined ? <span>来源分数 {sourceMeta.opportunityScore}/100</span> : null}
                {sourceMeta.opportunitySource ? <span className="max-w-[200px] truncate">来源名称：{sourceMeta.opportunitySource}</span> : null}
              </div>
              {sourceMeta.originalName || sourceMeta.analyzedName ? (
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-teal-700">
                  {sourceMeta.originalName ? <span>原始名称：{sourceMeta.originalName}</span> : null}
                  {sourceMeta.analyzedName ? <span>分析名称：{sourceMeta.analyzedName}</span> : null}
                </div>
              ) : null}
              {sourceMeta.candidateType && (
                <span className="inline-flex w-fit items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold">
                  {sourceMeta.candidateType === "product_candidate" ? "商品候选" : sourceMeta.candidateType === "category_hint" ? "类目提示" : sourceMeta.candidateType === "trend_signal" ? "趋势信号" : sourceMeta.candidateType}
                </span>
              )}
              {sourceMeta.sourceUrl && (
                <a href={sourceMeta.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal-600 underline hover:text-teal-800">
                  查看来源链接
                </a>
              )}
              {/* Phase Candidate-Status-M.1: Back to candidate pool link */}
              <div className="mt-1 border-t border-teal-100 pt-1.5">
                <Link
                  href="/opportunities"
                  className="inline-flex items-center gap-1 text-teal-700 font-semibold hover:text-teal-900 transition"
                >
                  回到候选池 →
                </Link>
                {sourceMeta.candidateId ? (
                  <span className="ml-2 text-[10px] text-teal-500">候选 ID：{sourceMeta.candidateId}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {/* Phase 4-E.2.1: Operation decision panel */}
          {isWorkflow && productLifecycle && (
            <OperationDecisionPanel taskId={taskId} lifecycle={productLifecycle} onUpdated={onLifecycleUpdated} />
          )}

        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[360px] lg:justify-end">
          <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + toneClass(summary.priorityTone)}>
            {summary.priorityLabel}
          </span>
          <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + toneClass(summary.riskTone)}>
            {summary.riskLabel}
          </span>
          <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + decisionOption.className}>
            {decisionOption.shortLabel}
          </span>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["风险等级", summary.riskLabel],
          ["新手适配", summary.beginnerLabel],
          ["小单判断", summary.smallBatchLabel],
          ["当前决策", decisionOption.shortLabel],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/80 bg-white p-3">
            <p className="text-xs font-bold text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">建议动作</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
            {summary.nextActions.slice(0, 5).map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">人工决策</p>
          <select
            value={decisionStatus}
            onChange={(event) => onDecisionChange(event.target.value as DecisionStatus)}
            disabled={updatingDecision}
            className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {decisionStatusOptions.filter((option) => option.value).map((status) => (
              <option key={status.value} value={status.value}>{status.shortLabel}</option>
            ))}
          </select>
          <p className="mt-2 text-sm leading-6 text-slate-500">{decisionOption.description}</p>
          {decisionMessage ? (
            <p className="mt-2 text-xs font-semibold text-teal-700">{decisionMessage}</p>
          ) : null}
        </div>
      </div>

      {/* Phase Agent-Save-M.1: Agent 主链路复盘 */}
      {agentRunSnapshot ? (
        <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4" data-testid="agent-run-review">
          <h3 className="text-base font-bold text-indigo-900">Agent 主链路复盘</h3>
          <p className="mt-0.5 text-sm leading-6 text-indigo-600">
            来自 Agent 主链路驾驶舱 · 受控自动化 · {agentRunSnapshot.manualConfirmed ? "人工已确认" : "未完整确认"}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {agentRunSnapshot.finalVerdict && (
              <div className="rounded-xl border border-white/80 bg-white p-2">
                <span className="text-sm font-semibold text-indigo-500">最终结论</span>
                <p className="mt-0.5 text-sm font-bold text-indigo-900">{agentRunSnapshot.finalVerdict}</p>
              </div>
            )}
            {agentRunSnapshot.riskLevel && (() => {
              const risk = formatRiskLevelLabel(agentRunSnapshot.riskLevel);
              return (
                <div className="rounded-xl border border-white/80 bg-white p-2">
                  <span className="text-sm font-semibold text-indigo-500">风险等级</span>
                  <p className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${risk.tone}`}>{risk.label}</p>
                </div>
              );
            })()}
            <div className="rounded-xl border border-white/80 bg-white p-2">
              <span className="text-sm font-semibold text-indigo-500">步骤完成</span>
              <p className="mt-0.5 text-sm font-bold text-indigo-900">
                {agentRunSnapshot.steps.filter((s) => s.status === "completed").length}/{agentRunSnapshot.steps.length}
              </p>
            </div>
            <div className="rounded-xl border border-white/80 bg-white p-2">
              <span className="text-sm font-semibold text-indigo-500">人工确认</span>
              <p className="mt-0.5 text-sm font-bold text-indigo-900">
                {agentRunSnapshot.manualConfirmed ? "已确认" : "未确认"}
              </p>
            </div>
          </div>
          <details className="mt-3 rounded-xl border border-white/80 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-indigo-700 select-none">
              8 步链路状态
            </summary>
            <div className="mt-2 space-y-1">
              {agentRunSnapshot.steps.map((step) => (
                <div key={step.key} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${
                    step.status === "completed" ? "bg-emerald-500" :
                    step.status === "needs_manual_review" ? "bg-amber-400" :
                    step.status === "warning" ? "bg-amber-400" :
                    "bg-slate-300"
                  }`} />
                  <span className="font-semibold text-slate-700">{step.label}</span>
                  <span className="text-sm text-slate-400">
                    {step.status === "completed" ? "已完成" :
                     step.status === "needs_manual_review" ? "需人工复核" :
                     step.status === "failed" ? "失败" :
                     step.status === "warning" ? "需留意" :
                     (step.status as string) === "running" ? "进行中" :
                     (step.status as string) === "pending" ? "待开始" : "待开始"}
                  </span>
                  {step.summary && <span className="text-sm text-slate-500">— {step.summary}</span>}
                </div>
              ))}
            </div>
          </details>
          {agentRunSnapshot.nextSteps && agentRunSnapshot.nextSteps.length > 0 && (
            <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
              <p className="text-sm font-semibold text-slate-700">下一步动作</p>
              <ul className="mt-1 space-y-0.5">
                {agentRunSnapshot.nextSteps.map((s, i) => <li key={i} className="text-sm text-slate-600">- {s}</li>)}
              </ul>
            </div>
          )}
          {listingPrepSnapshot ? (
            <div className="mt-3 rounded-xl border border-teal-200 bg-white p-4" data-testid="listing-prep-package">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-base font-bold text-teal-900">Listing 上架准备包</h4>
                <button
                  type="button"
                  onClick={() => {
                    const lines: string[] = [];
                    const lp = listingPrepSnapshot;
                    lines.push(`建议标题：${lp.titleStructure.recommendedTitle}`);
                    if (lp.keywordPool.coreWords.length) lines.push(`核心词：${lp.keywordPool.coreWords.join("、")}`);
                    if (lp.keywordPool.longTailWords.length) lines.push(`长尾词：${lp.keywordPool.longTailWords.join("、")}`);
                    if (lp.bulletDrafts.length) lines.push(`卖点要点：\n${lp.bulletDrafts.map((b, i) => `${i + 1}. ${b}`).join("\n")}`);
                    if (lp.complianceExpressionReminders.length) lines.push(`合规提醒：\n${lp.complianceExpressionReminders.map((c) => `- ${c}`).join("\n")}`);
                    const text = lines.join("\n\n");
                    navigator.clipboard.writeText(text).catch(() => {
                      const ta = document.createElement("textarea");
                      ta.value = text; document.body.appendChild(ta); ta.select();
                      document.execCommand("copy"); ta.remove();
                    });
                  }}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition"
                >
                  复制准备包
                </button>
              </div>

              {/* A. Suggested title */}
              <div className="mt-3 rounded-lg border border-teal-100 bg-teal-50/50 p-2.5">
                <p className="text-xs font-semibold text-teal-500 uppercase tracking-wide">建议标题</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{listingPrepSnapshot.titleStructure.recommendedTitle}</p>
                {listingPrepSnapshot.titleStructure.formula ? (
                  <p className="mt-0.5 text-sm text-slate-400">公式：{listingPrepSnapshot.titleStructure.formula}</p>
                ) : null}
              </div>

              {/* B. Keywords */}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {listingPrepSnapshot.keywordPool.coreWords.length > 0 && (
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">核心关键词</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {listingPrepSnapshot.keywordPool.coreWords.map((w) => (
                        <span key={w} className="rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">{w}</span>
                      ))}
                    </div>
                  </div>
                )}
                {listingPrepSnapshot.keywordPool.longTailWords.length > 0 && (
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">长尾词 / 扩展词</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {listingPrepSnapshot.keywordPool.longTailWords.map((w) => (
                        <span key={w} className="rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{w}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {(listingPrepSnapshot.keywordPool.coreWords.length === 0 && listingPrepSnapshot.keywordPool.longTailWords.length === 0) && (
                <p className="mt-2 text-sm text-slate-400 italic">待补充关键词 — 回到 Agent 主链路重新分析，或人工整理关键词后填入。</p>
              )}

              {/* C. Bullet drafts */}
              {listingPrepSnapshot.bulletDrafts.length > 0 && (
                <div className="mt-2 rounded-lg border border-slate-100 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">卖点要点（五点草稿）</p>
                  <ol className="mt-1.5 space-y-1">
                    {listingPrepSnapshot.bulletDrafts.map((b, i) => (
                      <li key={i} className="flex gap-1.5 text-sm leading-6 text-slate-600">
                        <span className="shrink-0 font-semibold text-teal-500">{i + 1}.</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* D. Compliance / risk reminders */}
              {listingPrepSnapshot.complianceExpressionReminders.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/50 p-2.5">
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">上架合规与风险注意</p>
                  <ul className="mt-1 space-y-0.5">
                    {listingPrepSnapshot.complianceExpressionReminders.slice(0, 5).map((c, i) => (
                      <li key={i} className="flex items-start gap-1 text-sm leading-6 text-amber-700">
                        <span className="mt-0.5 shrink-0 text-amber-400">⚠</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* E. Profit / cost summary */}
              {hasProfitSnapshot && isRecordValue(result.profitSnapshot) ? (
                <div className="mt-2 rounded-lg border border-slate-100 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">成本利润摘要</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {(() => {
                      const ps = result.profitSnapshot as Record<string, unknown>;
                      const currency = (ps.currency as string) || "¥";
                      const purchaseCost = Number(ps.purchaseCost) || 0;
                      const salePrice = Number(ps.salePrice) || 0;
                      const estimatedProfit = Number(ps.estimatedProfit) || 0;
                      const estimatedMarginRate = Number(ps.estimatedMarginRate) || 0;
                      return (
                        <>
                          <span>采购成本：{currency}{purchaseCost.toFixed(2)}</span>
                          <span>建议售价：{currency}{salePrice.toFixed(2)}</span>
                          <span>预估利润：{currency}{estimatedProfit.toFixed(2)}</span>
                          <span>毛利率：{(estimatedMarginRate * 100).toFixed(1)}%</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-400 italic">待补充成本/售价信息 — 回到 Agent 主链路填写采购价和售价后重新保存。</p>
              )}

              {/* F. Image material needs */}
              {listingPrepSnapshot.imageMaterialNeeds.length > 0 && (
                <details className="mt-2 rounded-lg border border-slate-100 bg-white p-2.5">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-400 uppercase tracking-wide select-none">图片素材需求（{listingPrepSnapshot.imageMaterialNeeds.length} 项）</summary>
                  <ul className="mt-1.5 space-y-0.5">
                    {listingPrepSnapshot.imageMaterialNeeds.map((img, i) => (
                      <li key={i} className="text-sm text-slate-500">- {img}</li>
                    ))}
                  </ul>
                </details>
              )}

              {/* G. Search terms hint */}
              {listingPrepSnapshot.searchTerms.draft && (
                <div className="mt-2 rounded-lg border border-slate-100 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Search Terms 草稿</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600 break-all">{listingPrepSnapshot.searchTerms.draft}</p>
                </div>
              )}

              {/* H. Manual supplement checklist */}
              <details className="mt-2 rounded-lg border border-amber-100 bg-amber-50/30 p-2.5">
                <summary className="cursor-pointer text-xs font-semibold text-amber-600 uppercase tracking-wide select-none">
                  待补资料 / 上架前仍需确认（{listingPrepSnapshot.manualSupplementChecklist.length} 项）
                </summary>
                <ul className="mt-1.5 space-y-0.5">
                  {listingPrepSnapshot.manualSupplementChecklist.map((item, i) => (
                    <li key={i} className="flex items-start gap-1 text-sm leading-6 text-amber-700">
                      <span className="mt-0.5 shrink-0 text-amber-400">☐</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-500">Listing 上架准备包</p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                该任务暂无 Listing 上架准备包。可回到 Agent 主链路重新分析并保存，或人工整理 Listing 资料。
              </p>
            </div>
          )}
        </section>
      ) : null}

      {/* AI Listing 包 — Core-4: real generator */}
      <ListingPackCard
        productName={summary.productName}
        resultJson={result}
        riskReviewSnapshot={hasRiskReviewSnapshot ? result.riskReviewSnapshot : undefined}
        profitSnapshot={hasProfitSnapshot ? result.profitSnapshot : undefined}
        disabled={decisionCard?.recommendation === "reject" || decisionCard?.recommendation === "needs_more_info"}
        taskId={taskId}
        existingSnapshot={(() => {
          try {
            const snap = (result as Record<string,unknown>)?.listingPackSnapshot as Record<string,unknown> | undefined;
            if (snap?.pack) {
              return { savedAt: snap.savedAt as string, source: snap.source as string, pack: snap.pack as ListingPack };
            }
          } catch { /* ignore */ }
          return null;
        })()}
      />

      <AiListingDraftPreviewCard taskId={taskId} />

      <details className="mt-4 rounded-xl border border-white/80 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-600 select-none">
          保存快照：成本利润 + 合规 / 侵权 AI 预筛
          <span className="ml-2 font-normal text-slate-400">默认折叠，复核时可按需展开</span>
        </summary>
        <div className="mt-3 space-y-3">
          {hasProfitSnapshot ? (
            <ProfitSnapshotCard
              initial={result.profitSnapshot as unknown as ProfitSnapshot}
              readonly
            />
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-500">
              该任务尚未保存成本利润快照。
            </p>
          )}
          {hasRiskReviewSnapshot ? (
            <RiskReviewChecklistCard
              initial={result.riskReviewSnapshot}
              readonly
            />
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm leading-6 text-amber-700">
              该任务尚未保存合规 / 侵权 AI 预筛记录。
            </p>
          )}
          {hasListingData && listingData ? (
            <ListingPrepPackageCard
              embedded
              listing={listingData as ListingPrepInput}
              riskReviewSnapshot={hasRiskReviewSnapshot ? (result.riskReviewSnapshot as Record<string, unknown>) : null}
            />
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-500">
              该任务暂无 Listing 准备包。可回到主链路重新分析，或人工补充关键词、五点描述和上架素材。
            </p>
          )}
        </div>
      </details>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3">
        <p className="text-sm font-semibold text-amber-800">人工确认提醒</p>
        <p className="mt-1 text-sm leading-6 text-amber-700">
          AI 结果不能直接等于采购、上架或投放决策。请先确认供应商、成本、侵权、认证、物流和平台规则，再手动执行真实动作。
        </p>
      </div>
    </section>
  );
}

/* ── Workflow result sub-component ────────────── */

function buildFinalReportMarkdown(result: Record<string, unknown>) {
  const fr = result.finalReport as Record<string, unknown> | undefined;
  const productName = (result.productName as string) || "未命名";
  if (!fr) return "";

  const lines: string[] = [];
  lines.push(`# 一键分析报告：${productName}`);
  lines.push("");
  lines.push(`- 结论：${fr.finalVerdict || "未评级"}`);
  lines.push(`- 风险等级：${fr.riskLevel || "unknown"}`);
  lines.push(`- 新手适配：${fr.beginnerFit || ""}`);
  lines.push(`- 可小单测试：${fr.canTestSmallBatch ? "是" : "否"}`);
  lines.push("");

  const checklist = fr.manualReviewChecklist as string[] | undefined;
  if (checklist && checklist.length) {
    lines.push("## 人工确认清单");
    checklist.forEach((item) => lines.push(`- [ ] ${item}`));
    lines.push("");
  }

  const mustCheck = fr.mustCheckBeforeListing as string[] | undefined;
  if (mustCheck && mustCheck.length) {
    lines.push("## 上线前必须检查");
    mustCheck.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  const nextSteps = fr.nextSteps as string[] | undefined;
  if (nextSteps && nextSteps.length) {
    lines.push("## 下一步动作");
    nextSteps.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  lines.push("---");
  lines.push("轻选 Agent 自动生成 · AI 结论仅供辅助参考");
  return lines.join("\n");
}

function WorkflowResultSection({ result }: { result: Record<string, unknown> }) {
  const fr = result.finalReport as Record<string, unknown> | undefined;
  const steps = Array.isArray(result.steps) ? result.steps as Array<Record<string, unknown>> : [];
  const batchMeta = getBatchMeta(result);
  const [copied, setCopied] = useState(false);

  if (!fr) return null;

  const riskLevel = (fr.riskLevel as string) || "unknown";
  const riskColors: Record<string, string> = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    yellow: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-rose-200 bg-rose-50 text-rose-700",
  };

  function handleCopy() {
    const md = buildFinalReportMarkdown(result);
    if (!md) return;
    navigator.clipboard.writeText(md).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = md;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-5 space-y-4">
      {batchMeta ? (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
          <h3 className="text-sm font-semibold text-slate-950">清单分析来源</h3>
          <p className="mt-2 text-sm font-semibold text-indigo-700">
            清单商品 {batchMeta.batchIndex}/{batchMeta.batchTotal}
          </p>
        </section>
      ) : null}

      {/* Final Report banner */}
      <section className={`rounded-2xl border p-4 ${riskColors[riskLevel] || riskColors.yellow}`}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-950">工作流最终报告</h3>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            {copied ? "已复制" : "复制报告"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {(fr.finalVerdict as string) || "未评级"}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${riskColors[riskLevel] || riskColors.yellow}`}>
            {riskLevel === "green" ? "低风险" : riskLevel === "red" ? "高风险" : riskLevel === "yellow" ? "中风险" : "未评级"}
          </span>
          <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {(fr.beginnerFit as string) || ""}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            fr.canTestSmallBatch ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}>
            {fr.canTestSmallBatch ? "可小单测试" : "需先评估合规"}
          </span>
        </div>
      </section>

      {/* ── Review status ── */}
      {(() => {
        const rs = result.reviewState as Record<string, unknown> | undefined;
        if (!rs) return null;
        const revSteps = [
          { key: "sourcing", label: "货源判断", done: !!rs.sourcingReviewed },
          { key: "risk", label: "风险排查", done: !!rs.riskReviewed },
          { key: "summary", label: "小白结论", done: !!rs.summaryReviewed },
          { key: "listing", label: "Listing 文案", done: !!rs.listingReviewed },
        ];
        const doneCount = revSteps.filter((s) => s.done).length;
        const allDone = doneCount === 4;
        return (
          <section className={`rounded-2xl border p-4 ${allDone ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">
                {allDone ? "人工复核已完成" : "待人工复核完成"}
              </h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${allDone ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {doneCount}/4
              </span>
            </div>
            <div className="mt-3 space-y-1.5">
              {revSteps.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-sm">
                  <span className="shrink-0">{s.done ? "✅" : "⬜"}</span>
                  <span className={s.done ? "text-slate-700 font-medium" : "text-slate-400"}>{s.label}</span>
                  <span className="text-xs ml-auto text-slate-400">{s.done ? "已确认" : "未确认"}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Steps summary */}
      {steps.length > 0 && (
        <section className="rounded-2xl border border-white/80 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">工作流步骤</h3>
          <div className="mt-3 space-y-1.5">
            {steps.map((s) => {
              const icon = s.status === "completed" ? "✅" : s.status === "fallback" ? "⚠️" : "❌";
              return (
                <div key={s.key as string} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="shrink-0">{icon}</span>
                  <span className="font-medium">{(s.label as string) || (s.key as string)}</span>
                  <span className="text-slate-400 truncate">{(s.summary as string || "").slice(0, 60)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Must check before listing */}
      {Array.isArray(fr.mustCheckBeforeListing) && (fr.mustCheckBeforeListing as string[]).length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
          <h3 className="text-sm font-semibold text-slate-950">上线前必须检查</h3>
          <ul className="mt-2 space-y-1">
            {(fr.mustCheckBeforeListing as string[]).map((item, i) => (
              <li key={i} className="text-sm text-slate-600">- {item}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Next steps */}
      {Array.isArray(fr.nextSteps) && (fr.nextSteps as string[]).length > 0 && (
        <section className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
          <h3 className="text-sm font-semibold text-slate-950">下一步动作</h3>
          <ul className="mt-2 space-y-1">
            {(fr.nextSteps as string[]).map((item, i) => (
              <li key={i} className="text-sm text-slate-600">- {item}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Manual review checklist */}
      {Array.isArray(fr.manualReviewChecklist) && (fr.manualReviewChecklist as string[]).length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 className="text-sm font-semibold text-slate-950">人工确认清单</h3>
          <ul className="mt-2 space-y-1">
            {(fr.manualReviewChecklist as string[]).map((item, i) => (
              <li key={i} className="text-sm text-slate-600">- {item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────── */

/* ── Phase 4-E.2.1: Operation Decision Panel ───── */

function OperationDecisionPanel({ taskId, lifecycle, onUpdated }: { taskId: string; lifecycle: ProductLifecycle; onUpdated: () => void }) {
  const [accessPassword] = useAccessPassword();
  const [updating, setUpdating] = useState(false);
  const [showForm, setShowForm] = useState<LifecycleStatus | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [error, setError] = useState("");

  const availableTransitions = getAvailableTransitions(lifecycle.status);
  const isAbandoned = lifecycle.status === "abandoned";

  async function handleTransition(to: LifecycleStatus) {
    setUpdating(true);
    setError("");
    try {
      const res = await fetch('/api/tasks/' + encodeURIComponent(taskId) + '/lifecycle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...buildAccessHeaders() },
        body: JSON.stringify({ status: to, reasonCode: reasonCode || undefined, reasonText: reasonText || undefined }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error?.message || '更新失败'); setUpdating(false); return; }
      setShowForm(null); setReasonCode(''); setReasonText('');
      onUpdated();
    } catch { setError('网络错误，请稍后重试。'); }
    setUpdating(false);
  }

  const st = lifecycle.status;
  const toneC: Record<string, string> = {
    teal: 'border-teal-200 bg-teal-50/70 text-teal-800',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-800',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
    slate: 'border-slate-200 bg-slate-50/70 text-slate-600',
  };
  const tone = st === 'analyzed' ? 'teal' : st === 'watching' ? 'amber' : st === 'ready_to_test' ? 'emerald' : st === 'abandoned' ? 'slate' : 'slate';

  return (
    <div className={'mt-2 rounded-xl border px-3 py-2 text-xs ' + (toneC[tone] || toneC.slate)}>
      <div className="flex items-center gap-2">
        <span className={'rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + (toneC[tone] || toneC.slate)}>
          {getLifecycleStatusLabel(lifecycle.status)}
        </span>
        <span className="text-xs opacity-70">- 人工决策</span>
      </div>
      <p className="mt-1.5">{getLifecycleStatusDescription(lifecycle.status)}</p>
      <p className="mt-1 font-medium">下一步：{getLifecycleNextAction(lifecycle.status)}</p>

      {!isAbandoned && availableTransitions.length > 0 && !showForm && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
          {availableTransitions.map((t) => (
            <button key={t} type="button" onClick={() => setShowForm(t)} disabled={updating}
              className={'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ' + (
                t === 'ready_to_test' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
                t === 'watching' ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' :
                t === 'abandoned' ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' :
                'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              )}>
              {getLifecycleStatusLabel(t)}
            </button>
          ))}
        </div>
      )}

      {isAbandoned && <p className="mt-2 text-slate-400">该候选已停止推进，不再显示操作按钮。</p>}

      {showForm && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <p className="mb-1.5 font-semibold">标记为「{getLifecycleStatusLabel(showForm)}」</p>
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
            <option value="">选择原因（可选）</option>
            {showForm === 'abandoned' ? (<>
              <option value="high_compliance_risk">合规/认证风险高</option>
              <option value="ip_risk">品牌/IP/侵权风险</option>
              <option value="low_margin">利润空间不足</option>
              <option value="high_competition">竞争过强</option>
              <option value="supply_uncertain">供应链不稳定</option>
              <option value="logistics_risk">物流/售后风险高</option>
              <option value="not_beginner_friendly">不适合新手</option>
              <option value="weak_evidence">来源证据不足</option>
            </>) : showForm === 'watching' ? (<>
              <option value="weak_evidence">来源证据不足</option>
              <option value="supply_uncertain">供应链信息不足</option>
              <option value="high_competition">竞争情况需观察</option>
            </>) : (
              <option value="manual_ready_to_test">人工判断可进入测款准备</option>
            )}
            <option value="other">其他</option>
          </select>
          {(reasonCode === 'other' || reasonCode) && (
            <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value.slice(0, 300))}
              placeholder={reasonCode === 'other' ? '请填写具体原因（必填）' : '补充说明（可选，最多300字）'}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" rows={2} maxLength={300} />
          )}
          {error && <p className="mt-1 text-rose-600">{error}</p>}
          <div className="mt-2 flex gap-1.5">
            <button type="button" onClick={() => handleTransition(showForm)}
              disabled={updating || (reasonCode === 'other' && !reasonText.trim())}
              className="rounded-lg bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              {updating ? '提交中...' : '确认'}
            </button>
            <button type="button" onClick={() => { setShowForm(null); setReasonCode(''); setReasonText(''); setError(''); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">取消</button>
          </div>
        </div>
      )}

      {lifecycle.history.length > 0 && (
        <details className="mt-2 border-t border-slate-200 pt-2">
          <summary className="cursor-pointer text-sm text-slate-400 select-none">状态历史（{lifecycle.history.length} 条）</summary>
          <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
            {[...lifecycle.history].reverse().map((h, i) => (
              <div key={i} className="text-[10px] text-slate-400">
                <span>{new Date(h.at).toLocaleString('zh-CN')}</span>
                <span className="mx-1">{h.by === 'system' ? 'SYS' : 'USER'}</span>
                <span>{h.from ? getLifecycleStatusLabel(h.from as LifecycleStatus) + ' -> ' : ''}{getLifecycleStatusLabel(h.to as LifecycleStatus)}</span>
                {h.reasonText && <span className="ml-1 text-slate-300">- {h.reasonText.slice(0, 40)}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function TaskRecordDetail({ id }: { id: string }) {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const router = useRouter();
  const [record, setRecord] = useState<TaskCenterItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [updatingDecision, setUpdatingDecision] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isAccessPasswordReady) {
      setLoading(true);
      setError("");
      return () => {
        cancelled = true;
      };
    }

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setRecord(null);
      setLoading(false);
      setError("请先输入访问密码后查看任务详情。");
      return () => {
        cancelled = true;
      };
    }

    async function loadRecord() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
          cache: "no-store",
          headers: { ...buildAccessHeaders() },
        });
        const data = await response.json() as DetailResponse;
        if (!response.ok || !data.ok) {
          if (!cancelled) setError(data.ok ? "任务详情读取失败。" : data.error.message);
          return;
        }
        if (!cancelled) setRecord(data.data);
      } catch {
        if (!cancelled) setError("任务详情暂时无法读取，请稍后刷新。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [id, accessPassword, isAccessPasswordReady, refreshKey]);

  const resultJson = useMemo(() => {
    if (!record) return "";
    try {
      return JSON.stringify(record.result, null, 2);
    } catch {
      return "结果内容暂时无法格式化。";
    }
  }, [record]);
  const recordSummary = useMemo(() => {
    if (!record) return null;
    return deriveTaskWorkflowSummary({
      type: record.type,
      title: record.title,
      materialText: record.materialText,
      oneLineSummary: record.oneLineSummary,
      level: record.level,
      decisionStatus: record.decisionStatus,
      result: record.result,
    });
  }, [record]);

  async function deleteRecord() {
    if (!record || deleting) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setDeleteError("请先输入访问密码后删除任务。");
      return;
    }

    const confirmed = window.confirm("确定删除这条任务记录吗？删除后无法恢复。");
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(record.id)}`, {
        method: "DELETE",
        headers: { ...buildAccessHeaders() },
      });
      const data = await response.json() as DeleteResponse;
      if (!response.ok || !data.ok) {
        setDeleteError(data.ok ? "删除失败，请稍后再试。" : data.error.message);
        return;
      }
      router.push("/tasks");
      router.refresh();
    } catch {
      setDeleteError("删除失败，请检查本地服务后重试。");
    } finally {
      setDeleting(false);
    }
  }

  async function updateDecisionStatus(nextDecisionStatus: DecisionStatus) {
    if (!record || updatingDecision) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setDecisionMessage("请先输入访问密码后更新人工状态。");
      return;
    }

    const previous = record.decisionStatus;
    setUpdatingDecision(true);
    setDecisionMessage("");
    setRecord({ ...record, decisionStatus: nextDecisionStatus });

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...buildAccessHeaders(),
        },
        body: JSON.stringify({ decisionStatus: nextDecisionStatus }),
      });
      const data = await response.json() as PatchResponse;
      if (!response.ok || !data.ok) {
        setRecord((current) => current ? { ...current, decisionStatus: previous } : current);
        setDecisionMessage(data.ok ? "人工状态更新失败，请稍后再试。" : data.error.message);
        return;
      }
      setRecord((current) => current ? { ...current, decisionStatus: data.data.decisionStatus } : current);
      setDecisionMessage("人工状态已保存。");
    } catch {
      setRecord((current) => current ? { ...current, decisionStatus: previous } : current);
      setDecisionMessage("人工状态更新失败，请检查本地服务后重试。");
    } finally {
      setUpdatingDecision(false);
    }
  }

  function handleCopyReport() {
    if (!record || record.type !== "workflow" || !isRecordValue(record.result)) return;
    const md = buildFinalReportMarkdown(record.result as Record<string, unknown>);
    if (!md) return;
    navigator.clipboard.writeText(md).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = md;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="任务详情" returnUrl={`/tasks/${id}`} />;
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <nav className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Link href="/tasks" className="hover:text-teal-600">任务中心</Link>
                  <span>/</span>
                  <span className="text-slate-600">商品推进详情</span>
                  {record && <><span>/</span><span className="font-medium text-slate-700 truncate max-w-[200px]">{getTitle(record)}</span></>}
                </nav>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  商品推进详情{record ? `：${getTitle(record)}` : ""}
                </h1>
                <p className="mt-1 text-sm text-slate-500">把 AI 分析结果沉淀为可推进的选品任务。AI 负责生成建议，人负责最终确认。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/tasks"
                  className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  返回任务中心
                </Link>
                {record?.type === "workflow" && isRecordValue(record.result) && (
                  <button
                    type="button"
                    onClick={handleCopyReport}
                    className="linear-button-soft inline-flex h-11 items-center justify-center gap-1.5 px-5 text-sm font-semibold"
                  >
                    {copied ? "已复制" : "复制报告"}
                  </button>
                )}
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          {loading ? (
            <section className="surface-card p-6 text-sm text-teal-800">
              正在读取任务详情...
            </section>
          ) : error ? (
            <section className="surface-card p-6">
              <p className="text-sm font-bold text-rose-700">{error}</p>
              <Link href="/tasks" className="mt-5 inline-flex text-sm font-bold text-teal-700">
                返回运营任务中心
              </Link>
            </section>
          ) : record ? (
            <section className="surface-card p-5 sm:p-6">
              {/* Pipeline status bar */}
              {(() => {
                const pipeStatus = derivePipelineStatus({ decisionStatus: record.decisionStatus, level: record.level, result: record.result });
                const nextAct = deriveNextAction({ decisionStatus: record.decisionStatus, level: record.level, result: record.result });
                const isAgentRun = (() => { try { const r = typeof record.result === "object" && record.result ? (record.result as Record<string,unknown>) : null; const ars = r?.agentRunSnapshot as Record<string,unknown> | undefined; return ars?.source === "agent_run"; } catch { return false; } })();
                return (
                  <div className="mb-5 rounded-2xl border border-teal-200 bg-teal-50/60 p-4" data-testid="pipeline-summary">
                    <p className="text-sm font-bold text-teal-700">商品推进摘要</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className={`rounded-full border px-3 py-1 text-sm font-bold ${PIPELINE_STATUS_TONES[pipeStatus]}`}>
                        当前状态：{PIPELINE_STATUS_LABELS[pipeStatus]}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-sm font-bold ${nextAct.priority === "high" ? "border-rose-200 bg-rose-50 text-rose-700" : nextAct.priority === "medium" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                        下一步：{nextAct.label}
                      </span>
                      {isAgentRun && (
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">8 步主链路</span>
                      )}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{nextAct.description}</p>
                    {pipeStatus === "needs_review" && (
                      <p className="mt-2 text-sm text-slate-500">该商品已有 AI 分析结果，但尚未完成人工确认。请逐项复核后决定下一步。</p>
                    )}
                    {pipeStatus === "high_risk" && (
                      <p className="mt-2 text-sm text-rose-600">AI 分析中识别到较高风险，建议人工确认后再决定是否放弃。</p>
                    )}
                  </div>
                );
              })()}
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-teal-700">商品详情</p>
                  <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-950">
                    {getTitle(record)}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{record.oneLineSummary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="linear-pill linear-pill-brand px-3 py-1 text-xs">{getTaskTypeLabel(record)}</span>
                    <span className="linear-pill px-3 py-1 text-xs text-slate-600">{getAgentTypeLabel(record)}</span>
                    <span className="linear-pill border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">已完成</span>
                    <span className={"linear-pill px-3 py-1 text-xs " + getDecisionStatusOption(record.decisionStatus).className}>
                      {getDecisionStatusOption(record.decisionStatus).shortLabel}
                    </span>
                    {(() => {
                      const batchMeta = getBatchMeta(record.result);
                      if (!batchMeta) return null;
                      return (
                        <span className="linear-pill border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
                          清单商品 {batchMeta.batchIndex}/{batchMeta.batchTotal}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
                    {record.score}/100
                  </span>
                  {(() => {
                    const risk = formatRiskLevelLabel(record.level);
                    return (
                      <span className={`rounded-full border px-3 py-1 text-sm font-bold ${risk.tone}`}>
                        {risk.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {record.type === "workflow" && isRecordValue(record.result) ? (
                <WorkflowDecisionSummary
                  result={record.result}
                  fallbackTitle={getTitle(record)}
                  decisionStatus={record.decisionStatus}
                  updatingDecision={updatingDecision}
                  decisionMessage={decisionMessage}
                  taskId={record.id}
                  onDecisionChange={(nextDecisionStatus) => void updateDecisionStatus(nextDecisionStatus)}
                  onLifecycleUpdated={() => setRefreshKey((k) => k + 1)}
                />
              ) : null}

              {record.type !== "workflow" && recordSummary ? (
                <section className="mt-5 rounded-2xl border border-teal-200 bg-teal-50/70 p-4">
                  <p className="text-xs font-bold text-teal-700">决策摘要</p>
                  <h3 className="mt-2 break-words text-xl font-semibold tracking-tight text-slate-950">
                    {recordSummary.productName}
                  </h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">
                    {recordSummary.verdictLabel}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ["风险等级", recordSummary.riskLabel],
                      ["新手适配", recordSummary.beginnerLabel],
                      ["当前人工状态", getDecisionStatusOption(record.decisionStatus).shortLabel],
                      ["下一步动作", recordSummary.primaryNextAction || recordSummary.nextActions[0] || "查看完整结果"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-white/80 bg-white p-3">
                        <p className="text-xs font-bold text-slate-400">{label}</p>
                        <p className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-slate-800">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Phase 4-E.2.1-Fix: Task info collapsed */}
              <details className="mt-5 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-500 select-none">任务信息</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">记录 ID</p>
                  <p className="mt-1 break-all text-xs font-bold text-slate-800">{record.id}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">创建时间</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{formatDate(record.createdAt)}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">平台</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">
                    {extendedPlatformLabels[record.platform] || record.platform}
                  </p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">来源</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{sourceLabel(record.source)}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">任务类型</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{getTaskTypeLabel(record)}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">Agent 类型</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{getAgentTypeLabel(record)}</p>
                </div>
              </div>
              </details>

              <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-500 select-none">Agent 状态和后续能力</summary>
                <AgentNextStepPanel
                  className="mt-3"
                  taskType={record.type}
                  decisionStatus={record.decisionStatus}
                  result={record.result}
                />
              </details>

              {/* Phase UI-C: Keep review capability, but lower default weight. */}
              <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-500 select-none">人工复核清单和详细建议</summary>
                <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <WorkflowNextStepCard taskType={record.type} />
                  <ManualReviewChecklist />
                </div>
              </details>

              <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-500 select-none">输入素材和原始链接</summary>
                {record.productUrl ? (
                  <p className="mt-3 break-all text-sm text-slate-500">链接：{record.productUrl}</p>
                ) : null}
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                  {record.materialText}
                </p>
              </details>

              {/* Workflow-specific result rendering */}
              {record.type === "workflow" && typeof record.result === "object" && record.result !== null && !Array.isArray(record.result) ? (
                <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-slate-500 select-none">完整分析、复制报告和过程记录</summary>
                  <WorkflowResultSection result={record.result as Record<string, unknown>} />
                </details>
              ) : (
                <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-slate-500 select-none">完整结果拆解</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ResultList title="核心卖点" items={getStringArray(record.result, "sellingPoints")} />
                  <ResultList title="用户痛点" items={getStringArray(record.result, "painPoints")} />
                  <ResultList title="开头钩子" items={getStringArray(record.result, "hooks")} />
                  <ResultList title="标题建议" items={getStringArray(record.result, "titleSuggestions")} />
                  <ResultList title="短视频开头" items={getStringArray(record.result, "videoOpenings")} />
                  <ResultList title="评论区话题" items={getStringArray(record.result, "commentTriggers")} />
                  <ResultList title="转化优化" items={getStringArray(record.result, "conversionSuggestions")} />
                  <ResultList title="风险提醒" items={getStringArray(record.result, "risks")} />
                  </div>
                </details>
              )}

              <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-500 select-none">完整结果 JSON（调试用）</summary>
                <p className="mt-1 text-sm text-slate-500">用于复核 AI/mock 返回结构，长内容可以滚动查看。</p>
                <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {resultJson}
                </pre>
              </details>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={deleteRecord}
                  disabled={deleting}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-5 text-sm font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? "删除中..." : "删除这条记录"}
                </button>
                <Link href="/tasks" className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  返回运营任务中心
                </Link>
                <Link href="/workflow/batch" className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  继续批量分析
                </Link>
                {deleteError ? <p className="text-sm font-bold text-rose-700">{deleteError}</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
