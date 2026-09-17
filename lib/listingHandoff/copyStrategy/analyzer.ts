import type { MarketingInsightItem, MarketingInsightV1 } from "@/lib/listingHandoff/marketingIntelligence/types";
import { assertCopyStrategyV1 } from "./schema";
import {
  COPY_STRATEGY_SCHEMA,
  type CopyStrategyInput,
  type CopyStrategyV1,
} from "./types";

function firstByTopic(items: readonly MarketingInsightItem[], topic: string): MarketingInsightItem | undefined {
  return items.find((item) => item.topic === topic);
}

function hasTopic(insight: MarketingInsightV1 | null | undefined, topic: string): boolean {
  if (!insight) return false;
  return [insight.painPoints, insight.customerNeeds, insight.marketAngles, insight.keywordThemes, insight.competitorPatterns].some((items) => firstByTopic(items, topic) !== undefined);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function strategyFrom(input: CopyStrategyInput): CopyStrategyV1 {
  const insight = input.marketingInsight ?? null;
  const quality = input.qualityReport ?? null;
  const brief = input.listingBrief ?? null;
  const painPoints = unique((insight?.painPoints ?? []).map((item) => item.summary)).slice(0, 6);
  const angle = brief?.coreSellingPoint ?? insight?.marketAngles[0]?.summary ?? insight?.keywordThemes[0]?.summary ?? null;
  const targetBuyer = brief?.targetAudience
    ?? (hasTopic(insight, "kitchen_convenience")
    ? "Buyers seeking practical organization for everyday kitchen spaces"
      : painPoints.length > 0
        ? "Buyers looking for a clearer, easier everyday routine"
        : null);
  const emotionalHook = brief?.contentEmphasis
    ?? (painPoints.length > 0 ? "Make everyday organization feel simpler and easier to maintain." : null);
  const issueCodes = new Set((quality?.issues ?? []).map((issue) => issue.code));
  const suggestions = quality?.suggestions ?? [];
  const avoidExpressions = unique([
    "Unsupported superlatives or guarantees",
    ...(issueCodes.has("unsupported_compliance_risk") ? ["Unverified performance or compliance wording"] : []),
    ...(suggestions.some((item) => item.code === "title_keyword_stacking") ? ["Keyword stacking"] : []),
  ]).slice(0, 8);
  const bulletStrategies = [1, 2, 3, 4, 5].map((order) => ({
    order,
    structure: "feature_benefit_scenario" as const,
    purpose: order === 1
      ? "Lead with the clearest confirmed feature and connect it to the buyer need."
      : order === 2
        ? "Explain the practical buyer benefit using only confirmed support."
        : order === 3
          ? "Place the benefit in a concrete use scenario from the available strategy context."
          : order === 4
            ? "Clarify another supported feature without repeating the title."
            : "Close with a concise usage reminder and a human review check.",
    referenceOnly: true as const,
  }));
  const factCount = input.confirmedFactSummary?.count ?? 0;
  return {
    version: COPY_STRATEGY_SCHEMA,
    referenceOnly: true,
    targetBuyer,
    buyerPainPoints: painPoints,
    mainAngle: angle,
    emotionalHook,
    copyTone: quality && quality.bulletScore < 70 ? "practical" : "clear",
    bulletStrategies: factCount > 0 ? bulletStrategies : bulletStrategies.slice(0, 3),
    titleStrategy: angle ? "Brand or product type first, then one primary angle; keep confirmed attributes readable and avoid repetition." : null,
    descriptionStrategy: (painPoints.length > 0 || brief?.useScenario) ? `Open with what the product is, connect one supported benefit to the buyer need, then place it in a clear use scenario${brief?.useScenario ? ` (${brief.useScenario})` : ""}.` : null,
    avoidExpressions,
  };
}

/** Pure reference-only strategy analysis. It never mutates inputs or produces Listing copy. */
export function buildCopyStrategy(input: CopyStrategyInput = {}): CopyStrategyV1 {
  const strategy = strategyFrom(input);
  assertCopyStrategyV1(strategy);
  return strategy;
}
