"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
// F2：SourcingEvidencePanel 已移入 EvidenceWorkbench 证据序列（不再在页尾独立渲染）
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders, isGuestMode } from "@/lib/client/accessToken";
import { clearSessionDraftsForEntity } from "@/lib/client/useSessionDraft";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import { ProfitSnapshotCard, type ProfitSnapshot } from "@/components/cross-border/ProfitSnapshotCard";
import { RiskReviewChecklistCard } from "@/components/cross-border/RiskReviewChecklistCard";
import { ListingPrepPackageCard, type ListingPrepInput } from "@/components/cross-border/ListingPrepPackageCard";
import { isAgentRunTask, extractAgentRunSnapshot, extractListingPrepSnapshot } from "@/lib/agentRunSnapshot";
import { extractAgentOutputSnapshotFromTask } from "@/lib/agentOutputSnapshot";
import { AgentOutputSnapshotCard } from "@/components/AgentOutputSnapshotCard";
import { DecisionEvidencePanel } from "@/components/DecisionEvidencePanel";
import { EvidenceWorkbench } from "@/components/evidence/EvidenceWorkbench";
import { extractDecisionEvidenceSnapshot } from "@/lib/decisionEvidence";
import { AgentRunTimeline } from "@/components/AgentRunTimeline";
import { TaskDecisionHero } from "@/components/TaskDecisionHero";
import { deriveAgentRunTimelineItems } from "@/lib/agentRunTimeline";
import {
  decisionStatusOptions,
  getDecisionStatusOption,
  type DecisionStatus,
} from "@/lib/tasks/decisionStatus";
import {
  LISTING_PACK_ANCHOR_ID,
  buildNoListingPackPrompt,
  buildTaskDeleteConfirmationMessage,
  getAiListingPackSnapshot,
  hasAiListingPack,
} from "@/lib/tasks/listingSnapshotUi";
import { deriveTaskWorkflowSummary, getTaskSourceMeta, toneClass } from "@/lib/taskWorkflowSummary";
import { deriveTaskOperationSummary } from "@/lib/taskOperationSummary";
import { buildDecisionCard } from "@/lib/decisionCard";
import { DecisionCard as DecisionCardUI } from "@/components/DecisionCard";
import { ListingPackCard } from "@/components/ListingPackCard";
import { AiListingDraftPreviewCard } from "@/components/AiListingDraftPreviewCard";
import { AiImageDraftCard } from "@/components/AiImageDraftCard";
import { extractAiImageDraftSnapshot } from "@/lib/aiImageDraft";
import type { ListingPack } from "@/lib/listingPack";
import type { AiListingPackSnapshot } from "@/lib/aiListingSnapshot";
import {
  derivePipelineStatus,
  deriveNextAction,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_TONES,
  type PipelineStatus,
} from "@/lib/productPipeline";
import { deriveDisplayLifecycle, getAvailableTransitions, getLifecycleStatusLabel, getLifecycleStatusDescription, getLifecycleNextAction, transitionLifecycle, type LifecycleStatus, type ProductLifecycle } from "@/lib/workflowLifecycle";
import {
  deriveProductResearchPresentation,
  formatResearchMoney,
  formatResearchRate,
} from "@/lib/productResearchPresentation";
import {
  deriveUserProgressSummary,
  type UserProgressSummary,
} from "@/lib/userProgressSummary";
import { ResearchProductImage } from "@/components/ResearchProductImage";
import { resolvePublicSourceImageUrl } from "@/lib/client/sourceImageUrl";
import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";
import { resolveTaskProductDisplayName } from "@/lib/productDisplayName";
import { ProductResearchDecisionPanel } from "@/components/product-research/ProductResearchDecisionPanel";
import { classifyResearchLifecycle } from "@/lib/researchLifecycle";
import {
  deriveCreativeMaterialStatus,
  deriveHistoricalArtifactSummary,
  deriveResearchHistoryStatus,
  type ResearchHistoryStatus,
} from "@/lib/taskResearchHistoryPresentation";
import { StudioNavigationLink } from "@/components/studio/StudioNavigationLink";

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
  productImage: ResearchProductImageDisplay | null;
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

/**
 * 用户进度摘要：按真实推进顺序派生"还缺什么 / 下一步"。
 * 逻辑在 lib/userProgressSummary.ts（可测试），此处仅做适配。
 */
function deriveProgressSummary(input: {
  presentation: {
    stage: { key: string; label: string };
    artifacts: ReadonlyArray<{ key: string; label: string }>;
    actions: ReadonlyArray<{ label: string; href: string }>;
  };
  decisionStatus: string;
  result: unknown;
}): UserProgressSummary {
  return deriveUserProgressSummary({
    stageLabel: input.presentation.stage.label,
    artifactKeys: input.presentation.artifacts.map((artifact) => artifact.key),
    decisionStatus: input.decisionStatus,
    result: input.result,
  });
}

function getTitle(item: TaskCenterItem) {
  return resolveTaskProductDisplayName({
    resultProductName: isRecordValue(item.result) ? item.result.productName : "",
    taskTitle: item.title,
    materialText: item.materialText.trim().slice(0, 20),
    fallback: "未命名记录",
  });
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

function hasVersionedProductResearchRecord(result: unknown) {
  if (!isRecordValue(result)) return false;
  const summary = result.productResearchSummary;
  return isRecordValue(summary)
    && summary.schema === "product-research-record.v1";
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

function uniqueStrings(values: ReadonlyArray<string | null | undefined>, limit = 8) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function safePublicHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * V3 Current Research Normalization：Research Completion 控件（Active → 研究记录）。
 * - researchCompletion 已存在 → "研究已完成并保存到研究记录。" + [查看研究记录]（幂等展示）；
 * - 人工决定未保存（无 researchRecord）→ 禁用并提示先保存决定；
 * - latestDecision = needs_information → 禁用并提示仍需补资料；
 * - creative_ready / abandoned → [完成研究并保存记录]（轻量确认 → POST /complete → 成功态）。
 * 同一 canonical Task 的 lifecycle 收口；不复制 Task、不删除 Evidence。
 */
function ResearchCompletionControl({
  taskId,
  result,
  researchStale,
  evidenceChangesSinceCompletion = [],
  onCompleted,
}: {
  taskId: string;
  result: Record<string, unknown>;
  /** 服务端计算的 stale 状态（client 无法计算 evidence hash） */
  researchStale?: boolean;
  /** V3 Research Staleness UX Closure：完成研究后新增/变更的证据明细（服务端投影） */
  evidenceChangesSinceCompletion?: Array<{
    evidenceType: string;
    source: string;
    capturedAt: string;
    summary: string;
  }>;
  onCompleted?: () => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  // 轮 15 修复：不再用 window.confirm（自动化/headless 环境静默返回 false → 按钮无响应）；
  // 改为组件内自定义确认对话框（React 状态控制，任何环境都工作）。
  const [confirmOpen, setConfirmOpen] = useState(false);

  const completion = isRecordValue(result.researchCompletion) ? result.researchCompletion as Record<string, unknown> : null;
  const completionStatus = completion && typeof completion.status === "string" ? completion.status : null;
  // 浏览器投影只暴露 productResearchSummary（researchRecord 仅服务端内部）；
  // 决策状态以投影 summary 为准，researchRecord 仅作兜底（完整 result 传入时）。
  const summary = isRecordValue(result.productResearchSummary) ? result.productResearchSummary as Record<string, unknown> : null;
  const record = isRecordValue(result.researchRecord) ? result.researchRecord as Record<string, unknown> : null;
  const latest = record && isRecordValue(record.latestDecision) ? record.latestDecision as Record<string, unknown> : null;
  const latestStatus = typeof summary?.status === "string"
    ? summary.status
    : (latest && typeof latest.status === "string" ? latest.status : null);

  if (completionStatus === "completed" || completionStatus === "abandoned" || done) {
    // V3 UX Closure Staleness：完成研究后证据内容发生变化 → 明确提示 + 重新确认
    const staleState = { stale: researchStale === true };
    if (completionStatus === "completed" && staleState.stale) {
      return (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="research-stale-notice">
          <p className="text-sm font-bold text-amber-800">研究资料在完成研究后发生了变化</p>
          <p className="mt-1 text-sm leading-6 text-amber-700">
            当前研究结论基于旧版本资料；新增的证据尚未纳入结论。请重新确认研究，确认后旧结论才会对应当前资料；
            重新确认前，新的 Listing / Image 生成会被暂停（历史结果保留）。
          </p>
          {/* V3 Research Staleness UX Closure：NEW_EVIDENCE_SINCE_LAST_COMPLETION 明细 */}
          {evidenceChangesSinceCompletion.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white/60 p-3" data-testid="new-evidence-since-completion">
              <p className="text-xs font-bold text-amber-800">自上次确认后新增 / 变更的证据</p>
              <ul className="mt-1.5 space-y-1">
                {evidenceChangesSinceCompletion.map((item, index) => (
                  <li key={`${item.evidenceType}-${item.capturedAt}-${index}`} className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-slate-700">
                    <span className="font-semibold text-slate-800">{item.evidenceType}</span>
                    <span className="text-slate-500">{new Date(item.capturedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="text-slate-600">{item.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={completing}
              onClick={() => void requestComplete()}
              data-testid="research-stale-confirm-trigger"
              className="inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {completing ? "确认中…" : "确认研究结论仍然有效"}
            </button>
            <button
              type="button"
              disabled={completing}
              onClick={() => void modifyDecision()}
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              修改人工决定
            </button>
            <Link
              href="/tasks"
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              查看研究记录
            </Link>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-amber-600/80">
            重新确认不会删除任何证据 / 事实 / 人工决定，也不会重跑研究；仅创建 Research Completion 新版本（Version N+1），
            历史完成版本保留可查。
          </p>
          {confirmOpen ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-white p-4" data-testid="research-confirm-dialog" role="dialog" aria-label="确认研究结论仍然有效">
              <p className="text-sm font-semibold text-slate-800">
                确认研究结论仍然有效？
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {researchStale === true
                  ? "确认后创建新的 Research Completion 版本（Version N+1），当前资料与结论对齐；不会删除任何证据 / 事实 / 人工决定，历史完成版本保留。"
                  : "完成后，该商品会从『商品研究』移动到『研究记录』。现有研究资料不会删除，仍可查看并使用创作工具。"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => {
                    setConfirmOpen(false);
                    void completeResearch();
                  }}
                  data-testid="research-confirm-dialog-accept"
                  className="inline-flex h-9 items-center rounded-lg border border-teal-300 bg-white px-3 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                >
                  {completing ? "确认中…" : "确认"}
                </button>
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => setConfirmOpen(false)}
                  data-testid="research-confirm-dialog-cancel"
                  className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
          {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        </section>
      );
    }
    return (
      <section className="mt-4 rounded-2xl border border-teal-200 bg-teal-50/60 p-4" data-testid="research-completed">
        <p className="text-sm font-bold text-teal-800">研究已完成并保存到研究记录。</p>
        <Link
          href="/tasks"
          className="mt-2 inline-flex h-9 items-center rounded-lg border border-teal-300 bg-white px-3 text-xs font-semibold text-teal-700 hover:bg-teal-50"
        >
          查看研究记录
        </Link>
      </section>
    );
  }

  const canComplete = latestStatus === "creative_ready" || latestStatus === "abandoned";
  const blockReason = !latestStatus
    ? "请先保存人工决定，再完成研究。"
    : latestStatus === "needs_information"
      ? "当前仍需补充资料，补充后再完成研究。"
      : "";

  /** 点击「确认研究结论仍然有效」→ 先显示组件内确认对话框（不依赖 window.confirm） */
  function requestComplete() {
    if (completing || !canComplete) return;
    setConfirmOpen(true);
  }

  async function completeResearch() {
    if (completing || !canComplete) return;
    // V3 Research Staleness UX Closure：stale 时是「重新确认」语义（创建 Version N+1）；
    // 首次完成保留原文案（Active → 研究记录）。
    // 轮 15 修复：确认对话框已是组件内 UI（requestComplete 打开），此处不再调用 window.confirm。
    setCompleting(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST",
        cache: "no-store",
        headers: { ...buildAccessHeaders() },
      });
      const data = await response.json() as { ok: boolean; error?: { message: string } };
      if (!response.ok || !data.ok) {
        setError(data.error?.message ?? "完成研究失败，请稍后重试。");
        return;
      }
      setDone(true);
      onCompleted?.();
    } catch {
      setError("网络异常，完成研究失败，请重试。");
    } finally {
      setCompleting(false);
    }
  }

  /** V3 Research Staleness UX Closure：修改人工决定 → 滚动到人工决定面板（不重跑研究） */
  function modifyDecision() {
    document.getElementById("product-research-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="research-completion-control">
      <p className="text-sm font-bold text-slate-900">完成研究</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        人工决定与完成研究是两个动作：保存决定表示研究判断；完成研究后，该商品会从「商品研究」移动到「研究记录」，
        现有研究资料不会删除，仍可查看并使用创作工具。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={completing || !canComplete}
          onClick={() => void requestComplete()}
          className="linear-button inline-flex h-10 items-center justify-center px-4 text-sm font-semibold disabled:opacity-50"
          data-testid="complete-research-button"
        >
          {completing ? "正在完成…" : "完成研究并保存记录"}
        </button>
        {blockReason ? <p className="text-xs font-semibold text-amber-700">{blockReason}</p> : null}
      </div>
      {confirmOpen ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-white p-4" data-testid="research-confirm-dialog" role="dialog" aria-label="完成研究确认">
          <p className="text-sm font-semibold text-slate-800">
            确认完成研究？
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            完成后，该商品会从『商品研究』移动到『研究记录』。现有研究资料不会删除，仍可查看并使用创作工具。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={completing}
              onClick={() => {
                setConfirmOpen(false);
                void completeResearch();
              }}
              data-testid="research-confirm-dialog-accept"
              className="inline-flex h-9 items-center rounded-lg border border-teal-300 bg-white px-3 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              {completing ? "确认中…" : "确认"}
            </button>
            <button
              type="button"
              disabled={completing}
              onClick={() => setConfirmOpen(false)}
              data-testid="research-confirm-dialog-cancel"
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
    </section>
  );
}

function getProductIdentity(result: unknown) {
  if (!isRecordValue(result)) return { asin: null, productUrl: null };
  const candidates = [result.product, result.normalizedProduct, result.normalized, result.candidateAnalysisContext]
    .filter(isRecordValue);
  const asin = candidates
    .map((candidate) => typeof candidate.asin === "string" ? candidate.asin.trim() : "")
    .find(Boolean) || null;
  const productUrl = candidates
    .map((candidate) => typeof candidate.productUrl === "string" ? candidate.productUrl.trim() : "")
    .find(Boolean) || null;
  return { asin, productUrl };
}

function getResearchEvidenceSections(result: unknown) {
  const agent = extractAgentOutputSnapshotFromTask(result);
  const evidence = extractDecisionEvidenceSnapshot(result);
  const marketSignals = uniqueStrings([
    agent?.sourcingSnapshot.supplierConclusion,
    ...(agent?.sourcingSnapshot.sourceSignals ?? []),
    ...(agent?.sourcingSnapshot.priceSignals ?? []),
    ...(agent?.sourcingSnapshot.availabilitySignals ?? []),
  ]);
  const risks = uniqueStrings([
    agent?.riskSnapshot.riskReason,
    ...(agent?.riskSnapshot.riskFlags ?? []),
    ...(agent?.riskSnapshot.complianceConcerns ?? []),
    ...(agent?.riskSnapshot.ipConcerns ?? []),
    ...(agent?.riskSnapshot.logisticsConcerns ?? []),
    ...(agent?.riskSnapshot.safetyConcerns ?? []),
    ...getStringArray(result, "risks"),
  ]);
  const evidenceGaps = uniqueStrings([
    ...(agent?.sourcingSnapshot.missingInfo ?? []),
    ...(agent?.listingSnapshot.missingInputs ?? []),
    ...(evidence?.missingData.map((item) => item.summary) ?? []),
  ]);
  const conflicts = uniqueStrings(evidence?.conflicts.map((item) => item.summary) ?? []);
  return { marketSignals, risks, evidenceGaps, conflicts };
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
  const hasVersionedDecision = hasVersionedProductResearchRecord(result);
  const hasListingData = isRecordValue(result) && isRecordValue(result.listing);
  const listingData = hasListingData ? (result.listing as { title?: string; keywords?: string[]; complianceNotes?: string[] }) : null;
  const agentOutputSnapshot = extractAgentOutputSnapshotFromTask(result);
  const decisionEvidence = extractDecisionEvidenceSnapshot(result);
  const operationSummary = deriveTaskOperationSummary({
    type: "workflow",
    title: fallbackTitle,
    materialText: fallbackTitle,
    oneLineSummary: "",
    level: "",
    decisionStatus,
    result,
  });

  // Phase Agent-Save-M.1: agent run snapshot
  const agentRunSnapshot = extractAgentRunSnapshot(result);
  const listingPrepSnapshot = extractListingPrepSnapshot(result) || (
    agentRunSnapshot ? null : null // will try fallback from listing data below
  );
  const agentRunTimelineItems = useMemo(
    () => deriveAgentRunTimelineItems({ result, decisionStatus }),
    [result, decisionStatus],
  );

  const decisionCard = useMemo(() => buildDecisionCard({
    resultJson: result,
    riskReviewSnapshot: hasRiskReviewSnapshot ? result.riskReviewSnapshot : undefined,
    profitSnapshot: hasProfitSnapshot ? result.profitSnapshot : undefined,
  }), [result, hasRiskReviewSnapshot, hasProfitSnapshot]);

  // Scroll refs for anchor navigation
  const evidenceRef = useRef<HTMLDivElement | null>(null);
  const listingRef = useRef<HTMLDivElement | null>(null);
  const scrollToRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const pipeStatus = derivePipelineStatus({ decisionStatus, level: "", result });
  const nextAct = deriveNextAction({ decisionStatus, level: "", result });
  const hasListingPrep = !!listingPrepSnapshot || hasListingData;

  return (
    <section className="mt-5 space-y-4">
      {/* ── Section 1: Hero — 当前决策与下一步 ── */}
      <TaskDecisionHero
        verdictLabel={summary.verdictLabel}
        reason={hasVersionedDecision
          ? "这是初始分析与流程复核快照；当前正式决定、原因和下一步以研究决定面板为准。"
          : summary.reason}
        riskLabel={summary.riskLabel}
        riskTone={summary.riskTone}
        beginnerLabel={summary.beginnerLabel}
        smallBatchLabel={summary.smallBatchLabel}
        nextActions={summary.nextActions}
        // V3 Human Decision Authority Consistency Fix：
        // 无正式决定（researchRecord/humanDecision）时，decisionStatus 兼容列（如存量 continue）
        // 不构成"人工决定已选择"——Hero 显示"待判断"，与决定面板"尚未保存"一致。
        decisionStatus={hasVersionedDecision ? decisionStatus : "pending"}
        stageLabel={operationSummary.stageLabel}
        blockingIssues={operationSummary.blockingIssues}
        reviewFocus={operationSummary.reviewFocus}
        evidence={decisionEvidence}
        pipelineStatus={pipeStatus}
        primaryNextAction={nextAct.label}
        hasListingPrep={hasListingPrep}
        onScrollToEvidence={() => scrollToRef(evidenceRef)}
        onScrollToListing={hasListingPrep ? () => scrollToRef(listingRef) : undefined}
      />

      {/* ── Section 2: 为什么得到这个结论 — Evidence + Decision Card ── */}
      <div ref={evidenceRef} className="scroll-mt-6">
        <DecisionCardUI card={decisionCard} compact />
      </div>
      <div className="mt-4">
        {hasVersionedDecision ? (
          <p className="mb-2 text-xs font-semibold text-slate-500">
            初始流程复核快照，不是当前正式研究决定。
          </p>
        ) : null}
        <DecisionEvidencePanel evidence={decisionEvidence} compact />
      </div>

      {/* ── Phase 2: Evidence Workbench（商品证据工作台） ── */}
      <EvidenceWorkbench taskId={taskId} result={result} />

      {/* ── Section 3: 接下来可以使用什么 — Listing ── */}
      {hasListingPrep && (
        <section ref={listingRef} className="scroll-mt-6 rounded-2xl border border-teal-200 bg-white p-4">
          <p className="text-sm font-bold text-teal-700">接下来可以使用什么</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            基于当前分析整理的规则草稿和上架准备包。内容不会自动上架，必须人工复核。
          </p>
        </section>
      )}

      {/* Listing 上架准备包 */}
      {listingPrepSnapshot ? (
        <section className="rounded-2xl border border-teal-200 bg-white p-4" data-testid="listing-prep-package">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-base font-bold text-teal-900">Listing 上架准备包</h4>
              <p className="mt-0.5 text-xs text-slate-500">规则草稿 · 基于当前分析结果整理 · 不会自动上架</p>
            </div>
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
            <p className="mt-2 text-sm text-slate-400 italic">待补充关键词 — 重新发起商品研究补充，或人工整理关键词后填入。</p>
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
                  return (
                    <>
                      <span>采购成本：{formatResearchMoney(ps.purchaseCost, currency, "待确认")}</span>
                      <span>建议售价：{formatResearchMoney(ps.salePrice, currency, "待确认")}</span>
                      <span>预估利润：{formatResearchMoney(ps.estimatedProfit, currency, "不可估算")}</span>
                      <span>毛利率：{formatResearchRate(ps.estimatedMarginRate, "不可估算")}</span>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400 italic">待补充成本/售价信息 — 重新发起商品研究填写采购价和售价后保存。</p>
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
        </section>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-500">Listing 上架准备包</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            该任务暂无 Listing 上架准备包。可重新发起商品研究并保存，或人工整理 Listing 资料。
          </p>
        </div>
      )}

      {/* 历史 Listing 包（只读展示，生成走「Listing 草稿」区） */}
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

      {/* 已保存图片草稿（只读展示；生成统一走上方「AI 生成图片草稿」Handoff 区） */}
      <AiImageDraftCard
        taskId={taskId}
        initialSnapshot={extractAiImageDraftSnapshot(result)}
        readOnly
      />

      {/* ── Section 4: 运营推进与状态 ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-bold text-slate-900">运营推进与状态</p>
        <p className="mt-1 text-sm text-slate-500">商品生命周期和人工决策状态追踪。</p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${toneClass(summary.priorityTone)}`}>
            {summary.priorityLabel}
          </span>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${toneClass(summary.riskTone)}`}>
            {summary.riskLabel}
          </span>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${decisionOption.className}`}>
            {decisionOption.shortLabel}
          </span>
        </div>

        {/* Source context */}
        {sourceMeta ? (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-teal-200 bg-white/70 px-3 py-2 text-sm text-teal-800">
            <div className="flex flex-wrap gap-2 font-semibold">
              <span>来自候选池</span>
              {sourceMeta.entry ? <span>入口：{sourceMeta.entry}</span> : null}
              {sourceMeta.candidateId ? <span>候选 ID：{sourceMeta.candidateId}</span> : null}
              {sourceMeta.opportunityScore !== undefined ? <span>来源分数 {sourceMeta.opportunityScore}/100</span> : null}
            </div>
            {sourceMeta.sourceUrl && (
              <a href={sourceMeta.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal-600 underline hover:text-teal-800">
                查看来源链接
              </a>
            )}
            {sourceMeta.evidenceSnapshot ? (
              <div className="rounded-lg border border-teal-100 bg-teal-50/70 px-2 py-1.5 text-xs text-teal-800">
                <p className="font-semibold">
                  来源证据：{sourceMeta.evidenceSnapshot.decision} · {sourceMeta.evidenceSnapshot.qualityScore}/100 · {sourceMeta.evidenceSnapshot.confidence}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-teal-600">历史任务未记录标准化来源证据。</p>
            )}
          </div>
        ) : null}

        {/* Lifecycle + Decision */}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {isWorkflow && productLifecycle && (
            <OperationDecisionPanel taskId={taskId} lifecycle={productLifecycle} onUpdated={onLifecycleUpdated} />
          )}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-400">人工决策</p>
            {hasVersionedDecision ? (
              <div className="mt-2 rounded-lg border border-teal-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-teal-800">研究决定已记录，请在上方专用面板更新。</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">当前正式决定、原因和下一步以研究决定面板为准。</p>
              </div>
            ) : (
              // V3 Legacy Removal：早期候选任务的决定状态只读展示（不再提供旧版写入口）
              <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">当前决定：{decisionOption.shortLabel}</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">{decisionOption.description}</p>
              </div>
            )}
          </div>
        </div>

        <Link
          href="/opportunities"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-900 transition"
        >
          回到候选池 →
        </Link>
      </section>

      {/* ── Section 5: 过程与原始记录（默认折叠）── */}
      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
          过程与原始记录
          <span className="ml-2 text-xs font-medium text-slate-400">研究过程、完整分析、成本利润明细，默认折叠</span>
        </summary>

        <div className="mt-4 space-y-4">
          {/* AgentOutputSnapshotCard */}
          {agentOutputSnapshot && (
            <AgentOutputSnapshotCard snapshot={agentOutputSnapshot} compact />
          )}

          {/* 商品研究复盘 */}
          {agentRunSnapshot ? (
            <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4" data-testid="agent-run-review">
              <h3 className="text-base font-bold text-indigo-900">商品研究复盘</h3>
              <p className="mt-0.5 text-sm leading-6 text-indigo-600">
                来自商品研究流程 · 受控自动化 · {agentRunSnapshot.manualConfirmed ? "人工已确认" : "未完整确认"}
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
              <AgentRunTimeline items={agentRunTimelineItems} className="mt-3" />
              {agentRunSnapshot.nextSteps && agentRunSnapshot.nextSteps.length > 0 && (
                <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-700">下一步动作</p>
                  <ul className="mt-1 space-y-0.5">
                    {agentRunSnapshot.nextSteps.map((s, i) => <li key={i} className="text-sm text-slate-600">- {s}</li>)}
                  </ul>
                </div>
              )}
            </section>
          ) : null}

          {/* 成本利润 + 风险预筛快照 */}
          <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-600 select-none">
              保存快照：成本利润 + 合规/侵权 AI 预筛
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
              ) : null}
            </div>
          </details>
        </div>
      </details>

      {/* ── Section 6: 人工确认提醒 ── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
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
  lines.push("轻选工作台自动生成 · AI 结论仅供辅助参考");
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

type FormalV2Module = {
  key: "market" | "buyers" | "sourcing" | "cost-risk";
  number: string;
  title: string;
  conclusion: string;
  evidence: string[];
  missing: string;
  nextLabel: string;
  nextHref: string;
};

export type FormalV2ResearchView = {
  productName: string;
  category: string;
  market: string;
  asin: string | null;
  status: ReturnType<typeof deriveResearchHistoryStatus>;
  headline: string;
  modules: FormalV2Module[];
  hasListingDraft: boolean;
  hasImageDraft: boolean;
};

function formalRecord(value: unknown) {
  return isRecordValue(value) ? value : null;
}

function formalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formalTexts(value: unknown, limit = 3) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => {
    if (typeof item === "string") return item;
    if (!isRecordValue(item)) return null;
    return formalText(item.text) || formalText(item.summary) || formalText(item.value) || formalText(item.label) || null;
  }), limit);
}

function formalMarketName(value: unknown) {
  const market = formalText(value).toUpperCase();
  const labels: Record<string, string> = {
    US: "Amazon 美国站",
    CA: "Amazon 加拿大站",
    UK: "Amazon 英国站",
    DE: "Amazon 德国站",
    FR: "Amazon 法国站",
    IT: "Amazon 意大利站",
    ES: "Amazon 西班牙站",
  };
  return labels[market] || (market ? `${market} 市场` : "市场尚未取得");
}

function formalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
    : "";
}

function formalProductFacts(result: Record<string, unknown>) {
  const sourceMeta = formalRecord(result.sourceMeta);
  const batch = formalRecord(sourceMeta?.productBatchSnapshot);
  const product = formalRecord(batch?.productFacts);
  const candidateContext = formalRecord(result.candidateAnalysisContext);
  const productObjects = [result.product, result.normalizedProduct, result.normalized]
    .map(formalRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const firstProductText = (key: string) => productObjects.map((item) => formalText(item[key])).find(Boolean) || "";
  const category = formalText(batch?.category)
    || formalText(product?.rootCategory)
    || firstProductText("category")
    || formalText(result.category)
    || "类目尚未取得";
  const market = formalMarketName(formalText(batch?.marketplace) || firstProductText("marketplace"));
  const asin = formalText(batch?.asin)
    || formalText(candidateContext?.asin)
    || productObjects.map((item) => formalText(item.asin)).find(Boolean)
    || null;
  return { sourceMeta, batch, product, category, market, asin };
}

function formalSnapshotEvidence(product: Record<string, unknown> | null) {
  if (!product) return [];
  return uniqueStrings([
    formalNumber(product.rating) ? `评分 ${formalNumber(product.rating)}` : null,
    formalNumber(product.reviews) ? `评论数 ${formalNumber(product.reviews)}` : null,
    formalNumber(product.estimatedMonthlySales) ? `来源快照月销量估算 ${formalNumber(product.estimatedMonthlySales)}` : null,
    formalNumber(product.estimatedMonthlyRevenue) ? `来源快照月销售额估算 ${formalNumber(product.estimatedMonthlyRevenue)}` : null,
    formalNumber(product.subCategoryBsr) ? `子类目排名 #${formalNumber(product.subCategoryBsr)}` : null,
  ], 3);
}

export function deriveFormalV2ResearchView(record: TaskCenterItem): FormalV2ResearchView {
  const result = formalRecord(record.result) ?? {};
  const productName = resolveTaskProductDisplayName({
    resultProductName: result.productName,
    taskTitle: record.title,
    materialText: record.materialText,
    fallback: "商品名称尚未取得",
  });
  const facts = formalProductFacts(result);
  const finalReport = formalRecord(result.finalReport);
  const agentOutput = formalRecord(result.agentOutputSnapshot);
  const sourcing = formalRecord(agentOutput?.sourcingSnapshot);
  const risk = formalRecord(agentOutput?.riskSnapshot);
  const summary = formalRecord(agentOutput?.summarySnapshot);
  const decisionEvidence = formalRecord(result.decisionEvidence);
  const evidenceItems = formalTexts(decisionEvidence?.items, 4);
  const evidenceMissing = formalTexts(decisionEvidence?.missingData, 4);
  const profit = formalRecord(result.profitSnapshot) ?? formalRecord(formalRecord(result.agentRunSnapshot)?.profitSnapshot);
  const riskReview = formalRecord(result.riskReviewSnapshot) ?? formalRecord(formalRecord(result.agentRunSnapshot)?.riskReviewSnapshot);
  const presentation = deriveProductResearchPresentation({
    id: record.id,
    title: productName,
    type: record.type,
    decisionStatus: record.decisionStatus,
    result,
  });
  const headline = formalText(summary?.decisionReason)
    || formalText(finalReport?.finalVerdict)
    || formalText(finalReport?.decisionReason)
    || presentation.researchConclusions[0]
    || formalText(record.oneLineSummary)
    || "AI 研究结论尚未取得。";

  const buyerSignals = uniqueStrings([
    ...formalTexts(summary?.concerns, 2),
    ...formalTexts(result.painPoints, 2),
  ], 3);
  const sourcingEvidence = uniqueStrings([
    ...formalTexts(sourcing?.sourceSignals, 2),
    ...formalTexts(sourcing?.priceSignals, 2),
    ...formalTexts(sourcing?.availabilitySignals, 2),
  ], 3);
  const riskEvidence = uniqueStrings([
    formalText(risk?.riskReason) || null,
    formalText(riskReview?.summary) || formalText(riskReview?.precheckReason) || null,
    ...formalTexts(risk?.riskFlags, 2),
    ...formalTexts(risk?.complianceConcerns, 2),
  ], 3);
  const costEvidence = uniqueStrings([
    formalNumber(profit?.purchaseCost) ? `采购成本 ${formalNumber(profit?.purchaseCost)}` : null,
    formalNumber(profit?.salePrice) ? `预计售价 ${formalNumber(profit?.salePrice)}` : null,
    formalNumber(profit?.estimatedProfit) ? `利润估算 ${formalNumber(profit?.estimatedProfit)}` : null,
    ...riskEvidence,
  ], 3);
  const sourcingMissing = formalTexts(sourcing?.missingInfo, 2)[0];

  return {
    productName,
    category: facts.category,
    market: facts.market,
    asin: facts.asin,
    status: deriveResearchHistoryStatus({
      result,
      decisionStatus: record.decisionStatus,
      oneLineSummary: record.oneLineSummary,
    }),
    headline,
    modules: [
      {
        key: "market",
        number: "01",
        title: "市场机会",
        conclusion: formalText(summary?.decisionReason) || presentation.researchConclusions[0] || "市场机会的 AI 结论尚未取得。",
        evidence: formalSnapshotEvidence(facts.product).length ? formalSnapshotEvidence(facts.product) : evidenceItems.slice(0, 3),
        missing: evidenceMissing[0] || (formalSnapshotEvidence(facts.product).length ? "竞争强度与可持续销量依据尚未取得。" : "市场销量、竞争和价格依据尚未取得。"),
        nextLabel: "核对市场依据",
        nextHref: "#formal-v2-materials",
      },
      {
        key: "buyers",
        number: "02",
        title: "买家需求与差评",
        conclusion: buyerSignals[0] || "买家需求与差评的 AI 结论尚未取得。",
        evidence: buyerSignals,
        missing: buyerSignals.length ? "评论样本范围与代表性仍需人工核对。" : "买家评论与差评数据尚未取得。",
        nextLabel: "核对评论依据",
        nextHref: "#formal-v2-materials",
      },
      {
        key: "sourcing",
        number: "03",
        title: "货源与商品匹配",
        conclusion: formalText(sourcing?.supplierConclusion) || "货源与商品匹配的 AI 结论尚未取得。",
        evidence: sourcingEvidence,
        missing: sourcingMissing || "供应商、MOQ、报价与交期尚未取得。",
        nextLabel: "补充货源资料",
        nextHref: "#formal-v2-materials",
      },
      {
        key: "cost-risk",
        number: "04",
        title: "成本与风险",
        conclusion: formalText(risk?.riskReason) || formalText(riskReview?.summary) || "成本与风险的 AI 结论尚未取得。",
        evidence: costEvidence,
        missing: profit ? "物流、平台费用和广告预算仍需人工核对。" : "采购、物流、平台费用和广告预算尚未取得。",
        nextLabel: "补充成本与风险资料",
        nextHref: "#formal-v2-materials",
      },
    ],
    hasListingDraft: isRecordValue(result.aiListingPackSnapshot) || isRecordValue(result.listingPackSnapshot) || isRecordValue(result.listing),
    hasImageDraft: Boolean(extractAiImageDraftSnapshot(result)),
  };
}

/**
 * §3.3 主操作推导：考虑任务类型，且只返回当前 DOM 中真实存在的目标。
 * - workflow（正式研究任务）才允许"人工决定/重新确认"目标；
 * - 非 workflow 的 stale/待决定 → 回退到真实存在的资料区目标，绝不给出点击后无反应的按钮。
 */
export type FormalV2PrimaryAction = {
  label: string;
  targetId: string;
  focusSelector: string;
};

export function deriveFormalV2PrimaryAction(input: {
  statusKey: ResearchHistoryStatus["key"];
  researchStale: boolean;
  taskType: string;
}): FormalV2PrimaryAction {
  const formalDecision = input.taskType === "workflow";
  if (input.researchStale && formalDecision) {
    return {
      label: "重新确认研究资料",
      targetId: "product-research-decision",
      focusSelector: '[data-testid="research-stale-notice"] button',
    };
  }
  if (input.researchStale && !formalDecision) {
    return {
      label: "重新核对研究资料",
      targetId: "formal-v2-materials",
      focusSelector: "summary",
    };
  }
  if (input.statusKey === "completed") {
    return {
      label: "查看 Listing 与图片",
      targetId: "listing-and-images",
      focusSelector: "h2",
    };
  }
  if (input.statusKey === "awaiting_decision" && formalDecision) {
    return {
      label: "记录人工决定",
      targetId: "product-research-decision",
      focusSelector: "h2",
    };
  }
  return {
    label: "补充研究资料",
    targetId: "formal-v2-materials",
    focusSelector: "summary",
  };
}

/** §3.6 顶部主操作按钮：真实 aria-controls + 动态 aria-expanded。 */
export function FormalV2PrimaryActionTrigger({
  primary,
  expanded,
  onActivate,
}: {
  primary: FormalV2PrimaryAction;
  expanded: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-controls={primary.targetId}
      aria-expanded={expanded}
      onClick={onActivate}
      className="linear-button-primary inline-flex h-11 shrink-0 items-center justify-center px-5 text-sm font-semibold"
      data-testid="formal-v2-primary-action"
    >
      {primary.label}
    </button>
  );
}

export function formalV2ImageCopy(hasImageDraft: boolean) {
  return hasImageDraft
    ? {
      headline: "这张 AI 图片暂时不能直接使用。",
      guidance: "发布前必须用真实参考图逐项核验。",
      verificationReasons: [
        "无法仅凭 AI 图片确认是不是同一个商品",
        "无法确认产品结构、颜色和数量与真实商品一致",
      ],
    }
    : {
      headline: "商品图片尚未取得。",
      guidance: "请补充清晰真实参考图。",
      verificationReasons: [],
    };
}

/** 默认激活函数：展开目标自身 + 最近封闭的祖先 details（内部目标位于总资料区时自动展开外层）。 */
function openDetails(node: HTMLElement | null) {
  let current = node;
  while (current) {
    if (current.tagName === "DETAILS" && "open" in current) {
      (current as unknown as HTMLDetailsElement).open = true;
    }
    current = current.parentElement;
  }
}

export function activateFormalV2Target(targetId: string, focusSelector: string): boolean {
  const section = document.getElementById(targetId);
  if (!section) return false;
  // 环境无关的 details 展开（不依赖 HTMLDetailsElement 全局存在）；内部目标需展开祖先 details
  if ("open" in section && typeof (section as HTMLDetailsElement).open === "boolean") {
    (section as HTMLDetailsElement).open = true;
  }
  openDetails(section.parentElement);
  const focusTarget = section.querySelector<HTMLElement>(focusSelector) ?? section;
  if (!focusTarget.matches("button, a, input, select, textarea, summary, [tabindex]")) {
    focusTarget.tabIndex = -1;
  }
  window.history.replaceState(null, "", `#${targetId}`);
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  focusTarget?.focus({ preventScroll: true });
  return true;
}

/** 四张业务卡 → 各自真实资料目标（按钮去向真实准确优先于其它）。 */
const MODULE_EVIDENCE_TARGETS: Readonly<Record<string, string>> = {
  market: "formal-v2-market-evidence",
  buyers: "formal-v2-buyer-evidence",
  sourcing: "formal-v2-sourcing-evidence",
  "cost-risk": "formal-v2-cost-risk-evidence",
};

function FormalV2ModuleCard({ module, onNext }: { module: FormalV2Module; onNext: () => void }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={`formal-v2-module-${module.key}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">{module.number}</span>
        <h3 className="text-base font-semibold text-slate-950">{module.title}</h3>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-6">
        <div>
          <p className="text-xs font-semibold text-slate-400">AI 结论</p>
          <p className="mt-1 text-slate-700">{module.conclusion}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400">关键依据</p>
          {module.evidence.length ? (
            <ul className="mt-1 space-y-1 text-slate-700">
              {module.evidence.map((item) => <li key={item}>· {item}</li>)}
            </ul>
          ) : <p className="mt-1 text-slate-500">尚未取得可核实的关键依据。</p>}
        </div>
        <div>
          <p className="text-xs font-semibold text-amber-700">缺什么</p>
          <p className="mt-1 text-amber-800">{module.missing}</p>
        </div>
      </div>
      <button type="button" aria-controls={MODULE_EVIDENCE_TARGETS[module.key] ?? "formal-v2-materials"} onClick={onNext} className="linear-button mt-4 inline-flex h-9 items-center justify-center px-3 text-sm font-semibold">
        {module.nextLabel}
      </button>
    </section>
  );
}

function RecordFooter({
  isActiveResearchView,
  deleting,
  deleteError,
  onDelete,
}: {
  isActiveResearchView: boolean;
  deleting: boolean;
  deleteError: string;
  onDelete: () => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onDelete} disabled={deleting} className="inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-5 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60">
        {deleting ? "删除中…" : "删除这条记录"}
      </button>
      <Link href={isActiveResearchView ? "/research" : "/tasks"} className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">{isActiveResearchView ? "返回商品研究" : "返回研究记录"}</Link>
      {deleteError ? <p className="text-sm font-semibold text-rose-700">{deleteError}</p> : null}
    </div>
  );
}

/**
 * §4 非 workflow 记录：保留既有（Formal v2 之前）详情展示——商品身份/来源+证据工作台+行为化结果卡，
 * 不套用 Formal v2 四模块；不出现 Formal v2 主操作。
 */
function LegacyRecordContent({
  record,
  deleting,
  deleteError,
  onDelete,
  onUpdated,
  isActiveResearchView,
}: {
  record: TaskCenterItem;
  deleting: boolean;
  deleteError: string;
  onDelete: () => void;
  onUpdated: () => void;
  isActiveResearchView: boolean;
}) {
  const result = isRecordValue(record.result) ? record.result as Record<string, unknown> : null;
  const productIdentity = getProductIdentity(result);
  const publicProductUrl = safePublicHttpUrl(record.productUrl) ?? safePublicHttpUrl(productIdentity.productUrl);
  const decisionEvidence = result ? extractDecisionEvidenceSnapshot(result) : null;
  const status = result && record ? deriveResearchHistoryStatus({
    result,
    decisionStatus: record.decisionStatus,
    oneLineSummary: record.oneLineSummary,
  }) : null;
  return (
    <section className="surface-card p-5 sm:p-6" data-testid="legacy-record-content">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-4">
          <ResearchProductImage image={record.productImage} alt={getTitle(record)} size="detail" />
          <div className="min-w-0">
            {status ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">{status.label}</span>
                <span className="text-xs text-slate-500">人工决定：{status.humanDecisionExists ? "已记录" : "待确认"}</span>
              </div>
            ) : null}
            <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-950">{getTitle(record)}</h2>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
              <span>来源：{sourceLabel(record.source)}</span>
              <span>研究时间：{formatDate(record.createdAt)}</span>
              {productIdentity.asin ? <span>ASIN：{productIdentity.asin}</span> : null}
            </div>
            {publicProductUrl ? (
              <a href={publicProductUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex break-all text-sm font-semibold text-teal-700 hover:text-teal-900">查看商品来源链接</a>
            ) : null}
          </div>
        </div>
      </section>
      {decisionEvidence ? <DecisionEvidencePanel evidence={decisionEvidence} compact /> : null}
      {result ? <EvidenceWorkbench taskId={record.id} result={result} onDataChanged={onUpdated} /> : null}
      {result ? <WorkflowResultSection result={result} /> : null}
      <RecordFooter isActiveResearchView={isActiveResearchView} deleting={deleting} deleteError={deleteError} onDelete={onDelete} />
    </section>
  );
}

function FormalV2RecordContent({
  record,
  researchStale,
  studioLegacyUnsupported,
  deleting,
  deleteError,
  onDelete,
  onUpdated,
  isActiveResearchView,
}: {
  record: TaskCenterItem;
  researchStale: boolean;
  studioLegacyUnsupported: boolean;
  deleting: boolean;
  deleteError: string;
  onDelete: () => void;
  onUpdated: () => void;
  isActiveResearchView: boolean;
}) {
  const view = deriveFormalV2ResearchView(record);
  const result = formalRecord(record.result) ?? {};
  const publicProductUrl = safePublicHttpUrl(record.productUrl) || safePublicHttpUrl(getProductIdentity(result).productUrl);
  const primary = deriveFormalV2PrimaryAction({ statusKey: view.status.key, researchStale, taskType: record.type });
  const imageCopy = formalV2ImageCopy(view.hasImageDraft);
  const [primaryOpen, setPrimaryOpen] = useState(false);

  return (
    <section className="surface-card p-5 sm:p-6" data-testid="formal-v2-product-result">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="商品结论">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <ResearchProductImage image={record.productImage} alt={view.productName} size="detail" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">{researchStale ? "研究资料需重新确认" : view.status.label}</span>
                <span className="text-xs text-slate-500">{view.category} · {view.market}</span>
              </div>
              <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-950">{view.productName}</h2>
              {view.asin ? <p className="mt-1 text-xs text-slate-500">ASIN：{view.asin}</p> : null}
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700">{view.headline}</p>
              {publicProductUrl ? (
                <a href={publicProductUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-sm font-semibold text-teal-700 hover:text-teal-900">查看商品来源</a>
              ) : null}
            </div>
          </div>
          <FormalV2PrimaryActionTrigger
            primary={primary}
            expanded={primaryOpen}
            onActivate={() => {
              activateFormalV2Target(primary.targetId, primary.focusSelector);
              setPrimaryOpen(true);
            }}
          />
        </div>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="研究模块">
        {view.modules.map((module) => (
          <FormalV2ModuleCard
            key={module.key}
            module={module}
            onNext={() => activateFormalV2Target(MODULE_EVIDENCE_TARGETS[module.key] ?? "formal-v2-materials", "h3")}
          />
        ))}
      </section>

      <details
        id="formal-v2-materials"
        className="mt-5 rounded-2xl border border-slate-200 bg-white p-4"
        data-testid="formal-v2-materials"
        onToggle={(event) => setPrimaryOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">核对与补充当前研究资料</summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">这里只显示当前正式研究记录；缺失数据不会由 AI 猜测补齐。</p>
        <div className="mt-4">
          <EvidenceWorkbench taskId={record.id} result={result} sourceImageUrl={resolvePublicSourceImageUrl(result)} onDataChanged={onUpdated} />
        </div>
      </details>

      {record.type === "workflow" ? (
        <section id="product-research-decision" className="mt-5 rounded-2xl border border-slate-200 bg-white p-4" data-testid="research-decision-section">
          <h2 className="text-base font-semibold text-slate-950">人工决定</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">AI 只整理依据，是否继续由你确认。</p>
          <ProductResearchDecisionPanel taskId={record.id} onUpdated={onUpdated} />
          <ResearchCompletionControl
            taskId={record.id}
            result={result}
            researchStale={researchStale}
            evidenceChangesSinceCompletion={(record as { evidenceChangesSinceCompletion?: Array<{ evidenceType: string; source: string; capturedAt: string; summary: string }> }).evidenceChangesSinceCompletion}
            onCompleted={onUpdated}
          />
        </section>
      ) : null}

      <section id="listing-and-images" className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Listing 与商品图片" data-testid="formal-v2-listing-images">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-950">Listing 与商品图片</h2>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">发布前需人工确认</span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
            <p className="text-sm font-semibold text-rose-700">Listing</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-rose-700">
              {view.hasListingDraft ? "历史未核实草稿，禁止使用。" : "Listing 草稿尚未取得。"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">必须先核对商品事实、关键词、合规表述和平台规则，不能直接发布。</p>
            {!studioLegacyUnsupported && !researchStale ? (
              <Link href={`/listing-studio?taskId=${encodeURIComponent(record.id)}`} className="linear-button mt-4 inline-flex h-9 items-center justify-center px-3 text-sm font-semibold">前往 Listing Studio 核对</Link>
            ) : <p className="mt-3 text-xs font-semibold text-amber-700">{researchStale ? "研究资料已变化，请先重新确认研究。" : "当前记录的创作资料尚未取得。"}</p>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-sm font-semibold text-slate-900">商品图片</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{imageCopy.headline}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">{imageCopy.guidance}</p>
            {imageCopy.verificationReasons.length ? (
              <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                {imageCopy.verificationReasons.map((reason) => <li key={reason}>· {reason}</li>)}
              </ul>
            ) : null}
            {!studioLegacyUnsupported && !researchStale ? (
              <Link href={`/image-studio?taskId=${encodeURIComponent(record.id)}`} className="linear-button mt-4 inline-flex h-9 items-center justify-center px-3 text-sm font-semibold">
                {view.hasImageDraft ? "补充清晰参考图后重新检查" : "提供清晰参考图"}
              </Link>
            ) : (
              <p className="mt-3 text-xs font-semibold text-amber-700">{researchStale ? "研究资料已变化，请先重新确认研究。" : "当前记录暂无可用的补图入口（历史记录未生成创作上下文）。"}</p>
            )}
          </div>
        </div>
      </section>

      <RecordFooter isActiveResearchView={isActiveResearchView} deleting={deleting} deleteError={deleteError} onDelete={onDelete} />
    </section>
  );
}

export function TaskRecordDetail({ id }: { id: string }) {
  const [accessPassword, , isAccessPasswordReady, , noAuthOwner] = useAccessPassword();
  // V3.1 Phase 1: Anonymous Guest（凭据在 HttpOnly Cookie，sessionStorage 无 token/密码）视为已解锁
  // V3.1 local_owner（显式）：无认证回环信任 → 直接解锁
  const unlocked = ((isAccessPasswordReady && accessPassword.trim().length > 0) || isGuestMode()) || noAuthOwner;
  const router = useRouter();
  const [record, setRecord] = useState<TaskCenterItem | null>(null);

  // F1：研究骨架判定 + AI 研究执行入口（无 researchRecord 时显示引导卡）
  // R5：统一生命周期分类（breadcrumb/h1/返回链接/Studio gate 复用）
  const researchLifecycle = useMemo(() => record
    ? classifyResearchLifecycle({ decisionStatus: record.decisionStatus, result: isRecordValue(record.result) ? record.result : null, type: record.type })
    : { lifecycle: "active" as const, detail: "active_open" as const }, [record]);
  const isActiveResearchView = researchLifecycle.lifecycle === "active";
  const recordHasResearchRecord = useMemo(() => {
    if (!record || !isRecordValue(record.result)) return false;
    return Object.prototype.hasOwnProperty.call(record.result, "researchRecord")
      || Object.prototype.hasOwnProperty.call(record.result, "researchVerification")
      || hasVersionedProductResearchRecord(record.result);
  }, [record]);
  // V3 Legacy Removal：早期候选任务（无新版创作上下文）→ 不显示创作工具区
  const studioLegacyUnsupported = record !== null && !hasVersionedProductResearchRecord(record.result);
  // V3 Research Staleness UX Closure：研究资料在完成研究后发生变化 → 创作 CTA 禁用（需重新确认研究）
  const researchStale = (record as { researchStale?: boolean } | null)?.researchStale === true;
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [copied, setCopied] = useState(false);

  // Prevent stale async responses from overwriting newer state
  const reqIdRef = useRef(0);

  /**
   * 轻量刷新：成功写入（Handoff / Listing / Image）后重读服务端真实任务状态。
   * 保留当前内容直到新数据到达（不整页闪 loading、不卸载子组件、不丢失展开状态），
   * 以服务端持久化结果为唯一事实源，不维护第二套前端进度状态。
   * 失败静默：进度摘要保持旧值，不打断用户操作，绝不错误推进。
   */
  const refreshRecord = useCallback(async () => {
    reqIdRef.current += 1;
    const currentId = reqIdRef.current;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        cache: "no-store",
        headers: { ...buildAccessHeaders() },
      });
      if (currentId !== reqIdRef.current) return;
      const data = await response.json() as DetailResponse;
      if (currentId !== reqIdRef.current) return;
      if (!response.ok || !data.ok || !data.data) return;
      setRecord(data.data);
      setLoading(false);
    } catch {
      // 刷新失败保持现有内容（进度摘要保留旧值，不打断用户）
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    if (!isAccessPasswordReady) {
      setLoading(true);
      setError("");
      return () => {
        cancelled = true;
      };
    }

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword) && !isGuestMode()) {
      setRecord(null);
      setLoading(false);
      setError("请先输入访问密码后查看任务详情。");
      return () => {
        cancelled = true;
      };
    }

    async function loadRecord() {
      // Bump request id so any in-flight stale response is discarded
      reqIdRef.current += 1;
      const currentId = reqIdRef.current;

      setLoading(true);
      setError("");
      setRecord(null);
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
          cache: "no-store",
          headers: { ...buildAccessHeaders() },
        });
        // Discard if a newer request has already started
        if (cancelled || currentId !== reqIdRef.current) return;

        const data = await response.json() as DetailResponse;
        if (cancelled || currentId !== reqIdRef.current) return;

        if (!response.ok || !data.ok) {
          setRecord(null);
          setError(data.ok ? "任务详情读取失败。" : data.error.message);
          return;
        }
        setRecord(data.data);
      } catch {
        if (cancelled || currentId !== reqIdRef.current) return;
        setRecord(null);
        setError("任务详情暂时无法读取，请稍后刷新。");
      } finally {
        if (!cancelled && currentId === reqIdRef.current) {
          setLoading(false);
        }
      }
    }

    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [id, accessPassword, isAccessPasswordReady]);


  
  const aiListingPackSnapshot = useMemo(() => (
    record ? getAiListingPackSnapshot(record.result) : null
  ), [record]);
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
  const presentation = useMemo(() => (
    record
      ? deriveProductResearchPresentation({
        id: record.id,
        title: getTitle(record),
        type: record.type,
        decisionStatus: record.decisionStatus,
        result: record.result,
      })
      : null
  ), [record]);
  const researchHistoryStatus = useMemo(() => (
    record
      ? deriveResearchHistoryStatus({
        result: record.result,
        decisionStatus: record.decisionStatus,
        oneLineSummary: record.oneLineSummary,
      })
      : null
  ), [record]);
  const creativeMaterialStatus = useMemo(() => (
    record ? deriveCreativeMaterialStatus(record.result) : null
  ), [record]);
  const historicalArtifacts = useMemo(() => (
    record ? deriveHistoricalArtifactSummary(record.result) : null
  ), [record]);
  const researchEvidenceSections = useMemo(() => (
    record ? getResearchEvidenceSections(record.result) : null
  ), [record]);
  const productIdentity = useMemo(() => (
    record ? getProductIdentity(record.result) : { asin: null, productUrl: null }
  ), [record]);
  const publicProductUrl = useMemo(() => (
    safePublicHttpUrl(record?.productUrl) ?? safePublicHttpUrl(productIdentity.productUrl)
  ), [record?.productUrl, productIdentity.productUrl]);
  const imageDraftSnapshot = useMemo(() => (
    record ? extractAiImageDraftSnapshot(record.result) : null
  ), [record]);
  const legacyListingPackSnapshot = useMemo(() => {
    if (!record || !isRecordValue(record.result)) return null;
    const snapshot = record.result.listingPackSnapshot;
    if (!isRecordValue(snapshot) || !isRecordValue(snapshot.pack)) return null;
    return {
      savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : undefined,
      source: typeof snapshot.source === "string" ? snapshot.source : undefined,
      pack: snapshot.pack as unknown as ListingPack,
    };
  }, [record]);

  async function deleteRecord() {
    if (!record || deleting) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setDeleteError("请先输入访问密码后删除任务。");
      return;
    }

    const confirmed = window.confirm(buildTaskDeleteConfirmationMessage({
      result: record.result,
    }));
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
      // 任务删除成功 → 清除该任务的创作交接草稿（不再恢复）
      clearSessionDraftsForEntity("creative-handoff", record.id);
      router.push("/tasks");
      router.refresh();
    } catch {
      setDeleteError("删除失败，请检查本地服务后重试。");
    } finally {
      setDeleting(false);
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
    return <WorkspaceLockedPrompt pageName="商品研究结果" returnUrl={`/tasks/${id}`} />;
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
                  {/* R5：Active=商品研究 / Historical=研究记录 */}
                  <Link href={isActiveResearchView ? "/research" : "/tasks"} className="hover:text-teal-600">{isActiveResearchView ? "商品研究" : "研究记录"}</Link>
                  <span>/</span>
                  {record && <span className="font-medium text-slate-700 truncate max-w-[200px]">{getTitle(record)}</span>}

                </nav>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  {isActiveResearchView ? "商品研究" : "研究记录"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  {record ? `${getTitle(record)} · ` : ""}{recordHasResearchRecord ? "查看研究结论、风险、待确认信息和人工决定；创作工具按需单独使用。" : "商品研究工作台：收集资料、让 AI 整理、最后做人工决定。"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={isActiveResearchView ? "/research" : "/tasks"}
                  className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  {isActiveResearchView ? "返回商品研究" : "返回研究记录"}
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
              正在读取研究记录…
            </section>
          ) : error ? (
            <section className="surface-card p-6">
              <p className="text-sm font-bold text-rose-700">{error}</p>
              <Link href="/tasks" className="mt-5 inline-flex text-sm font-bold text-teal-700">
                返回研究记录
              </Link>
            </section>
          ) : record ? (
            <>
              {record.type === "workflow" ? (
                <FormalV2RecordContent
                  record={record}
                  researchStale={researchStale}
                  studioLegacyUnsupported={studioLegacyUnsupported}
                  deleting={deleting}
                  deleteError={deleteError}
                  onDelete={() => void deleteRecord()}
                  onUpdated={() => void refreshRecord()}
                  isActiveResearchView={isActiveResearchView}
                />
              ) : (
                <LegacyRecordContent
                  record={record}
                  deleting={deleting}
                  deleteError={deleteError}
                  onDelete={() => void deleteRecord()}
                  onUpdated={() => void refreshRecord()}
                  isActiveResearchView={isActiveResearchView}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
