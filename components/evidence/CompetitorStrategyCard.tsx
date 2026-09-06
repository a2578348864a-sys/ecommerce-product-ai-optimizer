"use client";

import { useMemo, useState } from "react";
import { classifyCompetitorRelation } from "@/lib/research/researchInputQuality";

export type CompetitorEntryView = {
  asin: string;
  note?: string | null;
  sourceKind: "manual" | "browser_use";
  addedAt?: string | null;
  detailBulletsCount?: number;
};

export type CompetitorPendingPreviewItem = {
  asin: string;
  title: string;
  imageUrl?: string;
  price?: number;
  rating?: number;
  reviews?: number;
  bsr?: string;
  sourceUrl?: string;
};

export type CompetitorPendingPreview = {
  previewId: string;
  seedAsin: string;
  sourceUrl: string;
  competitorCount: number;
  capturedAt: string | null;
  items?: CompetitorPendingPreviewItem[];
};

export function visibleCompetitorEntries<T>(entries: T[], visibleCount = 3): {
  visible: T[];
  hidden: T[];
} {
  const limit = Math.max(1, Math.floor(visibleCount));
  return { visible: entries.slice(0, limit), hidden: entries.slice(limit) };
}

export function CompetitorStrategyCard({
  productName,
  entries,
  onCollect,
  onAdd,
  onDelete,
  error,
  busy,
  pendingPreview,
  onSavePending,
  onCancelPending,
  pendingPanel,
}: {
  productName?: string | null;
  entries: CompetitorEntryView[];
  onCollect?: () => void;
  onAdd: (input: { asin: string; note: string }) => Promise<string | null>;
  onDelete: (asin: string) => Promise<string | null>;
  error?: string | null;
  busy?: boolean;
  pendingPreview?: CompetitorPendingPreview | null;
  onSavePending?: () => void;
  onCancelPending?: () => void;
  pendingPanel?: React.ReactNode;
}) {
  const classified = useMemo(() => entries.map((e) => ({
    ...e,
    relation: productName ? classifyCompetitorRelation(e.note ?? e.asin, productName) : "irrelevant",
  })), [entries, productName]);
  const direct = classified.filter((e) => e.relation === "direct").length;
  const adjacent = classified.filter((e) => e.relation === "adjacent").length;
  const irrelevant = classified.filter((e) => e.relation === "irrelevant").length;
  const [manageOpen, setManageOpen] = useState(false);
  const [asinInput, setAsinInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const { visible, hidden } = visibleCompetitorEntries(classified);

  const submitAdd = async () => {
    const err = await onAdd({ asin: asinInput.trim(), note: noteInput.trim() });
    if (err) { setAddError(err); return; }
    setAddError(null);
    setAsinInput("");
    setNoteInput("");
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="competitor-strategy-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">竞品策略</h4>
          <p className="mt-1 text-xs text-slate-500" data-testid="cp-counts">
            直接竞品 {direct} · 相邻商品 {adjacent} · 待排除 {irrelevant}
          </p>
        </div>
        <button type="button" data-testid="cp-collect" onClick={onCollect} disabled={busy} className="inline-flex h-8 shrink-0 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {busy ? "正在采集…" : "采集关键词+竞品"}
        </button>
      </div>

      <ul className="mt-3 space-y-2 text-sm" data-testid="cp-list">
        {visible.map((e) => (
          <li key={e.asin} className="rounded-lg border border-slate-200 px-3 py-2" data-testid={"cp-item-" + e.asin}>
            <p className="font-semibold text-slate-900">{e.note ?? e.asin}</p>
            <p className="text-xs text-slate-500">
              {e.asin} · {e.sourceKind === "browser_use" ? "自动采集" : "人工添加"} · {e.relation === "direct" ? "直接竞品" : e.relation === "adjacent" ? "相邻商品" : "待排除"}
              {e.detailBulletsCount ? " · 已采集五点 " + e.detailBulletsCount : " · 尚未采集五点"}
            </p>
          </li>
        ))}
        {classified.length === 0 ? (
          pendingPanel || pendingPreview ? (
            <li className="text-xs text-amber-700 font-medium" data-testid="cp-pending-prompt">
              已发现待确认候选竞品，请先核对并确认保存。
            </li>
          ) : (
            <li className="text-xs text-slate-400">尚未采集竞品。点击「采集关键词+竞品」开始。</li>
          )
        ) : null}
      </ul>

      {pendingPanel ? (
        <div className="mt-3">{pendingPanel}</div>
      ) : pendingPreview ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm" data-testid="competitor-pending-card">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
              待确认：自动采集发现的候选竞品
            </p>
            <span className="text-[11px] font-medium text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md">
              {(pendingPreview.items?.length ?? pendingPreview.competitorCount)} 个候选
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            种子 ASIN：{pendingPreview.seedAsin} · 来源：Amazon 搜索结果
          </p>
          {Array.isArray(pendingPreview.items) && pendingPreview.items.length > 0 ? (
            <div className="mt-2.5 max-h-60 overflow-y-auto space-y-2 pr-1" data-testid="competitor-pending-list">
              {pendingPreview.items.map((item, idx) => (
                <div key={`${item.asin}-${idx}`} className="flex items-start gap-3 rounded-lg border border-amber-200/80 bg-white p-2.5 shadow-2xs" data-testid={`competitor-pending-item-${item.asin}`}>
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={item.title} className="h-12 w-12 shrink-0 rounded object-contain border border-slate-100 bg-slate-50" loading="lazy" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-100 text-[10px] text-slate-400">无图</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-semibold text-slate-900" title={item.title}>{item.title || item.asin}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="font-mono font-medium text-slate-700">{item.asin}</span>
                      {typeof item.price === "number" ? <span className="font-semibold text-slate-900">${item.price.toFixed(2)}</span> : null}
                      {typeof item.rating === "number" ? (
                        <span className="text-amber-600">
                          ★ {item.rating.toFixed(1)}
                          {typeof item.reviews === "number" ? ` (${item.reviews.toLocaleString()})` : ""}
                        </span>
                      ) : null}
                      {item.bsr ? <span className="text-slate-400">BSR: #{item.bsr}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 flex items-center gap-2">
            {onSavePending ? (
              <button
                type="button"
                data-testid="competitor-pending-save"
                onClick={onSavePending}
                className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
              >
                先保存竞品证据
              </button>
            ) : null}
            {onCancelPending ? (
              <button
                type="button"
                data-testid="competitor-pending-cancel"
                onClick={onCancelPending}
                className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                放弃本次预览
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {hidden.length > 0 ? (
        <details className="mt-2" data-testid="cp-more-details">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">查看全部竞品（另有 {hidden.length} 个）</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {hidden.map((e) => (
              <li key={e.asin} className="rounded-lg border border-slate-200 px-3 py-2" data-testid={"cp-hidden-item-" + e.asin}>
                <p className="truncate font-semibold text-slate-900" title={e.note ?? e.asin}>{e.note ?? e.asin}</p>
                <p className="text-xs text-slate-500">{e.asin} · {e.sourceKind === "browser_use" ? "自动采集" : "人工添加"}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="mt-3" data-testid="cp-manage" open={manageOpen} onToggle={(e) => setManageOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-xs font-medium text-slate-700">管理竞品</summary>
        <div className="mt-2 space-y-2">
          <input value={asinInput} onChange={(e) => setAsinInput(e.target.value)} placeholder="ASIN" data-testid="cp-asin-input" className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm" />
          <textarea value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder="备注" data-testid="cp-note-input" className="w-full min-h-[60px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm" />
          <button type="button" data-testid="cp-add" onClick={() => void submitAdd()} className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700">人工添加</button>
        </div>
      </details>

      {(error ?? addError) ? <p className="mt-2 text-xs text-rose-600" role="alert">{(error ?? addError) ?? ""}</p> : null}
    </section>
  );
}
