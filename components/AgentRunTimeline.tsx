import type { AgentRunTimelineItem, AgentRunTimelineStatus } from "@/lib/agentRunTimeline";

const STATUS_LABELS: Record<AgentRunTimelineStatus, string> = {
  completed: "已完成",
  pending: "待确认",
  warning: "需留意",
  unavailable: "无记录",
};

const STATUS_CLASSES: Record<AgentRunTimelineStatus, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  warning: "border-rose-200 bg-rose-50 text-rose-700",
  unavailable: "border-slate-200 bg-slate-50 text-slate-500",
};

const DOT_CLASSES: Record<AgentRunTimelineStatus, string> = {
  completed: "bg-emerald-500 ring-emerald-100",
  pending: "bg-amber-400 ring-amber-100",
  warning: "bg-rose-500 ring-rose-100",
  unavailable: "bg-slate-300 ring-slate-100",
};

export function AgentRunTimeline({
  items,
  className = "",
}: {
  items: AgentRunTimelineItem[];
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/80 bg-white p-4 ${className}`}
      data-testid="agent-run-timeline"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-base font-bold text-slate-950">Agent 执行过程</h4>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            从当前任务记录派生，不重新调用 AI，不写入数据库。
          </p>
        </div>
        <span className="w-fit rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
          7 段流程
        </span>
      </div>

      <ol className="mt-4 grid gap-2">
        {items.map((item, index) => (
          <li
            key={item.key}
            className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3"
          >
            <div className="flex flex-col items-center">
              <span
                className={`flex size-7 items-center justify-center rounded-full text-xs font-bold text-white ring-4 ${DOT_CLASSES[item.status]}`}
              >
                {index + 1}
              </span>
              {index < items.length - 1 ? <span className="mt-2 h-full min-h-4 w-px bg-slate-200" /> : null}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-slate-900">{item.label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_CLASSES[item.status]}`}>
                  {STATUS_LABELS[item.status]}
                </span>
              </div>
              <p className="mt-1 break-words text-sm leading-6 text-slate-600">{item.summary}</p>
              {item.evidence ? (
                <p className="mt-1 break-words text-xs font-semibold text-slate-400">证据：{item.evidence}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
