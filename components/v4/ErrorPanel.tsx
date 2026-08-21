import type { ResearchRunError } from "@/lib/v4/contracts";
import { ERROR_CODE_LABELS, formatDateTime } from "./labels";

/** 错误面板（纯展示 + 可恢复时的重试按钮）。 */
export function ErrorPanel({ error, onRetry }: { error: ResearchRunError; onRetry?: () => void }) {
  const label = ERROR_CODE_LABELS[error.code] ?? error.code;

  return (
    <section
      data-testid="error-panel"
      data-code={error.code}
      className={"rounded-2xl border p-4 " + (error.recoverable ? "border-amber-200 bg-amber-50/70" : "border-rose-200 bg-rose-50")}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">运行出错</h2>
        <span className={"rounded-full border px-2 py-0.5 text-xs font-semibold " + (error.recoverable ? "border-amber-300 bg-amber-100 text-amber-700" : "border-rose-300 bg-rose-100 text-rose-700")}>
          {error.recoverable ? "可恢复" : "不可恢复"}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-800">{label}</p>
      {error.safeMessage ? <p className="mt-1 text-sm leading-6 text-slate-600">{error.safeMessage}</p> : null}
      <p className="mt-2 text-[11px] text-slate-400">发生时间：{formatDateTime(error.occurredAt)}</p>
      {error.recoverable && onRetry ? (
        <button
          type="button"
          data-testid="error-retry-button"
          onClick={onRetry}
          className="mt-3 inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition"
        >
          重试
        </button>
      ) : null}
    </section>
  );
}
