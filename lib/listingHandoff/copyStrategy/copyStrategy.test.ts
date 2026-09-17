import { describe, expect, it } from "vitest";
import { analyzeMarketingIntelligence } from "@/lib/listingHandoff/marketingIntelligence/analyzer";
import { marketingResearchReferenceFixture } from "@/lib/listingHandoff/marketingIntelligence/fixtures/marketingResearchReference";
import { buildCopyStrategy } from "./analyzer";
import { parseCopyStrategyV1 } from "./schema";
import type { ConfirmedFactSummary } from "./types";

const insight = analyzeMarketingIntelligence(marketingResearchReferenceFixture);
const facts: ConfirmedFactSummary = { count: 3, labels: ["Product type", "Color", "Quantity"] };

describe("Copy Strategy Layer v1", () => {
  it("returns a safe empty strategy for empty input", () => {
    const result = buildCopyStrategy();
    expect(parseCopyStrategyV1(result).ok).toBe(true);
    expect(result.referenceOnly).toBe(true);
    expect(result.targetBuyer).toBeNull();
    expect(result.buyerPainPoints).toEqual([]);
  });

  it("derives a strategy from Marketing Intelligence and safe summaries", () => {
    const result = buildCopyStrategy({ marketingInsight: insight, confirmedFactSummary: facts });
    expect(result.targetBuyer).toBeTruthy();
    expect(result.mainAngle).toBeTruthy();
    expect(result.bulletStrategies[0]?.structure).toBe("feature_benefit_scenario");
    expect(result.bulletStrategies.every((item) => item.referenceOnly)).toBe(true);
  });

  it("does not expose fact ids, confirmed facts, claims, evidence, or used ids", () => {
    const serialized = JSON.stringify(buildCopyStrategy({ marketingInsight: insight, confirmedFactSummary: facts }));
    for (const forbidden of ["factId", "confirmedFacts", "claim", "evidence", "usedFactIds"]) expect(serialized).not.toContain(forbidden);
  });

  it("does not mutate the confirmed fact summary", () => {
    const before = JSON.stringify(facts);
    buildCopyStrategy({ marketingInsight: insight, confirmedFactSummary: facts });
    expect(JSON.stringify(facts)).toBe(before);
  });

  it("does not produce Listing fields or change a caller-owned output", () => {
    const result = buildCopyStrategy({ marketingInsight: insight, confirmedFactSummary: facts });
    expect(result).not.toHaveProperty("title");
    expect(result).not.toHaveProperty("bullets");
    expect(result).not.toHaveProperty("description");
  });

  it("rejects illegal fields", () => {
    const result = buildCopyStrategy({ marketingInsight: insight });
    expect(parseCopyStrategyV1({ ...result, claim: "illegal" }).ok).toBe(false);
    expect(parseCopyStrategyV1({ ...result, referenceOnly: false }).ok).toBe(false);
  });
});
