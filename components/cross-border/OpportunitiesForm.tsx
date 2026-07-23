"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";

import { useLocalDraft } from "@/hooks/useLocalDraft";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { OpportunitiesDecisionSummary } from "@/components/cross-border/OpportunitiesDecisionSummary";
import { OpportunitiesFlowGuidance } from "@/components/cross-border/OpportunitiesFlowGuidance";
import { OpportunitiesLockedPreview } from "@/components/cross-border/OpportunitiesLockedPreview";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";
import { getCandidateDeletePresentation } from "@/lib/opportunityCandidateActions";
import {
  buildCandidateTaskLinkMap,
  resolveCandidateTaskLinks,
  type LinkedTaskInfo,
} from "@/lib/candidateTaskLinks";
import {
  buildCandidateStatusUpdatePayload,
  canCandidateEnterAgent,
  filterCandidatePool,
  getCandidateQueuePresentation,
  getCandidateSourceIntegrityPresentation,
  mergeCandidatesIntoPool,
  mergeServerCandidatesWithLocalDrafts,
  readCandidatePool,
  serverCandidateToPoolItem,
  sortCandidatePool,
  updateCandidateStatus,
  writeCandidatePool,
  type CandidatePoolFilter,
  type CandidatePoolSort,
  type CandidateQueueState,
  type CandidateStatus,
  type OpportunityCandidateInput,
  type OpportunityCandidatePoolItem,
} from "@/lib/opportunityCandidatePool";
import {
  Search,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  FileDown,
  ChevronDown,
  ChevronUp,
  Target,
  Shield,
  Brain,
  Sparkles,
  Upload,
  Wifi,
  WifiOff,
  Trash2,
  ArrowRight,
  Database,
  FileText,
  Plus,
} from "lucide-react";
import { getCandidateTypeLabel, getCandidateTypeBadgeClass, getFailureReasonLabel, extractFailureReason, SOURCE_IMPORT_TIERS, SOURCE_IMPORT_HINT } from "@/lib/client/sourceImportLabels";
import { evaluateCandidateQuality, getCandidateQualityDisplay, QUALITY_TIER_LABELS, QUALITY_TIER_TONES, PAGE_TYPE_LABELS, type CandidateQualityLevel, type CandidateQualityTier } from "@/lib/candidateQuality";
import { getAccessMode } from "@/lib/client/accessToken";
import { normalizeCandidateEvidence, getRiskFlagLabel, sanitizeUrlForDisplay, type CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import { CandidateEvidenceReviewPanel } from "@/components/cross-border/CandidateEvidenceReviewPanel";
import {
  buildSourceImportCandidateSaveInput,
  sourceImportSaveSuccessMessage,
  type SourceImportCandidateSaveData,
} from "@/lib/client/sourceImportCandidateSave";
import {
  getSignedSourceQueuePolicy,
  type SignedSourceQueuePolicyReason,
} from "@/lib/ruleAssessmentPolicy";
import {
  buildDecisionDeskSummary,
  getDecisionDeskEvidencePresentation,
  getDecisionDeskMarketPresentation,
  getDecisionDeskRiskPresentation,
  getDecisionDeskScorePresentation,
  resolveDecisionDeskSelection,
} from "@/lib/opportunityDecisionDesk";

const QUALITY_TONE: Record<CandidateQualityLevel, string> = {
  recommended: "border-emerald-200 bg-emerald-50 text-emerald-700",
  caution: "border-amber-200 bg-amber-50 text-amber-700",
  not_recommended: "border-slate-200 bg-slate-50 text-slate-500",
  rejected: "border-rose-200 bg-rose-50 text-rose-500",
};

type CandidateData = {
  index: number;
  name: string;
  rawInput: string;
  link: string | null;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string;
  score: number;
  level: string;
  levelLabel: string;
  reasons: string[];
  risks: string[];
  nextAction: string;
  sourcing: {
    feasibility: string;
    summary: string;
    searchKeywords: string[];
    moqEstimate: string;
    beginnerFriendly?: boolean;
    beginnerFit?: string;
  } | null;
  risk: {
    overallLevel: string;
    displayLevel?: string;
    summary: string;
    blacklistMatches: string[];
  } | null;
  summary: {
    verdict: string;
    confidence: string;
    summary: string;
    reasons: string[];
    risks: string[];
    nextSteps: string[];
    beginnerTip: string;
    downgraded?: boolean;
    downgradeReasons?: string[];
  } | null;
};

type ApiResponse = {
  ok: true;
  data: {
    candidates: CandidateData[];
    totalCount: number;
    completedCount: number;
    failedCount: number;
  };
} | { ok: false; error: { code: string; message: string } };

const LEVEL_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-sky-100 text-sky-800 border-sky-200",
  C: "bg-amber-100 text-amber-800 border-amber-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  E: "bg-rose-100 text-rose-800 border-rose-200",
};

const LEVEL_DOT: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-sky-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  E: "bg-rose-500",
};

const RISK_BADGE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  yellow: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-rose-50 text-rose-700 border-rose-200",
};

type SourceImportCandidateData = SourceImportCandidateSaveData & {
  /** Phase 4-D.8: candidate quality classification */
  evidenceSnapshot?: CandidateEvidenceSnapshot;
};

function sourceQueueMessage(reason: SignedSourceQueuePolicyReason): string {
  if (reason === "ready_for_review") return "可进入人工复核，已纳入批量选择";
  if (reason === "manual_watch") return "证据或规则分有限，仅允许逐条人工选择";
  if (reason === "not_product_candidate") return "仅作为方向线索展示，不能保存为 Candidate";
  if (reason === "unsupported_algorithm") return "规则版本不受支持，请重新抓取";
  return "规则建议暂不推进，不能保存为 Candidate";
}

type SourceImportResponse = {
  ok: true;
  candidates: SourceImportCandidateData[];
  summary: { totalUrls: number; okUrls: number; failedUrls: number; totalCandidates: number };
  warnings: string[];
} | { ok: false; error: { code: string; message: string } };

const DRAFT_KEY = "qx:opportunities-draft:v1";

const candidateFilterOptions: { value: CandidatePoolFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待查看" },
  { value: "worth_analyzing", label: "待分析" },
  { value: "analyzed", label: "分析中" },
  { value: "paused", label: "待查看（历史暂缓）" },
  { value: "rejected", label: "已放弃" },
];

function displayRiskLevel(candidate?: Pick<CandidateData, "risk">) {
  return candidate?.risk?.displayLevel || candidate?.risk?.overallLevel || "";
}

const riskOrder: Record<string, number> = { red: 3, yellow: 2, green: 1 };

function riskText(level: string) {
  if (level === "red") return "高";
  if (level === "yellow") return "中";
  if (level === "green") return "低";
  return "—";
}

function riskSummaryText(level: string) {
  if (level === "red") return "高风险";
  if (level === "yellow") return "需注意";
  if (level === "green") return "低风险";
  return "—";
}

function riskColor(level: string) {
  if (level === "red") return "text-rose-600 font-semibold";
  if (level === "yellow") return "text-amber-600";
  return "text-emerald-600";
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fallback for focused-window / permission edge cases in local browser tests.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function buildPoolAgentRunHref(candidate: OpportunityCandidatePoolItem) {
  return buildCandidateAgentRunHref({
    candidateId: candidate.id,
    name: candidate.name,
    rawInput: candidate.rawInput,
    analyzedName: candidate.name,
    sourceTitle: candidate.summaryLabel || candidate.name,
    sourceUrl: candidate.link,
    source: candidate.source,
    score: candidate.score,
    keyword: candidate.keyword,
    evidenceSnapshot: candidate.evidenceSnapshot,
    marketDecisionSnapshot: candidate.r22MarketDecisionSnapshot,
  });
}

function candidateToPoolInput(candidate: CandidateData): OpportunityCandidateInput {
  const riskLevel = displayRiskLevel(candidate);
  return {
    name: candidate.name,
    rawInput: candidate.rawInput,
    link: candidate.link,
    score: candidate.score,
    source: "机会雷达",
    keyword: candidate.sourcing?.searchKeywords?.find((item) => item.trim().length > 0)?.trim() || candidate.rawInput,
    riskLevel,
    riskLabel: riskSummaryText(riskLevel),
    summaryLabel: candidate.summary?.verdict || candidate.reasons.slice(0, 1).join("") || candidate.nextAction,
    evidenceSnapshot: normalizeCandidateEvidence({
      title: candidate.name,
      sourceType: "manual",
      sourceName: "opportunity radar",
      sourceUrl: candidate.link,
      score: candidate.score,
      riskHint: candidate.risk?.summary,
    }),
  };
}

function candidateStatusClass(status: CandidateQueueState) {
  if (status === "pending_analysis") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "analyzing") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "converted") return "border-teal-200 bg-teal-50 text-teal-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function decisionDeskToneClass(tone: "positive" | "warning" | "danger" | "neutral") {
  if (tone === "positive") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "danger") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function getApiErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return fallback;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : fallback;
}

export type OpportunitiesSurface = "legacy_default" | "advanced_import";

export function getOpportunitiesSurfaceCopy(surface: OpportunitiesSurface) {
  return surface === "advanced_import"
    ? {
        eyebrow: "高级工具",
        lockedTitle: "手工导入外部来源 · 功能预览",
        lockedDescription: "保留现有 URL、RSS、Sitemap 与历史候选流程；导入不等于完成 Evidence 筛选或进入调查短名单。",
        unlockedTitle: "手工导入外部来源",
        unlockedDescription: "保留现有 URL、RSS、Sitemap 与历史候选流程；导入不等于完成 Evidence 筛选或进入调查短名单。",
      } as const
    : {
        eyebrow: null,
        lockedTitle: "机会雷达 / 候选品池 · 功能预览",
        lockedDescription: "跨境电商机会来源导入与候选池 — 未解锁时可浏览功能说明和示例",
        unlockedTitle: "机会雷达",
        unlockedDescription: "先看市场信号，再决定是否进入商业深挖。",
      } as const;
}

type OpportunitiesFormProps = {
  surface?: OpportunitiesSurface;
  visualFixture?: OpportunityCandidatePoolItem[];
};

type OpportunitiesFormContentProps = OpportunitiesFormProps & {
  accessPassword: string;
  isAccessPasswordReady: boolean;
  draftVal: string;
  setDraft: (value: string) => void;
  draftRestored: boolean;
};

export function OpportunitiesForm({
  surface = "legacy_default",
  visualFixture,
}: OpportunitiesFormProps = {}) {
  if (visualFixture) {
    return <OpportunitiesFormContent
      surface={surface}
      visualFixture={visualFixture}
      accessPassword=""
      isAccessPasswordReady={false}
      draftVal=""
      setDraft={() => {}}
      draftRestored={true}
    />;
  }
  return <OpportunitiesFormWithLocalAccess surface={surface} />;
}

function OpportunitiesFormWithLocalAccess({ surface }: Pick<OpportunitiesFormProps, "surface">) {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const { draftValue: draftVal, setDraftValue: setDraft, restored: draftRestored } = useLocalDraft<string>({
    storageKey: DRAFT_KEY,
    ttlMs: 10 * 60 * 1000,
    initialValue: "",
  });
  return <OpportunitiesFormContent
    surface={surface}
    accessPassword={accessPassword}
    isAccessPasswordReady={isAccessPasswordReady}
    draftVal={draftVal}
    setDraft={setDraft}
    draftRestored={draftRestored}
  />;
}

function OpportunitiesFormContent({
  surface = "legacy_default",
  visualFixture,
  accessPassword,
  isAccessPasswordReady,
  draftVal,
  setDraft,
  draftRestored,
}: OpportunitiesFormContentProps) {
  const visualFixtureMode = Boolean(visualFixture);
  const surfaceCopy = getOpportunitiesSurfaceCopy(surface);
  const [rawText, setRawText] = useState("");
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [poolItems, setPoolItems] = useState<OpportunityCandidatePoolItem[]>(() => visualFixture ? [...visualFixture] : []);
  const [poolHydrated, setPoolHydrated] = useState(visualFixtureMode);
  const [poolFilter, setPoolFilter] = useState<CandidatePoolFilter>("all");
  const [poolSort, setPoolSort] = useState<CandidatePoolSort>("updated");
  const [selectedPoolCandidateId, setSelectedPoolCandidateId] = useState<string | null>(null);
  const [showCandidateIntake, setShowCandidateIntake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [error, setError] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Phase 3-B.1: Server candidate pool state
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(visualFixtureMode ? false : null); // null = checking
  const [importingLocal, setImportingLocal] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [poolSyncNotice, setPoolSyncNotice] = useState("");

  // Phase 4-B: Source importer state
  const [sourceImportUrls, setSourceImportUrls] = useState("");
  const [sourceImporting, setSourceImporting] = useState(false);
  const [sourceImportError, setSourceImportError] = useState("");
  const [sourceImportWarnings, setSourceImportWarnings] = useState<string[]>([]);
  const [sourceImportCandidates, setSourceImportCandidates] = useState<SourceImportCandidateData[]>([]);
  const [sourceImportChecked, setSourceImportChecked] = useState<Set<string>>(new Set());
  const [sourceImportSummary, setSourceImportSummary] = useState<{ totalUrls: number; okUrls: number; failedUrls: number; totalCandidates: number } | null>(null);
  const [sourceConfirming, setSourceConfirming] = useState(false);
  const [sourceConfirmResult, setSourceConfirmResult] = useState("");
  const sourceReviewSelectionKeys = useMemo(() => sourceImportCandidates.flatMap((candidate, index) => (
    getSignedSourceQueuePolicy(candidate.ruleAssessment).defaultSelected ? [String(index)] : []
  )), [sourceImportCandidates]);
  const allSourceReviewsSelected = sourceReviewSelectionKeys.length > 0
    && sourceReviewSelectionKeys.every((key) => sourceImportChecked.has(key));

  // Phase Candidate-Status-M.1: candidate ↔ task links
  const [candidateTaskLinks, setCandidateTaskLinks] = useState<Map<string, LinkedTaskInfo[]>>(new Map());
  const [taskLinksLoading, setTaskLinksLoading] = useState(false);
  const [openMoreId, setOpenMoreId] = useState<string | null>(null);
  const [moreMenuStyle, setMoreMenuStyle] = useState<React.CSSProperties>({ display: "none" });

  const unlocked = visualFixtureMode || (isAccessPasswordReady && accessPassword.trim().length > 0);

  // Restore draft on mount (only once)
  const didRestore = useRef(false);
  useEffect(() => {
    if (!didRestore.current && draftRestored && draftVal) {
      setRawText(draftVal);
      didRestore.current = true;
    }
  }, [draftRestored, draftVal]);

  // Phase 3-B.1: Try server first, fall back to localStorage
  const hasAccess = !visualFixtureMode
    && isAccessPasswordReady
    && canRequestWithAccessPassword(isAccessPasswordReady, accessPassword);
  const demoMode = hasAccess ? (getAccessMode() === "demo") : false;

  const refreshServerPool = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/opportunity-candidates?limit=100", {
      headers: { ...buildAccessHeaders() },
      signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      throw new Error("候选池服务返回异常，请稍后重试。");
    }
    if (!res.ok || !json || typeof json !== "object" || Array.isArray(json)) {
      throw new Error(getApiErrorMessage(json, "候选池读取失败，请稍后重试。"));
    }
    const items = (json as Record<string, unknown>).items;
    if ((json as Record<string, unknown>).ok !== true || !Array.isArray(items)) {
      throw new Error(getApiErrorMessage(json, "候选池读取失败，请稍后重试。"));
    }

    const serverItems = items
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
      .map(serverCandidateToPoolItem);
    const cachedItems = readCandidatePool(typeof window === "undefined" ? null : window.localStorage);
    const mergedItems = mergeServerCandidatesWithLocalDrafts(serverItems, cachedItems);
    setPoolItems(mergedItems);
    setServerAvailable(true);
    writeCandidatePool(typeof window === "undefined" ? null : window.localStorage, mergedItems);
    return mergedItems;
  }, [accessPassword]);

  useEffect(() => {
    if (visualFixture) {
      setPoolItems([...visualFixture]);
      setPoolHydrated(true);
      setServerAvailable(false);
      return;
    }
    if (!hasAccess) {
      // No access password: use localStorage only
      setPoolItems(readCandidatePool(typeof window === "undefined" ? null : window.localStorage));
      setPoolHydrated(true);
      setServerAvailable(false);
      return;
    }

    // Try server first
    const controller = new AbortController();
    async function loadFromServer() {
      try {
        await refreshServerPool(controller.signal);
        setPoolSyncNotice("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPoolItems(readCandidatePool(window.localStorage));
        setServerAvailable(false);
        setPoolSyncNotice("候选池服务端读取失败，当前仅显示本浏览器候选池；刷新或重新输入访问密码后会再次尝试连接。");
      } finally {
        setPoolHydrated(true);
      }
    }

    void loadFromServer();
    return () => controller.abort();
  }, [hasAccess, refreshServerPool, visualFixture]);

  useEffect(() => {
    if (!poolHydrated || visualFixtureMode) return;
    writeCandidatePool(typeof window === "undefined" ? null : window.localStorage, poolItems);
  }, [poolHydrated, poolItems, visualFixtureMode]);

  // Phase Candidate-Status-M.1: Load recent tasks to build candidate→task link map
  useEffect(() => {
    if (!hasAccess || serverAvailable !== true) {
      setCandidateTaskLinks(new Map());
      return;
    }

    let cancelled = false;
    async function loadTaskLinks() {
      setTaskLinksLoading(true);
      try {
        const res = await fetch("/api/tasks?limit=50", {
          headers: { ...buildAccessHeaders() },
        });
        if (!res.ok) return;
        const json = await res.json();
        const records = json.records ?? json.data?.items ?? [];
        if (!Array.isArray(records)) return;
        if (!cancelled) {
          setCandidateTaskLinks(buildCandidateTaskLinkMap(records));
        }
      } catch {
        // Silently degrade — task links are optional
      } finally {
        if (!cancelled) setTaskLinksLoading(false);
      }
    }

    void loadTaskLinks();
    return () => { cancelled = true; };
  }, [hasAccess, serverAvailable, accessPassword]);

  // Position "更多操作" dropdown relative to viewport so it escapes parent overflow clipping.
  useEffect(() => {
    if (!openMoreId) {
      setMoreMenuStyle({ display: "none" });
      return;
    }

    const button = document.querySelector(`[data-more-button="${openMoreId}"]`) as HTMLElement | null;
    if (!button) {
      setMoreMenuStyle({ display: "none" });
      return;
    }

    function recalc() {
      const rect = button!.getBoundingClientRect();
      const menuWidth = 192; // w-48
      const menuHeight = 220; // approximate max height
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= menuHeight
        ? rect.bottom + 4
        : Math.max(4, rect.top - menuHeight - 4);
      const left = Math.max(4, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 4));

      setMoreMenuStyle({
        position: "fixed",
        top,
        left,
        zIndex: 20,
      });
    }

    recalc();

    const close = () => setOpenMoreId(null);
    window.addEventListener("scroll", close, { capture: true });
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", recalc);
    };
  }, [openMoreId]);

  const localDraftCount = useMemo(
    () => poolItems.filter((item) => item.identitySource === "local_draft").length,
    [poolItems],
  );
  const showImportButton = serverAvailable === true && localDraftCount > 0;

  const handleInputChange = useCallback((value: string) => {
    setRawText(value);
    setDraft(value);
  }, [setDraft]);

  const lines = rawText.split("\n").filter((l) => l.trim());
  const validCount = lines.length;
  const overLimit = validCount > 30;

  const handleAnalyze = useCallback(async () => {
    if (loading) return;
    setError("");
    if (!rawText.trim()) {
      setError("请至少输入一个候选商品。");
      return;
    }
    if (overLimit) {
      setError(`每次最多分析 30 个候选品，当前输入 ${validCount} 个。请删减后重试。`);
      return;
    }
    if (!isAccessPasswordReady) {
      setError("正在读取访问状态，请稍后再试。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setError("访问密码缺失或已过期，请先在首页输入访问密码。");
      return;
    }

    setLoading(true);
    setError("");
    setCandidates([]);
    setPoolSyncNotice("");
    setExpandedIndex(null);
    setCurrentStep("正在启动机会雷达...");

    try {
      const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          rawText,
          accessPassword: accessPassword.trim(),
        }),
      });

      const json: ApiResponse = await res.json();

      if (!json.ok) {
        const code = json.error?.code;
        if (code === "demo_access_expired" || code === "demo_access_inactive") {
          setError(json.error?.message || "访客访问已过期或已停用。");
        } else if (code === "demo_action_forbidden" || code === "demo_ai_quota_exceeded") {
          setError(json.error?.message || "访客模式下该操作受限。");
        } else if (res.status === 401 || code === "invalid_access" || code === "unauthorized") {
          setError("登录状态已失效，请回首页重新解锁。");
        } else {
          setError(json.error?.message || "分析失败，请稍后重试。");
        }
        setLoading(false);
        return;
      }

      const { data } = json;
      // Simulate progress updates
      setCurrentStep(`分析完成：${data.completedCount}/${data.totalCount} 成功，${data.failedCount} 失败`);
      setCandidates(data.candidates);
      const poolInputs = data.candidates.map(candidateToPoolInput);
      setPoolItems((current) => mergeCandidatesIntoPool(current, poolInputs));

      // Phase 3-B.1: Also write to server when unlocked. Failures must be visible.
      if (hasAccess && serverAvailable !== false) {
        try {
          const saveRes = await fetch("/api/opportunity-candidates", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
            body: JSON.stringify({ items: poolInputs.map((input) => ({ ...input, name: input.name })) }),
          });
          const saveJson: unknown = await saveRes.json().catch(() => null);
          if (!saveRes.ok || !saveJson || typeof saveJson !== "object" || Array.isArray(saveJson) || (saveJson as Record<string, unknown>).ok !== true) {
            throw new Error(getApiErrorMessage(saveJson, "分析已完成，但候选品保存到服务端失败。"));
          }
          await refreshServerPool();
          setPoolSyncNotice("分析结果已保存到服务端候选池。");
        } catch (saveError) {
          setPoolSyncNotice(saveError instanceof Error
            ? saveError.message
            : "分析已完成，但候选品保存到服务端失败。请稍后重试。");
        }
      } else {
        setPoolSyncNotice("分析结果当前仅保存在本浏览器候选池，清缓存会丢失。输入访问密码后可使用服务端候选池。");
      }

      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络请求失败，请检查服务是否在运行。");
      setLoading(false);
    }
  }, [rawText, accessPassword, isAccessPasswordReady, hasAccess, serverAvailable, overLimit, validCount, loading, refreshServerPool]);

  const handleExportMarkdown = useCallback(() => {
    const lines: string[] = [
      "# 机会雷达 · 候选品排行榜",
      "",
      `分析时间：${new Date().toLocaleString("zh-CN")}`,
      `总计：${candidates.length} 个候选品`,
      "",
      "---",
      "",
      "## 排行榜",
      "",
      "| 排名 | 等级 | 商品 | 分数 | 主要理由 | 主要风险 |",
      "|------|------|------|------|----------|----------|",
    ];

    candidates.forEach((c, i) => {
      const reasons = c.reasons.slice(0, 2).join("，") || "—";
      const risks = c.risks.slice(0, 2).join("，") || "—";
      lines.push(`| ${i + 1} | ${c.levelLabel} | ${c.name} | ${c.score} | ${reasons} | ${risks} |`);
    });

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## 详情");
    lines.push("");

    candidates.forEach((c) => {
      lines.push(`### ${c.levelLabel} · ${c.name}（${c.score}分）`);
      lines.push("");
      lines.push(`- **状态**：${c.status === "completed" ? "已完成" : c.status === "failed" ? "失败" : "待分析"}`);
      lines.push(`- **推荐等级**：${c.levelLabel}`);
      lines.push(`- **下一步**：${c.nextAction}`);
      if (c.reasons.length) lines.push(`- **推荐理由**：${c.reasons.join("；")}`);
      if (c.risks.length) lines.push(`- **风险提示**：${c.risks.join("；")}`);
      if (c.sourcing) {
        lines.push(`- **货源判断**：${c.sourcing.summary}`);
        if (c.sourcing.searchKeywords.length) lines.push(`- **找货关键词**：${c.sourcing.searchKeywords.join("、")}`);
      }
      if (c.risk) {
        lines.push(`- **风险等级**：${riskText(displayRiskLevel(c))}`);
        lines.push(`- **风险摘要**：${c.risk.summary}`);
      }
      if (c.summary) {
        lines.push(`- **综合结论**：${c.summary.verdict}`);
        lines.push(`- **小白提示**：${c.summary.beginnerTip}`);
      }
      if (c.errorMessage) lines.push(`- **错误信息**：${c.errorMessage}`);
      lines.push("");
    });

    lines.push("");
    lines.push("> ⚠️ 本报告由 AI 自动生成，仅供初筛参考。关键决策需人工复核认证、合规、利润和平台规则。");

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `机会雷达_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [candidates]);

  const handleCopyResults = useCallback(() => {
    const text = candidates.map((c, i) =>
      `${i + 1}. [${c.levelLabel}] ${c.name}（${c.score}分）\n   理由：${c.reasons.slice(0, 2).join("，") || "暂无"}\n   风险：${c.risks.slice(0, 2).join("，") || "暂无"}\n   下一步：${c.nextAction}`
    ).join("\n\n");
    copyTextToClipboard(text);
  }, [candidates]);

  const hasResults = candidates.length > 0;
  const isSingle = candidates.length === 1;
  const visiblePoolItems = useMemo(() => {
    return sortCandidatePool(filterCandidatePool(poolItems, poolFilter), poolSort);
  }, [poolItems, poolFilter, poolSort]);
  const poolCounts = useMemo(() => {
    return {
      all: poolItems.length,
      pending: filterCandidatePool(poolItems, "pending").length,
      worth_analyzing: filterCandidatePool(poolItems, "worth_analyzing").length,
      analyzed: filterCandidatePool(poolItems, "analyzed").length,
      paused: filterCandidatePool(poolItems, "paused").length,
      rejected: filterCandidatePool(poolItems, "rejected").length,
    };
  }, [poolItems]);
  const decisionDeskSummary = useMemo(
    () => buildDecisionDeskSummary(poolItems),
    [poolItems],
  );
  const selectedPoolCandidate = useMemo(
    () => resolveDecisionDeskSelection(visiblePoolItems, selectedPoolCandidateId),
    [visiblePoolItems, selectedPoolCandidateId],
  );

  const setPoolCandidateStatus = useCallback(async (id: string, status: CandidateStatus) => {
    const previous = poolItems.find((item) => item.id === id);
    setPoolItems((current) => updateCandidateStatus(current, id, status));
    setPoolSyncNotice("");

    if (!id) return false;

    if (!hasAccess || serverAvailable !== true || id.startsWith("opp-")) {
      setPoolSyncNotice("当前状态仅保存在本浏览器候选池，清缓存会丢失。连接服务端候选池后可持久保存。");
      return true;
    }

    try {
      const res = await fetch(`/api/opportunity-candidates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(previous
          ? buildCandidateStatusUpdatePayload(previous, status)
          : { status }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object" || Array.isArray(json) || (json as Record<string, unknown>).ok !== true) {
        throw new Error(getApiErrorMessage(json, "候选品状态保存失败，请稍后重试。"));
      }
      await refreshServerPool();
      setPoolSyncNotice("候选品状态已保存到服务端。");
      return true;
    } catch (updateError) {
      if (previous) {
        setPoolItems((current) => updateCandidateStatus(current, id, previous.candidateStatus));
      }
      setPoolSyncNotice(updateError instanceof Error
        ? updateError.message
        : "候选品状态保存失败，请稍后重试。");
      return false;
    }
  }, [poolItems, hasAccess, serverAvailable, accessPassword, refreshServerPool]);

  const deletePoolCandidate = useCallback(async (item: OpportunityCandidatePoolItem) => {
    if (!item.id) return;

    const isLocalOnly = !hasAccess || serverAvailable !== true || item.id.startsWith("opp-");
    const confirmed = window.confirm(
      isLocalOnly
        ? `确定从本浏览器候选池删除「${item.name}」吗？此操作不可恢复。`
        : `确定删除「${item.name}」这个候选吗？此操作不可恢复。`
    );
    if (!confirmed) return;

    setPoolSyncNotice("");

    if (isLocalOnly) {
      setPoolItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setPoolSyncNotice("已删除本浏览器候选；该操作只影响当前浏览器。");
      return;
    }

    try {
      const res = await fetch(`/api/opportunity-candidates/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { ...buildAccessHeaders() },
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object" || Array.isArray(json) || (json as Record<string, unknown>).ok !== true) {
        throw new Error(getApiErrorMessage(json, "候选删除失败，请稍后重试。"));
      }
      setPoolItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setPoolSyncNotice("候选已从服务端候选池删除。");
    } catch (deleteError) {
      setPoolSyncNotice(deleteError instanceof Error
        ? deleteError.message
        : "候选删除失败，请稍后重试。");
    }
  }, [hasAccess, serverAvailable, accessPassword]);

  // Phase 4-B: Source import handlers
  const handleSourceImport = useCallback(async () => {
    // Clear previous results immediately
    setSourceImportError("");
    setSourceImportWarnings([]);
    setSourceImportCandidates([]);
    setSourceImportChecked(new Set());
    setSourceImportSummary(null);
    setSourceConfirmResult("");

    const urls = sourceImportUrls.trim();
    if (!urls) {
      setSourceImportError("请输入至少 1 个公开 URL。");
      return;
    }

    // Show loading state immediately, before any async work
    setSourceImporting(true);

    try {
      const res = await fetch("/api/opportunities/source-import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({ input: urls, accessPassword }),
      });

      // Handle non-JSON responses (e.g. HTML error pages from reverse proxy)
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        if (res.status === 401 || res.status === 403) {
          setSourceImportError("访问已失效，请重新输入访问密码。");
        } else {
          setSourceImportError(`服务返回异常（${res.status}），请稍后重试。`);
        }
        return;
      }

      let json: SourceImportResponse;
      try {
        json = await res.json() as SourceImportResponse;
      } catch {
        setSourceImportError("服务返回了不可识别的数据，请稍后重试。");
        return;
      }

      if (!json.ok) {
        const code = json.error?.code;
        const msg = json.error?.message || "来源导入失败。";
        if (code === "demo_access_expired" || code === "demo_access_inactive") {
          setSourceImportError(msg);
        } else if (code === "demo_action_forbidden" || code === "demo_ai_quota_exceeded") {
          setSourceImportError(msg);
        } else if (code === "invalid_access" || code === "unauthorized") {
          setSourceImportError("访问已失效，请重新输入访问密码。");
        } else if (res.status === 401 || res.status === 403) {
          setSourceImportError("访问已失效，请重新输入访问密码。");
        } else if (code === "too_many_urls") {
          setSourceImportError(msg);
        } else if (json.error?.code === "no_valid_urls") {
          setSourceImportError(msg);
        } else {
          setSourceImportError(msg);
        }
        return;
      }

      const candidates = json.candidates || [];
      if (candidates.length === 0) {
        setSourceImportError("抓取成功，但未提取到候选品。请尝试 RSS 或 Sitemap 格式的链接。");
        setSourceImportSummary(json.summary);
        if (json.warnings?.length) setSourceImportWarnings(json.warnings);
        return;
      }

      setSourceImportCandidates(candidates);
      setSourceImportChecked(new Set(candidates.flatMap((candidate, index) => (
        getSignedSourceQueuePolicy(candidate.ruleAssessment).defaultSelected ? [String(index)] : []
      ))));
      setSourceImportSummary(json.summary);
      if (json.warnings?.length) setSourceImportWarnings(json.warnings);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setSourceImportError("网络连接失败，请检查网络后重试。");
      } else {
        setSourceImportError(msg || "来源抓取失败，请换 RSS / Sitemap / 公开文章页链接后重试。");
      }
    } finally {
      setSourceImporting(false);
    }
  }, [sourceImportUrls, accessPassword]);

  const toggleSourceCandidate = useCallback((index: number) => {
    const candidate = sourceImportCandidates[index];
    if (!candidate || !getSignedSourceQueuePolicy(candidate.ruleAssessment).canSave) return;
    setSourceImportChecked((prev) => {
      const next = new Set(prev);
      const key = String(index);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [sourceImportCandidates]);

  const toggleAllSourceCandidates = useCallback(() => {
    setSourceImportChecked((prev) => {
      const defaultIndices = sourceImportCandidates
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => getSignedSourceQueuePolicy(c.ruleAssessment).defaultSelected)
        .map(({ i }) => String(i));
      const allDefaultsSelected = defaultIndices.length > 0
        && defaultIndices.every((index) => prev.has(index));
      return allDefaultsSelected ? new Set<string>() : new Set(defaultIndices);
    });
  }, [sourceImportCandidates]);

  const handleConfirmImport = useCallback(async () => {
    if (sourceConfirming) return;
    if (sourceImportChecked.size === 0) {
      setSourceImportError("请至少勾选一个候选品后再导入。");
      return;
    }
    if (!hasAccess || serverAvailable !== true) {
      setSourceImportError("请先在首页输入访问密码并连接服务端候选池，再确认导入。");
      return;
    }

    setSourceConfirming(true);
    setSourceConfirmResult("");
    setSourceImportError("");

    const selected = sourceImportCandidates.filter((_, i) => sourceImportChecked.has(String(i)));
    if (selected.length !== sourceImportChecked.size
      || selected.some((candidate) => !getSignedSourceQueuePolicy(candidate.ruleAssessment).canSave)) {
      setSourceImportError("所选结果包含不能保存的来源线索，请重新选择。");
      setSourceConfirming(false);
      return;
    }
    const inputs = selected.map((candidate) => buildSourceImportCandidateSaveInput(candidate));

    try {
      const res = await fetch("/api/opportunity-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({ items: inputs }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object" || Array.isArray(json) || (json as Record<string, unknown>).ok !== true) {
        setSourceImportError(getApiErrorMessage(json, "导入失败，请稍后重试。"));
        return;
      }
      const created = Number((json as Record<string, unknown>).created ?? 0);
      const unchanged = Number((json as Record<string, unknown>).unchanged ?? 0);

      try {
        await refreshServerPool();
        setSourceConfirmResult(sourceImportSaveSuccessMessage(created, unchanged));
      } catch {
        setSourceConfirmResult("已导入服务端，但刷新候选池失败，请手动刷新页面查看。");
      }
    } catch (e) {
      setSourceImportError(e instanceof Error ? e.message : "导入失败。");
    } finally {
      setSourceConfirming(false);
    }
  }, [sourceImportCandidates, sourceImportChecked, accessPassword, hasAccess, serverAvailable, sourceConfirming, refreshServerPool]);

  // Score helper
  const scoreLabel = (s: number) => s >= 80 ? "优先测试" : s >= 65 ? "可小单验证" : s >= 50 ? "谨慎观察" : "暂不建议";
  const scoreColor = (s: number) => s >= 80 ? "text-emerald-600" : s >= 65 ? "text-sky-600" : s >= 50 ? "text-amber-600" : "text-rose-600";

  // Feasibility label in Chinese
  const feasibilityLabel = (f: string) => f === "high" ? "易找" : f === "medium" ? "一般" : "较难";
  const feasibilityColor = (f: string) => f === "high" ? "text-emerald-600" : f === "medium" ? "text-amber-600" : "text-rose-600";

  // Beginner fit label
  const beginnerLabel = (f: string | undefined) => {
    if (!f) return "—";
    if (f === "high") return "友好";
    if (f === "medium") return "一般";
    return "不友好";
  };

  // Top summary data
  const topByScore = candidates.filter(c => c.status === "completed").slice(0, 1)[0];
  const bestForBeginner = [...candidates].filter(c => c.status === "completed").sort((a, b) => {
    const aFriendly = a.sourcing?.beginnerFriendly ? 1 : 0;
    const bFriendly = b.sourcing?.beginnerFriendly ? 1 : 0;
    return bFriendly - aFriendly || b.score - a.score;
  })[0];
  const highestRisk = [...candidates].filter(c => c.status === "completed").sort((a, b) => {
    return (riskOrder[displayRiskLevel(b)] || 0) - (riskOrder[displayRiskLevel(a)] || 0);
  })[0];
  const completedCandidates = candidates.filter(c => c.status === "completed");

  if (!unlocked) {
    return <OpportunitiesLockedPreview surfaceCopy={surfaceCopy} />;
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="workspace-header">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="linear-icon size-10 shrink-0 rounded-xl">
                  <Target className="size-5" />
                </div>
                <div>
                  {surfaceCopy.eyebrow ? <p className="linear-kicker">{surfaceCopy.eyebrow}</p> : null}
                  <h1 className={surfaceCopy.eyebrow ? "mt-1 text-xl font-semibold tracking-tight text-slate-950" : "text-xl font-semibold tracking-tight text-slate-950"}>{surfaceCopy.unlockedTitle}</h1>
                  <p className="muted-text mt-1 text-sm">{surfaceCopy.unlockedDescription}</p>
                </div>
              </div>
              {!visualFixtureMode ? <button
                type="button"
                data-testid="candidate-intake-toggle"
                aria-expanded={showCandidateIntake}
                onClick={() => setShowCandidateIntake((current) => !current)}
                className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
              >
                <Plus className="size-4" />
                {showCandidateIntake ? "收起添加区" : "添加候选"}
              </button> : (
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                  隔离视觉验收数据
                </span>
              )}
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* 主链路引导 */}
          <OpportunitiesFlowGuidance />

          {/* Phase 3-B.1: Server connection indicator */}
          {visualFixtureMode ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-indigo-800">
              <p className="font-semibold">隔离视觉验收模式</p>
              <p className="mt-1 text-xs text-indigo-700">仅使用本地 fixture；不读取密码、Cookie、localStorage、生产数据或服务端 API。</p>
            </div>
          ) : serverAvailable !== null ? (
            <div className={`rounded-xl border p-3 text-sm ${serverAvailable ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
              <div className="flex items-center gap-2">
                {serverAvailable ? <Wifi className="size-4 text-emerald-600" /> : <WifiOff className="size-4 text-amber-600" />}
                <span className={`font-semibold ${serverAvailable ? "text-emerald-800" : "text-amber-800"}`}>
                  {serverAvailable ? "已解锁 / 服务端候选池" : "未解锁 / 本浏览器候选池"}
                </span>
              </div>
              <p className={`mt-1 text-xs ${serverAvailable ? "text-emerald-700" : "text-amber-700"}`}>
                {serverAvailable
                  ? "当前数据已从服务端候选池加载，刷新后仍保留。"
                  : "当前数据仅保存在本浏览器，清缓存或换设备会丢失。输入访问密码后可切换到服务端候选池。"}
              </p>
            </div>
          ) : null}

          {poolSyncNotice ? (
            <div className={"rounded-xl border p-3 text-sm " + (serverAvailable === true
              ? "border-teal-200 bg-teal-50 text-teal-800"
              : "border-amber-200 bg-amber-50 text-amber-800")}
            >
              {poolSyncNotice}
            </div>
          ) : null}

        {showCandidateIntake ? (
        <section className="space-y-5" data-testid="candidate-intake-panel">
        <div className="surface-card-soft border border-teal-100 p-4 sm:p-5">
          <p className="linear-kicker">添加候选</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">选择一种录入方式</h2>
          <p className="mt-1 text-sm text-slate-500">手动输入适合少量候选；公开 URL 导入适合已有商品页、RSS 或 Sitemap。</p>
        </div>

        {/* Input Area */}
        {!hasResults ? (
          <div className="surface-card p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              候选商品列表
              <span className="ml-2 text-xs font-normal text-slate-400">
                每行一个商品标题、描述或链接（最多 30 个）
              </span>
            </label>
            <textarea
              ref={textareaRef}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
              rows={10}
              placeholder={`宠物慢食碗\n儿童电动牙刷\n桌面手机支架\n硅胶折叠水杯\n宠物饮水机`}
              value={rawText}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={loading}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className={`text-xs ${overLimit ? "font-semibold text-rose-600" : "text-slate-400"}`}>
                {overLimit
                  ? `⚠️ 超过上限：${validCount} 个（最多 30 个）`
                  : validCount > 0
                  ? `已输入 ${validCount} 个候选品（上限 30 个）`
                  : "请输入候选商品"}
              </span>
              <button type="button" onClick={handleAnalyze} disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <><Loader2 className="size-4 animate-spin" />分析中...</> : <><Sparkles className="size-4" />开始分析</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="surface-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                已分析 {validCount} 个候选品
              </p>
              <button type="button" onClick={handleAnalyze} disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                重新分析
              </button>
            </div>
            <textarea
              ref={textareaRef}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 focus:border-teal-400 focus:outline-none"
              rows={3}
              value={rawText}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={loading}
            />
            {overLimit && (
              <p className="mt-1 text-xs font-semibold text-rose-600">⚠️ 超过上限 30 个，超出的已被截断</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="surface-card rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="mr-2 inline size-4" />
            {error}
          </div>
        )}

        {/* Progress */}
        {loading && (
          <div className="surface-card p-8 text-center">
            <Loader2 className="mx-auto mb-3 size-8 animate-spin text-teal-500" />
            <p className="text-sm font-semibold text-slate-700">{currentStep || "分析中..."}</p>
            <p className="mt-1 text-xs text-slate-400">正在逐个分析候选商品，请耐心等待...</p>
          </div>
        )}

        {/* Phase 4-B: Source Importer */}
        <section className="surface-card p-4 sm:p-5" data-testid="source-importer">
          <div className="flex items-start gap-3 mb-4">
            <div className="linear-icon size-10 shrink-0 rounded-xl">
              <Upload className="size-5" />
            </div>
            <div>
              <p className="linear-kicker">来源导入</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">从公开 URL 导入候选品</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                粘贴 RSS、Sitemap 或公开网页 URL（最多 5 个）。系统会遵守 robots.txt，不会自动执行商业动作。结果需你人工确认后再导入候选池。
              </p>
            </div>
          </div>

          {/* Phase 4-D.8: Source tier reference */}
          <details className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-600 select-none">来源可用性说明</summary>
            <div className="mt-3 space-y-3">
              {SOURCE_IMPORT_TIERS.map((tier) => (
                <div key={tier.key} className={`rounded-lg border p-2.5 ${
                  tier.tone === "green" ? "border-emerald-200 bg-emerald-50/60" :
                  tier.tone === "amber" ? "border-amber-200 bg-amber-50/60" :
                  tier.tone === "blue" ? "border-blue-200 bg-blue-50/60" :
                  "border-slate-200 bg-slate-50/60"
                }`}>
                  <p className="font-semibold text-slate-700">{tier.name} · {tier.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {tier.examples.map((ex) => (
                      <span key={ex.label} className="inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                        {ex.label}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-slate-400">{tier.recommendation}</p>
                </div>
              ))}
            </div>
          </details>

          {/* URL input */}
          <p className="mb-2 text-xs text-slate-400">{SOURCE_IMPORT_HINT}</p>
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <textarea
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
              rows={4}
              placeholder={`https://example.com/rss\nhttps://example.com/sitemap.xml\nhttps://example.com/products`}
              value={sourceImportUrls}
              onChange={(e) => { setSourceImportUrls(e.target.value); setSourceImportError(""); }}
              disabled={sourceImporting || sourceConfirming}
            />
            <div className="flex flex-col justify-end gap-2">
              <button
                type="button"
                onClick={handleSourceImport}
                disabled={sourceImporting || sourceConfirming || !sourceImportUrls.trim()}
                className="linear-button-primary inline-flex h-12 w-full items-center justify-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
              >
                {sourceImporting ? (
                  <><Loader2 className="size-4 animate-spin" />抓取中…</>
                ) : (
                  <><Search className="size-4" />抓取公开来源</>
                )}
              </button>
              {sourceImportCandidates.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSourceImportCandidates([]);
                    setSourceImportChecked(new Set());
                    setSourceImportSummary(null);
                    setSourceImportError("");
                    setSourceImportWarnings([]);
                    setSourceConfirmResult("");
                  }}
                  className="linear-button inline-flex h-10 w-full items-center justify-center text-sm"
                >
                  清除结果
                </button>
              )}
            </div>
          </div>

          {/* Source import error */}
          {sourceImportError && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertTriangle className="mr-2 inline size-4" />{sourceImportError}
            </div>
          )}

          {/* Source import warnings — Phase 4-D.8: show failureReason labels */}
          {sourceImportWarnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {sourceImportWarnings.map((w, i) => {
                const reasonKey = extractFailureReason(w);
                const reasonLabel = reasonKey ? getFailureReasonLabel(reasonKey) : null;
                // Extract the URL portion from warning (format: "URL: message [reason]")
                const urlMatch = w.match(/^(https?:\/\/[^\s]+):/);
                const sourceUrl = urlMatch ? urlMatch[1] : "";
                const messageText = w.replace(/\s*\[[a-z_]+\]\s*$/, "");
                return (
                  <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                    {reasonLabel && reasonLabel.reason !== "unknown" ? (
                      <>
                        <p className="font-semibold text-amber-800">{reasonLabel.title}</p>
                        <p className="mt-0.5 text-amber-700">{reasonLabel.description}</p>
                        <p className="mt-1 text-amber-600">{reasonLabel.recommendation}</p>
                        <p className="mt-1 text-amber-400">{messageText}</p>
                      </>
                    ) : (
                      <p className="text-amber-700">{w}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Results */}
          {sourceImportCandidates.length > 0 && sourceImportSummary && (
            <div className="mt-4">
              <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold">以下结果只是本次抓取的临时预览，刷新页面会清空。</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                      请勾选候选并点击&ldquo;确认导入候选池&rdquo;，导入后才会保存到服务端候选池。
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700">
                    已提取 {sourceImportCandidates.length} 个候选品
                    <span className="ml-2 text-xs text-slate-400">
                      ({sourceImportSummary.okUrls}/{sourceImportSummary.totalUrls} 个 URL 成功)
                    </span>
                  </p>
                  {/* Phase 4-D.8: candidateType breakdown */}
                  {(() => {
                    const pc = sourceImportCandidates.filter(c => getCandidateTypeLabel(c.candidateType).type === "product_candidate").length;
                    const ch = sourceImportCandidates.filter(c => getCandidateTypeLabel(c.candidateType).type === "category_hint").length;
                    const ts = sourceImportCandidates.filter(c => getCandidateTypeLabel(c.candidateType).type === "trend_signal").length;
                    const rj = sourceImportCandidates.filter(c => getCandidateTypeLabel(c.candidateType).type === "rejected").length;
                    if (pc + ch + ts + rj === 0) return null;
                    return (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {pc > 0 && <span className="mr-2">商品候选 {pc}</span>}
                        {ch > 0 && <span className="mr-2">类目提示 {ch}</span>}
                        {ts > 0 && <span className="mr-2">趋势信号 {ts}</span>}
                        {rj > 0 && <span>已过滤 {rj}</span>}
                      </p>
                    );
                  })()}
                  <p className="mt-1 text-xs text-slate-400">
                    仅商品候选可保存；观察项需逐条选择，类目、趋势和拒绝项只展示。
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={toggleAllSourceCandidates}
                    disabled={sourceReviewSelectionKeys.length === 0}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {allSourceReviewsSelected ? "取消批量选择" : "选择建议复核项"}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={sourceConfirming || sourceImportChecked.size === 0 || !hasAccess || serverAvailable !== true}
                    className="linear-button-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
                  >
                    {sourceConfirming ? (
                      <><Loader2 className="size-4 animate-spin" />导入中…</>
                    ) : (
                      <>确认导入候选池（{sourceImportChecked.size}）</>
                    )}
                  </button>
                </div>
              </div>

              {sourceConfirmResult && (
                <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 className="mr-2 inline size-4" />{sourceConfirmResult}
                </div>
              )}

              <div className="grid gap-2 max-h-[500px] overflow-y-auto">
                {sourceImportCandidates.map((c, i) => {
                  const checked = sourceImportChecked.has(String(i));
                  const queuePolicy = getSignedSourceQueuePolicy(c.ruleAssessment);
                  const candidateTypeLabel = getCandidateTypeLabel(c.candidateType);
                  const queueTone = queuePolicy.canSave
                    ? queuePolicy.defaultSelected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-slate-50 text-slate-500";
                  return (
                    <label
                      key={`${c.title}-${i}`}
                      className={`flex items-start gap-3 rounded-xl border p-3 transition ${queuePolicy.canSave ? "cursor-pointer" : "cursor-not-allowed opacity-75"} ${checked ? "border-teal-300 bg-teal-50/60" : "border-slate-200 bg-white"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSourceCandidate(i)}
                        disabled={!queuePolicy.canSave}
                        className="mt-1 size-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:cursor-not-allowed"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">{c.title}</p>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getCandidateTypeBadgeClass(candidateTypeLabel.tone)}`}>
                            {candidateTypeLabel.label}
                          </span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${queueTone}`}>
                            {sourceQueueMessage(queuePolicy.reason)}
                          </span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${c.riskLevel === "red" ? "border-rose-200 bg-rose-50 text-rose-700" : c.riskLevel === "yellow" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                            风险{riskText(c.riskLevel)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                          <span>来源：{c.sourceHost} · {c.sourceType}</span>
                          <span>页面规则分：{c.score}/100</span>
                          <span>页面需求线索：{c.demandSignalScore} | 规则风险：{c.riskScore} | 新手适配：{c.beginnerFitScore}</span>
                        </div>
                        {/* Source URL */}
                        <div className="mt-1 text-[10px] text-slate-500 flex items-start gap-1 min-w-0">
                          <span className="shrink-0 text-slate-400">链接：</span>
                          {c.sourceUrl ? (
                            <span className="break-all" title={c.sourceUrl}>{sanitizeUrlForDisplay(c.sourceUrl)}</span>
                          ) : (
                            <span className="italic text-slate-400">暂无标准化 URL</span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.summaryLabel}</p>
                        <p className="mt-1 text-[11px] font-semibold text-indigo-600">
                          来源证据链已验证；仅证明本次抓取事实与规则结果的完整性，不代表商品真实性或市场需求已验证。
                        </p>
                        <div className="mt-1 flex items-start gap-1 flex-wrap">
                          <span className="text-[10px] text-slate-400 shrink-0">规则风险：</span>
                          {c.ruleAssessment.riskFlags.length > 0 ? (
                            c.ruleAssessment.riskFlags.map((flag, j) => (
                              <span key={j} className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{flag}</span>
                            ))
                          ) : (
                            <span className="text-[10px] italic text-slate-400">未发现明显规则风险，仍需人工核对</span>
                          )}
                        </div>
                        {c.riskHint && (
                          <p className="mt-1 text-[11px] text-amber-600">⚠ {c.riskHint}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              <p className="mt-3 text-xs text-slate-400">
                ⚠ 以上仅为公开页面事实和可重算规则结果，不代表商品真实性、市场需求或最终选品结论。关键动作仍需人工确认。
              </p>
            </div>
          )}
        </section>
        </section>
        ) : null}

        {/* Candidate pool */}
        <section className="surface-card p-4 sm:p-5" data-testid="opportunity-candidate-pool">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="linear-kicker">候选品池</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">先筛选，再深挖</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {visualFixtureMode
                  ? "隔离视觉验收数据不会读取或写入浏览器、服务端与生产数据。"
                  : serverAvailable === true
                  ? localDraftCount > 0
                    ? `已连接服务端候选池；另有 ${localDraftCount} 个本地草稿仅供展示，保存为服务端 Candidate 后才能进入 Agent。`
                    : "已解锁 / 服务端候选池。当前候选均具备服务端权威身份，刷新后仍保留。"
                  : serverAvailable === false
                    ? "未解锁 / 本浏览器候选池。当前数据仅保存在本浏览器，清缓存或换设备会丢失。"
                    : "候选品会保存在本浏览器 7 天。这里不自动采购、不自动上架，只帮你记录判断状态。"}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {showImportButton ? (
                <button
                  type="button"
                  onClick={async () => {
                    setImportingLocal(true);
                    setImportResult("");
                    const localItems = poolItems.filter((item) => item.identitySource === "local_draft");
                    try {
                      const res = await fetch("/api/opportunity-candidates/import-local", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
                        body: JSON.stringify({ items: localItems }),
                      });
                      const json = await res.json();
                      if (json.ok) {
                        setImportResult(`已导入 ${json.imported} 个候选品`);
                        try {
                          await refreshServerPool();
                        } catch {
                          setImportResult("已导入服务端，但刷新候选池失败，请手动刷新页面查看。");
                        }
                      } else {
                        setImportResult("导入失败，请重试。");
                      }
                    } catch {
                      setImportResult("导入失败，请检查网络。");
                    } finally {
                      setImportingLocal(false);
                    }
                  }}
                  disabled={importingLocal}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importingLocal ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  保存 {localDraftCount} 个本地草稿为正式 Candidate
                </button>
              ) : null}
              {importResult ? (
                <span className="text-xs font-semibold text-teal-700">{importResult}</span>
              ) : null}
              <select
                value={poolSort}
                onChange={(event) => setPoolSort(event.target.value as CandidatePoolSort)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none"
                aria-label="候选品排序"
              >
                <option value="updated">最近更新</option>
                <option value="score">按分数优先</option>
              </select>
            </div>
          </div>

          <OpportunitiesDecisionSummary summary={decisionDeskSummary} />

          <div className="mt-4 flex flex-wrap gap-2">
            {candidateFilterOptions.map((option) => {
              const active = poolFilter === option.value;
              const count = option.value === "all" ? poolCounts.all : poolCounts[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPoolFilter(option.value)}
                  aria-pressed={active}
                  className={"rounded-full border px-3 py-1.5 text-xs font-semibold transition " + (active
                    ? "border-teal-300 bg-teal-50 text-teal-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}
                >
                  {option.label} {count}
                </button>
              );
            })}
          </div>

          {poolItems.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
              还没有候选品。先在上方输入候选商品并手动分析，结果会自动进入候选品池。
            </div>
          ) : visiblePoolItems.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
              当前筛选下没有候选品。
            </div>
          ) : (
            <div
              className="opportunity-decision-grid mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white"
              data-testid="opportunity-decision-desk"
            >
              <div className="min-w-0 divide-y divide-slate-100">
                <div className="hidden grid-cols-[minmax(170px,1.5fr)_84px_84px_48px_86px_70px] items-center gap-2 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 md:grid">
                  <span>候选商品</span>
                  <span>市场状态</span>
                  <span>处理状态</span>
                  <span>机会分</span>
                  <span>证据</span>
                  <span>风险</span>
                </div>
                {visiblePoolItems.map((item) => {
                  const linkedTasks = resolveCandidateTaskLinks(
                    item,
                    candidateTaskLinks.get(item.id) ?? [],
                  );
                  const hasLinkedTask = linkedTasks.length > 0 || Boolean(item.convertedTaskId);
                  const queuePresentation = getCandidateQueuePresentation(item.candidateStatus, hasLinkedTask);
                  const marketPresentation = getDecisionDeskMarketPresentation(item);
                  const evidencePresentation = getDecisionDeskEvidencePresentation(item);
                  const riskPresentation = getDecisionDeskRiskPresentation(item);
                  const selected = selectedPoolCandidate?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`decision-row-${item.id}`}
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedPoolCandidateId(item.id);
                        setOpenMoreId(null);
                      }}
                      className={
                        "grid w-full gap-2 px-4 py-3 text-left transition md:grid-cols-[minmax(170px,1.5fr)_84px_84px_48px_86px_70px] md:items-center " +
                        (selected ? "bg-teal-50/80 shadow-[inset_3px_0_0_#0f766e]" : "bg-white hover:bg-slate-50")
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-950">{item.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                          {item.keyword || item.source || "来源待核对"}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 md:block">
                        <span className="w-16 text-[10px] font-semibold text-slate-400 md:hidden">市场状态</span>
                        <span className={"inline-flex w-fit rounded-full border px-2 py-1 text-[11px] font-semibold " + decisionDeskToneClass(marketPresentation.tone)}>
                          {marketPresentation.label}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 md:block">
                        <span className="w-16 text-[10px] font-semibold text-slate-400 md:hidden">处理状态</span>
                        <span className={"inline-flex w-fit rounded-full border px-2 py-1 text-[11px] font-semibold " + candidateStatusClass(queuePresentation.state)}>
                          {queuePresentation.label}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 md:block">
                        <span className="w-16 text-[10px] font-semibold text-slate-400 md:hidden">机会分</span>
                        <span className="text-base font-semibold text-slate-900">{getDecisionDeskScorePresentation(item)}</span>
                      </span>
                      <span className="flex items-center gap-2 md:block">
                        <span className="w-16 text-[10px] font-semibold text-slate-400 md:hidden">证据</span>
                        <span className={"inline-flex w-fit rounded-full border px-2 py-1 text-[11px] font-semibold " + decisionDeskToneClass(evidencePresentation.tone)}>
                          {evidencePresentation.label}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 md:block">
                        <span className="w-16 text-[10px] font-semibold text-slate-400 md:hidden">风险</span>
                        <span className={"inline-flex w-fit rounded-full border px-2 py-1 text-[11px] font-semibold " + decisionDeskToneClass(riskPresentation.tone)}>
                          {riskPresentation.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="min-w-0 bg-slate-50/50" aria-live="polite">
              {[selectedPoolCandidate]
                .filter((item): item is OpportunityCandidatePoolItem => item !== null)
                .map((item) => {
                const itemSourceMode = (item as Record<string, unknown>).sourceMode as string | undefined;
                const isOfficialReadonly = demoMode && itemSourceMode === "official_readonly";
                const isDemoSandbox = demoMode && itemSourceMode === "demo_sandbox";
                const isLocalDraft = item.identitySource === "local_draft";
                const canManageAuthoritativeCandidate = !isOfficialReadonly
                  && !isLocalDraft
                  && serverAvailable === true;
                const linkedTasks = resolveCandidateTaskLinks(
                  item,
                  candidateTaskLinks.get(item.id) ?? [],
                );
                const latestLinkedTask = linkedTasks[0] ?? null;
                const hasLinkedTask = linkedTasks.length > 0 || Boolean(item.convertedTaskId);
                const deletePresentation = getCandidateDeletePresentation({
                  isOfficialReadonly,
                  isLocalDraft,
                  hasLinkedTask,
                });
                const queuePresentation = getCandidateQueuePresentation(item.candidateStatus, hasLinkedTask);
                const marketPresentation = getDecisionDeskMarketPresentation(item);
                const riskPresentation = getDecisionDeskRiskPresentation(item);
                const scorePresentation = getDecisionDeskScorePresentation(item);
                const sourceIntegrityPresentation = getCandidateSourceIntegrityPresentation(item.sourceIntegrity);
                const sourceReview = item.sourceReview ?? {
                  version: "candidate-evidence-review-v1" as const,
                  integrity: "unverified" as const,
                  reason: "legacy_or_invalid" as const,
                };
                const needsUnverifiedReview = !sourceIntegrityPresentation.verified
                  && (item.candidateStatus === "pending" || item.candidateStatus === "paused")
                  && canManageAuthoritativeCandidate;
                const agentHref = !isOfficialReadonly && canCandidateEnterAgent(item, serverAvailable, hasLinkedTask)
                  ? buildPoolAgentRunHref(item)
                  : null;
                return (
                <article
                  key={item.id}
                  data-testid={`decision-detail-${item.id}`}
                  className="h-full min-w-0 overflow-hidden bg-white p-4 sm:p-5"
                >
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-base font-semibold text-slate-950">{item.name}</h3>
                        <span className={"rounded-full border px-2.5 py-1 text-xs font-bold " + candidateStatusClass(queuePresentation.state)}>
                          处理：{queuePresentation.label}
                        </span>
                        {/* Demo-Sandbox.1-C-UI-Fix: source labels */}
                        {isDemoSandbox && (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">访客数据</span>
                        )}
                        {isOfficialReadonly && (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">只读样例</span>
                        )}
                        {isLocalDraft && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">本地草稿</span>
                        )}
                        <span
                          title={sourceIntegrityPresentation.description}
                          className={"rounded-full border px-2 py-0.5 text-[11px] font-semibold " + (sourceIntegrityPresentation.verified
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700")}
                        >
                          {sourceIntegrityPresentation.verified ? "✓ " : "! "}{sourceIntegrityPresentation.label}
                        </span>
                        {item.r22MarketDecisionSnapshot ? (
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                            市场：{marketPresentation.label}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.summaryLabel}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                        <span>机会分 {scorePresentation === "—" ? "—" : `${scorePresentation}/100`}</span>
                        <span>风险：{riskPresentation.label}</span>
                        {item.keyword ? <span>关键词：{item.keyword}</span> : null}
                        <span>来源：{item.source}</span>
                      </div>
                      {/* Source URL */}
                      <div className="mt-1.5 text-xs flex items-start gap-1 min-w-0">
                        <span className="text-slate-400 shrink-0">来源链接：</span>
                        {(() => {
                          const url = item.link || item.evidenceSnapshot?.sourceUrl;
                          if (!url) return <span className="italic text-slate-400">历史候选未记录标准化 URL</span>;
                          return (
                            <span className="text-slate-600 break-all" title={url}>
                              {sanitizeUrlForDisplay(url)}
                            </span>
                          );
                        })()}
                      </div>
                      {/* Risk flags */}
                      <div className="mt-1 text-xs flex items-start gap-1 flex-wrap">
                        <span className="text-slate-400 shrink-0">风险标记：</span>
                        {item.evidenceSnapshot?.riskFlags && item.evidenceSnapshot.riskFlags.length > 0 ? (
                          item.evidenceSnapshot.riskFlags.map((flag, j) => (
                            <span key={j} className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{getRiskFlagLabel(flag)}</span>
                          ))
                        ) : (
                          <span className="italic text-slate-400">未发现规则风险，仍需人工核对</span>
                        )}
                      </div>
                      <CandidateEvidenceReviewPanel review={sourceReview} />
                      {needsUnverifiedReview ? (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-800">
                          继续前请人工核对商品页、价格和合规风险；确认不会把来源升级为已验证。
                        </p>
                      ) : null}
                      {queuePresentation.state === "analyzing" ? (
                        <p className="mt-2 text-xs font-semibold text-indigo-700">分析对象已确认，可继续 Agent 分析。</p>
                      ) : null}
                      {/* Phase Candidate-Status-M.1: Linked tasks display */}
                      {latestLinkedTask ? (
                          <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-teal-200 bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                                已关联任务
                              </span>
                              {latestLinkedTask.source === "agent_run" ? (
                                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                                  来自 Agent 主链路
                                </span>
                              ) : null}
                              {linkedTasks.length > 1 ? (
                                <span className="text-[10px] text-slate-400">共 {linkedTasks.length} 条</span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-xs font-semibold text-slate-700">{latestLinkedTask.title}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <Link
                                href={`/tasks/${latestLinkedTask.taskId}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-100"
                              >
                                查看任务详情
                                <ArrowRight className="size-3" />
                              </Link>
                              <span className="text-[10px] text-slate-400">ID: {latestLinkedTask.taskId.slice(0, 12)}…</span>
                            </div>
                          </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      {/* Primary: only authoritative server Candidates enter Agent */}
                      {latestLinkedTask ? (
                        <Link
                          href={`/tasks/${latestLinkedTask.taskId}`}
                          data-testid={`candidate-linked-task-${item.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"
                        >
                          查看关联任务
                          <ArrowRight className="size-3" />
                        </Link>
                      ) : item.candidateStatus === "rejected" && canManageAuthoritativeCandidate ? (
                        <button
                          type="button"
                          onClick={() => { void setPoolCandidateStatus(item.id, "pending"); }}
                          data-testid={`candidate-restore-${item.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          恢复为待查看
                        </button>
                      ) : (item.candidateStatus === "pending" || item.candidateStatus === "paused") && canManageAuthoritativeCandidate ? (
                        <button
                          type="button"
                          onClick={() => { void setPoolCandidateStatus(item.id, "worth_analyzing"); }}
                          data-testid={`candidate-select-${item.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          {sourceIntegrityPresentation.verified ? "选择为待分析" : "确认并选择为待分析"}
                        </button>
                      ) : agentHref ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const ready = item.candidateStatus === "analyzed"
                              || await setPoolCandidateStatus(item.id, "analyzed");
                            if (ready) window.location.assign(agentHref);
                          }}
                          data-testid={`candidate-agent-run-${item.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                        >
                          {queuePresentation.nextAction}
                          <ArrowRight className="size-3" />
                        </button>
                      ) : (
                        <span
                          data-testid={`candidate-agent-blocked-${item.id}`}
                          className="inline-flex min-h-9 max-w-48 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-semibold leading-4 text-amber-700"
                        >
                          {isLocalDraft
                            ? serverAvailable === true
                              ? "请先导入本浏览器候选池"
                              : "连接服务端并保存后进入 Agent"
                            : "服务端身份未确认，暂不能进入 Agent"}
                        </span>
                      )}
                      {/* More actions dropdown — portalled to document.body to escape parent overflow clipping */}
                      <div>
                        <button
                          type="button"
                          data-more-button={item.id}
                          onClick={() => setOpenMoreId(openMoreId === item.id ? null : item.id)}
                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          更多操作
                          <ChevronDown className="size-3" />
                        </button>
                        {openMoreId === item.id && moreMenuStyle.display !== "none"
                          ? createPortal(
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setOpenMoreId(null)} />
                              <div
                                className="z-20 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                                style={moreMenuStyle}
                              >
                                <span className="px-3 py-1 text-[10px] font-semibold text-slate-400">人工标记</span>
                                {isOfficialReadonly ? (
                                  <span className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 cursor-not-allowed" title="访客体验模式下不能修改正式候选数据">
                                    正式候选不可修改
                                  </span>
                                ) : (<>
                                {item.candidateStatus !== "worth_analyzing" && item.candidateStatus !== "rejected" ? (
                                <button type="button" onClick={() => { void setPoolCandidateStatus(item.id, "worth_analyzing"); setOpenMoreId(null); }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-emerald-600 hover:bg-emerald-50">
                                  {sourceIntegrityPresentation.verified ? "选择为待分析" : "确认并选择为待分析"}
                                </button>
                                ) : null}
                                {item.candidateStatus !== "pending" ? (
                                <button type="button" onClick={() => { void setPoolCandidateStatus(item.id, "pending"); setOpenMoreId(null); }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                                  {item.candidateStatus === "rejected" ? "恢复为待查看" : "移回待查看"}
                                </button>
                                ) : null}
                                {item.candidateStatus !== "rejected" ? (
                                <button type="button" onClick={() => {
                                  const confirmed = window.confirm(
                                    `确认将「${item.name}」标记为放弃？这不会删除候选，只会改变状态。如需彻底移除，请使用"删除候选"。`
                                  );
                                  if (!confirmed) return;
                                  void setPoolCandidateStatus(item.id, "rejected");
                                  setOpenMoreId(null);
                                }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50">
                                  放弃候选
                                </button>
                                ) : null}
                                </>)}
                                <div className="mx-2 my-1 border-t border-slate-100" />
                                {!deletePresentation.canDelete ? (
                                  <span
                                    data-testid={`candidate-delete-blocked-${item.id}`}
                                    className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-2 text-xs text-slate-400"
                                    title={deletePresentation.title}
                                  >
                                    <Trash2 className="size-3" />
                                    {deletePresentation.label}
                                  </span>
                                ) : (
                                  <button type="button" onClick={() => { void deletePoolCandidate(item); setOpenMoreId(null); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50">
                                    <Trash2 className="size-3" />
                                    {deletePresentation.label}
                                  </button>
                                )}
                              </div>
                            </>,
                            document.body,
                          )
                        : null}
                      </div>
                      <span className="text-xs text-slate-400">不会自动开始 AI</span>
                    </div>
                  </div>
                </article>
              )})}
              </div>
            </div>
          )}
        </section>

        {/* Results */}
        {hasResults && !loading && (
          <>
            {/* Top Summary Card */}
            {completedCandidates.length > 0 && (
              <div className="surface-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="size-4 text-teal-600" />
                  <p className="text-sm font-semibold text-slate-800">机会雷达摘要</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div>
                    <p className="text-slate-400">共分析</p>
                    <p className="text-sm font-bold text-slate-900">{candidates.length} 个候选品</p>
                    <p className="text-[11px] text-slate-400">{candidates.filter(c => c.status === "completed").length} 完成 · {candidates.filter(c => c.status === "failed").length} 失败</p>
                  </div>
                  <div>
                    <p className="text-slate-400">最高分</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{topByScore?.name || "—"}</p>
                    <p className={`text-[11px] font-semibold ${scoreColor(topByScore?.score ?? 0)}`}>{topByScore?.score ?? "—"} 分 · {scoreLabel(topByScore?.score ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">新手最适合</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{bestForBeginner?.name || "—"}</p>
                    <p className="text-[11px] text-slate-400">{bestForBeginner?.levelLabel || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">风险最高</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{highestRisk?.name || "—"}</p>
                    <p className={`text-[11px] font-semibold ${riskColor(displayRiskLevel(highestRisk))}`}>
                      {riskSummaryText(displayRiskLevel(highestRisk))}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                  ⚠ 仅作初筛，最终仍需人工确认成本、认证、侵权、物流。高风险品类不要因为利润看起来好就直接做。
                </p>
              </div>
            )}

            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {isSingle ? "单品机会分析" : `机会排行榜 · ${candidates.length} 个候选品`}
                </h2>
                {isSingle && (
                  <p className="text-xs text-slate-400 mt-0.5">机会雷达更适合 3 个以上候选品对比，当前仅作单品判断。</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyResults}
                  className="surface-card inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                  <Copy className="size-3.5" /> 复制
                </button>
                <button onClick={handleExportMarkdown}
                  className="surface-card inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                  <FileDown className="size-3.5" /> 导出
                </button>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="space-y-2">
              {candidates.map((c, i) => {
                const isExpanded = expandedIndex === i;
                const oneLiner = c.summary?.verdict || c.reasons.slice(0, 1).join("") || "分析中...";
                return (
                  <div key={c.index}
                    className={`surface-card overflow-hidden transition ${c.status === "failed" ? "opacity-50" : ""}`}>
                    {/* Compact row */}
                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : i)}
                      className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-slate-50/50">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-500">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${LEVEL_COLORS[c.level] || ""}`}>
                            <span className={`inline-block size-1.5 rounded-full ${LEVEL_DOT[c.level] || ""}`} />
                            {c.levelLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{oneLiner.slice(0, 40)}</p>
                        {/* Mini indicators */}
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
                          <span title="货源难度">📦 货源：<span className={feasibilityColor(c.sourcing?.feasibility || "")}>{feasibilityLabel(c.sourcing?.feasibility || "")}</span></span>
                          <span title="风险等级">🛡 风险：<span className={riskColor(displayRiskLevel(c))}>{riskText(displayRiskLevel(c))}</span></span>
                          <span title="新手适合度">👤 新手：<span className={c.sourcing?.beginnerFriendly ? "text-emerald-600" : "text-rose-600"}>{beginnerLabel(c.sourcing?.beginnerFit)}</span></span>
                        </div>
                        {/* Reason tags */}
                        {c.reasons.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.reasons.slice(0, 3).map((r, ri) => (
                              <span key={ri} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{r}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold ${scoreColor(c.score)}`}>{c.score}</p>
                        <p className="text-[10px] text-slate-400">{scoreLabel(c.score)}</p>
                      </div>
                      {isExpanded ? <ChevronUp className="size-4 shrink-0 text-slate-400" /> : <ChevronDown className="size-4 shrink-0 text-slate-400" />}
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          {c.sourcing && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Search className="size-3.5 text-teal-600" />
                                <p className="text-xs font-semibold text-slate-700">货源判断</p>
                              </div>
                              <p className="text-xs text-slate-600">{c.sourcing.summary}</p>
                              {c.sourcing.searchKeywords.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {c.sourcing.searchKeywords.slice(0, 5).map(kw => (
                                    <span key={kw} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{kw}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {c.risk && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Shield className={`size-3.5 ${displayRiskLevel(c) === "red" ? "text-rose-500" : displayRiskLevel(c) === "yellow" ? "text-amber-500" : "text-emerald-500"}`} />
                                <p className="text-xs font-semibold text-slate-700">风险排查</p>
                                <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${RISK_BADGE[displayRiskLevel(c)] || ""}`}>{riskText(displayRiskLevel(c))}</span>
                              </div>
                              <p className="text-xs text-slate-600">{c.risk.summary}</p>
                              {c.risk.blacklistMatches.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {c.risk.blacklistMatches.map(m => (
                                    <span key={m} className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600">{m}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {c.summary && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Brain className="size-3.5 text-violet-600" />
                                <p className="text-xs font-semibold text-slate-700">综合结论</p>
                                {c.summary.downgraded && (
                                  <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">已降级</span>
                                )}
                              </div>
                              <p className="text-xs font-semibold text-slate-800">{c.summary.verdict}</p>
                              <p className="mt-1 text-[11px] text-slate-600">{c.summary.summary}</p>
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal-100 bg-teal-50/60 p-2.5 text-xs">
                          <TrendingUp className="size-3.5 text-teal-600 shrink-0" />
                          <span className="font-semibold text-teal-700">下一步：</span>
                          <span className="text-teal-700">{c.nextAction}</span>
                          <span className="ml-auto text-[11px] font-semibold text-indigo-700">
                            请在候选品池中人工确认后进入 Agent
                          </span>
                        </div>
                        {c.summary?.downgradeReasons && c.summary.downgradeReasons.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/50 p-2">
                            {c.summary.downgradeReasons.map((r, idx) => (
                              <p key={idx} className="text-[11px] text-amber-700">⚠ {r}</p>
                            ))}
                          </div>
                        )}
                        {c.status === "failed" && c.errorMessage && (
                          <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50 p-2 text-xs text-rose-600">
                            <XCircle className="mr-1 inline size-3.5" />{c.errorMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Score scale */}
            <div className="surface-card p-3">
              <p className="mb-2 text-[11px] font-semibold text-slate-500">分数参考</p>
              <div className="flex gap-3 text-[10px] text-slate-400">
                <span><span className="font-bold text-emerald-600">80-100</span> 优先测试</span>
                <span><span className="font-bold text-sky-600">65-79</span> 可小单验证</span>
                <span><span className="font-bold text-amber-600">50-64</span> 谨慎观察</span>
                <span><span className="font-bold text-rose-600">0-49</span> 暂不建议</span>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">可信度与人工确认</p>
                  <p className="mt-1 text-xs text-amber-700">
                    AI 分析结果仅供初筛参考，不代表采购建议。高风险商品如果出现在高分段，请以风险排查和硬规则降级标记为准。
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 工作流建议与人工确认 */}
        {hasResults && !loading && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <WorkflowNextStepCard taskType="opportunities" />
            <ManualReviewChecklist />
          </div>
        )}

        {/* Empty state */}
        {!hasResults && !loading && (
          <div className="surface-card p-8 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-slate-100">
              <Target className="size-8 text-slate-300" />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-600">还没有分析结果</p>
            <p className="mt-1 text-xs text-slate-400">在上方输入候选商品（每行一个），点击「开始分析」即可。</p>
            <p className="mt-1 text-xs text-slate-400">支持商品标题、描述或链接（链接仅作文本，不自动访问）。</p>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
