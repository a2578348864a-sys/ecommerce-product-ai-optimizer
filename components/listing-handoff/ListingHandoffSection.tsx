"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAccessHeaders, updateDemoAccessSnapshot, type DemoAccessInfo } from "@/lib/client/accessToken";
import { createBrowserUuid } from "@/lib/browserUuid";
import { copyPlainText } from "@/lib/client/copyPlainText";
import { resolveEvidenceConflictRecovery } from "@/lib/client/evidenceConflictRecovery";

type ListingStatus = "ready" | "active" | "stale" | "revoked" | "legacy_unbound" | "invalid";

type ListingDraftSafeSummary = {
  generatedAt: string | null;
  source: string | null;
  version: number | null;
  titles: string[];
  bullets: string[];
  description: string | null;
  keywords: string[];
  backendSearchTerms?: string[];
  /** R2：实际使用的已确认商品事实（服务端只返回 label/value） */
  usedFactTrace?: Array<{ label: string; value: string }>;
  /** R2：最终文案实际采用的关键词文本 */
  usedKeywordTrace?: string[];
  /** ListingPlan.v2：仅进入搜索词字段、未进入正文的关键词（诚实分离，不称正文采用） */
  searchOnlyKeywordTrace?: string[];
  /** R2：生成时提供给 AI 的研究参考（业务语言） */
  researchReferenceTrace?: string[];
  /** R1.6：被安全过滤的 backend term 人工可读警告（不暴露内部 id） */
  backendTermWarnings?: string[];
  /** 服务端三级判定保留的低风险表达（待人工确认） */
  humanReviewClaims?: string[];
  /** 服务端派生的关键词溯源 id */
  usedKeywordIds?: string[];
  /** 关键词方案来源（服务端权威） */
  keywordPlanSource?: "manual" | "auto_suggested" | "none";
  draftKind?: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft";
  qualityIssues?: string[];
  providerAttempted?: boolean;
  providerSucceeded?: boolean;
  fallbackApplied?: boolean;
  fallbackReason?: string | null;
  sellingPoints: string[];
  riskNotes: string[];
  reviewChecklist: string[];
  blockedClaims: string[];
  complianceWarnings: string[];
  /** R6：Listing 质量不合格（碎片/数量不足）→ 只显示「暂无合格草稿」 */
  listingUnqualified?: boolean;
  /** LISTING_COPY_QUALITY：事实安全（Claim Policy 出口）通过状态 */
  factSafe?: boolean;
  /** LISTING_COPY_QUALITY：文案质量（Copy Quality 合同）通过状态 */
  copyQuality?: boolean;
  /** R6：被拒绝的具体句子 + 中文原因（有界 ≤5，无内部 id） */
  rejectedListingSentences?: Array<{ text: string; reason: string }>;
  /** ListingPlan.v2：卖点策略（安全摘要；无计划历史草稿为 undefined） */
  sellingPointPlan?: Array<{
    role: string;
    shopperNeed: string;
    shopperAngle: string;
    factLabels: string[];
    keywordIds: string[];
    claimMode: string;
    cannotSay: string[];
  }>;
};

type ListingStateResponse = {
  ok: true;
  data: {
    canGenerate: boolean;
    listingStatus: ListingStatus;
    currentHandoffRevision: number | null;
    sourceHandoffRevision: number | null;
    staleReasonCode: string | null;
    staleDraftPresent: boolean;
    handoffEffectiveStatus: string | null;
    humanReviewRequired: boolean;
    researchRevision: number | null;
    storageVersion: { resultJsonHash: string; updatedAt: string } | null;
    factSummary: { confirmedFacts: number; listingEligibleFacts: number; prohibitedClaims: number };
    draft: ListingDraftSafeSummary | null;
    history: { sourceHandoffRevision: number; sourceResearchRevision: number; generatedAt: string; humanReviewRequired: boolean }[];
    readiness?: {
      claimSafe: boolean;
      copyReady: boolean;
      keywordReady: boolean;
      missingForQuality: string[];
      counts: { identity: number; specification: number; functional: number; listingEligible: number };
    } | null;
    // V2：capability 安全字段（仅 level/counts/canCallProvider/isBlocked/missing/suggested）
    capability?: {
      level: string;
      supportedBulletCount: number;
      targetBulletCount: number;
      canCallProvider: boolean;
      isBlocked: boolean;
      missingClaimGroups: string[];
      suggestedQuestions: string[];
    } | null;
    // V3R（契约①）：claimPreflight 与服务端 Generate 校验同源（可生成与否的事实校验预演）
    // reasonCode=english_rendering_pending 是允许生成状态（中文事实生成时英文化）
    claimPreflight?: { pass: boolean; reasonCode?: string | null; reason: string | null } | null;
    listingBrief?: { schema: "listing-creation-brief.v1"; coreSellingPoint: string; targetAudience: string; useScenario: string; differentiation: string; contentEmphasis: string } | null;
    keywordBriefSummary?: { primaryKeyword: string; source: string; backendTermsCount: number } | null;
  };
};

type GenerateResponse = {
  ok: true;
  data: {
    listingStatus: ListingStatus;
    currentHandoffRevision: number | null;
    sourceHandoffRevision: number | null;
    idempotentReplay: boolean;
    humanReviewRequired: boolean;
    // V2 Listing 稳定落库：AI 输出未通过事实校验时系统生成保守草稿
    safeFallbackApplied?: boolean;
    draft: ListingDraftSafeSummary | null;
  };
};

type ApiError = { status: number; code: string; message: string };

/** 商品创作补充保存状态（保存按钮轮）：idle/saving/success/error/conflict */
type ListingBriefSaveState = "idle" | "saving" | "success" | "error" | "conflict";

/** save_listing_brief 成功响应（与后端 route 契约同形） */
type SaveListingBriefResponse = {
  ok: true;
  data: {
    saved: true;
    listingBrief: ListingStateResponse["data"]["listingBrief"];
    storageVersion: { resultJsonHash: string; updatedAt: string };
    currentHandoffRevision: number | null;
  };
};

type ListingBriefForm = import("@/lib/client/listingCreationBriefState").ListingCreationBriefForm;
const EMPTY_LISTING_BRIEF = emptyListingCreationBrief();

const BTN_CLASS =
  "mt-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:focus-visible:ring-0";
const BTN_SECONDARY_CLASS =
  "mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:focus-visible:ring-0";

import { emptyListingCreationBrief, listingCreationBriefFormsEqual, resolveLoadedListingCreationBrief, type ListingCreationBriefForm } from "@/lib/client/listingCreationBriefState";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** R2：Listing 生成依据（服务端已生成的确定性快照 → 用户可读四组；无依据历史草稿诚实空态） */
/** R3：Listing 生成依据（三态）——
 * A. 历史草稿无任何依据字段 → 历史空态
 * B. 非 AI 草稿（providerAttempted=false）→ 不写「提供给 AI」；即使存在 aiReferences 也不展示研究参考组
 * C. 真实尝试调用 AI（providerAttempted=true）→ 展示「生成时提供给 AI 的研究参考」具体内容
 * 永远不写「AI 实际使用」（Provider 未返回使用记录）。
 */
/** ListingPlan.v2：draftKind → 运营语义标签（三态；纯函数，供 DOM 测试与渲染共用） */
export function draftKindLabel(draftKind: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft" | undefined): string {
  if (draftKind === "ai_optimized_listing") return "当前草稿：AI 优化草稿 · 已按卖点策略生成运营优化稿";
  if (draftKind === "structured_listing_draft") return "当前草稿：结构化草稿 · 安全事实草稿，不是运营优化版";
  if (draftKind === "safe_fact_draft") return "当前草稿：基础草稿 · 安全事实草稿，不是运营优化版";
  return "当前草稿：已有草稿";
}

export function ListingGenerationBasis({ draft }: { draft: ListingDraftSafeSummary | null }) {
  if (!draft) return null;
  // R4 契约：先检查 providerAttempted 显式值（true/false 优先于数组空判断）
  const aiAttempted = draft.providerAttempted === true;
  const providerAttemptedExplicit = draft.providerAttempted === true || draft.providerAttempted === false;
  const hasBasisEntries =
    (draft.usedFactTrace ?? []).length > 0
    || (draft.usedKeywordTrace ?? []).length > 0
    || (draft.searchOnlyKeywordTrace ?? []).length > 0
    || (draft.researchReferenceTrace ?? []).length > 0
    || (draft.humanReviewClaims ?? []).length > 0;
  // A. 历史草稿：providerAttempted 未定义 且 无新版依据字段 → 诚实空态；显式 false 不得判为历史
  if (!providerAttemptedExplicit && !hasBasisEntries) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="listing-generation-basis">
        <p className="text-xs font-bold text-slate-900">生成依据</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">这份历史草稿没有保存生成依据，重新生成后可查看。</p>
        <p className="mt-2 text-[11px] text-slate-400">研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。</p>
      </div>
    );
  }
  // B. 非 AI 草稿（安全草稿/结构化草稿）：诚实声明未调用 AI，不显示「提供给 AI」
  const showAiReferences = aiAttempted && (draft.researchReferenceTrace ?? []).length > 0;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="listing-generation-basis">
      <p className="text-xs font-bold text-slate-900">生成依据</p>
      {!aiAttempted ? (
        <p className="mt-2 text-xs leading-5 text-slate-600" data-testid="non-ai-basis-notice">
          本次未调用 AI，当前内容为基于已确认事实生成的安全草稿。
        </p>
      ) : null}
      {(draft.usedFactTrace ?? []).length > 0 ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-slate-500">最终文案实际命中的已确认商品事实</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
            {(draft.usedFactTrace ?? []).map((fact, index) => (<li key={index}>{fact.label}：{fact.value}</li>))}
          </ul>
        </div>
      ) : null}
      {(draft.usedKeywordTrace ?? []).length > 0 ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-slate-500">标题和正文实际采用的关键词</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(draft.usedKeywordTrace ?? []).map((keyword, index) => (
              <span key={index} className="rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">{keyword}</span>
            ))}
          </div>
        </div>
      ) : null}
      {(draft.searchOnlyKeywordTrace ?? []).length > 0 ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-slate-500">仅用于搜索词，未进入正文</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(draft.searchOnlyKeywordTrace ?? []).map((keyword, index) => (
              <span key={index} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{keyword}</span>
            ))}
          </div>
        </div>
      ) : null}
      {showAiReferences ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-slate-500">生成时提供给 AI 的研究参考</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
            {(draft.researchReferenceTrace ?? []).map((reference, index) => (<li key={index}>{reference}</li>))}
          </ul>
        </div>
      ) : null}
      {(draft.humanReviewClaims ?? []).length > 0 ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-amber-700">待人工确认的表达</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-700">
            {(draft.humanReviewClaims ?? []).map((claim, index) => (<li key={index}>{claim}</li>))}
          </ul>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-slate-400">研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。</p>
    </div>
  );
}

/** ListingPlan.v2：紧凑卖点策略区（3-5 张卡片；无计划历史草稿诚实空态） */
export function ListingSellingPointStrategy({ plan }: { plan: ListingDraftSafeSummary["sellingPointPlan"] }) {
  if (!plan || plan.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="listing-selling-points">
        <p className="text-xs font-bold text-slate-900">卖点策略</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">这份历史草稿没有保存卖点策略，重新生成后可查看。</p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3" data-testid="listing-selling-points">
      <p className="text-xs font-bold text-slate-900">卖点策略</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {plan.map((p, index) => (
          <div key={index} className="rounded-lg border border-slate-200 bg-white p-2.5">
            <p className="text-[11px] font-semibold text-teal-700">{p.role}{p.claimMode === "review" ? "（需人工确认）" : ""}</p>
            <p className="mt-1 text-xs leading-5 text-slate-700"><span className="font-semibold text-slate-500">买家关心：</span>{p.shopperNeed}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-700"><span className="font-semibold text-slate-500">准备表达：</span>{p.shopperAngle}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-700"><span className="font-semibold text-slate-500">使用事实：</span>{p.factLabels.join("、")}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-700"><span className="font-semibold text-slate-500">关键词：</span>{p.keywordIds.length > 0 ? p.keywordIds.join("、") : "无"}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-rose-600"><span className="font-semibold">不能写：</span>{p.cannotSay.slice(0, 3).join("、")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListingHandoffSection({
  taskId,
  imageMaterialNeeds = [],
  onCommitted,
  onProgressChange,
  refreshSignal = 0,
}: {
  taskId: string;
  /** 图片创作建议：来自研究保存时的 listingPrepSnapshot.imageMaterialNeeds（无数据则为空数组） */
  imageMaterialNeeds?: string[];
  /** Listing 草稿生成成功后通知父级（父级重读服务端真实任务状态，进度摘要随之刷新） */
  onCommitted?: () => void;
  onProgressChange?: (state: { isGenerating: boolean; hasResult: boolean }) => void;
  /** 外部触发重新加载（如事实补充成功后），变化即重读服务端最新状态 */
  refreshSignal?: number;
}) {
  const [status, setStatus] = useState<ListingStatus | null>(null);
  const [handoffRevision, setHandoffRevision] = useState<number | null>(null);
  const [handoffEffectiveStatus, setHandoffEffectiveStatus] = useState<string | null>(null);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [draft, setDraft] = useState<ListingDraftSafeSummary | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 轮 15：首次 409 后进入自动恢复（版本刷新后自动重试一次；复用轮 14 冲突决策） */
  const [conflictPending, setConflictPending] = useState(false);
  const lastConflictVersionRef = useRef<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [retryBody, setRetryBody] = useState<Record<string, unknown> | null>(null);
  const [listingBrief, setListingBrief] = useState<ListingBriefForm>(EMPTY_LISTING_BRIEF);
  const [savedListingBrief, setSavedListingBrief] = useState<ListingBriefForm>(EMPTY_LISTING_BRIEF);
  const [briefSaveState, setBriefSaveState] = useState<ListingBriefSaveState>("idle");
  const briefDirty = !listingCreationBriefFormsEqual(listingBrief, savedListingBrief);
  // 编辑态镜像：load 只依赖读取身份（taskId），编辑不得改变 load 身份或触发重新 GET；
  // 所有 editing/saved 更新入口同步镜像，避免事件后 effect 尚未运行的竞态。
  const listingBriefRef = useRef<ListingBriefForm>(emptyListingCreationBrief());
  const savedListingBriefRef = useRef<ListingBriefForm>(emptyListingCreationBrief());
  // 请求序号：taskId 切换/新 load 后旧响应不得覆盖新任务状态
  const loadSeqRef = useRef(0);
  const [factSummary, setFactSummary] = useState({
    confirmedFacts: 0,
    listingEligibleFacts: 0,
    prohibitedClaims: 0,
  });
  const [readiness, setReadiness] = useState<ListingStateResponse["data"]["readiness"]>(null);
  const [capability, setCapability] = useState<ListingStateResponse["data"]["capability"]>(null);
  const [claimPreflight, setClaimPreflight] = useState<ListingStateResponse["data"]["claimPreflight"]>(null);
  /** v2.2.14：每个复制按钮独立的短暂反馈（"已复制 ✓" / "复制失败"） */
  const [copiedButton, setCopiedButton] = useState<string | null>(null);
  const [copyFailedButton, setCopyFailedButton] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (options?: { preserveBriefEdits?: boolean }) => {
    const loadSeq = ++loadSeqRef.current;
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        headers: buildAccessHeaders(),
      });
      if (!mounted.current || loadSeq !== loadSeqRef.current) return;
      if (!res.ok) {
        setNotice({ tone: "error", text: "状态加载失败，请刷新重试。" });
        return;
      }
      const json = (await res.json()) as ListingStateResponse;
      if (!mounted.current || loadSeq !== loadSeqRef.current) return;
      if (json.ok) {
        setStatus(json.data.listingStatus);
        setHandoffRevision(json.data.currentHandoffRevision);
        setHandoffEffectiveStatus(json.data.handoffEffectiveStatus);
        setStorageVersion(json.data.storageVersion);
        setDraft(json.data.draft);
        setCanGenerate(json.data.canGenerate);
        setFactSummary(json.data.factSummary);
        setReadiness(json.data.readiness ?? null);
        setCapability(json.data.capability ?? null);
        setClaimPreflight(json.data.claimPreflight ?? null);
        const resolvedBrief = resolveLoadedListingCreationBrief({
          incoming: json.data.listingBrief,
          editing: listingBriefRef.current,
          saved: savedListingBriefRef.current,
          preserveEdits: options?.preserveBriefEdits === true,
        });
        listingBriefRef.current = resolvedBrief.editing;
        savedListingBriefRef.current = resolvedBrief.saved;
        setListingBrief(resolvedBrief.editing);
        setSavedListingBrief(resolvedBrief.saved);
      }
    } catch {
      if (mounted.current && loadSeq === loadSeqRef.current) {
        setNotice({ tone: "error", text: "网络异常，请重试。" });
      }
    }
    // 依赖仅真实读取身份：编辑态经 ref 读取，不进入依赖（编辑不改变 load 身份，无额外 GET）
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 外部刷新信号（事实补充成功等）→ 重读服务端最新状态，解除旧提示/按钮状态
  useEffect(() => {
    if (refreshSignal > 0) void load({ preserveBriefEdits: true });
  }, [refreshSignal, load]);

  // 轮 15：首次 409 自动恢复——版本刷新后（storageVersion 变化）自动重试一次
  useEffect(() => {
    if (!conflictPending || !storageVersion) return;
    const key = storageVersion.resultJsonHash + storageVersion.updatedAt;
    if (lastConflictVersionRef.current === key) return;
    lastConflictVersionRef.current = key;
    setConflictPending(false);
    // 自动重试（直接调用 generate；generate 内部会读取最新 storageVersion）
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅版本变化时触发一次，其余稳定
  }, [storageVersion, conflictPending]);

  useEffect(() => {
    onProgressChange?.({
      isGenerating: submitting,
      hasResult: status === "active" && draft !== null,
    });
  }, [draft, onProgressChange, status, submitting]);

  const handleConflict = useCallback((alreadyRetried: boolean) => {
    // 轮 15：409 自动恢复——首次刷新版本后自动重试一次；二次冲突停止并提示
    const recovery = resolveEvidenceConflictRecovery(409, "task_result_conflict", alreadyRetried);
    if (recovery.retry) {
      setConflictPending(true);
      setNotice({ tone: "info", text: "内容刚在其他位置更新，正在自动获取最新版本并重试…" });
    } else {
      setConflictPending(false);
      setNotice({ tone: "error", text: "创作资料又发生变化，请再试一次" });
    }
    void load({ preserveBriefEdits: true });
  }, [load]);

  const updateListingBrief = useCallback((field: keyof ListingBriefForm, value: string) => {
    const next = { ...listingBriefRef.current, [field]: value };
    listingBriefRef.current = next;
    setListingBrief(next);
    // The idempotency key binds all generation semantics, including this brief.
    setRequestId(null);
    setRetryBody(null);
    // 再次编辑 → 保存状态回到 idle（清除旧成功/失败/冲突反馈）
    setBriefSaveState("idle");
  }, []);

  /** 保存创作补充：save_listing_brief POST（六字段；全空 → listingBrief:null；409 保留输入并刷新版本，不自动重试） */
  const saveListingBrief = useCallback(async () => {
    if (briefSaveState === "saving") return;
    if (!storageVersion || handoffRevision === null) {
      setBriefSaveState("error");
      return;
    }
    const brief = listingBriefRef.current;
    const hasBriefContent = Object.values(brief).some((value) => value.trim().length > 0);
    const body = {
      action: "save_listing_brief",
      requestId: createBrowserUuid(),
      expectedStorageVersion: storageVersion,
      expectedHandoffRevision: handoffRevision,
      confirmed: true,
      listingBrief: hasBriefContent ? brief : null,
    };
    setBriefSaveState("saving");
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        method: "POST",
        headers: buildAccessHeaders(),
        body: JSON.stringify(body),
      });
      if (!mounted.current) return;
      if (res.status === 409) {
        // 409：保留用户输入；刷新服务端版本（storageVersion/handoffRevision），后续由用户再次点击
        setBriefSaveState("conflict");
        await load({ preserveBriefEdits: true });
        return;
      }
      if (!res.ok) {
        // 400/500：不得改动 editing/saved，不清空字段
        setBriefSaveState("error");
        return;
      }
      const json = (await res.json()) as SaveListingBriefResponse;
      if (!mounted.current) return;
      if (!json.ok) {
        setBriefSaveState("error");
        return;
      }
      // 成功后以响应 listingBrief 为准（复用现有归一化入口）；同步 editing/saved 双 ref 与双 state 及版本
      const resolved = resolveLoadedListingCreationBrief({
        incoming: json.data.listingBrief,
        editing: listingBriefRef.current,
        saved: savedListingBriefRef.current,
        preserveEdits: false,
      });
      listingBriefRef.current = resolved.editing;
      savedListingBriefRef.current = resolved.saved;
      setListingBrief(resolved.editing);
      setSavedListingBrief(resolved.saved);
      setStorageVersion(json.data.storageVersion);
      setHandoffRevision(json.data.currentHandoffRevision);
      setBriefSaveState("success");
    } catch {
      if (mounted.current) setBriefSaveState("error");
    }
  }, [storageVersion, handoffRevision, taskId, load, briefSaveState]);

  const generate = useCallback(async () => {
    if (submitting || handoffRevision === null || !canGenerate) return;
    // 内部防线：未保存的商品创作补充禁止生成（不依赖按钮 disabled），在任何请求构造之前拦截
    if (briefDirty) {
      setNotice({ tone: "error", text: "请先保存商品创作补充，再生成 Listing 草稿。" });
      return;
    }
    const nextRequestId = requestId ?? createBrowserUuid();
    let effectiveSv = storageVersion;
    if (!effectiveSv) {
      // storageVersion 直取（首次加载或 409 后）— 从本 Route 自己的 GET 获取，不依赖其他 API
      try {
        const svRes = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
          headers: buildAccessHeaders(),
        });
        const svJson = (await svRes.json()) as ListingStateResponse;
        if (svRes.ok && svJson.ok && svJson.data.storageVersion) {
          effectiveSv = svJson.data.storageVersion;
          setStorageVersion(effectiveSv);
        }
      } catch {
        effectiveSv = null;
      }
    }
    if (!effectiveSv) {
      setNotice({ tone: "error", text: "无法获取最新存储版本，请刷新后重试。" });
      return;
    }
    const hasListingBrief = Object.values(listingBrief).some((value) => value.trim().length > 0);
    const body = {
      requestId: nextRequestId,
      expectedStorageVersion: effectiveSv,
      expectedHandoffRevision: handoffRevision,
      confirmed: true,
      ...(hasListingBrief ? { listingBrief } : {}),
    };
    setSubmitting(true);
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        method: "POST",
        headers: buildAccessHeaders(),
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const json = (await res.json()) as { error?: { code?: string; message?: string } };
        handleConflict(conflictPending);
        void json;
        return;
      }
      if (!res.ok) {
        const json = (await res.json()) as { error?: { code?: string; message?: string } } & { demoAccess?: DemoAccessInfo };
        if (json.error?.code === "handoff_stale" || json.error?.code === "handoff_revision_conflict") {
          handleConflict(conflictPending);
          return;
        }
        if (json.demoAccess) {
          updateDemoAccessSnapshot(json.demoAccess);
        }
        setNotice({ tone: "error", text: `生成失败：${json.error?.message ?? "请重试。"}` });
        setRetryBody(body as unknown as Record<string, unknown>);
        return;
      }
      const json = (await res.json()) as GenerateResponse;
      const demoAccessSnapshot = (json as { demoAccess?: DemoAccessInfo }).demoAccess;
      if (demoAccessSnapshot) {
        updateDemoAccessSnapshot(demoAccessSnapshot);
      }
      if (mounted.current) {
        if (json.ok && json.data.idempotentReplay) {
          setNotice({ tone: "info", text: "该请求已成功生成过，未重复调用。" });
        } else if (json.ok && json.data.safeFallbackApplied) {
          // V2 Listing 稳定落库：AI 输出未通过事实校验 → 系统生成保守草稿（用户可编辑完善）
          setNotice({ tone: "info", text: "AI 优化未通过质量检查，已保留安全基础草稿。" });
        } else if (json.ok) {
          const kind = json.data.draft?.draftKind;
          if (kind === "ai_optimized_listing") {
            setNotice({ tone: "info", text: "AI 优化草稿已生成，请人工审核。" });
          } else if (kind === "structured_listing_draft") {
            setNotice({ tone: "info", text: "结构化草稿已生成，未进行 AI 优化。" });
          } else {
            setNotice({ tone: "info", text: "Listing 草稿已生成，请人工审核。" });
          }
        } else {
          setNotice({ tone: "error", text: "生成失败，请稍后重试。" });
        }
        setStatus(json.ok ? json.data.listingStatus : status);
        setRequestId(null);
        setRetryBody(null);
        setConflictPending(false);
        await load();
        onCommitted?.();
      }
    } catch {
      if (mounted.current) {
        setNotice({ tone: "error", text: "网络异常，请重试。" });
        setRetryBody(body as unknown as Record<string, unknown>);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [submitting, handoffRevision, canGenerate, requestId, taskId, status, load, handleConflict, storageVersion, onCommitted, listingBrief, conflictPending, briefDirty]);

  const retrySameRequest = useCallback(async () => {
    if (!retryBody || !requestId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        method: "POST",
        headers: buildAccessHeaders(),
        body: JSON.stringify(retryBody),
      });
      if (res.status === 409) {
        handleConflict(conflictPending);
        return;
      }
      if (res.ok) {
        setNotice({ tone: "info", text: "重试成功，未重复生成。" });
        setRequestId(null);
        setRetryBody(null);
        await load();
        onCommitted?.();
      } else {
        setNotice({ tone: "error", text: "重试仍失败，请稍后再试。" });
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [retryBody, requestId, submitting, taskId, load, handleConflict, onCommitted, conflictPending]);

  /** v2.2.14：复制（HTTP 兼容 helper）+ 每个按钮独立短暂反馈 */
  const copyWithFeedback = async (text: string, buttonKey: string, successText: string) => {
    if (!text.trim()) {
      setCopyFailedButton(buttonKey);
      window.setTimeout(() => setCopyFailedButton((cur) => cur === buttonKey ? null : cur), 1800);
      return;
    }
    const ok = await copyPlainText(text);
    if (ok) {
      setCopiedButton(buttonKey);
      window.setTimeout(() => setCopiedButton((cur) => cur === buttonKey ? null : cur), 1800);
    } else {
      setCopyFailedButton(buttonKey);
      window.setTimeout(() => setCopyFailedButton((cur) => cur === buttonKey ? null : cur), 1800);
    }
    void successText;
  };

  /** 完整 Listing = 仅 Listing 文本本体（Title / Bullet Points / Description / Keywords），不含图片创作建议 */
  const buildFullListingText = (): string => {
    if (!draft) return "";
    const parts: string[] = [];
    if (draft.titles.length) parts.push(`Title:\n${draft.titles.join("\n")}`);
    if (draft.bullets.length) {
      parts.push(`Bullet Points:\n${draft.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}`);
    }
    if (draft.description) parts.push(`Product Description:\n${draft.description}`);
    if (draft.keywords.length) parts.push(`Keywords:\n${draft.keywords.join(", ")}`);
    return parts.join("\n\n");
  };

  const renderDraftBody = () => {
    if (!draft) return null;
    /** v2.2.14：复制按钮（独立"已复制 ✓"/"复制失败"反馈，约 1.8 秒恢复） */
    const copyButton = (key: string, label: string, text: string, isPrimary = false) => {
      const showCopied = copiedButton === key;
      const showFailed = copyFailedButton === key;
      const btnLabel = showCopied ? "已复制 ✓" : showFailed ? "复制失败" : label;
      const cls = isPrimary
        ? "inline-flex h-8 items-center justify-center rounded-lg bg-teal-600 px-2.5 text-xs font-bold text-white hover:bg-teal-700"
        : `inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-xs font-semibold ${showFailed ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`;
      return (
        <button
          type="button"
          onClick={() => void copyWithFeedback(text, key, label)}
          className={cls}
          aria-live="polite"
        >
          {btnLabel}
        </button>
      );
    };
    return (
      <div className="mt-3 space-y-4 break-words text-sm text-slate-700">
        {/* 复制工具条 */}
        <div className="flex flex-wrap gap-2">
          {copyButton("title", "复制标题", draft.titles.join("\n"))}
          {copyButton("bullets", "复制五点描述", draft.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n"))}
          {copyButton("description", "复制商品描述", draft.description ?? "")}
          {copyButton("keywords", "复制关键词", draft.keywords.join(", "))}
          {copyButton("full", "复制完整 Listing", buildFullListingText(), true)}
        </div>

        {/* 1. 标题 Title */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">商品标题 Title</p>
          {draft.titles.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {draft.titles.map((t, i) => (
                <p key={`t-${i}`} className="leading-6">{t}</p>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成标题。</p>
          )}
        </div>

        {/* 2. 五点描述 Bullet Points */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">五点描述 Bullet Points</p>
          {draft.bullets.length > 0 ? (
            <ol className="mt-1.5 space-y-1">
              {draft.bullets.map((b, i) => (
                <li key={`b-${i}`} className="flex gap-1.5 leading-6">
                  <span className="shrink-0 font-semibold text-teal-600">{i + 1}.</span>
                  <span>{b}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成五点描述。</p>
          )}
        </div>

        {/* 3. 商品描述 Product Description */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">商品描述 Product Description</p>
          {draft.description ? (
            <p className="mt-1.5 leading-6">{draft.description}</p>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成商品描述。</p>
          )}
        </div>

        {/* 4. 搜索关键词 Keywords */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">搜索关键词 Keywords</p>
          {draft.keywords.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.keywords.map((k, i) => (
                <span key={`k-${i}`} className="rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">{k}</span>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成关键词。</p>
          )}
        </div>


        {/* 轮 16 收口：人工审核信息只展示服务端权威结果（不再本地猜测事实级别） */}
        {draft.bullets.length > 0 ? (() => {
          const reviewClaims = draft.humanReviewClaims ?? [];
          const planLabel = draft.keywordPlanSource === "manual"
            ? "已使用人工关键词方案"
            : draft.keywordPlanSource === "auto_suggested"
              ? "已自动使用关键词资料"
              : "暂无有效关键词方案";
          return (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="listing-human-review-aid">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">人工审核辅助</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">
                关键词方案：{planLabel}{draft.keywords.length > 0 ? "（当前草稿已用：" + draft.keywords.slice(0, 6).join("、") + "）" : ""}
              </p>
              {reviewClaims.length > 0 ? (
                <div className="mt-1 text-xs leading-5 text-amber-700">
                  <p>有 {reviewClaims.length} 条表达需人工确认（服务端判定）：</p>
                  <ul className="mt-0.5 list-disc pl-4">
                    {reviewClaims.slice(0, 3).map((claim, idx) => (
                      <li key={idx} className="truncate">{claim.length > 80 ? claim.slice(0, 80) + "..." : claim}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-1 text-xs leading-5 text-teal-700">已确认内容均基于已确认事实；无待人工确认表达。</p>
              )}
            </div>
          );
        })() : null}
        {/* 图片创作建议：独立区域，不属于 Listing 文本本体（Listing 后台字段不包含此内容） */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="image-creation-suggestions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">图片创作建议</p>
            {imageMaterialNeeds.length > 0 ? (
              <button
                type="button"
                onClick={() => void copyWithFeedback(imageMaterialNeeds.map((n, i) => `${i + 1}. ${n}`).join("\n"), "image-needs", "图片创作建议已复制。")}
                className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {copiedButton === "image-needs" ? "已复制 ✓" : "复制图片创作建议"}
              </button>
            ) : null}
          </div>
          {imageMaterialNeeds.length > 0 ? (
            <ol className="mt-1.5 space-y-1">
              {imageMaterialNeeds.map((n, i) => (
                <li key={`n-${i}`} className="flex gap-1.5 leading-6 text-slate-600">
                  <span className="shrink-0 font-semibold text-slate-400">{i + 1}.</span>
                  <span>{n}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成图片创作建议。</p>
          )}
        </div>

        {draft.riskNotes.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">风险提示</p>
            <ul className="mt-1.5 list-disc pl-5">
              {draft.riskNotes.map((r, i) => (
                <li key={`r-${i}`} className="mt-0.5 leading-6">{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="mt-5 min-w-0 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Listing 草稿">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-800">Listing 草稿</h2>
        {draft?.listingUnqualified ? (
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700" data-testid="listing-unqualified-badge">
            暂无合格草稿
          </span>
        ) : (
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700">
            当前有效 Listing
          </span>
        )}
        {draft ? (
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span className={`rounded-full px-2 py-0.5 ${draft.factSafe ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} data-testid="fact-safe-status">事实安全：{draft.factSafe ? "通过" : "未通过"}</span>
            <span className={`rounded-full px-2 py-0.5 ${draft.copyQuality ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} data-testid="copy-quality-status">文案质量：{draft.copyQuality ? "通过" : "未通过"}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600" data-testid="draft-kind-status">草稿类型：{draft.draftKind === "ai_optimized_listing" ? "AI 运营优化稿" : draft.draftKind === "structured_listing_draft" ? "安全事实提纲" : "暂无合格草稿"}</span>
          </div>
        ) : null}
      </header>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="mt-3 space-y-2 text-sm text-slate-600">
        {status !== null ? (
          <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600" data-testid="task-listing-fact-counts">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">已确认事实：{factSummary.confirmedFacts}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">可用于 Listing：{factSummary.listingEligibleFacts}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">禁止声明：{factSummary.prohibitedClaims}</span>
          </div>
        ) : null}
        {status !== null && factSummary.listingEligibleFacts === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            当前研究记录缺少可用于 Listing 的商品事实，请先补充并确认商品资料。
          </p>
        ) : null}
        {status === null ? (
          <p aria-busy="true">加载中…</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold" data-testid="listing-readiness-badges">
            <span className={`rounded-full px-2.5 py-1 ${readiness?.claimSafe ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              Claim Safety：{readiness?.claimSafe ? "通过" : "未通过"}
            </span>
            <span className={`rounded-full px-2.5 py-1 ${readiness?.copyReady ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
              优化 Listing：{readiness?.copyReady ? "可生成" : "暂不可生成"}
            </span>
            <span className={`rounded-full px-2.5 py-1 ${readiness?.keywordReady ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
              关键词资料：{readiness?.keywordReady ? "已满足" : "未提供（当前可生成文案，不进行关键词优化）"}
            </span>
            {readiness && !readiness.copyReady && readiness.missingForQuality.length > 0 ? (
              <span
                className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800"
                data-testid="listing-missing-quality"
                title={readiness.missingForQuality.join("；")}
              >
                生成高质量 Listing 还缺：{readiness.missingForQuality.join("；")}
              </span>
            ) : null}
          </div>
        )}
        {capability ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold" data-testid="listing-capability-badges">
            <span
              className={`rounded-full px-2.5 py-1 ${
                capability.canCallProvider ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"
              }`}
              data-testid="listing-capability-copy"
            >
              {capability.level === "full_draft"
                ? "可生成 5 条完整卖点"
                : capability.level === "standard_draft"
                  ? `可生成 ${capability.targetBulletCount} 条正式卖点`
                  : capability.level === "partial_draft"
                    ? "可生成 2 条部分草稿（还缺至少 1 个独立卖点组）"
                    : "仅能整理事实，暂不能生成正式 Listing"}
            </span>
            {capability.suggestedQuestions.length > 0 ? (
              <span
                className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800"
                data-testid="listing-capability-questions"
                title={capability.suggestedQuestions.join("；")}
              >
                补资料（最多 3 项）：{capability.suggestedQuestions.join("；")}
              </span>
            ) : null}
          </div>
        ) : null}
        {status !== null && status !== "legacy_unbound" ? (
          <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="listing-creation-brief" data-brief-dirty={briefDirty}>
            <legend className="px-1 text-sm font-bold text-slate-800">商品创作补充（可选）</legend>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              用于帮助AI理解营销方向，不代表已验证商品事实。不会写入已确认事实，也不会放宽 Claim Safety。
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {([
                ["coreSellingPoint", "核心卖点", "例如：希望重点表达带盖吸管的日常使用体验", 300],
                ["targetAudience", "目标用户", "例如：通勤和日常随身携带的人群", 200],
                ["useScenario", "使用场景", "例如：通勤、旅行、办公室补水", 200],
                ["differentiation", "差异化优势", "例如：希望突出与同类水杯不同的表达方向", 300],
                ["contentEmphasis", "内容强调方向", "例如：优先强调舒适饮用和日常节奏", 300],
              ] as const).map(([field, label, placeholder, maxLength]) => (
                <label key={field} className="grid gap-1 text-xs font-semibold text-slate-700">
                  {label}
                  <textarea
                    value={listingBrief[field]}
                    onChange={(event) => updateListingBrief(field, event.target.value)}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    rows={2}
                    className="min-h-16 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-normal text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="listing-brief-save"
                disabled={briefSaveState === "saving" || !briefDirty}
                onClick={() => void saveListingBrief()}
                className={BTN_SECONDARY_CLASS}
              >
                {briefSaveState === "saving"
                  ? "保存中…"
                  : briefSaveState === "error" || briefSaveState === "conflict"
                    ? "重新保存"
                    : briefDirty
                      ? "保存创作补充"
                      : "已保存"}
              </button>
              {briefSaveState === "success" || briefSaveState === "error" || briefSaveState === "conflict" ? (
                <p
                  data-testid="listing-brief-save-status"
                  role="status"
                  aria-live="polite"
                  className={`text-xs font-semibold ${briefSaveState === "success" ? "text-teal-700" : "text-rose-700"}`}
                >
                  {briefSaveState === "success"
                    ? "创作补充已保存"
                    : briefSaveState === "error"
                      ? "保存失败，已保留你的输入"
                      : "内容已在其他位置更新，已保留你的输入，请重新保存"}
                </p>
              ) : null}
            </div>
            {briefDirty ? (
              <p
                className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                data-testid="listing-brief-unsaved-warning"
                role="alert"
              >
                请先保存商品创作补充，再生成 Listing 草稿。
              </p>
            ) : null}
          </fieldset>
        ) : null}
        {status === null ? (
          <p aria-busy="true">加载中…</p>
        ) : status === "legacy_unbound" ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="font-semibold text-slate-800">历史草稿缺少有效创作资料</p>
            <p className="mt-1">该草稿只读展示，不能作为当前有效草稿。请先确认创作资料并进行人工复核。</p>
          </div>
        ) : status === "ready" ? (
          <div>
            <p>
              {(() => {
                // 三态：pending（可生成）不显示阻断；真 blocked 才显示
                const preflightBlocked = claimPreflight && !claimPreflight.pass
                  && claimPreflight.reasonCode !== "english_rendering_pending";
                const preflightPending = claimPreflight && !claimPreflight.pass
                  && claimPreflight.reasonCode === "english_rendering_pending";
                if (preflightBlocked) {
                  return "创作资料已确认 · 事实校验未通过，暂不能生成";
                }
                if (preflightPending) {
                  return "创作资料已确认 · 中文事实将在生成时自动英文化 · 可生成 Listing 草稿";
                }
                return factSummary.listingEligibleFacts > 0
                  ? "创作资料已确认 · 可生成 Listing 草稿"
                  : "创作资料已确认 · 但缺少可用于 Listing 的商品事实";
              })()}
            </p>
            {/* V3R（契约①）：真 blocked 才展示服务端同源阻断原因；pending 只显示普通提醒 */}
            {claimPreflight && !claimPreflight.pass && claimPreflight.reasonCode === "english_rendering_pending" ? (
              <p className="mt-1 rounded-lg bg-sky-50 px-3 py-2 text-sky-800">
                中文商品事实将在生成阶段转换为英文，并在生成后继续执行事实与文案校验。
              </p>
            ) : null}
            {claimPreflight && !claimPreflight.pass && claimPreflight.reasonCode !== "english_rendering_pending" ? (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-800" data-testid="claim-preflight-blocked" role="alert">
                暂不能生成：{claimPreflight.reason}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="generate-listing-draft"
              disabled={!canGenerate || submitting || briefDirty}
              onClick={() => void generate()}
              className={BTN_CLASS}
            >
              {submitting ? "生成中…" : "生成 Listing 草稿"}
            </button>
          </div>
        ) : status === "active" ? (
          <div>
            {/* v2.2.14：区分"当前草稿类型"与"生成能力"，不再把能力与结果混在一起 */}
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                {draft?.draftKind === "ai_optimized_listing"
                  ? "当前草稿：AI 优化草稿 · 已按卖点策略生成运营优化稿"
                  : draft?.draftKind === "structured_listing_draft"
                    ? "当前草稿：结构化草稿 · 安全事实草稿，不是运营优化版"
                    : draft?.draftKind === "safe_fact_draft"
                      ? "当前草稿：基础草稿 · 安全事实草稿，不是运营优化版"
                      : "当前草稿：已有草稿"}
              </span>
              <span className="text-xs font-normal text-slate-500">
                生成于 {formatDate(draft?.generatedAt ?? null)} · 仍需人工审核，不得直接发布
              </span>
            </div>
            {draft?.draftKind === "safe_fact_draft" && readiness?.copyReady ? (
              <p className="mt-1 rounded-lg bg-teal-50 px-3 py-2 text-teal-800" data-testid="copy-ready-ai-available">
                商品资料已满足 AI 优化条件，可点击“生成 AI 优化草稿”。
              </p>
            ) : null}
            {draft?.draftKind === "safe_fact_draft" && readiness && !readiness.copyReady ? (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-800" data-testid="safe-fact-draft-issues">
                当前为基础草稿：{draft.qualityIssues?.slice(0, 3).join("；") ?? "事实资料尚不足以生成优化草稿"}
              </p>
            ) : null}
            {draft?.draftKind === "structured_listing_draft" && draft.qualityIssues && draft.qualityIssues.length > 0 ? (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-800" data-testid="structured-advisory-issues">
                当前为结构化草稿，还有 {draft.qualityIssues.length} 项建议可完善。
              </p>
            ) : null}
            {draft?.providerAttempted === true && draft.providerSucceeded === false ? (
              <p className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-slate-600" data-testid="ai-fallback-notice">
                AI 草稿未通过事实校验：{draft.fallbackReason?.includes("未通过")
                  ? "AI 文案包含未经确认的信息，已保留安全基础草稿（补齐确认事实后可重新生成）。"
                  : (draft.fallbackReason ?? "AI 草稿未通过事实校验，已保留安全基础草稿。补齐确认事实后可重新生成。")}
              </p>
            ) : null}
            {draft?.backendTermWarnings && draft.backendTermWarnings.length > 0 ? (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-800" data-testid="backend-term-warnings">
                {draft.backendTermWarnings.length} 个搜索词因缺少商品事实依据未采用
              </p>
            ) : null}
            {/* R2：生成依据（服务端安全结果为唯一来源；前端只展示不重判） */}
            <ListingGenerationBasis draft={draft} />
          <ListingSellingPointStrategy plan={draft?.sellingPointPlan} />
            {draft?.listingUnqualified ? (
              <div data-testid="unqualified-listing-draft" className="mt-1 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2" role="alert">
                <p className="text-sm font-semibold text-rose-800">暂无合格草稿</p>
                <p className="mt-1 text-xs leading-5 text-rose-700">
                  当前草稿未达到 Listing 质量合同（3-5 条完整句、每条 8-30 个英文词、逐条绑定已确认事实）。补齐确认事实后可重新生成。
                </p>
                {(draft.rejectedListingSentences ?? []).length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-rose-700">
                    {(draft.rejectedListingSentences ?? []).map((item, index) => (
                      <li key={index}>
                        <span className="font-semibold">{item.text}</span> —— {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {!draft?.listingUnqualified ? renderDraftBody() : null}
            <div className="mt-3">
              <button
                type="button"
                disabled={!canGenerate || submitting || briefDirty}
                onClick={() => void generate()}
                className={BTN_SECONDARY_CLASS}
                data-testid="regenerate-listing-draft"
              >
                {submitting ? "生成中…" : draft?.draftKind === "ai_optimized_listing" ? "重新生成草稿" : "生成 AI 优化草稿"}
              </button>
              <p className="mt-1.5 text-xs text-slate-500">
                重新生成将替换当前草稿，不影响已确认的商品资料。
              </p>
            </div>
          </div>
        ) : status === "stale" ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <p className="font-semibold text-amber-800">该草稿基于旧创作资料</p>
            <p className="mt-1 text-amber-700">
              当前草稿只读，不能作为当前有效草稿。请基于最新资料生成新版本。
            </p>
            {renderDraftBody()}
            <button
              type="button"
              disabled={!canGenerate || submitting || briefDirty}
              onClick={() => void generate()}
              className={BTN_CLASS}
            >
              {submitting ? "生成中…" : "基于最新资料重新生成"}
            </button>
          </div>
        ) : status === "revoked" ? (
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="font-semibold text-red-800">创作资料已撤回</p>
            <p className="mt-1 text-red-700">草稿历史可查看，生成功能已禁用。</p>
            {renderDraftBody()}
          </div>
        ) : (
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="font-semibold text-red-800">草稿状态异常</p>
            <p className="mt-1 text-red-700">请刷新页面后重试。</p>
          </div>
        )}
      </div>

      {retryBody && requestId ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void retrySameRequest()}
          className={BTN_SECONDARY_CLASS}
        >
          重试同一请求
        </button>
      ) : null}
    </section>
  );
}
