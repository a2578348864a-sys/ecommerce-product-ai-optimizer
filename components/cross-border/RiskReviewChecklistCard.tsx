"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import {
  countRiskReviewItems,
  createDefaultRiskReviewItems,
  normalizeRiskReviewSnapshot,
  RISK_REVIEW_DISCLAIMER,
  RISK_REVIEW_OVERALL_LABELS,
  RISK_REVIEW_STATUS_LABELS,
  type RiskReviewItem,
  type RiskReviewItemStatus,
  type RiskReviewOverallStatus,
  type RiskReviewSnapshot,
} from "@/lib/riskReview";

type RiskReviewChecklistCardProps = {
  initial?: unknown;
  onChange?: (snapshot: RiskReviewSnapshot | null) => void;
  readonly?: boolean;
};

const statusTone: Record<RiskReviewItemStatus, string> = {
  unchecked: "border-slate-200 bg-slate-50 text-slate-600",
  cleared: "border-emerald-200 bg-emerald-50 text-emerald-700",
  needs_check: "border-amber-200 bg-amber-50 text-amber-700",
  high_risk: "border-rose-200 bg-rose-50 text-rose-700",
};

const overallTone: Record<RiskReviewOverallStatus, string> = {
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
  cleared: "border-emerald-200 bg-emerald-50 text-emerald-700",
  needs_check: "border-amber-200 bg-amber-50 text-amber-700",
  high_risk: "border-rose-200 bg-rose-50 text-rose-700",
};

const statusOptions: RiskReviewItemStatus[] = ["unchecked", "cleared", "needs_check", "high_risk"];

function hasUserInput(items: RiskReviewItem[], note: string) {
  return items.some((item) => item.status !== "unchecked" || Boolean(item.note)) || Boolean(note.trim());
}

export function RiskReviewChecklistCard({ initial, onChange, readonly = false }: RiskReviewChecklistCardProps) {
  const normalizedInitial = useMemo(() => normalizeRiskReviewSnapshot(initial), [initial]);
  const [createdAt] = useState(() => normalizedInitial?.createdAt || new Date().toISOString());
  const [items, setItems] = useState<RiskReviewItem[]>(() => normalizedInitial?.items || createDefaultRiskReviewItems());
  const [note, setNote] = useState(() => normalizedInitial?.note || "");

  const touched = hasUserInput(items, note);
  const snapshot = useMemo(() => normalizeRiskReviewSnapshot({
    items,
    note,
    createdAt,
  }), [items, note, createdAt]);

  const overallStatus = touched ? (snapshot?.overallStatus || "unknown") : "unknown";
  const counts = countRiskReviewItems(items);
  const importantItems = items
    .filter((item) => item.status === "high_risk" || item.status === "needs_check")
    .slice(0, 4);

  useEffect(() => {
    if (readonly) return;
    onChange?.(touched ? snapshot : null);
  }, [onChange, readonly, snapshot, touched]);

  function updateItemStatus(key: string, status: RiskReviewItemStatus) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, status } : item));
  }

  function updateItemNote(key: string, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, note: value.trim() ? value.slice(0, 300) : null } : item));
  }

  function markAllCleared() {
    setItems((current) => current.map((item) => ({ ...item, status: "cleared" })));
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4" data-testid="risk-review-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-700" />
            <p className="text-sm font-bold text-amber-950">合规 / 侵权人工复核</p>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-800">
            AI 风险判断不能替代商标、专利、平台规则和当地法规核查。涉及品牌、外观、功能结构、儿童用品、医疗健康、电子电器等产品时，必须人工复核。
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${overallTone[overallStatus]}`} data-testid="risk-review-overall">
          {RISK_REVIEW_OVERALL_LABELS[overallStatus]}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric label="高风险" value={counts.highRisk} tone="text-rose-700" />
          <Metric label="待核查" value={counts.needsCheck} tone="text-amber-700" />
          <Metric label="已确认" value={counts.cleared} tone="text-emerald-700" />
          <Metric label="未确认" value={counts.unchecked} tone="text-slate-600" />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          至少完成关键风险项复核后，再作为采购 / 上架参考。仅作为采购 / 上架前的人工复核记录。
        </p>
      </div>

      {!readonly ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={markAllCleared}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            data-testid="risk-review-mark-all-cleared"
          >
            <CheckCircle2 className="size-3.5" />
            全部标为已确认
          </button>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-xl border border-white/80 bg-white p-3" data-testid={`risk-review-item-${item.key}`}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.description}</p>
                {item.example ? <p className="mt-1 text-xs leading-5 text-slate-400">示例：{item.example}</p> : null}
              </div>
              {readonly ? (
                <span className={`w-fit shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusTone[item.status]}`}>
                  {RISK_REVIEW_STATUS_LABELS[item.status]}
                </span>
              ) : (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {statusOptions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => updateItemStatus(item.key, status)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                        item.status === status ? statusTone[status] : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                      data-testid={`risk-review-${item.key}-${status}`}
                    >
                      {RISK_REVIEW_STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {readonly ? (
              item.note ? <p className="mt-2 text-xs leading-5 text-slate-500">备注：{item.note}</p> : null
            ) : (
              <input
                type="text"
                value={item.note || ""}
                onChange={(event) => updateItemNote(item.key, event.target.value)}
                placeholder="可选备注，例如：需查商标 / 已问供应商要报告"
                maxLength={300}
                className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 placeholder-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                data-testid={`risk-review-${item.key}-note`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
        <label className="block text-xs font-semibold text-slate-600">统一备注</label>
        {readonly ? (
          <p className="mt-2 text-sm leading-6 text-slate-700">{note || "未填写统一备注。"}</p>
        ) : (
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 800))}
            placeholder="例如：高风险项需要查商标；供应商需补 CE / FCC / MSDS 文件。"
            rows={3}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
            data-testid="risk-review-note"
          />
        )}
      </div>

      {importantItems.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-bold text-amber-800">重点复核项</p>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-600">
                {importantItems.map((item) => (
                  <li key={item.key}>- {item.label}：{RISK_REVIEW_STATUS_LABELS[item.status]}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-5 text-slate-500">{RISK_REVIEW_DISCLAIMER}</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold ${tone}`}>{value}</p>
    </div>
  );
}
