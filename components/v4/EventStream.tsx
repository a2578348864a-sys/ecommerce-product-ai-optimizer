import type { ResearchRunEvent } from "@/lib/v4/contracts";
import { EVENT_TYPE_LABELS, NODE_LABELS, formatDateTime } from "./labels";

function summarizePayload(payloadJson: string): string {
  if (!payloadJson) return "";
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const keys = ["reason", "message", "decision", "summary", "note", "label"];
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  } catch {
    return "";
  }
}

/** 结构化事件流（纯展示；不含模型私有思维链，D6）。 */
export function EventStream({ events }: { events: ResearchRunEvent[] }) {
  if (!events.length) {
    return (
      <section data-testid="event-stream" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">事件流</h2>
        <p className="mt-2 text-sm text-slate-400">暂无事件记录。</p>
      </section>
    );
  }

  return (
    <section data-testid="event-stream" className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">事件流</h2>
      <ol className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.seq} data-event-type={event.type} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
            <span className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              #{event.seq}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">
                {EVENT_TYPE_LABELS[event.type] ?? event.type}
                <span className="ml-2 text-xs font-normal text-slate-400">{NODE_LABELS[event.node] ?? event.node}</span>
              </p>
              {summarizePayload(event.payloadJson) ? (
                <p className="mt-0.5 break-words text-xs leading-5 text-slate-600">{summarizePayload(event.payloadJson)}</p>
              ) : null}
            </div>
            <time className="shrink-0 text-[11px] text-slate-400">{formatDateTime(event.createdAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
