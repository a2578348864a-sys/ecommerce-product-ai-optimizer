import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { BudgetMeter } from "./BudgetMeter";
import { CancelResumeControls } from "./CancelResumeControls";
import { ErrorPanel } from "./ErrorPanel";
import { EventStream } from "./EventStream";
import { InterruptPanel } from "./InterruptPanel";
import { NodeFlow } from "./NodeFlow";
import { PlanSummary } from "./PlanSummary";
import { RunStatusBadge } from "./RunStatusBadge";
import { formatDateTime } from "./labels";

type RunConsoleViewProps = {
  run: ResearchRunState;
  events: ResearchRunEvent[];
  onRefresh?: () => void;
  onRetry?: () => void;
};

/** Run Console 详情页内容（纯展示；由 RunConsoleClient 注入数据与回调）。 */
export function RunConsoleView({ run, events, onRefresh, onRetry }: RunConsoleViewProps) {
  return (
    <div data-testid="run-console-view" className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <RunStatusBadge status={run.status} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">运行 {run.runId}</p>
            <p className="text-xs text-slate-500">候选 {run.candidateId} · 版本 rev.{run.revision}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400">更新 {formatDateTime(run.updatedAt)}</span>
            {onRefresh ? (
              <button
                type="button"
                data-testid="refresh-button"
                onClick={onRefresh}
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                刷新
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <PlanSummary run={run} events={events} />
      {run.wait ? <InterruptPanel run={run} onAction={onRefresh} /> : null}
      {run.lastError ? <ErrorPanel error={run.lastError} onRetry={onRetry} /> : null}
      <NodeFlow currentNode={run.currentNode} />
      <BudgetMeter budget={run.budget} />
      <CancelResumeControls runId={run.runId} status={run.status} revision={run.revision} onAction={onRefresh} />
      <EventStream events={events} />
    </div>
  );
}
