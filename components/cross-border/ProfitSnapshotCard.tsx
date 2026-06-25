"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateProfit, normalizeNumber } from "@/lib/profit";

/* ── Types ─────────────────────────────────────── */

export type ProfitDecision = "testable" | "cautious" | "not_recommended" | "unknown";

export type ProfitSnapshot = {
  estimatedPurchasePrice: number;
  estimatedSellingPrice: number;
  commissionRate: number;
  estimatedProfit: number;
  estimatedMargin: number;
  decision: ProfitDecision;
  currency: string;
};

const DECISION_LABELS: Record<ProfitDecision, string> = {
  testable: "可小单测试",
  cautious: "谨慎测试",
  not_recommended: "暂不建议",
  unknown: "未知",
};

const DECISION_COLORS: Record<ProfitDecision, string> = {
  testable: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cautious: "border-amber-200 bg-amber-50 text-amber-700",
  not_recommended: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};

function decide(margin: number): ProfitDecision {
  if (margin >= 0.25) return "testable";
  if (margin >= 0.10) return "cautious";
  if (margin < 0) return "not_recommended";
  return "unknown";
}

/* ── Props ─────────────────────────────────────── */

type ProfitSnapshotCardProps = {
  /** Initial values (may come from AI hints or previously saved data) */
  initial?: Partial<ProfitSnapshot>;
  /** Called when the snapshot changes (for parent to collect before save) */
  onChange?: (snapshot: ProfitSnapshot) => void;
  /** If true, renders as read-only display (for task detail view) */
  readonly?: boolean;
  /** Currency hint from AI analysis */
  currency?: string;
};

/* ── Component ─────────────────────────────────── */

export function ProfitSnapshotCard({
  initial,
  onChange,
  readonly = false,
  currency: currencyHint = "USD",
}: ProfitSnapshotCardProps) {
  const [purchasePrice, setPurchasePrice] = useState(
    String(initial?.estimatedPurchasePrice ?? "")
  );
  const [sellingPrice, setSellingPrice] = useState(
    String(initial?.estimatedSellingPrice ?? "")
  );
  const [commissionRate, setCommissionRate] = useState(
    String(initial?.commissionRate ?? 15)
  );

  const result = useMemo(() => {
    const pp = normalizeNumber(purchasePrice);
    const sp = normalizeNumber(sellingPrice);
    const cr = normalizeNumber(commissionRate) / 100;
    if (pp <= 0 || sp <= 0) return null;
    return calculateProfit({
      purchasePrice: String(pp),
      domesticShippingFee: "0",
      internationalShippingFee: "0",
      otherCost: "0",
      commissionRate: String(commissionRate),
      expectedProfitRate: "0",
      manualSellingPrice: String(sp),
      currency: currencyHint,
    });
  }, [purchasePrice, sellingPrice, commissionRate, currencyHint]);

  const snapshot: ProfitSnapshot = useMemo(() => {
    if (!result) {
      return {
        estimatedPurchasePrice: normalizeNumber(purchasePrice),
        estimatedSellingPrice: normalizeNumber(sellingPrice),
        commissionRate: normalizeNumber(commissionRate) / 100,
        estimatedProfit: 0,
        estimatedMargin: 0,
        decision: "unknown",
        currency: currencyHint,
      };
    }
    return {
      estimatedPurchasePrice: normalizeNumber(purchasePrice),
      estimatedSellingPrice: normalizeNumber(sellingPrice),
      commissionRate: normalizeNumber(commissionRate) / 100,
      estimatedProfit: result.grossProfit,
      estimatedMargin: result.grossMargin,
      decision: decide(result.grossMargin),
      currency: currencyHint,
    };
  }, [result, purchasePrice, sellingPrice, commissionRate, currencyHint]);

  // Notify parent when snapshot changes
  useEffect(() => {
    onChange?.(snapshot);
  }, [snapshot, onChange]);

  const dec = DECISION_LABELS[snapshot.decision];
  const decColor = DECISION_COLORS[snapshot.decision];

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-bold text-teal-800">成本利润估算</p>
        {result && (
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${decColor}`}>
            {dec}
          </span>
        )}
      </div>

      {readonly ? (
        /* ── Read-only display ── */
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs text-slate-400">估算采购价</span>
              <p className="font-semibold text-slate-800">
                {snapshot.currency} {snapshot.estimatedPurchasePrice.toFixed(2)}
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-400">估算售价</span>
              <p className="font-semibold text-slate-800">
                {snapshot.currency} {snapshot.estimatedSellingPrice.toFixed(2)}
              </p>
            </div>
            {result && (
              <>
                <div>
                  <span className="text-xs text-slate-400">估算利润</span>
                  <p className={`font-semibold ${result.grossProfit > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {snapshot.currency} {result.grossProfit.toFixed(2)}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">估算利润率</span>
                  <p className="font-semibold text-slate-800">
                    {(result.grossMargin * 100).toFixed(1)}%
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* ── Editable mode ── */
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">估算采购价</span>
              <input
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="例如 15"
                step="0.01"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">估算售价</span>
              <input
                type="number"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="例如 25"
                step="0.01"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">佣金率(%)</span>
              <input
                type="number"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                placeholder="15"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>

          {result && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>
                预估利润:{" "}
                <span className={result.grossProfit > 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                  {snapshot.currency} {result.grossProfit.toFixed(2)}
                </span>
              </span>
              <span>
                利润率: <span className="font-semibold text-slate-700">{(result.grossMargin * 100).toFixed(1)}%</span>
              </span>
              <span>
                保本价: <span className="font-semibold text-slate-700">{snapshot.currency} {result.breakEvenPrice.toFixed(2)}</span>
              </span>
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-xs leading-5 text-slate-400">
        以上为粗略估算，非真实市场价。实际采购价、物流和平台费用以真实供应商报价为准。
        此估算仅供人工复核参考，不做采购/上架决策依据。
      </p>
    </div>
  );
}
