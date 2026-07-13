import { describe, expect, it } from "vitest";
import {
  CURRENT_RULE_ASSESSMENT_ALGORITHM,
  LEGACY_RULE_ASSESSMENT_ALGORITHM,
  getSignedSourceQueuePolicy,
  isSupportedStoredAssessmentAlgorithm,
} from "@/lib/ruleAssessmentPolicy";

describe("signed source queue policy", () => {
  it("defaults only reviewable product candidates into the import selection", () => {
    expect(getSignedSourceQueuePolicy({
      algorithm: CURRENT_RULE_ASSESSMENT_ALGORITHM,
      candidateType: "product_candidate",
      queueSuggestion: "review",
    })).toEqual({ canSave: true, defaultSelected: true, reason: "ready_for_review" });
  });

  it("allows watch product candidates only by explicit individual selection", () => {
    expect(getSignedSourceQueuePolicy({
      algorithm: CURRENT_RULE_ASSESSMENT_ALGORITHM,
      candidateType: "product_candidate",
      queueSuggestion: "watch",
    })).toEqual({ canSave: true, defaultSelected: false, reason: "manual_watch" });
  });

  it.each([
    ["category_hint", "watch", "not_product_candidate"],
    ["trend_signal", "watch", "not_product_candidate"],
    ["rejected", "reject", "not_product_candidate"],
    ["product_candidate", "reject", "queue_rejected"],
  ] as const)("blocks %s / %s from Candidate persistence", (candidateType, queueSuggestion, reason) => {
    expect(getSignedSourceQueuePolicy({
      algorithm: CURRENT_RULE_ASSESSMENT_ALGORITHM,
      candidateType,
      queueSuggestion,
    })).toEqual({ canSave: false, defaultSelected: false, reason });
  });

  it("fails closed for stale or unknown algorithms", () => {
    expect(getSignedSourceQueuePolicy({
      algorithm: LEGACY_RULE_ASSESSMENT_ALGORITHM,
      candidateType: "product_candidate",
      queueSuggestion: "review",
    })).toEqual({ canSave: false, defaultSelected: false, reason: "unsupported_algorithm" });
    expect(getSignedSourceQueuePolicy({
      algorithm: "future-unreviewed-v9",
      candidateType: "product_candidate",
      queueSuggestion: "review",
    })).toEqual({ canSave: false, defaultSelected: false, reason: "unsupported_algorithm" });
  });

  it("keeps the known legacy algorithm readable while rejecting unknown stored algorithms", () => {
    expect(isSupportedStoredAssessmentAlgorithm(LEGACY_RULE_ASSESSMENT_ALGORITHM)).toBe(true);
    expect(isSupportedStoredAssessmentAlgorithm(CURRENT_RULE_ASSESSMENT_ALGORITHM)).toBe(true);
    expect(isSupportedStoredAssessmentAlgorithm("future-unreviewed-v9")).toBe(false);
  });
});
