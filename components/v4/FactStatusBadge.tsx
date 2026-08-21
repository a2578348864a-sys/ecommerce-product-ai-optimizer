/**
 * V4 P3 — FactStatusBadge（Product Fact Gate 状态徽章）。
 *
 * 纯展示组件：把一条事实的确认状态渲染为中文徽章。
 * 状态取值与冻结契约 lib/v4/factStore.ts 的 FactStatus 对齐
 * （confirmed | rejected | unknown | conflict | revoked），
 * 另加展示用 "unconfirmed"（待确认，尚未写入任何事实记录）。
 *
 * 本组件为 Leaf，同时导出 FactStatus / DisplayFactStatus 类型供
 * FactGatePanel 复用，避免客户端组件耦合 server-only 的 factStore。
 */

export type FactStatus = "confirmed" | "rejected" | "unknown" | "conflict" | "revoked";

export type DisplayFactStatus = FactStatus | "unconfirmed";

export const FACT_STATUS_LABELS: Record<DisplayFactStatus, string> = {
  confirmed: "已确认",
  rejected: "已驳回",
  unknown: "未知",
  conflict: "冲突",
  revoked: "已撤销",
  unconfirmed: "待确认",
};

export const FACT_STATUS_TONES: Record<DisplayFactStatus, string> = {
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
  conflict: "border-amber-200 bg-amber-50 text-amber-700",
  revoked: "border-slate-200 bg-slate-100 text-slate-400",
  unconfirmed: "border-slate-200 bg-slate-50 text-slate-500",
};

export function FactStatusBadge({ status, className }: { status: DisplayFactStatus; className?: string }) {
  const tone = FACT_STATUS_TONES[status] ?? FACT_STATUS_TONES.unconfirmed;
  return (
    <span
      data-testid="fact-status-badge"
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}${className ? ` ${className}` : ""}`}
    >
      {FACT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
