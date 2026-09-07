import { describe, expect, it } from "vitest";
import { analyzeMarketingIntelligence } from "./analyzer";
import { parseMarketingInsightV1 } from "./schema";
import { marketingResearchReferenceFixture } from "./fixtures/marketingResearchReference";
import type { MarketingInsightV1, MarketingResearchReference } from "./types";
import { composeListingDraft } from "@/lib/listingHandoff/listingComposition";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

describe("Marketing Intelligence reference-only contract", () => {
  it("accepts a valid deterministic report and rejects unknown fields", () => {
    const report = analyzeMarketingIntelligence(marketingResearchReferenceFixture);
    expect(parseMarketingInsightV1(report).ok).toBe(true);
    expect(parseMarketingInsightV1({ ...report, unexpected: true }).ok).toBe(false);
  });

  it("accepts empty research as an empty reference-only report", () => {
    const report = analyzeMarketingIntelligence({ voc: [], keywords: [], competitors: [], sourcing: [] });
    expect(report.painPoints).toEqual([]);
    expect(report.recommendations).toEqual([]);
    expect(report.referenceOnly).toBe(true);
    expect(parseMarketingInsightV1(report).ok).toBe(true);
  });

  it("clusters VOC into organization and access needs", () => {
    const report = analyzeMarketingIntelligence({
      voc: ["The kitchen is messy and storage is hard", "Easy access would help daily use"],
      keywords: [], competitors: [], sourcing: [],
    });
    expect(report.painPoints.map((entry) => entry.topic)).toEqual(["organization_need", "access_need"]);
    expect(report.customerNeeds.every((entry) => entry.sourceType === "VOC")).toBe(true);
  });

  it("classifies keyword intent without turning keywords into product facts", () => {
    const report = analyzeMarketingIntelligence({ voc: [], keywords: ["storage organizer", "kitchen counter"], competitors: [], sourcing: [] });
    expect(report.marketAngles.map((entry) => entry.topic)).toEqual(["organization", "kitchen_convenience"]);
    expect(JSON.stringify(report)).not.toContain("factId");
    expect(JSON.stringify(report)).not.toContain("claim");
  });

  it("isolates competitor patterns and never copies competitor text", () => {
    const source = "Best organizer guaranteed to keep every kitchen perfectly tidy";
    const report = analyzeMarketingIntelligence({ voc: [], keywords: [], competitors: [source], sourcing: [] });
    expect(report.competitorPatterns.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(source);
    expect(report.competitorPatterns.every((entry) => entry.referenceOnly && entry.sourceType === "competitor")).toBe(true);
  });

  it("keeps sourcing as availability reference only", () => {
    const report = analyzeMarketingIntelligence({ voc: [], keywords: [], competitors: [], sourcing: ["¥12.50, MOQ 10, iron" ] });
    expect(report.recommendations[0]?.sourceType).toBe("sourcing");
    expect(report.recommendations[0]?.summary).toContain("不能视为当前商品事实");
    expect(JSON.stringify(report)).not.toContain("factId");
  });

  it("does not mutate research input or create confirmed facts", () => {
    const input: MarketingResearchReference = {
      voc: ["messy kitchen"], keywords: ["storage"], competitors: ["organize items"], sourcing: ["supplier offer"],
    };
    const before = JSON.stringify(input);
    const report: MarketingInsightV1 = analyzeMarketingIntelligence(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(report).not.toHaveProperty("confirmedFacts");
    expect(report).not.toHaveProperty("productFacts");
  });

  it("does not change the deterministic Listing output", () => {
    const input: ListingGenerationInput = {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [{ field: "product_type", label: "Product type", value: "Organizer" }],
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
      creativeContext: {
        vocInsights: ["messy kitchen"],
        aiReferences: [],
        keywordCandidates: ["storage organizer"],
        competitiveContext: [],
        sourcingContext: [],
      },
    };
    const before = composeListingDraft(input);
    analyzeMarketingIntelligence(marketingResearchReferenceFixture);
    const after = composeListingDraft(input);
    expect(after).toEqual(before);
  });
});
