import type { ResearchRunState } from "@/lib/v4/contracts";
import { InterruptActions } from "./InterruptActions";
import { WAIT_KIND_LABELS, formatDateTime } from "./labels";

/** 等待人工中断面板：展示 wait 信息与决策按钮。 */
export function InterruptPanel({ run, onAction }: { run: ResearchRunState; onAction?: () => void }) {
  const wait = run.wait;
  if (!wait) return null;

  return (
    <section
      data-testid="interrupt-panel"
      data-wait-kind={wait.kind}
      className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">等待人工处理</h2>
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
          {WAIT_KIND_LABELS[wait.kind] ?? wait.kind}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-800">原因码：{wait.reasonCode}</p>
      {wait.instructions ? <p className="mt-1 text-sm leading-6 text-slate-600">{wait.instructions}</p> : null}
      <p className="mt-2 text-[11px] text-slate-400">请求时间：{formatDateTime(wait.requestedAt)}</p>
      <InterruptActions runId={run.runId} wait={wait} revision={run.revision} onAction={onAction} />
    </section>
  );
}
