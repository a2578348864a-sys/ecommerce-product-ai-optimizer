"use client";

import { useMemo } from "react";
import { analyzeMarketingIntelligence } from "@/lib/listingHandoff/marketingIntelligence/analyzer";
import type { MarketingInsightItem, MarketingInsightV1, MarketingResearchReference } from "@/lib/listingHandoff/marketingIntelligence/types";

/**
 * The Listing Studio receives the existing safe Creative Context summary rather
 * than raw research records. This keeps the panel reference-only and independent
 * from the Listing generation request.
 */
export type MarketingIntelligenceSummary = {
  counts?: {
    vocInsights?: number;
    keywordCandidates?: number;
    competitiveInsights?: number;
    sourcingEntries?: number;
  };
  vocInsights?: Array<{
    theme: string;
    summary: string;
    reviewCount: number;
    strength: string;
  }>;
  keywordCandidates?: Array<{ keyword: string; reportType: string }>;
  competitiveContext?: Array<{ asin: string; note: string }>;
  sourcingContext?: Array<{ offerId: string; title: string; displayedPrice: string; confirmed: boolean }>;
};

export function marketingReferenceFromSummary(summary: MarketingIntelligenceSummary | null | undefined): MarketingResearchReference {
  return {
    voc: (summary?.vocInsights ?? []).map((item) => ({
      theme: item.theme,
      summary: item.summary,
      reviewCount: item.reviewCount,
      strength: item.strength,
    })),
    keywords: (summary?.keywordCandidates ?? []).map((item) => ({ keyword: item.keyword, note: item.reportType })),
    competitors: (summary?.competitiveContext ?? []).map((item) => ({ title: item.asin, note: item.note })),
    sourcing: (summary?.sourcingContext ?? []).map((item) => ({
      title: item.title,
      note: `供应参考 ${item.offerId}；展示价格 ${item.displayedPrice}；已确认：${item.confirmed ? "是" : "否"}`,
    })),
  };
}

function sourceLabel(sourceType: MarketingInsightItem["sourceType"]): string {
  switch (sourceType) {
    case "VOC": return "VOC";
    case "keyword": return "关键词";
    case "competitor": return "竞品趋势";
    case "sourcing": return "供应参考";
  }
}

function confidenceLabel(confidence: MarketingInsightItem["confidence"]): string {
  switch (confidence) {
    case "high": return "高参考度";
    case "medium": return "中参考度";
    case "low": return "低参考度";
  }
}

function InsightList({ items, emptyText }: { items: MarketingInsightItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="mt-1 text-xs leading-5 text-slate-400">{emptyText}</p>;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((insight, index) => (
        <li key={`${insight.topic}-${index}`} className="rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-xs leading-5 text-slate-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-slate-900">{insight.summary}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{sourceLabel(insight.sourceType)}</span>
            <span className="text-[10px] text-slate-400">{confidenceLabel(insight.confidence)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MarketingIntelligencePanel({ summary }: { summary?: MarketingIntelligenceSummary | null }) {
  const report: MarketingInsightV1 = useMemo(
    () => analyzeMarketingIntelligence(marketingReferenceFromSummary(summary)),
    [summary],
  );
  const hasReferenceContent = report.painPoints.length > 0
    || report.customerNeeds.length > 0
    || report.marketAngles.length > 0
    || report.keywordThemes.length > 0
    || report.competitorPatterns.length > 0
    || report.recommendations.length > 0;
  const counts = summary?.counts;
  const referenceCount = (counts?.vocInsights ?? 0)
    + (counts?.keywordCandidates ?? 0)
    + (counts?.competitiveInsights ?? 0)
    + (counts?.sourcingEntries ?? 0);

  return (
    <section className="mt-4 min-w-0 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" data-testid="marketing-intelligence-panel" aria-label="Marketing Intelligence 营销洞察">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-indigo-950">Marketing Intelligence · 营销洞察</h3>
            <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-indigo-700">REFERENCE_ONLY</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-indigo-900/70">
            仅供 Listing 策略参考，不属于商品事实；不会覆盖或修改当前 Listing。
          </p>
        </div>
        {referenceCount > 0 ? (
          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700">研究参考 {referenceCount} 条</span>
        ) : null}
      </div>

      {!hasReferenceContent ? (
        <p className="mt-3 rounded-lg border border-dashed border-indigo-200 bg-white/70 px-3 py-2 text-xs leading-5 text-slate-500" data-testid="marketing-intelligence-empty">
          {referenceCount > 0 ? "研究参考已载入，但当前没有可展示的结构化洞察。" : "当前暂无可用研究参考，先保留安全空态。"}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-indigo-100 bg-white/70 p-2.5" data-testid="marketing-intelligence-pain-points">
            <p className="text-xs font-bold text-slate-800">用户痛点与需求</p>
            <InsightList items={report.painPoints} emptyText="暂无 VOC 痛点聚类。" />
            {report.customerNeeds.length > 0 ? <InsightList items={report.customerNeeds} emptyText="暂无需求聚类。" /> : null}
          </div>
          <div className="rounded-lg border border-indigo-100 bg-white/70 p-2.5" data-testid="marketing-intelligence-market-angles">
            <p className="text-xs font-bold text-slate-800">市场表达方向</p>
            <InsightList items={report.marketAngles} emptyText="暂无关键词表达方向。" />
            {report.keywordThemes.length > 0 ? <InsightList items={report.keywordThemes} emptyText="暂无关键词主题。" /> : null}
          </div>
          <div className="rounded-lg border border-indigo-100 bg-white/70 p-2.5" data-testid="marketing-intelligence-competitor-patterns">
            <p className="text-xs font-bold text-slate-800">竞品表达趋势</p>
            <InsightList items={report.competitorPatterns} emptyText="暂无竞品趋势参考。" />
          </div>
          <div className="rounded-lg border border-indigo-100 bg-white/70 p-2.5" data-testid="marketing-intelligence-recommendations">
            <p className="text-xs font-bold text-slate-800">Listing 建议结构</p>
            <InsightList items={report.recommendations} emptyText="暂无结构建议。" />
            <p className="mt-2 text-[11px] leading-5 text-slate-500">可按“先回应痛点 → 再说明已确认特点 → 最后落到使用场景”的顺序组织表达。建议仍需人工结合商品事实复核。</p>
          </div>
        </div>
      )}
    </section>
  );
}
