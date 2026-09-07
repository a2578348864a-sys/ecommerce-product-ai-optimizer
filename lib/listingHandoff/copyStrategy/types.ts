import type { MarketingInsightV1 } from "@/lib/listingHandoff/marketingIntelligence/types";
import type { ListingQualityReport } from "@/lib/listingHandoff/listingQualityPolicy";

export const COPY_STRATEGY_SCHEMA = "copy-strategy.v1" as const;

export type CopyTone = "clear" | "practical" | "reassuring" | "concise";

export type CopyStrategyBullet = {
  order: number;
  structure: "feature_benefit_scenario";
  purpose: string;
  referenceOnly: true;
};

export type CopyStrategyV1 = {
  version: typeof COPY_STRATEGY_SCHEMA;
  referenceOnly: true;
  targetBuyer: string | null;
  buyerPainPoints: string[];
  mainAngle: string | null;
  emotionalHook: string | null;
  copyTone: CopyTone;
  bulletStrategies: CopyStrategyBullet[];
  titleStrategy: string | null;
  descriptionStrategy: string | null;
  avoidExpressions: string[];
};

/** Deliberately value-free summary supplied by a caller that already owns facts. */
export type ConfirmedFactSummary = {
  count: number;
  labels: readonly string[];
};

export type CopyStrategyInput = {
  marketingInsight?: MarketingInsightV1 | null;
  confirmedFactSummary?: ConfirmedFactSummary | null;
  qualityReport?: Pick<ListingQualityReport, "titleScore" | "bulletScore" | "descriptionScore" | "issues" | "suggestions"> | null;
};
