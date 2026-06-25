"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Lightbulb,
  Loader2,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useAccessPassword, canRequestWithAccessPassword } from "@/lib/client/accessPassword";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from "@/hooks/useLocalDraft";
import { ProfitSnapshotCard, type ProfitSnapshot } from "@/components/cross-border/ProfitSnapshotCard";
import { RiskReviewChecklistCard } from "@/components/cross-border/RiskReviewChecklistCard";
import type { RiskReviewSnapshot } from "@/lib/riskReview";

/* ── Types ─────────────────────────────────────── */

type StepKey = "normalize" | "sourcing" | "risk" | "summary" | "listing" | "report";
type StepStatus = "pending" | "running" | "completed" | "fallback" | "failed";

type StepDisplay = {
  key: StepKey;
  label: string;
  description: string;
};

type ApiStep = {
  key: StepKey;
  label: string;
  status: "completed" | "fallback" | "failed";
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
  ok: boolean;
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

export type WorkflowSourceMeta = {
  source: "opportunity";
  opportunityTitle: string;
  opportunitySource?: string;
  opportunityScore?: number;
  keyword?: string;
  importedAt: string;
  /** Phase 4-E.1: enhanced candidate context */
  candidateType?: string;
  sourceUrl?: string;
  candidateId?: string;
};

type ApiErrorResponse = {
  ok: false;
  error: { code: string; message: string };
};

const STEPS: StepDisplay[] = [
  { key: "normalize", label: "标准化输入", description: "清洗商品名，记录来源" },
  { key: "sourcing", label: "货源判断", description: "采购难度、搜索词、价格带" },
  { key: "risk", label: "风险排查", description: "认证、侵权、物流、售后" },
  { key: "summary", label: "小白结论", description: "综合评分、推荐等级" },
  { key: "listing", label: "上架文案/关键词", description: "标题、卖点、关键词" },
  { key: "report", label: "生成最终报告", description: "聚合结论和下一步建议" },
];

/* ── Step icon helper ──────────────────────────── */

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-5 text-emerald-500" />;
    case "running":
      return <Loader2 className="size-5 animate-spin text-indigo-500" />;
    case "fallback":
      return <AlertCircle className="size-5 text-amber-500" />;
    case "failed":
      return <XCircle className="size-5 text-rose-500" />;
    default:
      return <div className="size-5 rounded-full border-2 border-slate-200" />;
  }
}

function StepStatusLabel({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed": return <span className="text-xs font-semibold text-emerald-600">已完成</span>;
    case "running": return <span className="text-xs font-semibold text-indigo-600">运行中</span>;
    case "fallback": return <span className="text-xs font-semibold text-amber-600">使用兜底</span>;
    case "failed": return <span className="text-xs font-semibold text-rose-600">失败</span>;
    default: return <span className="text-xs text-slate-400">等待中</span>;
  }
}

function riskLevelLabel(level: string) {
  if (level === "green") return { text: "低风险", cls: "bg-emerald-100 text-emerald-700" };
  if (level === "red") return { text: "高风险", cls: "bg-rose-100 text-rose-700" };
  return { text: "需注意", cls: "bg-amber-100 text-amber-700" };
}

/* ── Step Review Card ──────────────────────────── */

function s(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function sa(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

const REVIEW_STEP_LABELS: Record<string, string> = {
  sourcing: "货源判断",
  risk: "风险排查",
  summary: "小白结论",
  listing: "上架文案",
};

const FEASIBILITY_LABELS: Record<string, string> = { high: "容易找到", medium: "一般", low: "较难" };
const BARRIER_LABELS: Record<string, string> = { low: "低", medium: "中", high: "高" };
const FIT_LABELS: Record<string, string> = { high: "适合", medium: "一般", low: "不适合" };
const ENTRY_LABELS: Record<string, string> = { beginner: "新手可做", intermediate: "有经验可做", experienced: "需资深运营" };

function StepReviewCard({
  stepKey,
  result,
  confirmed,
  onToggle,
}: {
  stepKey: string;
  result: ApiWorkflowResult;
  confirmed: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = stepKey === "sourcing" ? result.sourcing
    : stepKey === "risk" ? result.risk
    : stepKey === "summary" ? result.summary
    : stepKey === "listing" ? result.listing
    : null;

  const stepInfo = result.steps?.find((s) => s.key === stepKey);
  const status = stepInfo?.status || "completed";
  const isFallback = status === "fallback" || status === "failed";

  if (!data && status === "completed") return null;

  return (
    <div className={`rounded-xl border p-3 ${confirmed ? "border-emerald-200 bg-emerald-50/60" : isFallback ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-400 shrink-0">
            {REVIEW_STEP_LABELS[stepKey] || stepKey}
          </span>
          {isFallback && <span className="text-xs font-semibold text-amber-600">⚠ 使用兜底</span>}
          {confirmed && <span className="text-xs font-semibold text-emerald-600">✓ 已确认</span>}
        </div>
        <span className="text-xs text-slate-400 shrink-0">{expanded ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {expanded && data && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
          {stepKey === "sourcing" && (
            <>
              <p className="leading-6">{s(data.summary) || "暂未获取到货源分析。"}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">可行性：{FEASIBILITY_LABELS[s(data.feasibility)] || s(data.feasibility) || "-"}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5">新手适配：{FIT_LABELS[s(data.beginnerFit)] || s(data.beginnerFit) || "-"}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5">合规门槛：{BARRIER_LABELS[s(data.complianceBarrier)] || s(data.complianceBarrier) || "-"}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5">物流难度：{BARRIER_LABELS[s(data.logisticsDifficulty)] || s(data.logisticsDifficulty) || "-"}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5">入门级别：{ENTRY_LABELS[s(data.suggestedEntryLevel)] || s(data.suggestedEntryLevel) || "-"}</span>
              </div>
              {sa(data.searchKeywords).length > 0 && (
                <p className="text-xs text-slate-500">关键词：{sa(data.searchKeywords).slice(0, 6).join("、")}</p>
              )}
            </>
          )}
          {stepKey === "risk" && (
            <>
              <p className="leading-6">{s(data.summary) || "暂未获取到风险分析。"}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 ${s(data.overallLevel) === "green" ? "bg-emerald-100 text-emerald-700" : s(data.overallLevel) === "red" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                  风险等级：{s(data.overallLevel) === "green" ? "低" : s(data.overallLevel) === "red" ? "高" : "中"}
                </span>
                {data.beginnerFriendly === true && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">新手友好</span>}
              </div>
              {sa(data.blacklistMatches).length > 0 && (
                <p className="text-xs text-rose-600">命中风险标签：{sa(data.blacklistMatches).join("、")}</p>
              )}
              {sa(data.complianceWarnings).length > 0 && (
                <p className="text-xs text-amber-600">合规提示：{sa(data.complianceWarnings).join("；")}</p>
              )}
            </>
          )}
          {stepKey === "summary" && (
            <>
              <p className="leading-6">{s(data.summary) || "暂未获取到综合结论。"}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700">结论：{s(data.verdict)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5">置信度：{s(data.confidence)}</span>
                {data.canTestSmallBatch !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 ${data.canTestSmallBatch ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {data.canTestSmallBatch ? "可小单测试" : "建议先评估"}
                  </span>
                )}
              </div>
              {sa(data.downgradeReasons).length > 0 && (
                <div className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs text-amber-700">
                  <p className="font-semibold">安全规则降级：</p>
                  {sa(data.downgradeReasons).map((r, i) => <p key={i}>- {r}</p>)}
                </div>
              )}
            </>
          )}
          {stepKey === "listing" && (
            <>
              {s(data.title) && <p className="font-semibold text-slate-800">{s(data.title)}</p>}
              {sa(data.keywords).length > 0 && (
                <p className="text-xs text-slate-500">关键词：{sa(data.keywords).slice(0, 8).join("、")}</p>
              )}
              {sa(data.complianceNotes).length > 0 && (
                <div className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs text-amber-700">
                  {sa(data.complianceNotes).map((n, i) => <p key={i}>- {n}</p>)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Confirm checkbox */}
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2">
        <input
          type="checkbox"
          id={`review-${stepKey}`}
          checked={confirmed}
          onChange={onToggle}
          className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <label htmlFor={`review-${stepKey}`} className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
          已人工确认{REVIEW_STEP_LABELS[stepKey] || stepKey}结果
        </label>
      </div>
    </div>
  );
}

/* ── Persistence ───────────────────────────────── */

const WORKFLOW_SINGLE_RUN_KEY = "qx:workflow-single-run:v1";
const WORKFLOW_SINGLE_RUN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const WORKFLOW_SINGLE_RUN_VERSION = 1;

type WorkflowSingleRun = {
  version: number;
  runId: string;
  completedAt: number;
  productName: string;
  result: ApiWorkflowResult | null;
  stepStatuses: Record<StepKey, StepStatus>;
  savedTaskId: string | null;
  reviewConfirmed: Record<string, boolean>;
  sourceMeta: WorkflowSourceMeta | null;
  riskReviewSnapshot: RiskReviewSnapshot | null;
};

const emptyRun: WorkflowSingleRun = {
  version: WORKFLOW_SINGLE_RUN_VERSION,
  runId: "",
  completedAt: 0,
  productName: "",
  result: null,
  stepStatuses: {} as Record<StepKey, StepStatus>,
  savedTaskId: null,
  reviewConfirmed: {},
  sourceMeta: null,
  riskReviewSnapshot: null,
};

/* ── Main component ────────────────────────────── */

export function WorkflowClient({
  initialProductName,
  initialSourceMeta,
}: {
  initialProductName?: string;
  initialSourceMeta?: WorkflowSourceMeta | null;
}) {
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const [productName, setProductName] = useState(initialProductName ?? "");
  const [sourceMeta, setSourceMeta] = useState<WorkflowSourceMeta | null>(initialSourceMeta ?? null);
  const [running, setRunning] = useState(false);
  const [stepStatuses, setStepStatuses] = useState<Record<StepKey, StepStatus>>({
    normalize: "pending",
    sourcing: "pending",
    risk: "pending",
    summary: "pending",
    listing: "pending",
    report: "pending",
  });
  const [result, setResult] = useState<ApiWorkflowResult | null>(null);
  const [error, setError] = useState("");
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const [savingToTasks, setSavingToTasks] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [progressExpanded, setProgressExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [runReady, setRunReady] = useState(false);
  const [runRestored, setRunRestored] = useState(false);
  const [runNotice, setRunNotice] = useState("");
  const [profitSnapshot, setProfitSnapshot] = useState<ProfitSnapshot | null>(null);
  const [riskReviewSnapshot, setRiskReviewSnapshot] = useState<RiskReviewSnapshot | null>(null);
  const finalReportRef = useRef<HTMLElement | null>(null);
  const reviewRef = useRef<HTMLElement | null>(null);
  const lastAutoScrolledWorkflowId = useRef<string | null>(null);
  const reviewStepKeys: StepKey[] = ["sourcing", "risk", "summary", "listing"];
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const allReviewed = reviewStepKeys.every((k) => reviewConfirmed[k]);

  const toggleReviewConfirm = useCallback((key: string) => {
    setReviewConfirmed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Restore from localStorage on mount ──
  useEffect(() => {
    const stored = readLocalDraft<WorkflowSingleRun>(
      WORKFLOW_SINGLE_RUN_KEY,
      emptyRun,
      { ttlMs: WORKFLOW_SINGLE_RUN_TTL_MS, version: WORKFLOW_SINGLE_RUN_VERSION },
    );

    if (stored.restored && stored.value.result) {
      const run = stored.value;
      if (initialProductName?.trim() && run.productName.trim() !== initialProductName.trim()) {
        clearLocalDraft(WORKFLOW_SINGLE_RUN_KEY);
        setRunReady(true);
        return;
      }
      try {
        setProductName(run.productName || "");
        setSourceMeta(run.sourceMeta || initialSourceMeta || null);
        setResult(run.result);
        if (run.stepStatuses && Object.keys(run.stepStatuses).length > 0) {
          setStepStatuses(run.stepStatuses);
        }
        if (run.savedTaskId) setSavedTaskId(run.savedTaskId);
        if (run.reviewConfirmed && Object.keys(run.reviewConfirmed).length > 0) {
          setReviewConfirmed(run.reviewConfirmed);
        }
        if (run.riskReviewSnapshot) setRiskReviewSnapshot(run.riskReviewSnapshot);
        setRunRestored(true);
        setRunNotice("已从浏览器本地恢复上次分析结果，可直接查看报告和人工复核。未重新消耗 AI。");
      } catch {
        clearLocalDraft(WORKFLOW_SINGLE_RUN_KEY);
      }
    }

    setRunReady(true);
  }, [initialProductName, initialSourceMeta]);

  // ── Write to localStorage when result changes ──
  useEffect(() => {
    if (!runReady) return;
    if (!result) return;

    const run: WorkflowSingleRun = {
      version: WORKFLOW_SINGLE_RUN_VERSION,
      runId: result.workflowId || `run-${Date.now()}`,
      completedAt: Date.now(),
      productName,
      result,
      stepStatuses,
      savedTaskId,
      reviewConfirmed,
      sourceMeta,
      riskReviewSnapshot,
    };

    try {
      writeLocalDraft(WORKFLOW_SINGLE_RUN_KEY, run, {
        ttlMs: WORKFLOW_SINGLE_RUN_TTL_MS,
        version: WORKFLOW_SINGLE_RUN_VERSION,
      });
    } catch {
      // Silently ignore storage errors
    }
  }, [runReady, result, productName, stepStatuses, savedTaskId, reviewConfirmed, sourceMeta, riskReviewSnapshot]);

  const scrollToFinalReport = useCallback(() => {
    finalReportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToReview = useCallback(() => {
    reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  async function saveToTasks() {
    if (!result || savingToTasks || savedTaskId) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setSaveError("请先输入访问密码。");
      return;
    }
    setSavingToTasks(true);
    setSaveError("");

    const reviewState = {
      sourcingReviewed: !!reviewConfirmed.sourcing,
      riskReviewed: !!reviewConfirmed.risk,
      summaryReviewed: !!reviewConfirmed.summary,
      listingReviewed: !!reviewConfirmed.listing,
    };

    try {
      const res = await fetch("/api/workflows/product-analysis/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessPassword, workflowResult: result, reviewState, sourceMeta, profitSnapshot, riskReviewSnapshot }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSaveError(data.error?.message || "保存失败，请稍后重试。");
        return;
      }
      setSavedTaskId(data.data.id);
    } catch {
      setSaveError("网络异常，保存失败。");
    } finally {
      setSavingToTasks(false);
    }
  }

  const resetRun = useCallback((options?: { keepSourceMeta?: boolean }) => {
    setResult(null);
    setError("");
    setSavedTaskId(null);
    setSaveError("");
    setSavingToTasks(false);
    setReviewConfirmed({});
    setProgressExpanded(false);
    setDetailExpanded(false);
    setRunRestored(false);
    setRunNotice("");
    setProfitSnapshot(null);
    setRiskReviewSnapshot(null);
    if (!options?.keepSourceMeta) setSourceMeta(null);
    lastAutoScrolledWorkflowId.current = null;
    clearLocalDraft(WORKFLOW_SINGLE_RUN_KEY);
    setStepStatuses({
      normalize: "pending",
      sourcing: "pending",
      risk: "pending",
      summary: "pending",
      listing: "pending",
      report: "pending",
    });
  }, []);

  const handleRun = useCallback(async () => {
    if (running) return;
    const name = productName.trim();
    if (!name || name.length < 2) {
      setError("请输入至少 2 个字符的商品名称。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setError("访问密码缺失或已过期，请先输入访问密码。");
      return;
    }

    resetRun({ keepSourceMeta: true });
    setRunning(true);

    // Start step progression animation
    const stepOrder: StepKey[] = ["normalize", "sourcing", "risk", "summary", "listing", "report"];
    let currentIdx = 0;
    const progressTimer = setInterval(() => {
      if (currentIdx < stepOrder.length) {
        setStepStatuses((prev) => {
          const next = { ...prev };
          if (currentIdx > 0) next[stepOrder[currentIdx - 1]] = "completed";
          next[stepOrder[currentIdx]] = "running";
          return next;
        });
        currentIdx++;
      }
    }, 600);

    try {
      const res = await fetch("/api/workflows/product-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: name, source: "manual", accessPassword }),
      });

      const data = await res.json() as ApiWorkflowResult | ApiErrorResponse;

      clearInterval(progressTimer);

      if (!res.ok || !data.ok) {
        const err = data as ApiErrorResponse;
        setError(err.error?.message || "请求失败");
        // Mark all pending steps as failed
        setStepStatuses((prev) => {
          const next = { ...prev };
          for (const key of stepOrder) {
            if (next[key] === "running") next[key] = "failed";
          }
          return next;
        });
        return;
      }

      const wf = data as ApiWorkflowResult;

      // Set step statuses from API response
      const finalStatuses: Record<StepKey, StepStatus> = {} as Record<StepKey, StepStatus>;
      for (const step of wf.steps) {
        finalStatuses[step.key] = step.status === "completed" ? "completed" : step.status === "fallback" ? "fallback" : "failed";
      }
      // Fill in any missing steps
      for (const key of stepOrder) {
        if (!finalStatuses[key]) finalStatuses[key] = "completed";
      }
      setStepStatuses(finalStatuses);
      setProgressExpanded(false);
      setResult(wf);

      if (wf.warnings.length) {
        setError(wf.warnings.join("；"));
      }
    } catch (e) {
      clearInterval(progressTimer);
      setError(e instanceof Error ? e.message : "网络异常，请稍后重试。");
      setStepStatuses((prev) => {
        const next = { ...prev };
        for (const key of stepOrder) {
          if (next[key] === "running") next[key] = "failed";
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  }, [productName, accessPassword, isAccessPasswordReady, running, resetRun]);

  useEffect(() => {
    if (!result?.workflowId || !result.finalReport) return;
    if (lastAutoScrolledWorkflowId.current === result.workflowId) return;
    lastAutoScrolledWorkflowId.current = result.workflowId;
    window.requestAnimationFrame(() => {
      finalReportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [result?.workflowId, result?.finalReport]);

  // Build markdown for export
  function buildMarkdown() {
    if (!result) return "";
    const r = result.finalReport;
    const lines: string[] = [];
    lines.push(`# 单品一键分析报告：${result.productName}`);
    lines.push("");
    lines.push(`- 工作流 ID：${result.workflowId}`);
    lines.push(`- 状态：${result.status}`);
    lines.push(`- AI 调用：${result.costGuard.aiStepsCompleted}/${result.costGuard.aiStepsRequested} 成功，${result.costGuard.fallbackSteps} 兜底`);
    lines.push("");
    lines.push("## 工作流步骤");
    lines.push("");
    result.steps.forEach((s) => {
      const status = s.status === "completed" ? "✅" : s.status === "fallback" ? "⚠️" : "❌";
      lines.push(`- ${status} ${s.label}：${s.summary}`);
    });
    if (r) {
      lines.push("");
      lines.push("## 最终结论");
      lines.push("");
      lines.push(`- 结论：${r.finalVerdict}`);
      lines.push(`- 风险等级：${r.riskLevel}`);
      lines.push(`- 新手适配：${r.beginnerFit}`);
      lines.push(`- 可小单测试：${r.canTestSmallBatch ? "是" : "否"}`);
      lines.push("");
      lines.push("## 上线前必须检查");
      lines.push("");
      r.mustCheckBeforeListing.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
      lines.push("## 下一步动作");
      lines.push("");
      r.nextSteps.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
      lines.push("## 人工确认清单");
      lines.push("");
      r.manualReviewChecklist.forEach((item) => lines.push(`- [ ] ${item}`));
    }
    lines.push("");
    lines.push("---");
    lines.push("本报告由轻选 Agent 自动生成，AI 结论仅供辅助参考，关键决策需人工确认。");
    return lines.join("\n");
  }

  function copyMarkdown() {
    const md = buildMarkdown();
    if (!md) return;
    navigator.clipboard.writeText(md).catch(() => {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = md;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    });
  }

  function exportMarkdown() {
    const md = buildMarkdown();
    if (!md) return;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result?.productName || "分析报告"}-工作流报告.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasResult = result !== null;
  const report = result?.finalReport || null;
  const aiStepsCompleted = result?.costGuard.aiStepsCompleted ?? 0;
  const aiStepsRequested = result?.costGuard.aiStepsRequested ?? 4;
  const progressHasIssues = Object.values(stepStatuses).some((status) => status === "fallback" || status === "failed");
  const progressSummaryText = progressHasIssues
    ? `已完成 ${aiStepsCompleted}/${aiStepsRequested}，含兜底/异常步骤`
    : `已完成 ${aiStepsCompleted}/${aiStepsRequested}`;

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="单品分析" returnUrl="/workflow" />;
  }

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-4">
          <header className="workspace-header">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="section-title text-2xl">单品一键分析</h1>
                <p className="muted-text mt-1 text-sm">
                  输入一个商品，自动完成货源判断、风险排查、小白结论和上架准备。结果需人工确认。
                </p>
                <p className="mt-1.5 text-xs text-slate-400">
                  <Lightbulb className="inline size-3 mr-0.5 align-[-1px]" />
                  分析完成后，可一键保存到任务中心，继续人工复核、复制报告和运营跟进。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/workflow/batch" className="linear-button-soft inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  批量分析
                </Link>
                <Link href="/tasks" className="linear-button inline-flex h-10 items-center justify-center px-4 text-sm font-semibold">
                  任务中心
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Restore notice */}
          {runRestored && runNotice ? (
            <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-sm font-semibold text-teal-800" data-testid="single-run-notice">
              {runNotice}
            </div>
          ) : null}

          {/* Input area */}
          <section className="surface-card p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-950">输入商品</h2>
              <p className="mt-1 text-sm text-slate-600">
                填写商品名称或简短描述。本次会依次调用货源判断、风险排查、小白结论和上架文案生成（共 4 个 AI 步骤）。
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  商品名称 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => { setProductName(e.target.value); if (error) setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRun(); }}
                  placeholder="例如：桌面手机支架、硅胶折叠水杯、宠物慢食碗"
                  maxLength={120}
                  disabled={running}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                />
                <p className="mt-1 text-xs text-slate-400">{productName.length}/120</p>
                {sourceMeta ? (
                  <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-xs leading-5 text-teal-800">
                    <p className="font-semibold">已从机会雷达带入：{sourceMeta.opportunityTitle}</p>
                    <p>请确认商品名后再开始分析。{sourceMeta.opportunityScore !== undefined ? `来源分数 ${sourceMeta.opportunityScore}/100。` : ""}</p>
                    {/* Phase 4-E.1: enhanced context display */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {sourceMeta.opportunitySource && (
                        <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[11px] text-teal-700">
                          来源：{sourceMeta.opportunitySource}
                        </span>
                      )}
                      {sourceMeta.candidateType && (
                        <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                          {sourceMeta.candidateType === "product_candidate" ? "商品候选" : sourceMeta.candidateType === "category_hint" ? "类目提示" : sourceMeta.candidateType === "trend_signal" ? "趋势信号" : sourceMeta.candidateType}
                        </span>
                      )}
                      {sourceMeta.sourceUrl && (
                        <a href={sourceMeta.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[11px] text-teal-600 underline hover:text-teal-800">
                          查看来源
                        </a>
                      )}
                    </div>
                    <p className="mt-1.5 text-teal-600">后续分析结果需人工复核，不代表自动立项或推荐采购。</p>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={running || !productName.trim() || productName.trim().length < 2}
                  className="linear-button-primary inline-flex h-12 w-full items-center justify-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
                >
                  {running ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      分析中…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      开始一键分析
                    </>
                  )}
                </button>
                {hasResult && !running && (
                  <button
                    type="button"
                    onClick={() => resetRun()}
                    className="linear-button inline-flex h-10 w-full items-center justify-center text-sm"
                  >
                    重新分析
                  </button>
                )}
              </div>
            </div>

            {/* Access password — removed from this page, now only on home */}

            {/* Cost warning */}
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">AI 调用说明</p>
                  <p className="mt-1 text-xs leading-5 text-amber-700">
                    本次会依次调用 4 个 AI 步骤（货源判断、风险排查、小白结论、上架文案）。如果某一步失败，系统会使用保守兜底结果，不会中断全流程。结果仅供初筛参考，关键决策需人工确认。当前仅支持单品，不支持批量自动分析。
                  </p>
                </div>
              </div>
            </div>

            {error && !hasResult && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm text-rose-700">{error}</p>
              </div>
            )}
          </section>

          {/* ═══ Decision summary card — first thing user sees ═══ */}
          {hasResult && report && (
            <section className="surface-card border-teal-200 bg-gradient-to-b from-teal-50/80 to-white p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">分析完成 · {result?.productName}</p>

              {/* Big verdict */}
              <div className="mt-3">
                <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">
                  {report.finalVerdict}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${riskLevelLabel(report.riskLevel).cls}`}>
                    风险{riskLevelLabel(report.riskLevel).text}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                    新手{report.beginnerFit}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    report.canTestSmallBatch ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {report.canTestSmallBatch ? "可小单测试" : "建议先评估"}
                  </span>
                </div>
              </div>

              {/* Primary action */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {savedTaskId ? (
                  <Link href={`/tasks/${savedTaskId}`} className="linear-button-primary inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold">
                    <CheckCircle2 className="size-4" /> 已保存，查看任务详情
                  </Link>
                ) : (
                  <button type="button" onClick={saveToTasks} disabled={savingToTasks}
                    className="linear-button-primary inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold disabled:opacity-50">
                    {savingToTasks ? <><Loader2 className="size-4 animate-spin" /> 保存中…</> : <><Save className="size-4" /> 保存到任务中心</>}
                  </button>
                )}
                <button type="button" onClick={() => setDetailExpanded(!detailExpanded)}
                  className="linear-button inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold">
                  {detailExpanded ? "收起详细报告 ▲" : "查看详细报告 ▼"}
                </button>
                <Link href="/tasks" className="linear-button-soft inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold">
                  <ClipboardList className="size-4" /> 任务中心
                </Link>
                <button type="button" onClick={copyMarkdown}
                  className="linear-button-soft inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold">
                  <Copy className="size-3.5" /> 复制
                </button>
                <button type="button" onClick={exportMarkdown}
                  className="linear-button-soft inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold">
                  <Download className="size-3.5" /> 导出
                </button>
                <button type="button" onClick={() => resetRun()}
                  className="linear-button-soft inline-flex h-9 items-center px-3 text-xs font-semibold">
                  重新分析
                </button>
              </div>
              {saveError && <p className="mt-2 text-xs text-rose-600">{saveError}</p>}
              {savedTaskId && (
                <>
                  <p className={`mt-2 text-xs font-semibold ${allReviewed ? "text-emerald-600" : "text-amber-600"}`}>
                    {allReviewed ? "已保存为已复核任务" : "已保存为待复核任务"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    在任务中心可复核结论、复制报告、标记观察 / 测款 / 放弃。
                  </p>
                </>
              )}

              {/* Next steps — right under decision */}
              {report.nextSteps.length > 0 && (
                <div className="mt-5 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
                  <p className="text-sm font-bold text-teal-800">下一步做什么</p>
                  <ul className="mt-2 space-y-1.5">
                    {report.nextSteps.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-500" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Profit estimate — MVP: rough calculation, not real market data */}
              <div className="mt-5">
                <ProfitSnapshotCard
                  onChange={setProfitSnapshot}
                />
              </div>
              <div className="mt-5">
                <RiskReviewChecklistCard
                  onChange={setRiskReviewSnapshot}
                />
              </div>
            </section>
          )}

          {/* ═══ Detailed report — collapsible ═══ */}
          {hasResult && report && detailExpanded && (
            <section ref={finalReportRef} className="surface-card p-4 sm:p-5 scroll-mt-4">
              <h2 className="text-lg font-semibold text-slate-950">详细分析依据</h2>
              <p className="mt-1 text-sm text-slate-500">
                AI 对货源、风险、小白结论和上架文案的完整分析。结论仅供初筛参考，关键决策需人工确认。
              </p>

              {/* Verdict detail */}
              <div className={`mt-4 rounded-2xl border p-4 ${
                report.riskLevel === "red" ? "border-rose-200 bg-rose-50" :
                report.riskLevel === "green" ? "border-emerald-200 bg-emerald-50" :
                "border-amber-200 bg-amber-50"
              }`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${
                    report.riskLevel === "red" ? "bg-rose-100 text-rose-700" :
                    report.riskLevel === "green" ? "bg-emerald-100 text-emerald-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>
                    {report.riskLevel === "red" ? <ShieldAlert className="size-4" /> :
                     report.riskLevel === "green" ? <CheckCircle2 className="size-4" /> :
                     <AlertCircle className="size-4" />}
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI 结论</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{report.finalVerdict}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${riskLevelLabel(report.riskLevel).cls}`}>
                        风险{riskLevelLabel(report.riskLevel).text}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        新手{report.beginnerFit}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Must check before listing */}
              {report.mustCheckBeforeListing.length > 0 && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                  <p className="text-sm font-bold text-slate-950 mb-2">上线前必须检查</p>
                  <ul className="space-y-1">
                    {report.mustCheckBeforeListing.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700">
                        <AlertCircle className="mt-0.5 size-3 shrink-0 text-rose-400" /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cost guard */}
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-xs text-slate-500">
                  AI 调用：{result?.costGuard.aiStepsCompleted}/{result?.costGuard.aiStepsRequested} 成功
                  {result?.costGuard.fallbackSteps ? `，${result.costGuard.fallbackSteps} 兜底` : ""}
                  <span className="mx-2">·</span> {result?.workflowId}
                </p>
              </div>
            </section>
          )}

          {/* ═══ Step review: "上线前人工确认" ═══ */}
          {hasResult && result && (
            <section ref={reviewRef} className="surface-card p-4 sm:p-5 scroll-mt-4">
              <h2 className="text-lg font-semibold text-slate-950">上线前人工确认</h2>
              <p className="mt-1 text-sm text-slate-500">
                以下 4 项是 AI 每一步的判断依据。逐项展开确认后，结论才能作为采购/上架参考。
              </p>

              {!allReviewed && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  还不能作为最终采购/上架依据，请先完成上线前确认。
                </div>
              )}

              <div className="mt-4 space-y-3">
                {reviewStepKeys.map((key) => (
                  <StepReviewCard key={key} stepKey={key} result={result}
                    confirmed={!!reviewConfirmed[key]} onToggle={() => toggleReviewConfirm(key)} />
                ))}
              </div>

              <div className={`mt-4 rounded-xl border p-3 text-sm ${allReviewed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {allReviewed
                  ? "✓ 4/4 已完成确认，可作为下一步测试参考"
                  : `已完成 ${Object.values(reviewConfirmed).filter(Boolean).length}/4 项确认`}
              </div>
            </section>
          )}

          {/* ═══ Progress — at the bottom, collapsed when complete ═══ */}
          {(running || hasResult) && (
            <section className="surface-card p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-500">分析过程记录</h2>
                {hasResult && !running && (
                  <button type="button" onClick={() => setProgressExpanded(!progressExpanded)}
                    className="text-xs font-semibold text-slate-400 hover:text-teal-600">
                    {progressExpanded ? "收起 ▲" : "展开 ▼"}
                  </button>
                )}
              </div>

              {hasResult && !running && !progressExpanded ? (
                <p className="mt-1 text-xs text-slate-400">{progressSummaryText} · 过程已折叠</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {STEPS.map((step) => {
                    const status = stepStatuses[step.key] || "pending";
                    return (
                      <div key={step.key} className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-xs ${
                        status === "running" ? "border-indigo-200 bg-indigo-50/60" :
                        status === "fallback" ? "border-amber-200 bg-amber-50/60" :
                        status === "failed" ? "border-rose-200 bg-rose-50/60" :
                        status === "completed" ? "border-emerald-100 bg-emerald-50/40" :
                        "border-slate-100 bg-slate-50/40"
                      }`}>
                        <span className="mt-0.5 shrink-0"><StepIcon status={status} /></span>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-slate-700">{step.label}</span>
                          <StepStatusLabel status={status} />
                          {status !== "pending" && result?.steps.find((s) => s.key === step.key)?.summary && (
                            <p className="mt-0.5 text-slate-500 line-clamp-1">
                              {result.steps.find((s) => s.key === step.key)?.summary}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Quick links to individual pages */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>单项分析入口：</span>
            <Link href="/sourcing" className="hover:text-teal-600">货源判断</Link>
            <span>·</span>
            <Link href="/risk" className="hover:text-teal-600">风险排查</Link>
            <span>·</span>
            <Link href="/summary" className="hover:text-teal-600">小白结论</Link>
            <span>·</span>
            <Link href="/products/new" className="hover:text-teal-600">新品体检</Link>
            <span>·</span>
            <Link href="/opportunities" className="hover:text-teal-600">机会雷达</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
