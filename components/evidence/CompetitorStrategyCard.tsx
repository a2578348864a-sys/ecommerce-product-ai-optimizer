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

export function CompetitorStrategyCard({
  productName,
  entries,
  onCollect,
  onAdd,
  onDelete,
  error,
  busy,
}: {
  productName?: string | null;
  entries: CompetitorEntryView[];
  onCollect?: () => void;
  onAdd: (input: { asin: string; note: string }) => Promise<string | null>;
  onDelete: (asin: string) => Promise<string | null>;
  error?: string | null;
  busy?: boolean;
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
          自动采集竞品
        </button>
      </div>

      <ul className="mt-3 space-y-2 text-sm" data-testid="cp-list">
        {classified.slice(0, 5).map((e) => (
          <li key={e.asin} className="rounded-lg border border-slate-200 px-3 py-2" data-testid={"cp-item-" + e.asin}>
            <p className="font-semibold text-slate-900">{e.note ?? e.asin}</p>
            <p className="text-xs text-slate-500">
              {e.asin} · {e.sourceKind === "browser_use" ? "自动采集" : "人工添加"} · {e.relation === "direct" ? "直接竞品" : e.relation === "adjacent" ? "相邻商品" : "待排除"}
              {e.detailBulletsCount ? " · 已采集五点 " + e.detailBulletsCount : " · 尚未采集五点"}
            </p>
          </li>
        ))}
        {classified.length === 0 ? <li className="text-xs text-slate-400">尚未采集竞品。点击「自动采集竞品」开始。</li> : null}
      </ul>

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
