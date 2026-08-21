import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { getRun } from "@/components/v4/api";
import { formatDateTime } from "@/components/v4/labels";
import { BudgetMeter } from "@/components/v4/BudgetMeter";
import { NodeFlow } from "@/components/v4/NodeFlow";
import { CancelResumeControls } from "@/components/v4/CancelResumeControls";
import { EventStream } from "@/components/v4/EventStream";

export function DebugView({
  run,
  events,
  loading,
  error,
}: {
  run: ResearchRunState | null;
  events: ResearchRunEvent[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div data-testid="debug-loading" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        开发调试加载中…
      </div>
    );
  }
  if (error || !run) {
    return (
      <div data-testid="debug-error" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-800">无法加载调试详情</p>
        <p className="mt-1 text-sm text-slate-600">{error ?? "运行不存在或未启用。"}</p>
      </div>
    );
  }

  const budget = run.budget;
  return (
    <div data-testid="debug-view" className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="eyebrow">V4 研究任务 · 开发调试</p>
        <h1 className="section-title text-2xl">开发调试详情（研究后台）</h1>
        <p className="mt-2 text-xs text-slate-500">运行 {run.runId}</p>
      </section>

      <section data-testid="debug-run-raw" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">原始运行信息</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-slate-500">状态</dt><dd className="break-all text-right font-mono text-slate-800">{run.status}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">当前节点</dt><dd className="break-all text-right font-mono text-slate-800">{run.currentNode}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">revision</dt><dd className="text-right font-mono text-slate-800">rev.{run.revision}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">planRevision</dt><dd className="text-right font-mono text-slate-800">{run.planRevision}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">candidateId</dt><dd className="break-all text-right font-mono text-slate-800">{run.candidateId}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">mode</dt><dd className="break-all text-right font-mono text-slate-800">{run.mode}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">evidenceRevision</dt><dd className="text-right font-mono text-slate-800">{run.evidenceRevision}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">factRevision</dt><dd className="text-right font-mono text-slate-800">{run.factRevision ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">policyPackVersion</dt><dd className="break-all text-right font-mono text-slate-800">{run.policyPackVersion ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">activeQuestionId</dt><dd className="break-all text-right font-mono text-slate-800">{run.activeQuestionId ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">createdAt</dt><dd className="text-right text-slate-800">{formatDateTime(run.createdAt)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">updatedAt</dt><dd className="text-right text-slate-800">{formatDateTime(run.updatedAt)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">completedAt</dt><dd className="text-right text-slate-800">{formatDateTime(run.completedAt)}</dd></div>
        </dl>
      </section>

      {run.wait ? (
        <section data-testid="debug-wait" className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <h2 className="text-sm font-bold text-slate-900">等待（原始码）</h2>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">kind</dt><dd className="break-all text-right font-mono text-slate-800">{run.wait.kind}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">reasonCode</dt><dd className="break-all text-right font-mono text-slate-800">{run.wait.reasonCode}</dd></div>
            {run.wait.instructions ? <div className="flex justify-between gap-3"><dt className="text-slate-500">instructions</dt><dd className="text-right text-slate-700">{run.wait.instructions}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-slate-500">requestedAt</dt><dd className="text-right text-slate-700">{formatDateTime(run.wait.requestedAt)}</dd></div>
          </dl>
        </section>
      ) : null}

      {run.lastError ? (
        <section data-testid="debug-error-raw" className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
          <h2 className="text-sm font-bold text-slate-900">最近错误（原始码）</h2>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">code</dt><dd className="break-all text-right font-mono text-slate-800">{run.lastError.code}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">recoverable</dt><dd className="text-right font-mono text-slate-800">{String(run.lastError.recoverable)}</dd></div>
            {run.lastError.safeMessage ? <div className="flex justify-between gap-3"><dt className="text-slate-500">safeMessage</dt><dd className="text-right text-slate-700">{run.lastError.safeMessage}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-slate-500">occurredAt</dt><dd className="text-right text-slate-700">{formatDateTime(run.lastError.occurredAt)}</dd></div>
          </dl>
        </section>
      ) : null}

      <section data-testid="debug-budget-raw" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">预算明细</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-slate-500">currency</dt><dd className="text-right font-mono text-slate-800">{budget.currency}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">usedCost / maxCost</dt><dd className="text-right font-mono text-slate-800">{budget.usedCost} / {budget.maxCost}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">usedBrowserSteps / max</dt><dd className="text-right font-mono text-slate-800">{budget.usedBrowserSteps} / {budget.maxBrowserSteps}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">usedLlmTokens / max</dt><dd className="text-right font-mono text-slate-800">{budget.usedLlmTokens} / {budget.maxLlmTokens}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">usedImageCalls / max</dt><dd className="text-right font-mono text-slate-800">{budget.usedImageCalls} / {budget.maxImageCalls}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">maxWallClockMs</dt><dd className="text-right font-mono text-slate-800">{budget.maxWallClockMs}</dd></div>
        </dl>
      </section>

      <section data-testid="debug-events-raw" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">原始事件流（{events.length} 条）</h2>
        {events.length > 0 ? (
          <ol className="mt-3 max-h-96 space-y-1 overflow-auto">
            {events.map((ev) => (
              <li key={ev.seq} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-500">#{ev.seq}</span>
                  <time className="shrink-0 text-slate-400">{formatDateTime(ev.createdAt)}</time>
                </div>
                <p className="mt-0.5 font-mono text-slate-700">type={ev.type} · node={ev.node}</p>
                <p className="mt-0.5 break-all font-mono text-slate-500">{ev.payloadJson}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-slate-400">暂无事件。</p>
        )}
      </section>

      <NodeFlow currentNode={run.currentNode} />
      <BudgetMeter budget={run.budget} />
      <CancelResumeControls runId={run.runId} status={run.status} revision={run.revision} onAction={undefined} />
      <EventStream events={events} />
    </div>
  );
}

export default function RunDebugPage() {
  const params = useParams<{ runId: string }>();
  const runId = typeof params?.runId === "string" ? params.runId : "";
  const [run, setRun] = useState<ResearchRunState | null>(null);
  const [events, setEvents] = useState<ResearchRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      setError("缺少运行标识。");
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getRun(runId)
      .then((data) => {
        if (!alive) return;
        setRun(data.run);
        setEvents(data.events ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "加载失败");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <div className="min-w-0">
          <DebugView run={run} events={events} loading={loading} error={error} />
        </div>
      </div>
    </main>
  );
}
