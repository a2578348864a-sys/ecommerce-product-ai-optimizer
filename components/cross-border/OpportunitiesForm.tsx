"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";

import { useLocalDraft } from "@/hooks/useLocalDraft";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";
import { buildCandidateTaskLinkMap, type LinkedTaskInfo } from "@/lib/candidateTaskLinks";
import {
  filterCandidatePool,
  mergeCandidatesIntoPool,
  normalizeCandidate,
  readCandidatePool,
  sortCandidatePool,
  updateCandidateStatus,
  writeCandidatePool,
  type CandidatePoolFilter,
  type CandidatePoolSort,
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
  Lock,
  ArrowRight,
  Eye,
  Database,
  ShieldCheck,
  FileText,
  BarChart3,
  Lightbulb,
} from "lucide-react";
import { getCandidateTypeLabel, getCandidateTypeBadgeClass, getFailureReasonLabel, extractFailureReason, SOURCE_IMPORT_TIERS, SOURCE_IMPORT_HINT } from "@/lib/client/sourceImportLabels";
import { evaluateCandidateQuality, getCandidateQualityDisplay, QUALITY_TIER_LABELS, QUALITY_TIER_TONES, PAGE_TYPE_LABELS, type CandidateQualityLevel, type CandidateQualityTier } from "@/lib/candidateQuality";
import { getAccessMode } from "@/lib/client/accessToken";

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

type SourceImportCandidateData = {
  title: string;
  sourceUrl: string;
  sourceType: string;
  sourceHost: string;
  categoryHint: string;
  keyword: string;
  riskHint: string;
  riskLevel: string;
  summaryLabel: string;
  score: number;
  demandSignalScore: number;
  supplyEaseScore: number;
  riskScore: number;
  beginnerFitScore: number;
  /** Phase 4-D.8: candidate quality classification */
  candidateType?: string;
};

type SourceImportResponse = {
  ok: true;
  candidates: SourceImportCandidateData[];
  summary: { totalUrls: number; okUrls: number; failedUrls: number; totalCandidates: number };
  warnings: string[];
} | { ok: false; error: { code: string; message: string } };

const DRAFT_KEY = "qx:opportunities-draft:v1";

const candidateStatusLabels: Record<CandidateStatus, string> = {
  pending: "待判断",
  worth_analyzing: "值得深挖",
  analyzed: "已进入单品分析",
  paused: "暂缓",
  rejected: "已标记放弃",
};

const candidateFilterOptions: { value: CandidatePoolFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "worth_analyzing", label: "值得深挖" },
  { value: "pending", label: "待判断" },
  { value: "paused", label: "暂缓/高风险" },
  { value: "analyzed", label: "已进入单品分析" },
  { value: "rejected", label: "已标记放弃" },
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

function buildOpportunityWorkflowHrefFromParts(input: {
  name: string;
  score: number;
  sourceName?: string | null;
  keyword?: string;
  rawInput?: string;
  candidateId?: string;
  sourceUrl?: string;
  candidateType?: string;
}) {
  const productName = input.name.trim();
  const params = new URLSearchParams({
    product: productName,
    source: "opportunity",
    opportunityTitle: productName,
    opportunityScore: String(Math.round(input.score)),
    opportunitySource: input.sourceName?.trim().slice(0, 180) || "机会雷达候选品",
  });
  const keyword = input.keyword?.trim() || input.rawInput?.trim();
  if (keyword) params.set("keyword", keyword.slice(0, 80));
  // Phase 4-E.1: enhanced context
  if (input.sourceUrl?.trim()) params.set("sourceUrl", input.sourceUrl.trim().slice(0, 500));
  if (input.candidateType?.trim()) params.set("candidateType", input.candidateType.trim());
  if (input.candidateId?.trim()) params.set("candidateId", input.candidateId.trim());
  return `/workflow?${params.toString()}`;
}

function buildOpportunityWorkflowHref(candidate: CandidateData) {
  return buildOpportunityWorkflowHrefFromParts({
    name: candidate.name,
    score: candidate.score,
    sourceName: candidate.link,
    keyword: candidate.sourcing?.searchKeywords?.find((item) => item.trim().length > 0),
    rawInput: candidate.rawInput,
  });
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
  });
}

function buildOpportunityAgentRunHref(candidate: CandidateData) {
  return buildCandidateAgentRunHref({
    name: candidate.name,
    rawInput: candidate.rawInput,
    analyzedName: candidate.name,
    sourceTitle: candidate.summary?.verdict || candidate.reasons.slice(0, 1).join("") || candidate.name,
    sourceUrl: candidate.link,
    source: "机会雷达候选品",
    score: candidate.score,
    keyword: candidate.sourcing?.searchKeywords?.find((item) => item.trim().length > 0),
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
  };
}

function candidateStatusClass(status: CandidateStatus) {
  if (status === "worth_analyzing") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "analyzed") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "paused") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function serverCandidateToPoolItem(item: Record<string, unknown>): OpportunityCandidatePoolItem {
  return {
    id: String(item.id || ""),
    name: String(item.name || ""),
    rawInput: String(item.rawInput || item.name || ""),
    link: typeof item.link === "string" ? item.link : null,
    score: typeof item.score === "number" ? item.score : 0,
    source: String(item.source || "机会雷达"),
    keyword: String(item.keyword || ""),
    riskLevel: String(item.riskLevel || ""),
    riskLabel: String(item.riskLabel || ""),
    summaryLabel: String(item.summaryLabel || ""),
    candidateStatus: (["pending", "worth_analyzing", "analyzed", "paused", "rejected"].includes(String(item.status))
      ? String(item.status) : "pending") as CandidateStatus,
    createdAt: typeof item.createdAt === "string" ? new Date(item.createdAt).getTime() : Date.now(),
    updatedAt: typeof item.updatedAt === "string" ? new Date(item.updatedAt).getTime() : Date.now(),
    lastActionAt: typeof item.lastActionAt === "string" ? new Date(item.lastActionAt).getTime() : null,
  };
}

function getApiErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return fallback;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : fallback;
}

export function OpportunitiesForm() {
  const [rawText, setRawText] = useState("");
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [poolItems, setPoolItems] = useState<OpportunityCandidatePoolItem[]>([]);
  const [poolHydrated, setPoolHydrated] = useState(false);
  const [poolFilter, setPoolFilter] = useState<CandidatePoolFilter>("all");
  const [poolSort, setPoolSort] = useState<CandidatePoolSort>("updated");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [error, setError] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Phase 1E: Crawl state
  const [crawlInput, setCrawlInput] = useState("");
  const [crawling, setCrawling] = useState(false);
  const [crawlWarnings, setCrawlWarnings] = useState<string[]>([]);

  // Phase 3-B.1: Server candidate pool state
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null); // null = checking
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

  // Phase Candidate-Status-M.1: candidate ↔ task links
  const [candidateTaskLinks, setCandidateTaskLinks] = useState<Map<string, LinkedTaskInfo[]>>(new Map());
  const [taskLinksLoading, setTaskLinksLoading] = useState(false);
  const [openMoreId, setOpenMoreId] = useState<string | null>(null);

  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const { draftValue: draftVal, setDraftValue: setDraft, restored: draftRestored } = useLocalDraft<string>({
    storageKey: DRAFT_KEY,
    ttlMs: 10 * 60 * 1000, // Phase 1E: 10 minutes
    initialValue: "",
  });

  // Restore draft on mount (only once)
  const didRestore = useRef(false);
  useEffect(() => {
    if (!didRestore.current && draftRestored && draftVal) {
      setRawText(draftVal);
      didRestore.current = true;
    }
  }, [draftRestored, draftVal]);

  // Phase 3-B.1: Try server first, fall back to localStorage
  const hasAccess = isAccessPasswordReady && canRequestWithAccessPassword(isAccessPasswordReady, accessPassword);
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
    setPoolItems(serverItems);
    setServerAvailable(true);
    writeCandidatePool(typeof window === "undefined" ? null : window.localStorage, serverItems);
    return serverItems;
  }, [accessPassword]);

  useEffect(() => {
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
  }, [hasAccess, refreshServerPool]);

  useEffect(() => {
    if (!poolHydrated) return;
    writeCandidatePool(typeof window === "undefined" ? null : window.localStorage, poolItems);
  }, [poolHydrated, poolItems]);

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

  // Check if localStorage has items that server might not have
  const localPoolCount = typeof window === "undefined" ? 0 : readCandidatePool(window.localStorage).length;
  const showImportButton = serverAvailable === true && localPoolCount > 0;

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
        if (res.status === 401 || res.status === 403 || json.error?.code === "invalid_access") {
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

  // Phase 1E: Crawl public sources
  const handleCrawl = useCallback(async () => {
    if (!crawlInput.trim() || crawling || loading) return;
    if (!isAccessPasswordReady || !canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setCrawlWarnings(["访问密码缺失或已过期。"]);
      return;
    }

    setCrawling(true);
    setCrawlWarnings([]);
    setError("");

    try {
      const res = await fetch("/api/opportunities/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({ input: crawlInput, accessPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (res.status === 401 || res.status === 403 || data.error?.code === "invalid_access") {
          setCrawlWarnings(["登录状态已失效，请回首页重新解锁。"]);
        } else {
          setCrawlWarnings([data.error?.message || "该来源暂时无法抓取，请换一个商品页或稍后重试。"]);
        }
        return;
      }

      // Convert crawl items to plain text lines, append to rawText
      const crawlLines = (data.items || []).map(
        (item: { title: string; sourceHost: string; scores: { finalScore: number } }) =>
          `${item.title} [${item.sourceHost}] score:${item.scores.finalScore}`
      );
      if (crawlLines.length > 0) {
        const newText = [rawText, ...crawlLines].filter(Boolean).join("\n");
        setRawText(newText);
        setDraft(newText);
      }

      if (data.warnings?.length) {
        setCrawlWarnings(data.warnings);
      }
      if (crawlLines.length > 0) {
        setCrawlWarnings((prev) => [...prev, `已抓取 ${crawlLines.length} 条公开线索，已填入候选列表。可继续手动编辑后点「开始分析」。`]);
      }
    } catch {
      setCrawlWarnings(["网络异常，抓取失败。"]);
    } finally {
      setCrawling(false);
    }
  }, [crawlInput, accessPassword, isAccessPasswordReady, crawling, loading, rawText, setDraft]);

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

  const setPoolCandidateStatus = useCallback(async (id: string, status: CandidateStatus) => {
    const previous = poolItems.find((item) => item.id === id);
    setPoolItems((current) => updateCandidateStatus(current, id, status));
    setPoolSyncNotice("");

    if (!id) return;

    if (!hasAccess || serverAvailable !== true || id.startsWith("opp-")) {
      setPoolSyncNotice("当前状态仅保存在本浏览器候选池，清缓存会丢失。连接服务端候选池后可持久保存。");
      return;
    }

    try {
      const res = await fetch(`/api/opportunity-candidates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({ status }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object" || Array.isArray(json) || (json as Record<string, unknown>).ok !== true) {
        throw new Error(getApiErrorMessage(json, "候选品状态保存失败，请稍后重试。"));
      }
      await refreshServerPool();
      setPoolSyncNotice("候选品状态已保存到服务端。");
    } catch (updateError) {
      if (previous) {
        setPoolItems((current) => updateCandidateStatus(current, id, previous.candidateStatus));
      }
      setPoolSyncNotice(updateError instanceof Error
        ? updateError.message
        : "候选品状态保存失败，请稍后重试。");
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

  const markCandidateAnalyzed = useCallback((candidate: CandidateData) => {
    const input = candidateToPoolInput(candidate);
    const normalized = normalizeCandidate(input);
    if (!normalized) return;
    setPoolItems((current) => {
      const merged = mergeCandidatesIntoPool(current, [input]);
      return updateCandidateStatus(merged, normalized.id, "analyzed");
    });
  }, []);

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
        const msg = json.error?.message || "来源导入失败。";
        if (res.status === 401 || json.error?.code === "unauthorized") {
          setSourceImportError("访问已失效，请重新输入访问密码。");
        } else if (json.error?.code === "too_many_urls") {
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
    setSourceImportChecked((prev) => {
      const next = new Set(prev);
      const key = String(index);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleAllSourceCandidates = useCallback(() => {
    setSourceImportChecked((prev) => {
      // Re-select all only if every importable candidate is already checked
      const importableIndices = sourceImportCandidates
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => {
          const q = evaluateCandidateQuality({ title: c.title, url: c.sourceUrl, candidateType: c.candidateType });
          return q.shouldAllowImport;
        })
        .map(({ i }) => String(i));
      if (prev.size >= importableIndices.length) return new Set<string>();
      return new Set(importableIndices);
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
    const inputs = selected.map((c) => {
      const now = new Date().toISOString();
      return {
        name: c.title,
        rawInput: c.title,
        link: c.sourceUrl || null,
        score: c.score,
        source: `${c.sourceType === "rss" ? "RSS抓取" : c.sourceType === "sitemap" ? "Sitemap抓取" : "网页抓取"} · ${c.sourceHost}`,
        keyword: c.keyword || c.categoryHint,
        riskLevel: c.riskLevel,
        riskLabel: c.riskLevel === "red" ? "高风险" : c.riskLevel === "yellow" ? "需注意" : c.riskLevel === "green" ? "低风险" : "未评级",
        summaryLabel: c.summaryLabel,
        sourceMetaJson: JSON.stringify({
          sourceType: c.sourceType,
          sourceUrl: c.sourceUrl,
          sourceHost: c.sourceHost,
          importedAt: now,
          importMethod: "phase4b_source_importer_mvp",
          crawlStatus: "success",
          robotsAllowed: true,
        }),
        analysisJson: JSON.stringify({
          title: c.title,
          sourceUrl: c.sourceUrl,
          sourceType: c.sourceType,
          sourceHost: c.sourceHost,
          categoryHint: c.categoryHint,
          riskHint: c.riskHint,
          scores: {
            demandSignalScore: c.demandSignalScore,
            supplyEaseScore: c.supplyEaseScore,
            riskScore: c.riskScore,
            beginnerFitScore: c.beginnerFitScore,
            finalScore: c.score,
          },
          importedAt: now,
        }),
      };
    });

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
      const updated = Number((json as Record<string, unknown>).updated ?? 0);

      try {
        await refreshServerPool();
        setSourceConfirmResult(`已导入候选池，可在下方候选池查看。新增 ${created} 个，更新 ${updated} 个。`);
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
    return (
      <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
        <div className="workspace-page workspace-layout">
          <WorkspaceSidebar />
          <div className="min-w-0 space-y-6">
            {/* Header — same as unlocked state for visual consistency */}
            <header className="workspace-header">
              <div className="flex items-center gap-3">
                <div className="linear-icon size-10 shrink-0 rounded-xl">
                  <Target className="size-5" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-slate-950">机会雷达 / 候选品池 · 功能预览</h1>
                  <p className="muted-text mt-1 text-sm">跨境电商机会来源导入与候选池 — 未解锁时可浏览功能说明和示例</p>
                </div>
              </div>
            </header>

            {/* Value proposition */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="linear-icon size-10 shrink-0 rounded-xl bg-amber-100 text-amber-600">
                  <Lightbulb className="size-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-800">把公开来源中的商品/趋势线索整理成可复核候选</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">
                    粘贴公开 URL、RSS 或 Sitemap → 系统自动抓取并解析 → 你勾选确认后进入候选池 → 标记状态、筛选排序 → 进入单品分析深挖。
                  </p>
                </div>
              </div>
            </div>

            {/* 3-step flow */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">三分钟上手流程</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { step: "1", icon: Upload, title: "导入来源", desc: "粘贴公开 URL、RSS 或 Sitemap，一次最多 5 条" },
                  { step: "2", icon: Search, title: "解析候选", desc: "系统自动爬取、清洗、评分，生成候选清单" },
                  { step: "3", icon: CheckCircle2, title: "人工复核入池", desc: "你勾选确认的候选才会写入候选池，其余自动丢弃" },
                ].map((s) => (
                  <div key={s.step} className="flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-4 text-center">
                    <div className="linear-icon size-9 shrink-0 rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                      <s.icon className="size-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{s.title}</p>
                    <p className="text-xs leading-relaxed text-slate-400">{s.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Example candidates — clearly marked as mock */}
            <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="size-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-amber-800">示例候选品（仅供参考，非真实数据）</h3>
              </div>
              <p className="mb-4 text-xs text-amber-600">
                以下为静态示例，展示候选池的卡片样式和状态标记。解锁后可查看真实候选数据。
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { name: "桌面手机支架", score: 90, level: "A", levelLabel: "强烈推荐", reasons: ["需求稳定", "采购门槛低", "售后风险小"], status: "worth_analyzing" },
                  { name: "宠物慢食碗", score: 55, level: "B", levelLabel: "可选关注", reasons: ["细分需求增长", "食品接触需合规", "新手可尝试"], status: "pending" },
                  { name: "硅胶折叠水杯", score: 45, level: "C", levelLabel: "谨慎评估", reasons: ["食品接触材料", "FDA/LFGB 认证", "专利风险"], status: "paused" },
                ].map((item, i) => (
                  <div key={i} className="rounded-lg border border-amber-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${item.level === "A" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : item.level === "B" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                        {item.level} · {item.levelLabel}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                      <BarChart3 className="size-3" />
                      评分 {item.score} · 示例数据
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.reasons.map((r, j) => (
                        <span key={j} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{r}</span>
                      ))}
                    </div>
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.status === "worth_analyzing" ? "bg-emerald-50 text-emerald-700" :
                        item.status === "pending" ? "bg-slate-100 text-slate-500" :
                        "bg-amber-50 text-amber-700"
                      }`}>
                        {item.status === "worth_analyzing" ? "值得深挖" : item.status === "pending" ? "待判断" : "暂缓"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Data safety notice */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 shrink-0 text-emerald-500" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">数据安全说明</h3>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-500">
                    <li>· 未解锁时不会读取或展示任何真实候选池数据</li>
                    <li>· 来源导入抓取结果只是临时预览，确认导入前不写数据库</li>
                    <li>· 删除候选需要二次确认，&ldquo;标记为放弃&rdquo;不等于删除</li>
                    <li>· 所有关键动作（导入、删除、进入分析）都需人工操作</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Unlock CTA */}
            <div className="rounded-xl border-2 border-dashed border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 text-center shadow-sm">
              <div className="mx-auto flex max-w-md flex-col items-center gap-4">
                <div className="linear-icon size-12 rounded-2xl bg-blue-100 text-blue-500">
                  <Lock className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">解锁后使用完整功能</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">
                    输入访问密码后，即可连接服务端候选池、使用来源导入、管理真实候选数据。
                  </p>
                </div>
                <Link
                  href="/?redirect=%2Fopportunities"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  返回首页解锁
                  <ArrowRight className="size-4" />
                </Link>
                <p className="text-xs text-slate-400">
                  轻选 Agent · Alpha MVP · 受控自动化 + 人工复核
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="workspace-header">
            <div className="flex items-center gap-3">
              <div className="linear-icon size-10 shrink-0 rounded-xl">
                <Target className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-950">机会雷达</h1>
                <p className="muted-text mt-1 text-sm">把来源导入结果转成可判断的选品机会。系统先做质量分层和理由解释，再由人工决定是否进入 AI 分析。</p>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* 主链路引导 */}
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm">
            <p className="font-semibold text-teal-800">📍 主路径：机会雷达 → Agent 主链路 → 人工复核 → 任务中心</p>
            <p className="mt-1 text-xs text-teal-700">
              本页用于发现候选商品并标记状态。筛选出感兴趣的商品后，去
              <Link href="/agent/run" className="mx-0.5 font-semibold underline">Agent 主链路</Link>
              做 8 步深度分析，保存后进入
              <Link href="/tasks" className="mx-0.5 font-semibold underline">任务中心</Link>
              跟进。
            </p>
          </div>

          {/* Phase 3-B.1: Server connection indicator */}
          {serverAvailable !== null ? (
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

        {/* Phase 1E: Crawl input */}
        <div className="surface-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                抓取公开线索（可选）
                <span className="ml-1 font-normal text-slate-400">粘贴公开 URL / RSS / sitemap，每行一个，最多 5 个</span>
              </label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                placeholder="https://example.com/sitemap.xml"
                value={crawlInput}
                onChange={(e) => setCrawlInput(e.target.value)}
                disabled={loading || crawling}
              />
            </div>
            <button type="button" onClick={handleCrawl} disabled={loading || crawling || !crawlInput.trim()}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-700 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50">
              {crawling ? <><Loader2 className="size-3.5 animate-spin" />抓取中</> : <><Search className="size-3.5" />抓取公开线索</>}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">不调用 AI，不保存任务，仅整理候选机会。不支持登录态页面。</p>
          {crawlWarnings.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
              {crawlWarnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
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
                  {/* Candidate-Quality-M.1: quality summary */}
                  {(() => {
                    const qs = sourceImportCandidates.map(c => evaluateCandidateQuality({ title: c.title, url: c.sourceUrl, candidateType: c.candidateType }));
                    const rec = qs.filter(q => q.level === "recommended").length;
                    const cau = qs.filter(q => q.level === "caution").length;
                    const nr = qs.filter(q => q.level === "not_recommended").length;
                    const rej = qs.filter(q => q.level === "rejected").length;
                    if (rec + cau + nr + rej === 0) return null;
                    return (
                      <p className="mt-1 text-xs text-slate-400">
                        候选质量：
                        {rec > 0 && <span className="ml-1 text-emerald-600">推荐入池 {rec}</span>}
                        {cau > 0 && <span className="ml-1 text-amber-600">谨慎 {cau}</span>}
                        {nr > 0 && <span className="ml-1 text-slate-500">不建议 {nr}</span>}
                        {rej > 0 && <span className="ml-1 text-rose-500">拒绝 {rej}</span>}
                      </p>
                    );
                  })()}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={toggleAllSourceCandidates}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                  >
                    {sourceImportChecked.size === sourceImportCandidates.length ? "取消全选" : "全选"}
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
                  return (
                    <label
                      key={`${c.title}-${i}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${checked ? "border-teal-300 bg-teal-50/60" : "border-slate-200 bg-white hover:border-teal-200"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSourceCandidate(i)}
                        className="mt-1 size-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">{c.title}</p>
                          {/* Phase Candidate-Quality-M.1: quality badge */}
                          {(() => {
                            const quality = evaluateCandidateQuality({ title: c.title, url: c.sourceUrl, candidateType: c.candidateType });
                            return (
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${QUALITY_TONE[quality.level]}`}>
                                {quality.label}
                              </span>
                            );
                          })()}
                          {/* Phase 4-D.8: candidateType badge */}
                          {(() => {
                            const ctLabel = getCandidateTypeLabel(c.candidateType);
                            return (
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getCandidateTypeBadgeClass(ctLabel.tone)}`}>
                                {ctLabel.label}
                              </span>
                            );
                          })()}
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${c.riskLevel === "red" ? "border-rose-200 bg-rose-50 text-rose-700" : c.riskLevel === "yellow" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                            风险{riskText(c.riskLevel)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                          <span>来源：{c.sourceHost} · {c.sourceType}</span>
                          <span>分数：{c.score}/100</span>
                          <span>需求：{c.demandSignalScore} | 风险：{c.riskScore} | 新手：{c.beginnerFitScore}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.summaryLabel}</p>
                        {c.riskHint && (
                          <p className="mt-1 text-[11px] text-amber-600">⚠ {c.riskHint}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              <p className="mt-3 text-xs text-slate-400">
                ⚠ 以上结果由系统规则评分生成，不代表最终选品决策。关键动作需人工确认。本次不会自动采购、自动上架或自动投广告。
              </p>
            </div>
          )}
        </section>

        {/* Candidate pool */}
        <section className="surface-card p-4 sm:p-5" data-testid="opportunity-candidate-pool">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="linear-kicker">候选品池</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">先筛选，再深挖</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {serverAvailable === true
                  ? "已解锁 / 服务端候选池。当前数据已从服务端候选池加载，刷新后仍保留。"
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
                    const localItems = readCandidatePool(window.localStorage);
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
                  导入本浏览器候选池
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

          <div className="mt-4 flex flex-wrap gap-2">
            {candidateFilterOptions.map((option) => {
              const active = poolFilter === option.value;
              const count = option.value === "all" ? poolCounts.all : poolCounts[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPoolFilter(option.value)}
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
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {visiblePoolItems.map((item) => {
                const itemSourceMode = (item as Record<string, unknown>).sourceMode as string | undefined;
                const isOfficialReadonly = demoMode && itemSourceMode === "official_readonly";
                const isDemoSandbox = demoMode && itemSourceMode === "demo_sandbox";
                return (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-base font-semibold text-slate-950">{item.name}</h3>
                        <span className={"rounded-full border px-2.5 py-1 text-xs font-bold " + candidateStatusClass(item.candidateStatus)}>
                          {candidateStatusLabels[item.candidateStatus]}
                        </span>
                        {/* Demo-Sandbox.1-C-UI-Fix: source labels */}
                        {isDemoSandbox && (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">访客数据</span>
                        )}
                        {isOfficialReadonly && (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">只读样例</span>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.summaryLabel}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                        <span>分数 {item.score}/100</span>
                        <span>风险：{item.riskLabel}</span>
                        {item.keyword ? <span>关键词：{item.keyword}</span> : null}
                        <span>来源：{item.source}</span>
                      </div>
                      {item.candidateStatus === "analyzed" ? (
                        <p className="mt-2 text-xs font-semibold text-indigo-700">已进入单品分析，可继续深挖。</p>
                      ) : null}
                      {/* Phase Candidate-Status-M.1: Linked tasks display */}
                      {(() => {
                        const linkedTasks = candidateTaskLinks.get(item.id);
                        if (!linkedTasks || linkedTasks.length === 0) return null;
                        const latest = linkedTasks[0];
                        return (
                          <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-teal-200 bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                                已关联任务
                              </span>
                              {latest.source === "agent_run" ? (
                                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                                  来自 Agent 主链路
                                </span>
                              ) : null}
                              {linkedTasks.length > 1 ? (
                                <span className="text-[10px] text-slate-400">共 {linkedTasks.length} 条</span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-xs font-semibold text-slate-700">{latest.title}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <Link
                                href={`/tasks/${latest.taskId}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-100"
                              >
                                查看任务详情
                                <ArrowRight className="size-3" />
                              </Link>
                              <span className="text-[10px] text-slate-400">ID: {latest.taskId.slice(0, 12)}…</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      {/* Primary: 进入 Agent 主链路 */}
                      <Link
                        href={buildPoolAgentRunHref(item)}
                        data-testid={`candidate-agent-run-${item.id}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                      >
                        进入 Agent 主链路
                        <ArrowRight className="size-3" />
                      </Link>
                      {/* More actions dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMoreId(openMoreId === item.id ? null : item.id)}
                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          更多操作
                          <ChevronDown className="size-3" />
                        </button>
                        {openMoreId === item.id ? (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenMoreId(null)} />
                            <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                              <span className="px-3 py-1 text-[10px] font-semibold text-slate-400">人工标记</span>
                              {isOfficialReadonly ? (
                                <span className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 cursor-not-allowed" title="访客体验模式下不能修改正式候选数据">
                                  正式候选不可修改
                                </span>
                              ) : (<>
                              <button type="button" onClick={() => { setPoolCandidateStatus(item.id, "analyzed"); setOpenMoreId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-indigo-600 hover:bg-indigo-50">
                                人工标记为已分析
                              </button>
                              <button type="button" onClick={() => { setPoolCandidateStatus(item.id, "worth_analyzing"); setOpenMoreId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-emerald-600 hover:bg-emerald-50">
                                人工标记为值得深挖
                              </button>
                              <button type="button" onClick={() => { setPoolCandidateStatus(item.id, "pending"); setOpenMoreId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                                人工标记为待判断
                              </button>
                              <button type="button" onClick={() => { setPoolCandidateStatus(item.id, "paused"); setOpenMoreId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-amber-600 hover:bg-amber-50">
                                人工标记为暂缓
                              </button>
                              <button type="button" onClick={() => {
                                const confirmed = window.confirm(
                                  `确认将「${item.name}」标记为放弃？这不会删除候选，只会改变状态。如需彻底移除，请使用"删除候选"。`
                                );
                                if (!confirmed) return;
                                setPoolCandidateStatus(item.id, "rejected");
                                setOpenMoreId(null);
                              }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50">
                                人工标记为放弃
                              </button>
                              </>)}
                              <div className="mx-2 my-1 border-t border-slate-100" />
                              {isOfficialReadonly ? (
                                <span className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 cursor-not-allowed" title="访客体验模式下不能删除正式候选数据">
                                  <Trash2 className="size-3" />
                                  正式候选不可删除
                                </span>
                              ) : (
                                <button type="button" onClick={() => { void deletePoolCandidate(item); setOpenMoreId(null); }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50">
                                  <Trash2 className="size-3" />
                                  删除候选
                                </button>
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>
                      <span className="text-xs text-slate-400">不会自动开始 AI</span>
                    </div>
                  </div>
                </article>
              )})}
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
                          {c.name?.trim() && (
                            <Link
                              href={buildOpportunityWorkflowHref(c)}
                              onClick={() => markCandidateAnalyzed(c)}
                              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700"
                            >
                              用单品分析深挖
                              <TrendingUp className="size-3" />
                            </Link>
                          )}
                          {c.name?.trim() && (
                            <Link
                              href={buildOpportunityAgentRunHref(c)}
                              data-testid={`candidate-agent-run-result-${c.index}`}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                            >
                              进入 Agent 主链路
                              <ArrowRight className="size-3" />
                            </Link>
                          )}
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
