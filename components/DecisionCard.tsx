"use client";

import { RECOMMENDATION_TONES, type DecisionCard as DecisionCardType } from "@/lib/decisionCard";

export function DecisionCard({ card, compact = false }: { card: DecisionCardType; compact?: boolean }) {
  const tone = RECOMMENDATION_TONES[card.recommendation] || "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${compact ? "" : "surface-card"}`} data-testid="decision-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-teal-700">AI 决策卡</p>
          <p className="mt-0.5 text-xs text-slate-400">AI 负责生成建议，人负责最终确认</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${tone}`}>
          {card.recommendationLabel}
        </span>
      </div>

      {/* Headline */}
      <p className="mt-3 text-base font-semibold leading-7 text-slate-800">{card.headline}</p>

      {/* Key metrics */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricBox label="风险等级" value={card.riskLevel} />
        <MetricBox label="利润判断" value={card.profitSignal} />
        <MetricBox label="新手适配" value={card.beginnerFitLabel} />
        <MetricBox label="Listing 准备" value={card.listingReadiness.label} />
      </div>

      {/* Biggest risk + profit summary */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
          <p className="text-xs font-semibold text-rose-600">最大风险</p>
          <p className="mt-1 text-sm leading-6 text-rose-800">{card.biggestRisk}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500">利润摘要</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">{card.profitSummary}</p>
        </div>
      </div>

      {/* Next action */}
      <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50/50 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-teal-700">下一步：{card.nextActionLabel}</span>
        </div>
        <p className="mt-1 text-sm leading-6 text-teal-600">{card.nextActionDescription}</p>
      </div>

      {/* Review points */}
      {card.reviewPoints.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/30 p-3">
          <p className="text-xs font-semibold text-amber-700">人工复核点</p>
          <ul className="mt-1.5 space-y-1">
            {card.reviewPoints.map((p) => (
              <li key={p.key} className="flex items-start gap-1.5 text-sm leading-6 text-amber-800">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>{p.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Listing readiness */}
      <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
        <p className="text-xs font-semibold text-indigo-600">Listing 包状态</p>
        <p className="mt-1 text-sm leading-6 text-indigo-700">{card.listingReadiness.description}</p>
      </div>

      {/* Missing fields */}
      {card.missingFields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 text-xs text-slate-400">
          <span>缺失数据：</span>
          {card.missingFields.map((f) => (
            <span key={f} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">{f}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value || "暂无"}</p>
    </div>
  );
}
