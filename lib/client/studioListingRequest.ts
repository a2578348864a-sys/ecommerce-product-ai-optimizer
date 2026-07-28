import type {
  StudioListingObjective,
  StudioListingTone,
  StudioOutputLanguage,
  StudioTargetMarket,
} from "@/lib/studioListingInput";

export type ListingFormIntent = {
  targetMarket: StudioTargetMarket;
  outputLanguage: StudioOutputLanguage;
  coreFunctions: string;
  targetAudience: string;
  problemsSolved: string;
  differentiators: string;
  primaryKeyword: string;
  secondaryKeywords: string;
  competitorKeywords: string;
  confirmedFacts: string;
  unverifiedFacts: string;
  prohibitedClaims: string;
  listingObjective: StudioListingObjective;
  copyStyle: StudioListingTone;
};

export const EMPTY_LISTING_INTENT: ListingFormIntent = {
  targetMarket: "US",
  outputLanguage: "en",
  coreFunctions: "",
  targetAudience: "",
  problemsSolved: "",
  differentiators: "",
  primaryKeyword: "",
  secondaryKeywords: "",
  competitorKeywords: "",
  confirmedFacts: "",
  unverifiedFacts: "",
  prohibitedClaims: "",
  listingObjective: "balanced",
  copyStyle: "professional",
};

function splitTerms(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n|[,;，；]/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildStudioListingRequestCore(input: {
  productName: string;
  description: string;
  category: string;
  intent: ListingFormIntent;
  mode: "mock" | "real";
}) {
  return {
    productName: input.productName.trim(),
    description: input.description.trim(),
    category: input.category.trim(),
    mode: input.mode,
    targetMarket: input.intent.targetMarket,
    outputLanguage: input.intent.outputLanguage,
    tone: input.intent.copyStyle,
    coreFunction: input.intent.coreFunctions.trim(),
    targetAudience: input.intent.targetAudience.trim(),
    problemSolved: input.intent.problemsSolved.trim(),
    differentiators: splitTerms(input.intent.differentiators),
    primaryKeywords: splitTerms(input.intent.primaryKeyword),
    secondaryKeywords: splitTerms(input.intent.secondaryKeywords),
    competitorKeywords: splitTerms(input.intent.competitorKeywords),
    confirmedFacts: splitTerms(input.intent.confirmedFacts),
    unverifiedFacts: splitTerms(input.intent.unverifiedFacts),
    prohibitedClaims: splitTerms(input.intent.prohibitedClaims),
    listingObjective: input.intent.listingObjective,
  };
}
