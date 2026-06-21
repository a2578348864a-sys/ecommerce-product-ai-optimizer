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

/* ── Main component ────────────────────────────── */

export function WorkflowClient() {
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const [productName, setProductName] = useState("");
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
  const finalReportRef = useRef<HTMLElement | null>(null);
  const reviewRef = useRef<HTMLElement | null>(null);
  const lastAutoScrolledWorkflowId = useRef<string | null>(null);
  const reviewStepKeys: StepKey[] = ["sourcing", "risk", "summary", "listing"];
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const allReviewed = reviewStepKeys.every((k) => reviewConfirmed[k]);

  const toggleReviewConfirm = useCallback((key: string) => {
    setReviewConfirmed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

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
    try {
      const res = await fetch("/api/workflows/product-analysis/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessPassword, workflowResult: result }),
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

  const resetRun = useCallback(() => {
    setResult(null);
    setError("");
    setSavedTaskId(null);
    setSaveError("");
    setSavingToTasks(false);
    setReviewConfirmed({});
    setProgressExpanded(false);
    lastAutoScrolledWorkflowId.current = null;
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

    resetRun();
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
              </div>
              <span className="linear-pill linear-pill-brand px-3 py-1 text-sm">
                Phase 2-A
              </span>
            </div>
            <WorkspaceMobileNav />
          </header>

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
                    onClick={resetRun}
                    className="linear-button inline-flex h-10 w-full items-center justify-center text-sm"
                  >
                    重新分析
                  </button>
                )}
              </div>
            </div>

            {/* Access password */}
            <div className="mt-4">
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                访问密码 <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                value={accessPassword}
                onChange={(e) => setAccessPassword(e.target.value)}
                placeholder="输入访问密码（本会话内有效）"
                disabled={running}
                className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
              />
            </div>

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

          {hasResult && result && (
            <section className="surface-card border-teal-200 bg-teal-50/70 p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-teal-800">
                    ✅ 分析完成：{result.productName}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-teal-700">
                    已生成最终报告和人工复核清单，请先查看最终报告，再展开各步骤复核。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={scrollToFinalReport}
                    className="linear-button-primary inline-flex h-10 items-center justify-center px-3 text-xs font-semibold"
                  >
                    查看最终报告
                  </button>
                  <button
                    type="button"
                    onClick={scrollToReview}
                    className="linear-button-soft inline-flex h-10 items-center justify-center px-3 text-xs font-semibold"
                  >
                    查看人工复核
                  </button>
                  <button
                    type="button"
                    onClick={copyMarkdown}
                    className="linear-button-soft inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                  >
                    <Copy className="size-3.5" />
                    复制报告
                  </button>
                  {savedTaskId ? (
                    <Link
                      href={`/tasks/${savedTaskId}`}
                      className="linear-button inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                    >
                      <CheckCircle2 className="size-3.5" />
                      查看任务
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={saveToTasks}
                      disabled={savingToTasks}
                      className="linear-button inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold disabled:opacity-50"
                    >
                      {savingToTasks ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          保存中…
                        </>
                      ) : (
                        <>
                          <Save className="size-3.5" />
                          保存到任务中心
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {saveError && (
                <p className="mt-2 text-xs text-rose-600">{saveError}</p>
              )}
            </section>
          )}

          {/* Final report */}
          {hasResult && report && (
            <section ref={finalReportRef} className="surface-card p-4 sm:p-5 scroll-mt-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">最终选品报告</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    先看结论、风险等级、是否可小单测试，再进入人工复核区逐项确认。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyMarkdown}
                    className="linear-button-soft inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                  >
                    <Copy className="size-3.5" />
                    复制报告
                  </button>
                  <button
                    type="button"
                    onClick={exportMarkdown}
                    className="linear-button-soft inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                  >
                    <Download className="size-3.5" />
                    导出 Markdown
                  </button>
                  {savedTaskId ? (
                    <Link
                      href={`/tasks/${savedTaskId}`}
                      className="linear-button-primary inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                    >
                      <CheckCircle2 className="size-3.5" />
                      已保存，查看任务详情
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={saveToTasks}
                      disabled={savingToTasks}
                      className="linear-button inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold disabled:opacity-50"
                    >
                      {savingToTasks ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          保存中…
                        </>
                      ) : (
                        <>
                          <Save className="size-3.5" />
                          保存到任务中心
                        </>
                      )}
                    </button>
                  )}
                  <Link
                    href="/tasks"
                    className="linear-button inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                  >
                    <ClipboardList className="size-3.5" />
                    任务中心
                  </Link>
                </div>
                {saveError && (
                  <p className="mt-2 text-xs text-rose-600">{saveError}</p>
                )}
              </div>

              {/* Review gate banner */}
              {!allReviewed && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  ⚠️ AI 初步结论，尚未完成人工确认。请在下方人工复核区逐项确认后，再用于采购/上架决策。
                </div>
              )}

              {/* Verdict banner */}
              <div className={`rounded-2xl border p-4 ${
                report.riskLevel === "red"
                  ? "border-rose-200 bg-rose-50"
                  : report.riskLevel === "green"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
              }`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${
                    report.riskLevel === "red" ? "bg-rose-100 text-rose-700" :
                    report.riskLevel === "green" ? "bg-emerald-100 text-emerald-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>
                    {report.riskLevel === "red" ? <ShieldAlert className="size-5" /> :
                     report.riskLevel === "green" ? <CheckCircle2 className="size-5" /> :
                     <AlertCircle className="size-5" />}
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">结论</p>
                    <h3 className="mt-1 text-base font-bold text-slate-950">{report.finalVerdict}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${riskLevelLabel(report.riskLevel).cls}`}>
                        风险等级：{riskLevelLabel(report.riskLevel).text}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                        新手适配：{report.beginnerFit}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        report.canTestSmallBatch
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {report.canTestSmallBatch ? "可小单测试" : "建议先完成合规评估"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Must check before listing */}
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="size-4 text-rose-600" />
                  <h3 className="text-sm font-bold text-slate-950">上线前必须检查</h3>
                </div>
                <ul className="space-y-1.5">
                  {report.mustCheckBeforeListing.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Next steps */}
              <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="size-4 text-teal-600" />
                  <h3 className="text-sm font-bold text-slate-950">下一步动作</h3>
                </div>
                <ul className="space-y-1.5">
                  {report.nextSteps.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Manual review checklist */}
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ClipboardList className="size-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-950">人工确认清单</h3>
                </div>
                <ul className="space-y-1.5">
                  {report.manualReviewChecklist.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Cost guard */}
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">
                  AI 调用统计：{result.costGuard.aiStepsCompleted}/{result.costGuard.aiStepsRequested} 成功
                  {result.costGuard.fallbackSteps > 0 ? `，${result.costGuard.fallbackSteps} 使用兜底` : ""}
                  <span className="mx-2">·</span>
                  工作流 ID：{result.workflowId}
                </p>
              </div>
            </section>
          )}

          {/* ── Review section ── */}
          {hasResult && result && (
            <section ref={reviewRef} className="surface-card p-4 sm:p-5 scroll-mt-4">
              <h2 className="mb-1 text-lg font-semibold text-slate-950">人工复核区</h2>
              <p className="mb-4 text-sm text-slate-500">
                以下是 AI 每一步的详细依据，请逐项展开确认。AI 结论不能替代人工采购和合规判断。
              </p>
              <div className="space-y-3">
                {reviewStepKeys.map((key) => (
                  <StepReviewCard
                    key={key}
                    stepKey={key}
                    result={result}
                    confirmed={!!reviewConfirmed[key]}
                    onToggle={() => toggleReviewConfirm(key)}
                  />
                ))}
              </div>
              <div className={`mt-4 rounded-xl border p-3 text-sm ${allReviewed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {allReviewed
                  ? "✓ 4/4 已完成人工确认，可作为下一步测试参考"
                  : "⚠️ 请完成 4 个步骤人工确认后，再把结论用于采购/上架决策"}
              </div>
            </section>
          )}

          {/* Progress stepper */}
          {(running || hasResult) && (
            <section className="surface-card p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">分析进度</h2>
                  {hasResult && result ? (
                    <p className="mt-1 text-sm text-slate-500">{progressSummaryText}</p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">正在按步骤生成报告，请稍候。</p>
                  )}
                </div>
                {hasResult && !running && (
                  <button
                    type="button"
                    onClick={() => setProgressExpanded((expanded) => !expanded)}
                    className="linear-button-soft inline-flex h-9 items-center justify-center px-3 text-xs font-semibold"
                  >
                    {progressExpanded ? "收起完整进度" : "展开完整进度"}
                  </button>
                )}
              </div>

              {hasResult && !running && !progressExpanded ? (
                <div className={`mt-3 flex items-center gap-2 rounded-xl border p-3 text-sm ${
                  progressHasIssues
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}>
                  {progressHasIssues ? <AlertCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
                  <span className="font-semibold">{progressSummaryText}</span>
                  <span className="text-xs opacity-80">完整过程已折叠，最终报告和人工复核在上方。</span>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {STEPS.map((step) => {
                    const status = stepStatuses[step.key] || "pending";
                    return (
                      <div
                        key={step.key}
                        className={`flex items-start gap-3 rounded-xl border p-3 ${
                          status === "running"
                            ? "border-indigo-200 bg-indigo-50/60"
                            : status === "fallback"
                              ? "border-amber-200 bg-amber-50/60"
                              : status === "failed"
                                ? "border-rose-200 bg-rose-50/60"
                                : status === "completed"
                                  ? "border-emerald-100 bg-emerald-50/40"
                                  : "border-slate-100 bg-slate-50/40"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          <StepIcon status={status} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{step.label}</span>
                            <StepStatusLabel status={status} />
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>
                          {status !== "pending" && result?.steps.find((s) => s.key === step.key)?.summary && (
                            <p className="mt-1 text-xs leading-5 text-slate-600 line-clamp-2">
                              {result.steps.find((s) => s.key === step.key)?.summary}
                            </p>
                          )}
                          {result?.steps.find((s) => s.key === step.key)?.warnings?.length ? (
                            <div className="mt-1">
                              {result.steps.find((s) => s.key === step.key)!.warnings.map((w, i) => (
                                <p key={i} className="text-xs text-amber-600">{w}</p>
                              ))}
                            </div>
                          ) : null}
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
