"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  FileText,
  Loader2,
  PackageCheck,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import { ResearchProductImage } from "@/components/ResearchProductImage";
import { useAccessPassword } from "@/lib/client/accessPassword";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import {
  buildAccessHeaders,
  getAccessMode,
  getDemoAccessInfo,
  updateDemoAccessSnapshot,
  type DemoAccessInfo,
} from "@/lib/client/accessToken";
import { ProfitSnapshotCard, type ProfitSnapshot } from "@/components/cross-border/ProfitSnapshotCard";
import { RiskReviewChecklistCard } from "@/components/cross-border/RiskReviewChecklistCard";
import { ListingPrepPackageCard } from "@/components/cross-border/ListingPrepPackageCard";
import type { RiskPrecheckInput, RiskReviewSnapshot } from "@/lib/riskReview";
import { buildAgentRunSnapshot, buildListingPrepSnapshot } from "@/lib/agentRunSnapshot";
import { buildDecisionCard } from "@/lib/decisionCard";
import { DecisionCard as DecisionCardUI } from "@/components/DecisionCard";
import { readJsonApiResponse } from "@/lib/client/safeApiResponse";
import {
  clearAgentRunCandidateCaches,
  saveAgentRunCache,
  loadAgentRunCache,
  loadLatestAgentRunCache,
  type CachedSourceMeta,
} from "@/lib/agentRunCache";
import { canSubmitAgentRunSave, getAgentRunSaveErrorMessage } from "@/lib/agentRunSave";
import { isAuthoritativeCandidateId } from "@/lib/opportunityCandidatePool";
import type { CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import type { R22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";
import type { R22CommercialRunSnapshot } from "@/lib/r22CommercialValidation";
import { normalizeAgentOutputSnapshot } from "@/lib/agentOutputSnapshot";
import { AgentOutputSnapshotCard } from "@/components/AgentOutputSnapshotCard";
import { DecisionEvidencePanel } from "@/components/DecisionEvidencePanel";
import { buildDecisionEvidenceSnapshot } from "@/lib/decisionEvidence";
import { decisionStatusOptions, normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";
import {
  parseCandidateResearchContext,
  type CandidateResearchContext,
} from "@/lib/candidateResearchContext";
import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";
import { createBrowserUuid } from "@/lib/browserUuid";

type ApiStepKey = "normalize" | "sourcing" | "risk" | "summary" | "listing" | "report";
type ApiStepStatus = "completed" | "fallback" | "failed";

type ApiStep = {
  key: ApiStepKey;
  label: string;
  status: ApiStepStatus;
  summary: string;
  warnings: string[];
};

type ApiFinalReport = {
  finalVerdict: string;
  riskLevel: "green" | "yellow" | "red";
  beginnerFit: string;
  canTestSmallBatch: boolean;
  mustCheckBeforeListing: string[];
  nextSteps: string[];
  manualReviewChecklist: string[];
};

type ApiWorkflowResult = {
  ok: true;
  workflowId: string;
  runId: string;
  runProof: string;
  input: {
    productName: string;
    source: "manual" | "opportunity" | "task";
    candidateId: string | null;
  };
  productName: string;
  status: "completed" | "partial_failed" | "failed";
  steps: ApiStep[];
  sourcing: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  listing: Record<string, unknown> | null;
  finalReport: ApiFinalReport | null;
  costGuard: {
    aiStepsRequested: number;
    aiStepsCompleted: number;
    fallbackSteps: number;
  };
  warnings: string[];
  r22CommercialValidation?: R22CommercialRunSnapshot;
  demoAccess?: DemoAccessInfo;
};

type ApiErrorResponse = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
  };
  demoAccess?: DemoAccessInfo;
};

type ApiIdempotentReplay = {
  ok: true;
  idempotentReplay: true;
  productJourney: { status: "committed" };
  demoAccess?: DemoAccessInfo;
};

export type AgentRunSourceMeta = {
  source: "opportunity";
  from?: "opportunity";
  entry?: "candidate_to_agent_m1" | "candidate_to_agent_run";
  opportunityTitle: string;
  opportunitySource?: string;
  opportunityScore?: number;
  keyword?: string;
  candidateType?: string;
  sourceUrl?: string;
  candidateId?: string;
  sourceTitle?: string;
  originalName?: string;
  analyzedName?: string;
  evidenceSnapshot?: CandidateEvidenceSnapshot;
  r22MarketDecisionSnapshot?: R22MarketDecisionSnapshot;
  originKind?: "legacy_market_screening" | "seller_sprite_product_batch" | "seller_sprite_market_research";
  productBatchId?: string;
  productBatchName?: string;
  productBatchItemId?: string;
  marketplace?: string;
  asin?: string | null;
  reportType?: "search_results" | "category_current" | "SellerSprite Search Results";
  query?: string | null;
  category?: string | null;
  researchPriority?: string;
  evidenceStatus?: string;
  evidenceHash?: string;
  sellerSpriteDisclaimerVersion?: string;
  researchMode?: "market_research_only";
  promotionEligible?: false;
  contextHash?: string;
  importedAt: string;
};

type RunPhase = "idle" | "running" | "completed" | "failed" | "needs_manual_review";
type CandidateContextState =
  | "candidate_context_loading"
  | "candidate_context_ready"
  | "candidate_context_invalid";
type TimelineStatus = "idle" | "pending" | "running" | "completed" | "needs_manual_review" | "paused" | "failed";

type TimelineStep = {
  key: "normalize" | "market" | "sourcing" | "profit" | "risk" | "listing" | "report" | "manual";
  title: string;
  description: string;
  detail: string;
  icon: typeof Search;
};

type ResearchStage = {
  key: "understanding" | "market" | "creative";
  title: string;
  description: string;
  completedContent: string;
  nextAction: string;
  actionLabel: string;
  actionHref: string;
  stepKeys: TimelineStep["key"][];
  icon: typeof Search;
};

const TIMELINE_STEPS: TimelineStep[] = [
  {
    key: "normalize",
    title: "数据清洗",
    description: "整理商品名、来源和候选上下文。",
    detail: "输入产品或从候选带入后，先变成可分析对象。",
    icon: Search,
  },
  {
    key: "market",
    title: "市场机会判断",
    description: "结合候选来源、需求线索和 AI 结论判断机会强弱。",
    detail: "当前 MVP 复用 workflow 的最终结论和下一步动作，不新增外部数据源。",
    icon: Target,
  },
  {
    key: "sourcing",
    title: "供货可行性",
    description: "复用现有货源判断，关注 MOQ、供应商和新手适配。",
    detail: "只给研究判断建议，不自动联系供应商。",
    icon: PackageCheck,
  },
  {
    key: "profit",
    title: "成本利润估算",
    description: "人工填写采购价、售价和佣金率，形成 profitSnapshot。",
    detail: "默认折叠，保存任务时随结果一起记录。",
    icon: DollarSign,
  },
  {
    key: "risk",
    title: "合规 / 侵权 AI 预筛",
    description: "系统做 AI / 规则预筛，人工最终确认。",
    detail: "不能替代商标专利平台规则和当地法规核查。",
    icon: ShieldAlert,
  },
  {
    key: "listing",
    title: "Listing / 关键词准备",
    description: "复用现有标题、关键词和合规提醒草稿。",
    detail: "Listing 只是草稿，必须人工复核后使用。",
    icon: FileText,
  },
  {
    key: "report",
    title: "最终结论",
    description: "输出风险等级、新手适配、小单测试和下一步动作。",
    detail: "先看业务结论，再展开过程细节。",
    icon: Sparkles,
  },
  {
    key: "manual",
    title: "人工确认与保存",
    description: "人工确认后保存任务，进入研究记录跟进。",
    detail: "不会自动执行商业动作。",
    icon: ClipboardCheck,
  },
];

const RESEARCH_STAGES: ResearchStage[] = [
  {
    key: "understanding",
    title: "商品理解",
    description: "整理商品信息、用户场景和已有的基础市场信息。",
    completedContent: "商品信息、用户场景和基础市场信息已整理。",
    nextAction: "先确认商品是什么、面向谁，以及哪些信息仍需补充。",
    actionLabel: "填写商品信息",
    actionHref: "#product-research-input",
    stepKeys: ["normalize"],
    icon: Search,
  },
  {
    key: "market",
    title: "市场研究",
    description: "查看市场机会、竞争情况和风险提示。",
    completedContent: "市场机会、竞争情况和风险提示已整理。",
    nextAction: "结合现有证据判断哪些方向值得继续人工研究。",
    actionLabel: "开始市场研究",
    actionHref: "#product-research-input",
    stepKeys: ["market", "sourcing", "profit", "risk"],
    icon: Target,
  },
  {
    key: "creative",
    title: "创作准备",
    description: "整理 Listing、关键词和图片需求，等待人工确认。",
    completedContent: "Listing、关键词和图片需求草稿已整理。",
    nextAction: "内容只作为草稿，不会自动保存、发布或上架。",
    actionLabel: "保存后在任务详情准备",
    actionHref: "/tasks",
    stepKeys: ["listing", "report", "manual"],
    icon: Sparkles,
  },
];

const INITIAL_STATUSES: Record<TimelineStep["key"], TimelineStatus> = {
  normalize: "idle",
  market: "idle",
  sourcing: "idle",
  profit: "idle",
  risk: "idle",
  listing: "idle",
  report: "idle",
  manual: "idle",
};

export function normalizeCachedStepStatuses(value: unknown) {
  const cached = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Partial<Record<TimelineStep["key"], TimelineStatus>>
    : {};
  return {
    ...INITIAL_STATUSES,
    ...cached,
    sourcing: "needs_manual_review" as const,
  };
}

const MANUAL_ITEMS = [
  { key: "sourcing", label: "已人工复核供货可行性和供应商证据" },
  { key: "profit", label: "已人工复核成本利润估算，不把估算当真实市场价" },
  { key: "risk", label: "已人工最终确认合规、侵权、认证和平台规则仍需查证" },
  { key: "listing", label: "已确认 Listing / 关键词草稿不会直接发布" },
] as const;

type ProductResearchDecisionStatus = "creative_ready" | "needs_information" | "abandoned";

const PRODUCT_RESEARCH_DECISION_OPTIONS: Array<{
  value: ProductResearchDecisionStatus;
  label: string;
  description: string;
}> = [
  {
    value: "creative_ready",
    label: "进入创作准备",
    description: "仅表示可以开始内容准备，不代表采购、盈利、合规或上架成立；不会自动创建 Listing、图片或发布任务。",
  },
  {
    value: "needs_information",
    label: "待补信息",
    description: "记录仍缺少的证据和明确的下一步补充动作。",
  },
  {
    value: "abandoned",
    label: "放弃研究",
    description: "保留原因和历史，不删除 Candidate 或已有研究证据。",
  },
];

function compatibilityDecisionStatus(status: ProductResearchDecisionStatus): DecisionStatus {
  if (status === "creative_ready") return "continue";
  if (status === "needs_information") return "need_info";
  return "rejected";
}

type ManualItemKey = (typeof MANUAL_ITEMS)[number]["key"];

function statusLabel(status: TimelineStatus) {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "已完成";
    case "needs_manual_review":
      return "需要人工确认";
    case "paused":
      return "暂缓 / 风险较高";
    case "failed":
      return "失败";
    default:
      return "未开始";
  }
}

function statusClass(status: TimelineStatus) {
  switch (status) {
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "needs_manual_review":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "paused":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-500";
  }
}

function getResearchStageStatus(
  stage: ResearchStage,
  stepStatuses: Record<TimelineStep["key"], TimelineStatus>,
): TimelineStatus {
  const statuses = stage.stepKeys.map((key) => stepStatuses[key]);

  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("paused")) return "paused";
  if (statuses.includes("running")) return "running";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.includes("needs_manual_review")) return "needs_manual_review";
  if (statuses.some((status) => status === "completed" || status === "pending")) return "pending";
  return "idle";
}

function riskLabel(level?: string) {
  if (level === "green") return "低风险";
  if (level === "red") return "高风险";
  return "中风险";
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function apiStatusToTimeline(status?: ApiStepStatus): TimelineStatus {
  if (status === "completed") return "completed";
  if (status === "fallback") return "needs_manual_review";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "pending") return "pending";
  return "pending"; // unrecognized → treat as pending (not prematurely completed)
}

function getApiStep(result: ApiWorkflowResult | null, key: ApiStepKey) {
  return result?.steps.find((step) => step.key === key) || null;
}

function sourceMetaFromResearchContext(
  context: CandidateResearchContext,
): AgentRunSourceMeta {
  return {
    source: "opportunity",
    from: "opportunity",
    entry: "candidate_to_agent_run",
    opportunityTitle: context.productName,
    opportunitySource: context.sourceLabel,
    candidateId: context.candidateId,
    sourceTitle: context.productName,
    analyzedName: context.productName,
    originKind: context.sourceType,
    ...(context.productBatchName ? { productBatchName: context.productBatchName } : {}),
    ...(context.productBatchId ? { productBatchId: context.productBatchId } : {}),
    ...(context.productBatchItemId ? { productBatchItemId: context.productBatchItemId } : {}),
    ...(context.marketplace ? { marketplace: context.marketplace } : {}),
    ...(context.asin !== undefined ? { asin: context.asin } : {}),
    ...(context.reportType ? { reportType: context.reportType } : {}),
    ...(context.query !== undefined ? { query: context.query } : {}),
    ...(context.category !== undefined ? { category: context.category } : {}),
    researchPriority: context.researchPriority,
    evidenceStatus: context.evidenceStatus,
    ...(context.sellerSpriteDisclaimerVersion
      ? { sellerSpriteDisclaimerVersion: context.sellerSpriteDisclaimerVersion }
      : {}),
    ...(context.sourceType === "seller_sprite_product_batch"
      ? { researchMode: "market_research_only" as const }
      : {}),
    promotionEligible: false,
    contextHash: context.contextHash,
    importedAt: context.capturedAt,
  };
}

export function AgentRunClient({
  initialProductName,
  candidateMode = false,
  candidateId,
}: {
  initialProductName?: string;
  candidateMode?: boolean;
  candidateId?: string;
}) {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  // F1：来自 Research Workbench 的「开始 AI 研究」入口携带 taskId → 保存时回写该任务
  const [linkedTaskId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("taskId");
  });
  const [productName, setProductName] = useState(candidateMode ? "" : initialProductName || "");
  const [sourceMeta, setSourceMeta] = useState<AgentRunSourceMeta | null>(null);
  const [candidateProductImage, setCandidateProductImage] =
    useState<ResearchProductImageDisplay | null>(null);
  const [candidateContextState, setCandidateContextState] = useState<CandidateContextState>(
    candidateMode ? "candidate_context_loading" : "candidate_context_ready",
  );
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [stepStatuses, setStepStatuses] = useState(INITIAL_STATUSES);
  const [result, setResult] = useState<ApiWorkflowResult | null>(null);
  const [profitSnapshot, setProfitSnapshot] = useState<ProfitSnapshot | null>(null);
  const [riskReviewSnapshot, setRiskReviewSnapshot] = useState<RiskReviewSnapshot | null>(null);
  const [manualChecked, setManualChecked] = useState<Record<ManualItemKey, boolean>>({
    sourcing: false,
    profit: false,
    risk: false,
    listing: false,
  });
  const [manualDecisionStatus, setManualDecisionStatus] = useState<DecisionStatus>("need_info");
  const [productResearchDecisionStatus, setProductResearchDecisionStatus] =
    useState<ProductResearchDecisionStatus>("needs_information");
  const [manualDecisionReason, setManualDecisionReason] = useState("");
  const [manualDecisionNextAction, setManualDecisionNextAction] = useState("");
  // 当前展开区域（待人工核验 details，默认折叠；草稿持久化）
  const [humanVerificationOpen, setHumanVerificationOpen] = useState(false);
  // 会话草稿：刷新防丢失（研究输入 / 核验勾选 / 决定 / 原因 / 下一步 / 展开区）
  // Revision：候选模式绑定服务端候选内容指纹（contextHash，候选内容更新时旧草稿失效）；
  // 手工模式无服务端版本概念，用稳定 "manual-v1"。
  const decisionDraftRevision = candidateMode
    ? (sourceMeta?.contextHash ?? null)
    : "manual-v1";
  const decisionDraft = useSessionDraft<{
    productName: string;
    manualChecked: Record<ManualItemKey, boolean>;
    manualDecisionStatus: DecisionStatus;
    productResearchDecisionStatus: ProductResearchDecisionStatus;
    manualDecisionReason: string;
    manualDecisionNextAction: string;
    humanVerificationOpen: boolean;
  }>({
    pageKind: "research-decision",
    entityId: candidateId || candidateMode ? candidateId || "" : initialProductName || "manual",
    revision: decisionDraftRevision,
    initial: {
      productName: productName,
      manualChecked: { sourcing: false, profit: false, risk: false, listing: false },
      manualDecisionStatus: "need_info",
      productResearchDecisionStatus: "needs_information",
      manualDecisionReason: "",
      manualDecisionNextAction: "",
      humanVerificationOpen: false,
    },
  });
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(""); // auth failures should never mark steps as failed
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTaskId, setSavedTaskId] = useState("");
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const jobRequestIdRef = useRef("");
  const researchDecisionIdRef = useRef("");

  // 会话草稿恢复：在候选上下文就绪、且 agent-run 缓存恢复判定结束后应用
  // （避免 clearCandidateUi / 缓存恢复覆盖草稿恢复值）。
  const draftAppliedRef = useRef(false);
  const [cacheRestoreSettled, setCacheRestoreSettled] = useState(false);
  useEffect(() => {
    if (!decisionDraft.draft || !decisionDraft.restored) return;
    if (candidateMode && candidateContextState !== "candidate_context_ready") return;
    if (!cacheRestoreSettled) return;
    if (draftAppliedRef.current) return;
    draftAppliedRef.current = true;
    const d = decisionDraft.draft;
    // 候选模式下商品名以服务端候选上下文为权威，不覆盖草稿中的名称
    if (!candidateMode && typeof d.productName === "string") setProductName(d.productName);
    if (d.manualChecked && typeof d.manualChecked === "object") {
      setManualChecked({
        sourcing: d.manualChecked.sourcing === true,
        profit: d.manualChecked.profit === true,
        risk: d.manualChecked.risk === true,
        listing: d.manualChecked.listing === true,
      });
    }
    if (d.manualDecisionStatus) setManualDecisionStatus(d.manualDecisionStatus);
    if (d.productResearchDecisionStatus) setProductResearchDecisionStatus(d.productResearchDecisionStatus);
    if (typeof d.manualDecisionReason === "string") setManualDecisionReason(d.manualDecisionReason);
    if (typeof d.manualDecisionNextAction === "string") setManualDecisionNextAction(d.manualDecisionNextAction);
    if (typeof d.humanVerificationOpen === "boolean") setHumanVerificationOpen(d.humanVerificationOpen);
  }, [decisionDraft.draft, decisionDraft.restored, candidateMode, candidateContextState, cacheRestoreSettled]);

  // 表单变化 → 防抖保存草稿（300-500ms，不每次按键触发网络请求）
  useEffect(() => {
    decisionDraft.save({
      productName,
      manualChecked,
      manualDecisionStatus,
      productResearchDecisionStatus,
      manualDecisionReason,
      manualDecisionNextAction,
      humanVerificationOpen,
    });
  }, [
    productName,
    manualChecked,
    manualDecisionStatus,
    productResearchDecisionStatus,
    manualDecisionReason,
    manualDecisionNextAction,
    humanVerificationOpen,
    decisionDraft,
  ]);

  const report = result?.finalReport || null;
  const manualReady = MANUAL_ITEMS.every((item) => manualChecked[item.key]);
  const manualReviewGateSatisfied = !candidateMode
    ? manualReady
    : productResearchDecisionStatus !== "creative_ready" || manualReady;
  const candidateDecisionValid = !candidateMode || (
    manualDecisionReason.trim().length > 0
    && (productResearchDecisionStatus !== "needs_information"
      || manualDecisionNextAction.trim().length > 0)
    && (productResearchDecisionStatus !== "creative_ready"
      || (result?.status === "completed" && manualReady))
    && (result?.status !== "partial_failed"
      || productResearchDecisionStatus === "needs_information")
  );
  const isRunning = phase === "running";
  const needsManualReview = phase === "needs_manual_review" || phase === "completed";

  const riskPrecheckInput: RiskPrecheckInput | undefined = useMemo(() => {
    if (!result) return undefined;
    return {
      productName: result.productName,
      sourcing: result.sourcing || undefined,
      risk: result.risk || undefined,
      summary: result.summary || undefined,
      listing: result.listing || undefined,
      finalReport: result.finalReport || undefined,
    };
  }, [result]);

  const listingTitle = text(result?.listing?.title, "暂未生成 Listing 标题");
  const listingKeywords = stringArray(result?.listing?.keywords);
  const listingNotes = stringArray(result?.listing?.complianceNotes);
  const agentOutputSnapshot = useMemo(() => {
    if (!result) return null;
    return normalizeAgentOutputSnapshot({
      workflowResult: result,
      sourceMeta,
      profitSnapshot,
      riskReviewSnapshot,
    });
  }, [result, sourceMeta, profitSnapshot, riskReviewSnapshot]);
  const humanDecisionDraft = useMemo(() => ({
    status: candidateMode
      ? compatibilityDecisionStatus(productResearchDecisionStatus)
      : manualDecisionStatus,
    reason: manualDecisionReason,
    nextAction: manualDecisionNextAction,
    confirmedItems: MANUAL_ITEMS.filter((item) => manualChecked[item.key]).map((item) => item.label),
    unconfirmedItems: MANUAL_ITEMS.filter((item) => !manualChecked[item.key]).map((item) => item.label),
  }), [candidateMode, productResearchDecisionStatus, manualDecisionStatus, manualDecisionReason, manualDecisionNextAction, manualChecked]);
  const decisionEvidence = useMemo(() => {
    if (!result) return null;
    return buildDecisionEvidenceSnapshot({
      workflowResult: result,
      sourceMeta,
      profitSnapshot,
      riskReviewSnapshot,
      reviewState: {
        sourcingReviewed: manualChecked.sourcing,
        riskReviewed: manualChecked.risk,
        summaryReviewed: true,
        listingReviewed: manualChecked.listing,
        reviewedCount: MANUAL_ITEMS.filter((item) => manualChecked[item.key]).length,
        totalReviewSteps: MANUAL_ITEMS.length,
        allReviewed: manualReady,
        reviewedAt: manualReady ? new Date().toISOString() : null,
      },
      humanDecision: humanDecisionDraft,
    });
  }, [result, sourceMeta, profitSnapshot, riskReviewSnapshot, manualChecked, manualReady, humanDecisionDraft]);

  const resetRun = useCallback(() => {
    setPhase("idle");
    setStepStatuses(INITIAL_STATUSES);
    setResult(null);
    setProfitSnapshot(null);
    setRiskReviewSnapshot(null);
    setManualChecked({ sourcing: false, profit: false, risk: false, listing: false });
    setManualDecisionStatus("need_info");
    setProductResearchDecisionStatus("needs_information");
    setManualDecisionReason("");
    setManualDecisionNextAction("");
    setHumanVerificationOpen(false);
    setError("");
    setAuthError("");
    setSaveError("");
    setSaving(false);
    setSavedTaskId("");
    jobRequestIdRef.current = "";
    researchDecisionIdRef.current = "";
    cacheRestoreAttempted.current = false;
    // 用户主动重新开始 → 清除会话草稿（不恢复旧未提交内容）
    decisionDraft.clear();
    // Clear agent run cache (scoped to current access mode only)
    try {
      const storage = window.sessionStorage;
      const mode = getAccessMode();
      const info = getDemoAccessInfo();
      const scope = mode === "demo" ? (info?.id || "demo") : "owner";
      const scopePfx = `agent-run:v2:${mode === "demo" ? `demo:${info?.id || "demo"}:` : "owner:"}`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(scopePfx)) keysToRemove.push(key);
      }
      keysToRemove.forEach((k) => storage.removeItem(k));
    } catch { /* ignore */ }
  }, [decisionDraft]);

  useEffect(() => {
    if (!candidateMode && initialProductName) {
      setProductName(initialProductName);
    }
  }, [candidateMode, initialProductName]);

  useEffect(() => {
    if (!result?.workflowId) return;
    window.requestAnimationFrame(() => {
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [result?.workflowId]);

  // Access-Control-Fix.1: derive cache scope from access mode to prevent
  // Owner/Demo agent run result leakage through shared sessionStorage keys.
  const cacheScope = useMemo(() => {
    const mode = getAccessMode();
    if (mode === "demo") {
      const info = getDemoAccessInfo();
      return info?.id || "demo";
    }
    return "owner";
  }, [isAccessPasswordReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!candidateMode || !isAccessPasswordReady || !unlocked) return;
    const clearCandidateUi = () => {
      setProductName("");
      setSourceMeta(null);
      setCandidateProductImage(null);
      setPhase("idle");
      setStepStatuses(INITIAL_STATUSES);
      setResult(null);
      setProfitSnapshot(null);
      setRiskReviewSnapshot(null);
      setManualChecked({ sourcing: false, profit: false, risk: false, listing: false });
      setManualDecisionStatus("need_info");
      setProductResearchDecisionStatus("needs_information");
      setManualDecisionReason("");
      setManualDecisionNextAction("");
      setSavedTaskId("");
      setError("");
      setSaveError("");
      jobRequestIdRef.current = "";
      researchDecisionIdRef.current = "";
    };
    const normalizedCandidateId = candidateId?.trim() || "";
    if (!isAuthoritativeCandidateId(normalizedCandidateId)) {
      clearCandidateUi();
      setCandidateContextState("candidate_context_invalid");
      if (normalizedCandidateId) {
        clearAgentRunCandidateCaches(normalizedCandidateId, cacheScope);
      }
      return;
    }

    const controller = new AbortController();
    clearCandidateUi();
    setCandidateContextState("candidate_context_loading");
    cacheRestoreAttempted.current = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/opportunity-candidates/research-context?candidateId=${encodeURIComponent(normalizedCandidateId)}`,
          {
            method: "GET",
            headers: buildAccessHeaders(),
            signal: controller.signal,
          },
        );
        const payload = await response.json().catch(() => null) as {
          ok?: boolean;
          data?: unknown;
        } | null;
        const context = response.ok && payload?.ok
          ? parseCandidateResearchContext(payload.data)
          : null;
        if (!context || context.candidateId !== normalizedCandidateId) {
          clearAgentRunCandidateCaches(normalizedCandidateId, cacheScope);
          clearCandidateUi();
          setCandidateContextState("candidate_context_invalid");
          return;
        }
        const authorizedSourceMeta = sourceMetaFromResearchContext(context);
        setProductName(context.productName);
        setSourceMeta(authorizedSourceMeta);
        setCandidateProductImage(context.productImage || null);
        setCandidateContextState("candidate_context_ready");
      } catch (cause) {
        if (controller.signal.aborted) return;
        clearAgentRunCandidateCaches(normalizedCandidateId, cacheScope);
        clearCandidateUi();
        setCandidateContextState("candidate_context_invalid");
      }
    })();

    return () => controller.abort();
  }, [
    candidateMode,
    candidateId,
    isAccessPasswordReady,
    unlocked,
    cacheScope,
  ]);

  // Cache restore: after auth hydration, try to restore a previously saved run.
  // Uses initialProductName (from URL/server props) directly, not productName state,
  // to avoid race with the setProductName useEffect.
  const cacheRestoreAttempted = useRef(false);
  useEffect(() => {
    if (!isAccessPasswordReady) return;
    if (cacheRestoreAttempted.current) return;
    if (candidateMode && candidateContextState !== "candidate_context_ready") return;
    if (candidateMode && !sourceMeta) return;

    const nameFromUrl = (candidateMode ? productName : initialProductName || "").trim();
    const cacheSourceMeta = candidateMode ? sourceMeta : null;
    const cached = nameFromUrl
      ? loadAgentRunCache(nameFromUrl, cacheSourceMeta, cacheScope)
      : loadLatestAgentRunCache(cacheSourceMeta, cacheScope);
    if (!cached) {
      cacheRestoreAttempted.current = true;
      setCacheRestoreSettled(true);
      return;
    }

    // Batch restore all state in a single synchronous pass.
    // Defensive: merge with INITIAL_STATUSES to fill any missing step keys.
    cacheRestoreAttempted.current = true;
    setProductName(cached.productName || nameFromUrl);
    setPhase((cached.phase as RunPhase) || "idle");
    setStepStatuses(normalizeCachedStepStatuses(cached.stepStatuses));
    setResult((cached.result as ApiWorkflowResult) || null);
    if (cached.profitSnapshot) setProfitSnapshot(cached.profitSnapshot as ProfitSnapshot);
    if (cached.riskReviewSnapshot) setRiskReviewSnapshot(cached.riskReviewSnapshot as RiskReviewSnapshot);
    if (cached.manualChecked) {
      setManualChecked({
        sourcing: false, profit: false, risk: false, listing: false,
        ...(cached.manualChecked as Partial<Record<ManualItemKey, boolean>> || {}),
      });
    }
    const cachedDecisionStatus = normalizeDecisionStatus(cached.manualDecisionStatus || "need_info");
    setManualDecisionStatus(cachedDecisionStatus);
    if (candidateMode) {
      setProductResearchDecisionStatus(
        cachedDecisionStatus === "continue"
          ? "creative_ready"
          : cachedDecisionStatus === "rejected"
            ? "abandoned"
            : "needs_information",
      );
    }
    setManualDecisionReason(typeof cached.manualDecisionReason === "string" ? cached.manualDecisionReason : "");
    setManualDecisionNextAction(typeof cached.manualDecisionNextAction === "string" ? cached.manualDecisionNextAction : "");
    if (cached.savedTaskId) setSavedTaskId(cached.savedTaskId);
    setCacheRestoreSettled(true);
  }, [
    isAccessPasswordReady,
    cacheScope,
    candidateMode,
    candidateContextState,
    sourceMeta,
    productName,
    initialProductName,
  ]);

  const persistCurrentRunCache = useCallback(() => {
    if (phase !== "needs_manual_review" && phase !== "completed") return;
    if (!result) return;

    const currentName = productName.trim() || result.productName.trim();
    if (!currentName) return;
    saveAgentRunCache(currentName, sourceMeta, {
      phase,
      stepStatuses,
      result,
      profitSnapshot: profitSnapshot as unknown,
      riskReviewSnapshot: riskReviewSnapshot as unknown,
      manualChecked,
      manualDecisionStatus: candidateMode
        ? compatibilityDecisionStatus(productResearchDecisionStatus)
        : manualDecisionStatus,
      manualDecisionReason,
      manualDecisionNextAction,
      savedTaskId,
    }, cacheScope);
  }, [phase, productName, sourceMeta, stepStatuses, result, profitSnapshot, riskReviewSnapshot, manualChecked, candidateMode, productResearchDecisionStatus, manualDecisionStatus, manualDecisionReason, manualDecisionNextAction, savedTaskId, cacheScope]);

  // Cache save: after analysis completes, persist to sessionStorage
  useEffect(() => {
    persistCurrentRunCache();
  }, [persistCurrentRunCache]);

  async function handleRun() {
    const name = productName.trim();
    if (isRunning) return;
    if (candidateMode && candidateContextState !== "candidate_context_ready") {
      setError("候选不存在或不属于当前访问身份，请返回发现商品重新选择。");
      return;
    }
    if (sourceMeta && !isAuthoritativeCandidateId(sourceMeta.candidateId)) {
      setError("该候选仅存在于本浏览器草稿中，请返回候选品池保存为服务端候选后再进入商品研究。");
      return;
    }
    if (name.length < 2) {
      setError("请输入至少 2 个字符的商品名称。");
      return;
    }
    const accessHeaders = buildAccessHeaders();
    const currentAccessCredential = accessHeaders["x-access-token"] || accessPassword.trim();
    if (!isAccessPasswordReady || !currentAccessCredential) {
      setAuthError("会话未就绪，请返回首页重新登录后再操作。");
      return;
    }

    setPhase("running");
    setError("");
    setAuthError("");
    setSaveError("");
    setSavedTaskId("");
    setResult(null);
    setProfitSnapshot(null);
    setRiskReviewSnapshot(null);
    setManualChecked({ sourcing: false, profit: false, risk: false, listing: false });
    setManualDecisionStatus("need_info");
    setProductResearchDecisionStatus("needs_information");
    setManualDecisionReason("");
    setManualDecisionNextAction("");
    researchDecisionIdRef.current = "";

    setStepStatuses({
      ...INITIAL_STATUSES,
      normalize: "running",
    });

    try {
      if (!jobRequestIdRef.current) {
        jobRequestIdRef.current = createBrowserUuid();
      }
      const response = await fetch("/api/workflows/product-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders },
        body: JSON.stringify({
          productName: name,
          source: sourceMeta ? "opportunity" : "manual",
          candidateId: sourceMeta?.candidateId || undefined,
          jobRequestId: jobRequestIdRef.current,
          options: { runListing: false },
          accessPassword: currentAccessCredential,
          accessToken: accessHeaders["x-access-token"] || undefined,
        }),
      });
      const parsedResponse = await readJsonApiResponse(response);
      if (!parsedResponse.ok) {
        setPhase("failed");
        setError("商品研究服务暂时异常，请稍后重试。");
        setStepStatuses({ ...INITIAL_STATUSES, normalize: "failed" });
        jobRequestIdRef.current = "";
        return;
      }
      if (!parsedResponse.payload || typeof parsedResponse.payload !== "object" || !("ok" in parsedResponse.payload)) {
        setPhase("failed");
        setError("商品研究服务暂时异常，请稍后重试。");
        setStepStatuses({ ...INITIAL_STATUSES, normalize: "failed" });
        jobRequestIdRef.current = "";
        return;
      }
      const data = parsedResponse.payload as ApiWorkflowResult | ApiErrorResponse | ApiIdempotentReplay;
      if (data.demoAccess) updateDemoAccessSnapshot(data.demoAccess);
      if (!response.ok || !data.ok) {
        const message = response.status >= 500
          ? "商品研究服务暂时异常，请稍后重试。"
          : data.ok ? "商品研究服务暂时异常，请稍后重试。" : data.error?.message || "商品研究服务暂时异常，请稍后重试。";
        // Auth errors (401/403) should NOT pollute business run state
        if (response.status === 401 || response.status === 403) {
          setAuthError(message);
          setPhase("idle");
          setStepStatuses(INITIAL_STATUSES);
        } else {
          setPhase("failed");
          setError(message);
          setStepStatuses({ ...INITIAL_STATUSES, normalize: "failed" });
        }
        jobRequestIdRef.current = "";
        return;
      }
      if ("idempotentReplay" in data) {
        setPhase("idle");
        setStepStatuses(INITIAL_STATUSES);
        setError("该商品已占用体验名额，不会重复扣减；请从研究记录或当前页面缓存继续已有流程。");
        jobRequestIdRef.current = "";
        return;
      }

      const workflowResult = data;
      const riskLevel = workflowResult.finalReport?.riskLevel;
      setProductName(workflowResult.productName);
      setResult(workflowResult);
      setPhase("needs_manual_review");
      setStepStatuses({
        normalize: apiStatusToTimeline(getApiStep(workflowResult, "normalize")?.status),
        market: workflowResult.finalReport ? "completed" : "needs_manual_review",
        sourcing: "needs_manual_review",
        profit: "needs_manual_review",
        risk: riskLevel === "red" ? "paused" : "needs_manual_review",
        listing: apiStatusToTimeline(getApiStep(workflowResult, "listing")?.status),
        report: workflowResult.finalReport ? "completed" : "needs_manual_review",
        manual: "needs_manual_review",
      });
      if (workflowResult.warnings.length) {
        setError(workflowResult.warnings.join("；"));
      }
      jobRequestIdRef.current = "";
    } catch {
      setPhase("failed");
      setError("网络异常，请稍后重试。");
      setStepStatuses({ ...INITIAL_STATUSES, normalize: "failed" });
    }
  }

  async function saveToTasks() {
    if (!result) return;
    persistCurrentRunCache();
    if (!canSubmitAgentRunSave({
      hasResult: true,
      saving,
      savedTaskId,
      manualReady: manualReviewGateSatisfied,
    })) {
      if (saving || savedTaskId) return;
      setSaveError(candidateMode
        ? "进入创作准备前，请先完成 4 项人工确认。"
        : "请先完成 4 项人工确认，再保存任务。");
      return;
    }
    if (!candidateDecisionValid) {
      setSaveError("请填写决定原因；选择待补信息时还需填写下一步动作。进入创作准备仅适用于完整完成且已人工复核的研究。");
      return;
    }

    const saveAccessHeaders = buildAccessHeaders();
    const saveAccessCredential = saveAccessHeaders["x-access-token"] || accessPassword.trim();
    if (!isAccessPasswordReady || !saveAccessCredential) {
      setSaveError(getAgentRunSaveErrorMessage(401, "invalid_access"));
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      if (candidateMode && !researchDecisionIdRef.current) {
        researchDecisionIdRef.current = createBrowserUuid();
      }
      const response = await fetch("/api/workflows/product-analysis/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...saveAccessHeaders },
        body: JSON.stringify({
          accessPassword: saveAccessCredential,
          accessToken: saveAccessHeaders["x-access-token"] || undefined,
          ...(linkedTaskId ? { taskId: linkedTaskId } : {}),
          workflowResult: result,
          runProof: result.runProof,
          reviewState: {
            sourcingReviewed: manualChecked.sourcing,
            riskReviewed: manualChecked.risk,
            summaryReviewed: true,
            listingReviewed: manualChecked.listing,
          },
          source: "agent_run",
          sourceMeta,
          profitSnapshot,
          riskReviewSnapshot,
          decisionStatus: candidateMode
            ? compatibilityDecisionStatus(productResearchDecisionStatus)
            : manualDecisionStatus,
          humanConfirmed: true,
          humanDecision: {
            ...humanDecisionDraft,
            decidedAt: new Date().toISOString(),
          },
          ...(candidateMode ? {
            productResearchDecision: {
              decisionId: researchDecisionIdRef.current,
              status: productResearchDecisionStatus,
              reason: manualDecisionReason,
              nextAction: manualDecisionNextAction || null,
            },
          } : {}),
          agentRunSnapshot: buildAgentRunSnapshot({
            workflowResult: result as Record<string, unknown>,
            riskReviewSnapshot,
            profitSnapshot,
            manualChecked,
            productName: result.productName,
            sourceMeta,
          }),
          listingPrepSnapshot: buildListingPrepSnapshot({
            listing: result?.listing as Record<string, unknown> | undefined,
            riskReviewSnapshot,
            finalReport: result?.finalReport as Record<string, unknown> | undefined,
            productName: result.productName,
          }),
        }),
      });
      const data = await response.json() as { ok?: boolean; data?: { id?: string }; error?: { code?: string; message?: string } };
      if (!response.ok || !data.ok || !data.data?.id) {
        setSaveError(getAgentRunSaveErrorMessage(response.status, data.error?.code, data.error?.message));
        return;
      }
      setSavedTaskId(data.data.id);
      setPhase("completed");
      setStepStatuses((current) => ({ ...current, manual: "completed" }));
      // 人工决定保存成功 → 清除草稿（提交后不恢复旧未提交内容）
      decisionDraft.clear();
      // F1：保存后直接进入 Research Workbench（研究记录详情），不再停留在旧决策页
      const savedId = data.data.id;
      window.setTimeout(() => {
        window.location.assign(`/tasks/${encodeURIComponent(savedId)}`);
      }, 600);
    } catch {
      setSaveError("网络异常，保存任务失败。");
    } finally {
      setSaving(false);
    }
  }

  // Auth hydration guard: wait for sessionStorage read before showing locked prompt.
  // Without this, a brief flash of the locked prompt appears on every refresh
  // even when the user has a valid session token.
  if (!isAccessPasswordReady) {
    return (
      <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
          <p className="text-sm text-slate-400">正在恢复工作台会话…</p>
        </div>
      </main>
    );
  }

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="商品研究" returnUrl={candidateMode && candidateId ? `/opportunity-candidates/${encodeURIComponent(candidateId)}` : "/opportunity-candidates"} />;
  }

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-4">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">辅助研究 · 人工确认</p>
                <h1 className="section-title mt-1 text-2xl">商品研究</h1>
                <p className="muted-text mt-1 max-w-3xl text-sm leading-6">
                  从一个商品出发，依次完成商品理解、市场研究和创作准备。
                  AI 只负责整理与建议，不代替供应商、成本、合规核验，最终决定始终由人工完成。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/opportunity-candidates" className="linear-button-primary inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  商品研究池
                </Link>
                <Link href="/opportunities" className="linear-button-soft inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  发现商品
                </Link>
                <Link href="/tasks" className="linear-button inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  研究记录
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section
            className="surface-card-strong overflow-hidden p-4 sm:p-5"
            data-testid="agent-run-research-flow"
            aria-labelledby="agent-run-research-flow-title"
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="linear-kicker">三阶段商品研究</p>
                <h2 id="agent-run-research-flow-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                  先理解，再研究，最后准备创作
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  页面只展示你需要的结论和下一步；系统内部步骤仅用于研究过程，不在此展示。
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClass(phase === "failed" ? "failed" : needsManualReview ? "needs_manual_review" : isRunning ? "running" : "idle")}`}>
                {phase === "failed" ? "研究未完成，可重新开始" : needsManualReview ? "等待人工确认" : isRunning ? "研究中" : "从商品理解开始"}
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {RESEARCH_STAGES.map((stage, index) => (
                <ResearchStageCard
                  key={stage.key}
                  index={index}
                  stage={stage}
                  status={getResearchStageStatus(stage, stepStatuses)}
                />
              ))}
            </div>
            {isRunning ? (
              <div
                className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-800"
                role="status"
                data-testid="agent-run-progress-hint"
              >
                <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                AI 分析进行中（通常 10–30 秒，视 AI 服务响应而定）。正在并行分析货源判断与风险排查，随后生成综合结论；
                完成后自动展示结果。请勿关闭页面或重复点击。
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-bold text-amber-900">人工确认口径</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  系统不会自动执行商业动作。不会自动保存任务、不会自动修改任务状态、不会自动采购、不会自动上架。
                  合规 / 侵权 AI / 规则预筛只能做提醒，不能替代商标专利平台规则和当地法规核查。
                </p>
              </div>
            </div>
          </section>

          <section id="product-research-input" className="surface-card scroll-mt-4 p-4 sm:p-5">
            {!candidateMode ? (
              <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-sm leading-6 text-teal-900">
                <p className="font-semibold">先从商品研究池选择商品</p>
                <p className="mt-1">
                  研究池会保持 Candidate 身份和来源上下文；下方输入框仅作为旧版手工输入兼容。
                </p>
                <Link href="/opportunity-candidates" className="mt-2 inline-flex font-semibold text-teal-800 underline decoration-teal-300">
                  打开商品研究池
                </Link>
              </div>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="agent-run-product">
                  输入商品 / 从发现商品带入
                </label>
                <input
                  id="agent-run-product"
                  name="productName"
                  type="text"
                  autoComplete="off"
                  value={productName}
                  onChange={(event) => {
                    setProductName(event.target.value.slice(0, 120));
                    if (error) setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleRun();
                  }}
                  placeholder="例如：桌面手机支架、硅胶折叠水杯、宠物慢食碗…"
                  disabled={isRunning || candidateMode}
                  className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{productName.length}/120</span>
                  <span>{candidateMode ? "候选商品信息由当前访问身份授权后加载。" : "可以输入商品名称，也可以从发现商品带入。"}</span>
                  {sourceMeta ? (
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-semibold text-teal-700">
                      已从候选带入：{sourceMeta.opportunityTitle}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <button
                  type="button"
                  data-testid="agent-run-start"
                  onClick={() => void handleRun()}
                  disabled={
                    isRunning
                    || productName.trim().length < 2
                    || (candidateMode && candidateContextState !== "candidate_context_ready")
                  }
                  className="linear-button-primary inline-flex h-12 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:opacity-50"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      商品研究中
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      开始商品研究
                    </>
                  )}
                </button>
                {result || phase === "failed" ? (
                  <button
                    type="button"
                    onClick={resetRun}
                    className="linear-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold"
                  >
                    <RotateCcw className="size-4" />
                    重新开始
                  </button>
                ) : null}
              </div>
            </div>
            {authError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700" data-testid="agent-run-auth-error">
                <p className="font-semibold">会话状态异常</p>
                <p className="mt-1">{authError}</p>
                <Link href="/" className="mt-2 inline-block text-sm font-semibold text-rose-600 underline">返回首页重新登录</Link>
              </div>
            ) : null}
            {/* 会话草稿状态：恢复提示 / 自动保存 / 失效提示 / 清除入口 */}
            {decisionDraft.restored ? (
              <p role="status" className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
                已恢复刷新前的未提交内容
                <button
                  type="button"
                  onClick={decisionDraft.clear}
                  className="ml-2 rounded border border-teal-300 px-1.5 py-0.5 text-xs font-semibold text-teal-700 hover:bg-teal-100"
                >
                  清除当前草稿
                </button>
              </p>
            ) : decisionDraft.invalidated ? (
              <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                任务内容已经更新，为避免使用过期信息，未恢复上次草稿。
              </p>
            ) : decisionDraft.saved ? (
              <p className="mt-3 text-xs text-slate-400">草稿已自动保存</p>
            ) : null}
            {candidateMode && candidateContextState === "candidate_context_loading" ? (
              <div
                className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-700"
                data-testid="agent-run-candidate-context-loading"
              >
                正在验证候选商品与当前访问身份…
              </div>
            ) : null}
            {candidateMode && candidateContextState === "candidate_context_invalid" ? (
              <div
                className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700"
                data-testid="agent-run-candidate-context-invalid"
              >
                候选不存在或不属于当前访问身份，请返回发现商品重新选择。
              </div>
            ) : null}
            {error ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800" data-testid="agent-run-error">
                {error}
              </div>
            ) : null}
            {cacheRestoreAttempted.current && (phase === "needs_manual_review" || phase === "completed") ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm leading-6 text-emerald-800" data-testid="agent-run-cache-restored">
                <p className="font-semibold">已恢复上次分析结果</p>
                <p className="mt-1">可继续人工确认或保存任务，无需重新调用 AI 分析。</p>
              </div>
            ) : null}
            {sourceMeta ? (
              <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-sm leading-6 text-indigo-800">
                <p className="font-semibold">
                  {sourceMeta.originKind === "seller_sprite_product_batch"
                    ? "SellerSprite ProductBatch 研究上下文"
                    : "已带入发现商品上下文"}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <ResearchProductImage
                    image={candidateProductImage}
                    alt={productName || "候选商品"}
                  />
                  <p className="text-xs text-indigo-700">
                    {candidateProductImage
                      ? "商品图片来自已验证并缓存的 Candidate 快照。"
                      : "当前商品没有可验证的本地图片快照，使用统一占位图。"}
                  </p>
                </div>
                {sourceMeta.originKind === "seller_sprite_product_batch" ? (
                  <>
                    <p className="mt-1">
                      批次：{sourceMeta.productBatchName || sourceMeta.productBatchId} · 商品：{sourceMeta.asin || sourceMeta.productBatchItemId}
                    </p>
                    <p className="mt-1 text-xs">
                      市场：{sourceMeta.marketplace || "未提供"} · 报表：{sourceMeta.reportType || "未提供"}
                      {sourceMeta.query ? ` · 查询：${sourceMeta.query}` : ""}
                      {sourceMeta.category ? ` · 类目：${sourceMeta.category}` : ""}
                    </p>
                    <details className="mt-2 text-xs text-slate-600">
                      <summary className="cursor-pointer font-semibold text-indigo-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                        高级信息
                      </summary>
                      <div className="mt-2 space-y-1 rounded-lg border border-indigo-100 bg-white/70 p-3">
                        <p>候选 ID：{sourceMeta.candidateId || "未提供"} · 研究优先级：{sourceMeta.researchPriority || "未提供"}</p>
                        <p>证据状态：{sourceMeta.evidenceStatus || "未提供"}</p>
                        <p>SellerSprite 口径：{sourceMeta.sellerSpriteDisclaimerVersion || "未提供"}</p>
                        <p>原始名称：{sourceMeta.originalName || "未提供"} · 分析名称：{sourceMeta.analyzedName || productName}</p>
                      </div>
                    </details>
                    <p className="mt-2 rounded-lg border border-indigo-200 bg-white/70 px-2 py-1.5 text-xs font-semibold">
                      仅用于市场研究；不代表商业晋级或自动选品结论。
                    </p>
                  </>
                ) : (
                  <p className="mt-1">
                    来自发现商品：{sourceMeta.sourceTitle || sourceMeta.opportunityTitle}
                  </p>
                )}
                {sourceMeta.evidenceSnapshot ? (
                  <div className="mt-2 rounded-lg border border-indigo-200 bg-white/70 px-2 py-1.5 text-xs">
                    <p className="font-semibold">
                      来源证据：{sourceMeta.evidenceSnapshot.decision}
                    </p>
                    <p className="mt-1 text-indigo-700">{sourceMeta.evidenceSnapshot.decisionReason}</p>
                  </div>
                ) : null}
                <p className="mt-1 text-xs font-semibold">
                  不会自动开始 AI 分析，仍需你手动点击“开始商品研究”。
                </p>
              </div>
            ) : null}
          </section>

          <details
            data-testid="agent-run-human-verification"
            className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5"
            open={humanVerificationOpen}
            onToggle={(event) => setHumanVerificationOpen((event.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer list-none select-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-amber-900">待人工核验</p>
                  <p className="mt-1 text-sm leading-6 text-amber-800">
                    这些内容缺少可靠的一手证据，不作为 AI 已确认结论。
                  </p>
                </div>
                <span className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold text-amber-700">
                  默认折叠
                </span>
              </div>
            </summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-amber-200 bg-white/80 p-4">
                <p className="font-semibold text-slate-900">供货与供应商</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  当前没有可靠供应商数据，需要人工寻找和确认。
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-white/80 p-4">
                <p className="font-semibold text-slate-900">成本与利润</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  需要补充采购、物流、平台费用和广告预算后才能计算。
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-white/80 p-4">
                <p className="font-semibold text-slate-900">合规与知识产权</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  不能替代专业合规或知识产权审核。
                </p>
              </div>
            </div>
          </details>

          {phase === "failed" ? (
            <section className="surface-card border-rose-200 bg-rose-50/70 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
                <div>
                  <h2 className="text-lg font-semibold text-rose-900">商品研究未完成</h2>
                  <p className="mt-1 text-sm leading-6 text-rose-700">
                    {error || "API mock 或网络返回异常。页面未崩溃，可以重新开始，或进入研究记录查看已保存的记录。"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={resetRun} className="linear-button-primary inline-flex h-10 items-center px-4 text-sm font-semibold">
                      重新开始
                    </button>
                    <Link href="/tasks" className="linear-button inline-flex h-10 items-center px-4 text-sm font-semibold">
                      查看研究记录
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {result && report ? (
            <>
              {/* 商品研究结论（主阅读流）：先看结论，再展开过程细节 */}
              <section ref={summaryRef} className="surface-card border-teal-200 bg-gradient-to-b from-teal-50/80 to-white p-5 sm:p-6 scroll-mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">商品研究结论 · {result.productName}</p>
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h2 className="break-words text-2xl font-bold tracking-tight text-slate-950">
                    {report.finalVerdict || "需要人工复核后再决定"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    AI 结果只做预筛和建议。请先核对商品事实与风险，再决定是否继续。
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800">
                    风险提示：{riskLabel(report.riskLevel)}（待人工核验）
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-bold text-slate-700">
                    {report.beginnerFit || "需人工判断"}
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
                    {report.canTestSmallBatch ? "可评估小单测试" : "先补充评估"}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
                  <p className="text-sm font-bold text-teal-800">建议下一步</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
                    {(Array.isArray(report.nextSteps) ? report.nextSteps : []).slice(0, 3).map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <p className="text-sm font-bold text-amber-800">尚缺的关键信息</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-amber-800">
                    {(Array.isArray(report.mustCheckBeforeListing) ? report.mustCheckBeforeListing : []).slice(0, 3).map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryMetric label="研究状态" value={result.status === "completed" ? "已生成研究结论" : "需要人工复核"} />
                <SummaryMetric label="风险提示" value={`${riskLabel(report.riskLevel)}（待人工核验）`} />
                <SummaryMetric label="人工确认" value={manualReady ? "4 项已确认" : "待完成 4 项"} />
                <SummaryMetric label="保存状态" value={savedTaskId ? "已保存" : "未保存"} />
                {result.r22CommercialValidation ? (
                  <SummaryMetric label="商业决策" value="待真实供应与成本资料" />
                ) : null}
              </div>

              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <p className="text-sm font-bold text-amber-900">人工确认与任务沉淀</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  以下是流程复核声明，不代表商品字段已被人工确认。勾选后才允许点击“人工确认后保存任务”，且不会自动保存任务或修改任务状态。
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {MANUAL_ITEMS.map((item) => (
                    <label key={item.key} className="flex items-start gap-2 rounded-xl border border-white/80 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                      <input
                        type="checkbox"
                        data-testid={`agent-run-manual-${item.key}`}
                        checked={manualChecked[item.key]}
                        onChange={(event) => setManualChecked((current) => ({ ...current, [item.key]: event.target.checked }))}
                        className="mt-1"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <label className="text-xs font-bold text-amber-900" htmlFor="agent-run-decision-status">
                      人工最终决定
                    </label>
                    <select
                      id="agent-run-decision-status"
                      name="decisionStatus"
                      value={candidateMode ? productResearchDecisionStatus : manualDecisionStatus}
                      onChange={(event) => {
                        if (candidateMode) {
                          setProductResearchDecisionStatus(event.target.value as ProductResearchDecisionStatus);
                        } else {
                          setManualDecisionStatus(normalizeDecisionStatus(event.target.value));
                        }
                      }}
                      className="mt-1 h-11 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    >
                      {candidateMode
                        ? PRODUCT_RESEARCH_DECISION_OPTIONS.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={
                              (result.status === "partial_failed" && option.value !== "needs_information")
                              || (option.value === "creative_ready" && (result.status !== "completed" || !manualReady))
                            }
                          >
                            {option.label}
                          </option>
                        ))
                        : decisionStatusOptions.filter((option) => option.value).map((option) => (
                          <option key={option.value} value={option.value}>{option.shortLabel}</option>
                        ))}
                    </select>
                    {candidateMode ? (
                      <div className="mt-2 space-y-1 text-xs leading-5 text-amber-800">
                        <p>{PRODUCT_RESEARCH_DECISION_OPTIONS.find((option) => option.value === productResearchDecisionStatus)?.description}</p>
                        {result.status === "partial_failed" ? (
                          <p>partial_failed 可在未完成四项流程复核时保存为“待补信息”，但不能进入创作准备或放弃研究。</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block text-xs font-bold text-amber-900">
                      决定原因
                      <textarea
                        name="decisionReason"
                        value={manualDecisionReason}
                        onChange={(event) => setManualDecisionReason(event.target.value.slice(0, 1000))}
                        rows={3}
                        placeholder="例如：成本还缺物流/广告/退货率，先补资料；或风险可控，进入小单验证。"
                        className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      />
                    </label>
                    <label className="block text-xs font-bold text-amber-900">
                      下一步动作
                      <textarea
                        name="decisionNextAction"
                        value={manualDecisionNextAction}
                        onChange={(event) => setManualDecisionNextAction(event.target.value.slice(0, 1000))}
                        rows={3}
                        placeholder="例如：补供应商报价和平台认证；复核商标风险；整理小单测试清单。"
                        className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      />
                    </label>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {savedTaskId ? (
                    <Link href={`/tasks/${savedTaskId}`} className="linear-button-primary inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold">
                      <CheckCircle2 className="size-4" />
                      {result.r22CommercialValidation
                        ? "已保存商业验证任务"
                        : "已保存，进入研究记录"}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      data-testid="agent-run-save-task"
                      onClick={() => void saveToTasks()}
                      disabled={saving || !manualReviewGateSatisfied || !candidateDecisionValid}
                      className="linear-button-primary inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          保存中
                        </>
                      ) : (
                        <>
                          <Save className="size-4" />
                          人工确认后保存任务
                        </>
                      )}
                    </button>
                  )}
                  <button type="button" onClick={resetRun} className="linear-button inline-flex h-11 items-center px-4 text-sm font-semibold">
                    暂不保存
                  </button>
                  <Link href="/tasks" className="linear-button-soft inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold">
                    查看研究记录
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
                {saveError ? <p className="mt-2 text-xs font-semibold text-rose-600">{saveError}</p> : null}
              </div>
            </section>
            </>
          ) : null}

          <p className="text-center text-xs text-slate-400">
            商品研究 · AI / 规则辅助 · 人工最终确认
          </p>
        </div>
      </div>
    </main>
  );
}

function TimelineCard({ step, status }: { step: TimelineStep; status: TimelineStatus }) {
  const Icon = step.icon;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="linear-icon size-9 shrink-0 rounded-xl bg-teal-50 text-teal-700">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-950">{step.title}</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
              {status === "running" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
              {statusLabel(status)}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">{step.detail}</p>
        </div>
      </div>
    </div>
  );
}

function ResearchStageCard({
  stage,
  status,
  index,
}: {
  stage: ResearchStage;
  status: TimelineStatus;
  index: number;
}) {
  const Icon = stage.icon;
  return (
    <article
      data-testid="agent-run-research-stage"
      className="relative overflow-hidden rounded-2xl border border-teal-100 bg-gradient-to-b from-white to-teal-50/50 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="linear-icon size-10 shrink-0 rounded-xl bg-teal-50 text-teal-700">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tracking-[0.12em] text-teal-600">
              阶段 {index + 1}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
              {status === "running" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
              {statusLabel(status)}
            </span>
          </div>
          <h3 className="mt-2 text-base font-bold text-slate-950">{stage.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{stage.description}</p>
          <div className="mt-3 rounded-xl border border-teal-100 bg-white/80 p-3 text-xs leading-5 text-slate-600">
            <p className="font-semibold text-slate-700">已完成内容</p>
            <p className="mt-1">
              {status === "completed" ? stage.completedContent : "尚未完成；完成后会在这里汇总。"}
            </p>
          </div>
          <p className="mt-3 border-t border-teal-100 pt-3 text-xs leading-5 text-slate-500">
            {stage.nextAction}
          </p>
          <Link
            href={stage.actionHref}
            data-testid="agent-run-research-stage-action"
            className="linear-button mt-3 inline-flex h-9 items-center justify-center px-3 text-xs font-semibold"
          >
            {stage.actionLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/80 bg-white p-3">
      <p className="text-sm font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
