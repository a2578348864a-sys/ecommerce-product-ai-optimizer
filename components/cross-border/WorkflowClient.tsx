"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Lightbulb,
  Loader2,
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

  const resetRun = useCallback(() => {
    setResult(null);
    setError("");
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

          {/* Progress stepper — always visible when running or has result */}
          {(running || hasResult) && (
            <section className="surface-card p-4 sm:p-5">
              <h2 className="mb-4 text-lg font-semibold text-slate-950">分析进度</h2>
              <div className="space-y-2">
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
            </section>
          )}

          {/* Final report */}
          {hasResult && report && (
            <section className="surface-card p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">最终报告</h2>
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
                  <Link
                    href="/tasks"
                    className="linear-button inline-flex h-10 items-center gap-2 px-3 text-xs font-semibold"
                  >
                    <ClipboardList className="size-3.5" />
                    任务中心
                  </Link>
                </div>
              </div>

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
                    <h3 className="text-base font-bold text-slate-950">{report.finalVerdict}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${riskLevelLabel(report.riskLevel).cls}`}>
                        {riskLevelLabel(report.riskLevel).text}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                        {report.beginnerFit}
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
