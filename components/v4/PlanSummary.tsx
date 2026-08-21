import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { formatDateTime } from "./labels";

/** 研究计划摘要：计划版本、自动修订次数与计划相关事件。 */
export function PlanSummary({ run, events }: { run: ResearchRunState; events: ResearchRunEvent[] }) {
  const planEvents = events.filter(
    (event) => event.type === "plan_created" || event.type === "plan_revised",
  );

  return (
    <section data-testid="plan-summary" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">研究计划</h2>
        <span className="text-xs text-slate-500">计划版本 rev.{run.planRevision}</span>
      </div>

      {run.automaticPlanRevisionCount > 0 ? (
        <p className="mt-1 text-xs text-slate-500">自动修订次数：{run.automaticPlanRevisionCount}</p>
      ) : null}

      {planEvents.length ? (
        <ul className="mt-2 space-y-1">
          {planEvents.map((event) => (
            <li key={event.seq} data-plan-event={event.type} className="flex items-baseline gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">
                {event.type === "plan_created" ? "创建计划" : "修订计划"}
              </span>
              <span className="text-slate-400">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">暂无计划记录。</p>
      )}
    </section>
  );
}
