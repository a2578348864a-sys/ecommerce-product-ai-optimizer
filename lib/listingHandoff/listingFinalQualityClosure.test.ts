import { describe, expect, it } from "vitest";
import { dedupeListingBullets, draftSafeSummary, salvageAiListingBullets } from "./listingGenerationService";
import type { RuntimeFact } from "./listingRuntimeSkill";

describe("Listing final quality closure", () => {
  it("removes exact duplicate bullets while preserving the first wording", () => {
    const bullets = dedupeListingBullets([
      "Easy countertop organization for everyday utensils.",
      "easy countertop organization for everyday utensils!",
      "A two-size design keeps cooking tools sorted and easy to reach.",
      "The ceramic holders stay balanced on the counter during daily use.",
    ]);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toBe("Easy countertop organization for everyday utensils.");
  });

  it("keeps the more complete bullet for a bounded near duplicate", () => {
    const bullets = dedupeListingBullets([
      "Two sizes keep everyday cooking tools sorted and easy to reach.",
      "The two-size design keeps everyday cooking tools sorted and easy to reach on the counter.",
      "The ceramic body stays balanced during daily countertop use.",
    ]);
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toContain("on the counter");
  });

  it("does not collapse distinct supported bullet ideas", () => {
    const bullets = dedupeListingBullets([
      "The two-piece set keeps everyday tools sorted and easy to reach.",
      "The ceramic body stays balanced on the kitchen counter during daily use.",
      "The larger holder fits full-size cooking utensils for convenient storage.",
    ]);
    expect(bullets).toHaveLength(3);
  });

  it("returns fewer than three when fewer than three supported ideas remain", () => {
    expect(dedupeListingBullets([
      "Organizes tools on the counter.",
      "Organizes tools on the counter!",
    ])).toHaveLength(1);
  });

  it("salvages unsafe and overlong bullets without rewriting the surviving three", () => {
    const facts: RuntimeFact[] = [
      { factId: "material", field: "material", label: "Material", value: "Ceramic" },
      { factId: "capacity", field: "capacity", label: "Capacity", value: "2 Count" },
      { factId: "size", field: "size", label: "Size", value: "9.8 inch" },
    ];
    const result = salvageAiListingBullets({
      bullets: [
        "The ceramic body supports daily countertop organization.",
        "The set includes BPA-free components for kitchen storage.",
        "The organizer comes in a 2 Count for practical placement.",
        "This deliberately overlong bullet contains many unsupported words and keeps adding extra wording beyond the allowed runtime quality limit for a single sentence.",
        "A convenient organizer keeps the kitchen tidy without a confirmed fact anchor.",
      ],
      unsupportedClaims: [
        { text: "The set includes BPA-free components for kitchen storage", reason: "unsupported_certification_claim" },
      ],
      facts,
      usedFactIds: ["material", "capacity"],
    });
    expect(result.claimRejectedBullets).toHaveLength(1);
    expect(result.qualityRejectedBullets).toHaveLength(2);
    expect(result.acceptedBullets).toEqual([
      "The ceramic body supports daily countertop organization.",
      "The organizer comes in a 2 Count for practical placement.",
    ]);
    expect(result.acceptedBulletIndexes).toEqual([0, 2]);
  });

  it("does not treat an unclassified anchored sentence as a Claim rejection", () => {
    const result = salvageAiListingBullets({
      bullets: ["The ceramic body supports daily countertop organization."],
      unsupportedClaims: [{ text: "The ceramic body supports daily countertop organization", reason: "unclassified_factual_claim" }],
      facts: [{ factId: "material", field: "material", label: "Material", value: "Ceramic" }],
      usedFactIds: ["material"],
    });
    expect(result.claimRejectedBullets).toEqual([]);
    expect(result.qualityRejectedBullets).toEqual([]);
    expect(result.acceptedBullets).toHaveLength(1);
  });

  it("round-trips final renderer metadata through the safe snapshot projection", () => {
    const snapshot = {
      source: "deterministic_composition_v1",
      generatedAt: new Date().toISOString(),
      humanReviewRequired: true,
      titles: ["Acme organizer"],
      bullets: ["Ceramic construction supports daily countertop storage."],
      description: "A compact organizer for everyday use.",
      keywords: [],
      sellingPoints: [],
      riskNotes: [],
      reviewChecklist: [],
      blockedClaims: [],
      complianceWarnings: [],
      rendererQualifiedOptionCount: 8,
      rendererQualifiedRoleCount: 5,
      plannerRawSelectionCount: 3,
      plannerValidSelectionCount: 2,
      plannerRejectedSelectionCount: 1,
      plannerFilledSelectionCount: 1,
      plannerFinalSelectionCount: 3,
      plannerSemanticStatus: "partial",
      rendererFailureValidator: "plan_binding",
      rendererFailureFieldPath: "bulletPlans",
      rendererFailureReasonCode: "no_finalizable_plan",
    };
    const projected = draftSafeSummary(snapshot);
    expect(projected).toEqual(expect.objectContaining({
      rendererQualifiedOptionCount: 8,
      rendererQualifiedRoleCount: 5,
      plannerRawSelectionCount: 3,
      plannerValidSelectionCount: 2,
      plannerRejectedSelectionCount: 1,
      plannerFilledSelectionCount: 1,
      plannerFinalSelectionCount: 3,
      plannerSemanticStatus: "partial",
      rendererFailureValidator: "plan_binding",
      rendererFailureFieldPath: "bulletPlans",
      rendererFailureReasonCode: "no_finalizable_plan",
    }));
  });
});
