"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { platformLabels } from "@/lib/types";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import {
  decisionStatusOptions,
  getDecisionStatusOption,
  type DecisionStatus,
} from "@/lib/tasks/decisionStatus";
import { TASK_TYPE_LABEL_MAP, TASK_AGENT_LABEL_MAP } from "@/lib/taskConcepts";

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
  return source === "ai" ? "AI 深度拆解" : "mock 模拟拆解";
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
          <h3 className="text-sm font-semibold text-slate-950">批量队列来源</h3>
          <p className="mt-2 text-sm font-semibold text-indigo-700">
            批量任务 {batchMeta.batchIndex}/{batchMeta.batchTotal}
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
            {riskLevel === "green" ? "低风险" : riskLevel === "red" ? "高风险" : "需注意"}
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

export function TaskRecordDetail({ id }: { id: string }) {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const router = useRouter();
  const [record, setRecord] = useState<TaskCenterItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [updatingDecision, setUpdatingDecision] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");

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
          headers: { "x-access-password": accessPassword },
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
  }, [id, accessPassword, isAccessPasswordReady]);

  const resultJson = useMemo(() => {
    if (!record) return "";
    try {
      return JSON.stringify(record.result, null, 2);
    } catch {
      return "结果内容暂时无法格式化。";
    }
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
        headers: { "x-access-password": accessPassword },
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
          "x-access-password": accessPassword,
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

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Task Detail</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">任务详情</h1>
                <p className="mt-1 text-sm text-slate-500">查看单条任务的输入、Agent 摘要、执行状态和完整结果。</p>
              </div>
              <Link
                href="/tasks"
                className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
              >
                返回任务中心
              </Link>
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
                返回任务列表
              </Link>
            </section>
          ) : record ? (
            <section className="surface-card p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-teal-700">Task Center Record</p>
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
                          批量任务 {batchMeta.batchIndex}/{batchMeta.batchTotal}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
                    {record.score}/100
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-700">
                    {record.level}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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

              <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="linear-panel p-4">
                  <p className="text-sm font-semibold text-slate-950">执行步骤预留</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {["输入素材", "Agent 分析", "保存任务", "人工确认"].map((step, index) => (
                      <div key={step} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <span className="text-[11px] font-semibold text-slate-400">0{index + 1}</span>
                        <p className="mt-1 text-sm font-semibold text-slate-800">{step}</p>
                      </div>
                    ))}
                  </div>
                  <p className="muted-text mt-3 text-xs leading-5">失败原因、重试、继续执行、多 Agent 串联均为后续能力，本页不触发真实动作。</p>
                </div>
                <div className="linear-panel p-4">
                  <p className="text-sm font-semibold text-slate-950">人工决策状态</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    AI 结果仅供初筛，关键动作需人工确认后再继续。
                  </p>
                  <select
                    value={record.decisionStatus}
                    onChange={(event) => void updateDecisionStatus(event.target.value as DecisionStatus)}
                    disabled={updatingDecision}
                    className="input-soft mt-3 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {decisionStatusOptions.filter((option) => option.value).map((status) => (
                      <option key={status.value} value={status.value}>{status.shortLabel}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {getDecisionStatusOption(record.decisionStatus).description}
                  </p>
                  {decisionMessage ? (
                    <p className="mt-2 text-xs font-semibold text-teal-700">{decisionMessage}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <WorkflowNextStepCard taskType={record.type} />
                <ManualReviewChecklist />
              </div>

              <div className="mt-5 rounded-2xl border border-white/80 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-950">输入素材</h3>
                {record.productUrl ? (
                  <p className="mt-3 break-all text-xs text-slate-500">链接：{record.productUrl}</p>
                ) : null}
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                  {record.materialText}
                </p>
              </div>

              {/* Workflow-specific result rendering */}
              {record.type === "workflow" && typeof record.result === "object" && record.result !== null && !Array.isArray(record.result) ? (
                <WorkflowResultSection result={record.result as Record<string, unknown>} />
              ) : (
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <ResultList title="核心卖点" items={getStringArray(record.result, "sellingPoints")} />
                  <ResultList title="用户痛点" items={getStringArray(record.result, "painPoints")} />
                  <ResultList title="开头钩子" items={getStringArray(record.result, "hooks")} />
                  <ResultList title="标题建议" items={getStringArray(record.result, "titleSuggestions")} />
                  <ResultList title="短视频开头" items={getStringArray(record.result, "videoOpenings")} />
                  <ResultList title="评论区话题" items={getStringArray(record.result, "commentTriggers")} />
                  <ResultList title="转化优化" items={getStringArray(record.result, "conversionSuggestions")} />
                  <ResultList title="风险提醒" items={getStringArray(record.result, "risks")} />
                </div>
              )}

              <div className="mt-5 rounded-2xl border border-white/80 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-950">完整结果 JSON</h3>
                <p className="mt-1 text-xs text-slate-500">用于复核 AI/mock 返回结构，长内容可以滚动查看。</p>
                <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {resultJson}
                </pre>
              </div>

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
                  返回任务中心
                </Link>
                <button type="button" disabled className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  继续执行（规划中）
                </button>
                {deleteError ? <p className="text-sm font-bold text-rose-700">{deleteError}</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
