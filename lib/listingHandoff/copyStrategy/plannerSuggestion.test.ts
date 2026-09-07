import { describe, expect, it } from "vitest";
import { buildCopyStrategy } from "./analyzer";
import {
  assertCopyStrategyPlannerSuggestionV1,
  buildCopyStrategyPlannerSuggestion,
  isCopyStrategyPlannerSuggestionV1,
} from "./plannerSuggestion";
import type { CopyStrategyV1 } from "./types";

const strategy: CopyStrategyV1 = buildCopyStrategy({
  marketingInsight: {
    version: "marketing-insight.v1",
    referenceOnly: true,
    painPoints: [{ topic: "organization_need", summary: "Keep everyday spaces organized", sourceType: "VOC", confidence: "high", referenceOnly: true }],
    customerNeeds: [],
    marketAngles: [{ topic: "kitchen_convenience", summary: "Kitchen organization", sourceType: "keyword", confidence: "medium", referenceOnly: true }],
    keywordThemes: [],
    competitorPatterns: [],
    recommendations: [],
  },
  confirmedFactSummary: { count: 2, labels: ["Color", "Pack count"] },
});

describe("Copy Strategy Planner Suggestion", () => {
  it("builds a normal reference-only suggestion", () => {
    const suggestion = buildCopyStrategyPlannerSuggestion(strategy);
    expect(suggestion.version).toBe("copy-strategy-planner-suggestion.v1");
    expect(suggestion.referenceOnly).toBe(true);
    expect(suggestion.requiresHumanApproval).toBe(true);
    expect(suggestion.targetRoles).toEqual(expect.arrayContaining(["core_outcome", "pain_relief", "use_scenario"]));
    expect(suggestion.bulletStructureSuggestions[0]?.structure).toBe("feature_benefit_scenario");
    expect(isCopyStrategyPlannerSuggestionV1(suggestion)).toBe(true);
    expect(() => assertCopyStrategyPlannerSuggestionV1(suggestion)).not.toThrow();
  });

  it("does not expose fact, claim, evidence, or generated-copy fields", () => {
    const forbidden = new Set([
      "factId", "factIds", "confirmedFacts", "productFacts", "claim", "evidence",
      "usedFactIds", "generatedCopy", "titleText", "bulletText", "descriptionText",
    ]);
    const keys = Object.keys(buildCopyStrategyPlannerSuggestion(strategy));
    expect(keys.some((key) => forbidden.has(key))).toBe(false);
    expect(JSON.stringify(buildCopyStrategyPlannerSuggestion(strategy))).not.toMatch(/factId|generatedCopy|titleText|bulletText|descriptionText/);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(strategy);
    const before = JSON.stringify(input);
    buildCopyStrategyPlannerSuggestion(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("returns a safe empty preview for empty input", () => {
    const suggestion = buildCopyStrategyPlannerSuggestion(null);
    expect(suggestion).toEqual({
      version: "copy-strategy-planner-suggestion.v1",
      referenceOnly: true,
      targetRoles: [],
      recommendedAngles: [],
      bulletStructureSuggestions: [],
      titleApproach: null,
      descriptionApproach: null,
      requiresHumanApproval: true,
    });
  });

  it("produces no Listing text and therefore cannot alter Listing output", () => {
    const suggestion = buildCopyStrategyPlannerSuggestion(strategy);
    expect("generatedCopy" in suggestion).toBe(false);
    expect("titleText" in suggestion).toBe(false);
    expect("bulletText" in suggestion).toBe(false);
    expect("descriptionText" in suggestion).toBe(false);
  });

  it("rejects an invalid payload at the contract boundary", () => {
    expect(isCopyStrategyPlannerSuggestionV1({ version: "copy-strategy-planner-suggestion.v1", referenceOnly: false })).toBe(false);
  });
});
