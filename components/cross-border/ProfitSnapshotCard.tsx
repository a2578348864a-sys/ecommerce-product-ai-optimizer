"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateProfit, normalizeNumber } from "@/lib/profit";

export type ProfitDecision = "testable" | "caution" | "not_recommended" | "unknown";

export type ProfitSnapshot = {
  purchaseCost: number;
  salePrice: number;
  platformFeeRate: number;
  platformFeeAmount: number;
  estimatedProfit: number;
  estimatedMarginRate: number;
  decision: ProfitDecision;
  note: string;
  source: "manual_profit_mvp";
  createdAt: string;
  currency?: string;
};

type LegacyProfitSnapshot = Partial<ProfitSnapshot> & {
  estimatedPurchasePrice?: number;
  estimatedSellingPrice?: number;
  commissionRate?: number;
  estimatedMargin?: number;
};

type ProfitSnapshotCardProps = {
  initial?: LegacyProfitSnapshot;
  onChange?: (snapshot: ProfitSnapshot) => void;
  readonly?: boolean;
  currency?: string;
};

const SNAPSHOT_NOTE = "粗略估算，非真实市场价，需人工复核";

const DECISION_LABELS: Record<ProfitDecision, string> = {
  testable: "可小单测试",
  caution: "谨慎测试",
  not_recommended: "暂不建议",
  unknown: "未知",
};

const DECISION_COLORS: Record<ProfitDecision, string> = {
  testable: "border-emerald-200 bg-emerald-50 text-emerald-700",
  caution: "border-amber-200 bg-amber-50 text-amber-700",
  not_recommended: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};

function formatMoney(value: number) {
  return `¥${normalizeNumber(value).toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${(normalizeNumber(value) * 100).toFixed(1)}%`;
}

function toPercentInput(rate: unknown) {
  const normalized = normalizeNumber(rate, 0.15);
  return normalized > 1 ? normalized : normalized * 100;
}

function decideProfit(estimatedProfit: number, estimatedMarginRate: number, hasResult: boolean): ProfitDecision {
  if (!hasResult) return "unknown";
  if (estimatedProfit <= 0) return "not_recommended";
  if (estimatedMarginRate >= 0.25) return "testable";
  return "caution";
}

function normalizeInitial(initial?: LegacyProfitSnapshot) {
  return {
    purchaseCost: normalizeNumber(initial?.purchaseCost ?? initial?.estimatedPurchasePrice),
    salePrice: normalizeNumber(initial?.salePrice ?? initial?.estimatedSellingPrice),
    platformFeeRatePercent: toPercentInput(initial?.platformFeeRate ?? initial?.commissionRate ?? 0.15),
    platformFeeAmount: normalizeNumber(initial?.platformFeeAmount),
    estimatedProfit: normalizeNumber(initial?.estimatedProfit),
    estimatedMarginRate: normalizeNumber(initial?.estimatedMarginRate ?? initial?.estimatedMargin),
    decision: initial?.decision === "caution" || initial?.decision === "testable" || initial?.decision === "not_recommended" || initial?.decision === "unknown"
      ? initial.decision
      : "unknown",
    note: typeof initial?.note === "string" && initial.note.trim() ? initial.note.trim() : SNAPSHOT_NOTE,
    source: initial?.source === "manual_profit_mvp" ? initial.source : "manual_profit_mvp",
    createdAt: typeof initial?.createdAt === "string" && initial.createdAt.trim() ? initial.createdAt : "",
    currency: typeof initial?.currency === "string" && initial.currency.trim() ? initial.currency : "CNY",
  };
}

export function ProfitSnapshotCard({
  initial,
  onChange,
  readonly = false,
  currency: currencyHint = "CNY",
}: ProfitSnapshotCardProps) {
  const normalizedInitial = useMemo(() => normalizeInitial(initial), [initial]);
  const [createdAt] = useState(() => normalizedInitial.createdAt || new Date().toISOString());
  const [purchaseCost, setPurchaseCost] = useState(String(normalizedInitial.purchaseCost || ""));
  const [salePrice, setSalePrice] = useState(String(normalizedInitial.salePrice || ""));
  const [platformFeeRatePercent, setPlatformFeeRatePercent] = useState(String(normalizedInitial.platformFeeRatePercent || 15));

  const inputs = useMemo(() => {
    const purchase = normalizeNumber(purchaseCost);
    const sale = normalizeNumber(salePrice);
    const feeRate = normalizeNumber(platformFeeRatePercent) / 100;
    return { purchase, sale, feeRate };
  }, [purchaseCost, salePrice, platformFeeRatePercent]);

  const result = useMemo(() => {
    if (inputs.purchase <= 0 || inputs.sale <= 0) return null;

    return calculateProfit({
      purchasePrice: String(inputs.purchase),
      domesticShippingFee: "0",
      internationalShippingFee: "0",
      otherCost: "0",
      commissionRate: String(inputs.feeRate),
      expectedProfitRate: "0",
      manualSellingPrice: String(inputs.sale),
      currency: currencyHint,
    });
  }, [inputs, currencyHint]);

  const snapshot: ProfitSnapshot = useMemo(() => {
    const hasResult = Boolean(result);
    const platformFeeAmount = result ? result.commissionAmount : normalizedInitial.platformFeeAmount;
    const estimatedProfit = result ? result.grossProfit : normalizedInitial.estimatedProfit;
    const estimatedMarginRate = result ? result.grossMargin : normalizedInitial.estimatedMarginRate;

    return {
      purchaseCost: inputs.purchase,
      salePrice: inputs.sale,
      platformFeeRate: inputs.feeRate,
      platformFeeAmount,
      estimatedProfit,
      estimatedMarginRate,
      decision: decideProfit(estimatedProfit, estimatedMarginRate, hasResult),
      note: normalizedInitial.note,
      source: "manual_profit_mvp",
      createdAt,
      currency: currencyHint || normalizedInitial.currency,
    };
  }, [result, normalizedInitial, inputs, createdAt, currencyHint]);

  useEffect(() => {
    onChange?.(snapshot);
  }, [snapshot, onChange]);

  const decisionLabel = DECISION_LABELS[snapshot.decision];
  const decisionColor = DECISION_COLORS[snapshot.decision];

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-teal-900">成本利润估算</p>
          <p className="mt-1 text-xs leading-5 text-teal-700">
            填写采购价、售价和平台佣金率后，自动估算利润、毛利率和测试建议。
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${decisionColor}`}>
          {decisionLabel}
        </span>
      </div>

      {readonly ? null : (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">估算采购价</span>
            <input
              type="number"
              value={purchaseCost}
              onChange={(event) => setPurchaseCost(event.target.value)}
              placeholder="例如 15"
              step="0.01"
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">估算售价</span>
            <input
              type="number"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              placeholder="例如 25"
              step="0.01"
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">佣金率(%)</span>
            <input
              type="number"
              value={platformFeeRatePercent}
              onChange={(event) => setPlatformFeeRatePercent(event.target.value)}
              placeholder="15"
              step="0.1"
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
            />
          </label>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-white/80 bg-white p-3">
        {result || readonly ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ResultCell label="总成本" value={formatMoney(snapshot.purchaseCost)} />
              <ResultCell label="平台佣金" value={formatMoney(snapshot.platformFeeAmount)} />
              <ResultCell
                label="预估利润"
                value={formatMoney(snapshot.estimatedProfit)}
                valueClassName={snapshot.estimatedProfit > 0 ? "text-emerald-700" : "text-rose-700"}
              />
              <ResultCell label="预估毛利率" value={formatPercent(snapshot.estimatedMarginRate)} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              毛利率按售价口径估算。当前决策标签：<span className="font-semibold text-slate-700">{decisionLabel}</span>。
            </p>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">
            填写采购价和售价后，将自动估算利润和毛利率。
            <span className="ml-1 font-semibold text-slate-600">当前决策标签：未知。</span>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
        <p>{SNAPSHOT_NOTE}。</p>
        {readonly ? (
          <p>人工估算，需复核；老任务没有利润快照时不会显示此模块。</p>
        ) : (
          <p>保存任务时会一并记录本次利润估算快照。</p>
        )}
      </div>
    </div>
  );
}

function ResultCell({
  label,
  value,
  valueClassName = "text-slate-800",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <p className={`mt-1 text-base font-bold ${valueClassName}`}>{value}</p>
    </div>
  );
}
