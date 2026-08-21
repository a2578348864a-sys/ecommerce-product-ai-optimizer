"use client";

/**
 * V4 P5 — 内容人工审核面板（Lead 接线）。approve_export / request_revision / reject_asset；不自动发布。
 */
export function ContentReviewPanel({ review, onChoice, disabled }: {
  review: { choice?: string; note?: string; actor?: string; at?: string } | null;
  onChoice: (choice: "approve_export" | "request_revision" | "reject_asset", note?: string) => void;
  disabled?: boolean;
}) {
  return (
    <section className="surface-card p-4 sm:p-5" data-testid="v4-content-review-panel">
      <header className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">内容人工审核</h2>
        {review?.choice && <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">已提交：{review.choice}</span>}
      </header>
      <p className="muted-text mt-2 text-sm leading-6">逐项核对 Listing 事实声明与图片来源后决定。内容不会自动发布。</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => onChoice("approve_export")} data-testid="content-approve"
          className="linear-button-primary inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50">通过并准备导出</button>
        <button type="button" disabled={disabled} onClick={() => onChoice("request_revision", "需修订")} data-testid="content-revision"
          className="linear-button inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50">要求修订</button>
        <button type="button" disabled={disabled} onClick={() => onChoice("reject_asset", "拒绝资产")} data-testid="content-reject"
          className="linear-button inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50">拒绝资产</button>
      </div>
      {review?.at && <p className="muted-text mt-3 text-xs">审核人 {review.actor} @ {review.at}</p>}
    </section>
  );
}
