/**
 * Marketing Intelligence is a reference-only projection of research material.
 *
 * This contract deliberately has no factId, product fact, claim, or persistence
 * fields. A consumer may use it to plan copy, but it cannot be used as evidence
 * for a product statement.
 */

export const MARKETING_INSIGHT_SCHEMA = "marketing-insight.v1" as const;
export const MARKETING_INSIGHT_REFERENCE_ONLY = true as const;

export type MarketingInsightSourceType = "VOC" | "keyword" | "competitor" | "sourcing";
export type MarketingInsightConfidence = "high" | "medium" | "low";

export type MarketingInsightItem = {
  /** Stable analytical topic, never a product fact identifier. */
  topic: string;
  summary: string;
  sourceType: MarketingInsightSourceType;
  confidence: MarketingInsightConfidence;
  referenceOnly: true;
};

export type MarketingInsightV1 = {
  version: typeof MARKETING_INSIGHT_SCHEMA;
  referenceOnly: true;
  painPoints: MarketingInsightItem[];
  customerNeeds: MarketingInsightItem[];
  marketAngles: MarketingInsightItem[];
  keywordThemes: MarketingInsightItem[];
  competitorPatterns: MarketingInsightItem[];
  recommendations: MarketingInsightItem[];
};

export type MarketingResearchReferenceText = string | {
  theme?: string;
  summary?: string;
  keyword?: string;
  note?: string;
  title?: string;
  bullets?: readonly string[];
  strength?: string;
  reviewCount?: number;
};

/**
 * The analyzer accepts a deliberately small, transport-neutral reference shape.
 * The Listing generation input or a UI adapter may project its existing
 * CreativeContext into this shape without changing that main-chain contract.
 */
export type MarketingResearchReference = {
  voc: readonly MarketingResearchReferenceText[];
  keywords: readonly MarketingResearchReferenceText[];
  competitors: readonly MarketingResearchReferenceText[];
  sourcing: readonly MarketingResearchReferenceText[];
};

