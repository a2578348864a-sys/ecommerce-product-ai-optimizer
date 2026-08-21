import type { ResearchRunStatus } from "@/lib/v4/contracts";
import { STATUS_LABELS, statusToneClass } from "./labels";

/** 运行状态徽标（纯展示）。 */
export function RunStatusBadge({ status }: { status: ResearchRunStatus }) {
  return (
    <span
      data-testid="run-status-badge"
      data-status={status}
      className={"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold " + statusToneClass(status)}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
