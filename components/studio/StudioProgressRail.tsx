import type { StudioProgressStep } from "@/lib/client/studioProgress";

export function StudioProgressRail({
  label,
  steps,
}: {
  label: string;
  steps: StudioProgressStep[];
}) {
  return (
    <ol
      aria-label={label}
      className="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr"
      data-testid="studio-progress-rail"
    >
      {steps.map((item, index) => (
        <li
          key={item.key}
          data-step-key={item.key}
          data-step-status={item.status}
          aria-current={item.status === "active" ? "step" : undefined}
          className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
            item.status === "completed"
              ? "border-teal-200 bg-teal-50 text-teal-800"
              : item.status === "active"
                ? "border-cyan-300 bg-cyan-50 text-cyan-900"
                : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              item.status === "completed"
                ? "bg-teal-600 text-white"
                : item.status === "active"
                  ? "bg-cyan-600 text-white"
                  : "bg-slate-200 text-slate-600"
            }`}
          >
            {item.loading ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : item.status === "completed" ? "✓" : String(index + 1).padStart(2, "0")}
          </span>
          <span className="truncate font-semibold">{item.label}</span>
          <span className="sr-only">
            {item.loading ? "进行中" : item.status === "completed" ? "已完成" : item.status === "active" ? "当前步骤" : "待开始"}
          </span>
        </li>
      ))}
    </ol>
  );
}
