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
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { ProfitSnapshotCard, type ProfitSnapshot } from "@/components/cross-border/ProfitSnapshotCard";
import { RiskReviewChecklistCard } from "@/components/cross-border/RiskReviewChecklistCard";
import { ListingPrepPackageCard } from "@/components/cross-border/ListingPrepPackageCard";
import type { RiskPrecheckInput, RiskReviewSnapshot } from "@/lib/riskReview";
import { buildAgentRunSnapshot, buildListingPrepSnapshot } from "@/lib/agentRunSnapshot";

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
};

type ApiErrorResponse = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
  };
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
  importedAt: string;
};

type RunPhase = "idle" | "running" | "completed" | "failed" | "needs_manual_review";
type TimelineStatus = "idle" | "running" | "completed" | "needs_manual_review" | "paused" | "failed";

type TimelineStep = {
  key: "normalize" | "market" | "sourcing" | "profit" | "risk" | "listing" | "report" | "manual";
  title: string;
  description: string;
  detail: string;
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
    detail: "只给运营判断建议，不自动联系供应商。",
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
    title: "人工确认与任务沉淀",
    description: "人工确认后保存任务，进入运营跟进。",
    detail: "当前 Alpha 阶段不会自动执行商业动作。",
    icon: ClipboardCheck,
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

const MANUAL_ITEMS = [
  { key: "sourcing", label: "已人工复核供货可行性和供应商证据" },
  { key: "profit", label: "已人工复核成本利润估算，不把估算当真实市场价" },
  { key: "risk", label: "已人工最终确认合规、侵权、认证和平台规则仍需查证" },
  { key: "listing", label: "已确认 Listing / 关键词草稿不会直接发布" },
] as const;

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

function riskTone(level?: string) {
  if (level === "green") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (level === "red") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
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
  return "completed";
}

function getApiStep(result: ApiWorkflowResult | null, key: ApiStepKey) {
  return result?.steps.find((step) => step.key === key) || null;
}

function buildWorkflowHref(productName: string, sourceMeta: AgentRunSourceMeta | null) {
  const params = new URLSearchParams({ product: productName });
  if (sourceMeta) {
    params.set("source", "opportunity");
    params.set("opportunityTitle", sourceMeta.opportunityTitle);
    if (sourceMeta.opportunityScore !== undefined) params.set("opportunityScore", String(sourceMeta.opportunityScore));
    if (sourceMeta.opportunitySource) params.set("opportunitySource", sourceMeta.opportunitySource);
    if (sourceMeta.keyword) params.set("keyword", sourceMeta.keyword);
    if (sourceMeta.candidateType) params.set("candidateType", sourceMeta.candidateType);
    if (sourceMeta.sourceUrl) params.set("sourceUrl", sourceMeta.sourceUrl);
    if (sourceMeta.candidateId) params.set("candidateId", sourceMeta.candidateId);
  }
  return `/workflow?${params.toString()}`;
}

export function AgentRunClient({
  initialProductName,
  initialSourceMeta,
}: {
  initialProductName?: string;
  initialSourceMeta?: AgentRunSourceMeta | null;
}) {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const [productName, setProductName] = useState(initialProductName || "");
  const [sourceMeta] = useState<AgentRunSourceMeta | null>(initialSourceMeta || null);
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
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(""); // auth failures should never mark steps as failed
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTaskId, setSavedTaskId] = useState("");
  const summaryRef = useRef<HTMLDivElement | null>(null);

  const report = result?.finalReport || null;
  const manualReady = MANUAL_ITEMS.every((item) => manualChecked[item.key]);
  const isRunning = phase === "running";
  const needsManualReview = phase === "needs_manual_review" || phase === "completed";
  const workflowHref = buildWorkflowHref(productName.trim(), sourceMeta);

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

  const resetRun = useCallback(() => {
    setPhase("idle");
    setStepStatuses(INITIAL_STATUSES);
    setResult(null);
    setProfitSnapshot(null);
    setRiskReviewSnapshot(null);
    setManualChecked({ sourcing: false, profit: false, risk: false, listing: false });
    setError("");
    setAuthError("");
    setSaveError("");
    setSaving(false);
    setSavedTaskId("");
  }, []);

  useEffect(() => {
    if (initialProductName) {
      setProductName(initialProductName);
    }
  }, [initialProductName]);

  useEffect(() => {
    if (!result?.workflowId) return;
    window.requestAnimationFrame(() => {
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [result?.workflowId]);

  async function handleRun() {
    const name = productName.trim();
    if (isRunning) return;
    if (name.length < 2) {
      setError("请输入至少 2 个字符的商品名称。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
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

    const runOrder: TimelineStep["key"][] = ["normalize", "market", "sourcing", "profit", "risk", "listing", "report", "manual"];
    let cursor = 0;
    setStepStatuses({
      ...INITIAL_STATUSES,
      normalize: "running",
    });
    const timer = window.setInterval(() => {
      cursor += 1;
      setStepStatuses((current) => {
        const next = { ...current };
        const previous = runOrder[cursor - 1];
        const active = runOrder[cursor];
        if (previous && next[previous] === "running") next[previous] = "completed";
        if (active) next[active] = "running";
        return next;
      });
    }, 450);

    try {
      const response = await fetch("/api/workflows/product-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          productName: name,
          source: sourceMeta ? "opportunity" : "manual",
          accessPassword,
        }),
      });
      const data = await response.json() as ApiWorkflowResult | ApiErrorResponse;
      window.clearInterval(timer);

      if (!response.ok || !data.ok) {
        const message = data.ok ? "主链路分析失败，请稍后重试。" : data.error?.message || "主链路分析失败，请稍后重试。";
        // Auth errors (401/403) should NOT pollute business run state
        if (response.status === 401 || response.status === 403) {
          setAuthError(message);
          setPhase("idle");
          setStepStatuses(INITIAL_STATUSES);
        } else {
          setPhase("failed");
          setError(message);
          setStepStatuses((current) => {
            const next = { ...current };
            for (const key of runOrder) {
              if (next[key] === "running") next[key] = "failed";
            }
            return next;
          });
        }
        return;
      }

      const workflowResult = data;
      const riskLevel = workflowResult.finalReport?.riskLevel;
      setResult(workflowResult);
      setPhase("needs_manual_review");
      setStepStatuses({
        normalize: apiStatusToTimeline(getApiStep(workflowResult, "normalize")?.status),
        market: workflowResult.finalReport ? "completed" : "needs_manual_review",
        sourcing: apiStatusToTimeline(getApiStep(workflowResult, "sourcing")?.status),
        profit: "needs_manual_review",
        risk: riskLevel === "red" ? "paused" : "needs_manual_review",
        listing: apiStatusToTimeline(getApiStep(workflowResult, "listing")?.status),
        report: workflowResult.finalReport ? "completed" : "needs_manual_review",
        manual: "needs_manual_review",
      });
      if (workflowResult.warnings.length) {
        setError(workflowResult.warnings.join("；"));
      }
    } catch (runError) {
      window.clearInterval(timer);
      setPhase("failed");
      setError(runError instanceof Error ? runError.message : "网络异常，请稍后重试。");
      setStepStatuses((current) => {
        const next = { ...current };
        for (const key of runOrder) {
          if (next[key] === "running") next[key] = "failed";
        }
        return next;
      });
    }
  }

  async function saveToTasks() {
    if (!result || saving || savedTaskId) return;
    if (!manualReady) {
      setSaveError("请先完成 4 项人工确认，再保存任务。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setSaveError("会话未就绪，请返回首页重新登录后再操作。");
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/workflows/product-analysis/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          accessPassword,
          workflowResult: result,
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
          agentRunSnapshot: buildAgentRunSnapshot({
            workflowResult: result as Record<string, unknown>,
            riskReviewSnapshot,
            profitSnapshot,
            manualChecked,
            productName: productName.trim(),
            sourceMeta,
          }),
          listingPrepSnapshot: buildListingPrepSnapshot({
            listing: result?.listing as Record<string, unknown> | undefined,
            riskReviewSnapshot,
            finalReport: result?.finalReport as Record<string, unknown> | undefined,
            productName: productName.trim(),
          }),
        }),
      });
      const data = await response.json() as { ok?: boolean; data?: { id?: string }; error?: { message?: string } };
      if (!response.ok || !data.ok || !data.data?.id) {
        setSaveError(data.error?.message || "保存任务失败，请稍后重试。");
        return;
      }
      setSavedTaskId(data.data.id);
      setPhase("completed");
      setStepStatuses((current) => ({ ...current, manual: "completed" }));
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
    return <WorkspaceLockedPrompt pageName="Agent 主链路驾驶舱" returnUrl="/agent/run" />;
  }

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-4">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">受控自动化 · Alpha MVP</p>
                <h1 className="section-title mt-1 text-2xl">Agent 主链路驾驶舱</h1>
                <p className="muted-text mt-1 max-w-3xl text-sm leading-6">
                  从一个商品出发，完成选品判断、风险预筛、Listing 准备与人工复核。
                  当前为受控自动化工作流，AI 负责预筛和建议，最终商业动作需人工确认。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/opportunities" className="linear-button-soft inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  候选池
                </Link>
                <Link href="/tasks" className="linear-button inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  任务中心
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-bold text-amber-900">Alpha 安全口径</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  当前 Alpha 阶段不会自动执行商业动作。不会自动保存任务、不会自动修改任务状态、不会自动采购、不会自动上架。
                  合规 / 侵权 AI / 规则预筛只能做提醒，不能替代商标专利平台规则和当地法规核查。
                </p>
              </div>
            </div>
          </section>

          <section className="surface-card p-4 sm:p-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="agent-run-product">
                  输入产品 / 从候选带入
                </label>
                <input
                  id="agent-run-product"
                  type="text"
                  value={productName}
                  onChange={(event) => {
                    setProductName(event.target.value.slice(0, 120));
                    if (error) setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleRun();
                  }}
                  placeholder="例如：桌面手机支架、硅胶折叠水杯、宠物慢食碗"
                  disabled={isRunning}
                  className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{productName.length}/120</span>
                  <span>可以输入产品名称，也可以后续从候选池带入。</span>
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
                  disabled={isRunning || productName.trim().length < 2}
                  className="linear-button-primary inline-flex h-12 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:opacity-50"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      主链路分析中
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      开始主链路分析
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
            {error ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800" data-testid="agent-run-error">
                {error}
              </div>
            ) : null}
            {sourceMeta ? (
              <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-sm leading-6 text-indigo-800">
                <p className="font-semibold">已带入候选池上下文</p>
                <p className="mt-1">
                  来自候选池：{sourceMeta.sourceTitle || sourceMeta.opportunityTitle}
                  {sourceMeta.candidateId ? ` · 候选 ID：${sourceMeta.candidateId}` : ""}
                </p>
                {sourceMeta.originalName || sourceMeta.analyzedName ? (
                  <p className="mt-1 text-xs">
                    原始名称：{sourceMeta.originalName || "未提供"} · 分析名称：{sourceMeta.analyzedName || productName}
                  </p>
                ) : null}
                <p className="mt-1 text-xs font-semibold">
                  不会自动开始 AI 分析，仍需你手动点击“开始主链路分析”。
                </p>
              </div>
            ) : null}
          </section>

          <section className="surface-card p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="linear-kicker">一条主链路</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                  从输入到任务沉淀的 8 步受控流程
                </h2>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClass(phase === "failed" ? "failed" : needsManualReview ? "needs_manual_review" : isRunning ? "running" : "idle")}`}>
                {phase === "failed" ? "分析未完成，可重新开始" : needsManualReview ? "等待人工确认" : isRunning ? "运行中" : "未开始"}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {TIMELINE_STEPS.map((step) => (
                <TimelineCard key={step.key} step={step} status={stepStatuses[step.key]} />
              ))}
            </div>
          </section>

          {phase === "failed" ? (
            <section className="surface-card border-rose-200 bg-rose-50/70 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
                <div>
                  <h2 className="text-lg font-semibold text-rose-900">主链路分析失败</h2>
                  <p className="mt-1 text-sm leading-6 text-rose-700">
                    {error || "API mock 或网络返回异常。页面未崩溃，可以重新开始或返回单品分析页查看细节。"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={resetRun} className="linear-button-primary inline-flex h-10 items-center px-4 text-sm font-semibold">
                      重新开始
                    </button>
                    <Link href="/workflow" className="linear-button inline-flex h-10 items-center px-4 text-sm font-semibold">
                      返回单品分析页查看细节
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {result && report ? (
            <section ref={summaryRef} className="surface-card border-teal-200 bg-gradient-to-b from-teal-50/80 to-white p-5 sm:p-6 scroll-mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">Agent 主链路结论 · {result.productName}</p>
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h2 className="break-words text-2xl font-bold tracking-tight text-slate-950">
                    {report.finalVerdict || "需要人工复核后再决定"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    AI 结果只做预筛和建议。请先完成成本利润、合规 / 侵权、Listing 和供应商证据的人工最终确认。
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className={`rounded-full border px-3 py-1 text-sm font-bold ${riskTone(report.riskLevel)}`}>
                    {riskLabel(report.riskLevel)}
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
                  <p className="text-sm font-bold text-teal-800">下一步动作</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
                    {report.nextSteps.slice(0, 5).map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <p className="text-sm font-bold text-amber-800">需要人工查证的重点</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-amber-800">
                    {report.mustCheckBeforeListing.slice(0, 5).map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryMetric label="AI 步骤" value={`${result.costGuard.aiStepsCompleted}/${result.costGuard.aiStepsRequested}`} />
                <SummaryMetric label="兜底步骤" value={String(result.costGuard.fallbackSteps)} />
                <SummaryMetric label="工作流状态" value={result.status === "completed" ? "已完成" : "需复核"} />
                <SummaryMetric label="保存状态" value={savedTaskId ? "已保存" : "未保存"} />
              </div>

              <details className="mt-5 rounded-xl border border-slate-200 bg-white/80 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
                  成本利润估算 · profitSnapshot
                  <span className="ml-2 text-xs font-medium text-slate-400">默认折叠，人工填写后随任务保存</span>
                </summary>
                <div className="mt-3">
                  <ProfitSnapshotCard onChange={setProfitSnapshot} />
                </div>
              </details>

              <details className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
                  合规 / 侵权 AI / 规则预筛 · riskReviewSnapshot
                  <span className="ml-2 text-xs font-medium text-slate-400">默认折叠，人工最终确认后再使用</span>
                </summary>
                <div className="mt-3">
                  <RiskReviewChecklistCard
                    precheckInput={riskPrecheckInput}
                    onChange={setRiskReviewSnapshot}
                  />
                </div>
              </details>

              <details className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
                  Listing / 关键词准备
                  <span className="ml-2 text-xs font-medium text-slate-400">上架准备包，默认折叠</span>
                </summary>
                <div className="mt-3">
                  <ListingPrepPackageCard
                    embedded
                    listing={{ title: listingTitle, keywords: listingKeywords, complianceNotes: listingNotes }}
                    riskReviewSnapshot={riskReviewSnapshot}
                    finalReport={result?.finalReport}
                    productName={productName.trim() || undefined}
                  />
                </div>
              </details>

              <details className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
                  完整 AI 分析 / 过程日志 / JSON
                  <span className="ml-2 text-xs font-medium text-slate-400">默认折叠，调试时再展开</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-bold text-slate-500">过程日志</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
                      {result.steps.map((step) => (
                        <li key={step.key}>- {step.label}：{step.summary}</li>
                      ))}
                    </ul>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </details>

              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <p className="text-sm font-bold text-amber-900">人工确认与任务沉淀</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  勾选后才允许点击“人工确认后保存任务”。这一步只由人工触发，不会自动保存任务或修改任务状态。
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
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {savedTaskId ? (
                    <Link href={`/tasks/${savedTaskId}`} className="linear-button-primary inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold">
                      <CheckCircle2 className="size-4" />
                      已保存，进入运营跟进
                    </Link>
                  ) : (
                    <button
                      type="button"
                      data-testid="agent-run-save-task"
                      onClick={() => void saveToTasks()}
                      disabled={saving || !manualReady}
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
                  <Link href={workflowHref} className="linear-button-soft inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold">
                    返回单品分析页查看细节
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
                {saveError ? <p className="mt-2 text-xs font-semibold text-rose-600">{saveError}</p> : null}
              </div>
            </section>
          ) : null}

          <p className="text-center text-xs text-slate-400">
            Agent 主链路驾驶舱 · 受控自动化 · AI / 规则预筛 · 人工最终确认
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

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/80 bg-white p-3">
      <p className="text-sm font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
