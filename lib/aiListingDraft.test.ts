import { describe, expect, it } from "vitest";
import { buildMockAiListingDraft, validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

function validDraft() {
  return buildMockAiListingDraft({
    productName: "Desktop Phone Stand",
    decisionSummary: "Good candidate after manual review.",
    riskLevel: "yellow",
    category: "phone accessory",
    sellingPoints: ["Adjustable angle", "Compact desktop use"],
  });
}

describe("validateAiListingPackDraft", () => {
  it("accepts a valid mock draft", () => {
    const result = validateAiListingPackDraft(validDraft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("mock_ai_draft");
      expect(result.data.model).toBe("mock");
      expect(result.data.humanReviewRequired).toBe(true);
    }
  });

  it("rejects non-object input", () => {
    const result = validateAiListingPackDraft(null);
    expect(result.ok).toBe(false);
  });

  it("rejects humanReviewRequired=false", () => {
    const result = validateAiListingPackDraft({ ...validDraft(), humanReviewRequired: false });
    expect(result.ok).toBe(false);
  });

  it("rejects titles that are not arrays", () => {
    const result = validateAiListingPackDraft({ ...validDraft(), titles: "bad" });
    expect(result.ok).toBe(false);
  });

  it("rejects empty description", () => {
    const result = validateAiListingPackDraft({ ...validDraft(), description: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects source other than mock_ai_draft", () => {
    const result = validateAiListingPackDraft({ ...validDraft(), source: "ai_draft" });
    expect(result.ok).toBe(false);
  });

  it("rejects visible banned claims before filtering", () => {
    const result = validateAiListingPackDraft({
      ...validDraft(),
      titles: ["FDA Approved Desktop Phone Stand"],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a draft after claim filtering", () => {
    const filtered = filterListingClaims({
      ...validDraft(),
      bullets: ["100% Safe Medical Grade desktop accessory."],
    });

    const result = validateAiListingPackDraft(filtered.cleaned);

    expect(filtered.blockedClaims).toEqual(expect.arrayContaining(["100% Safe", "Medical Grade"]));
    expect(result.ok).toBe(true);
  });
});

describe("buildMockAiListingDraft", () => {
  it("generates a valid draft from full context", () => {
    const draft = validDraft();
    const result = validateAiListingPackDraft(draft);

    expect(result.ok).toBe(true);
    expect(draft.titles.length).toBeGreaterThanOrEqual(1);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(5);
    expect(draft.reviewChecklist.join(" ")).toMatch(/Human review required/i);
  });

  it("generates a safe fallback from minimal input", () => {
    const draft = buildMockAiListingDraft({});
    const result = validateAiListingPackDraft(draft);

    expect(result.ok).toBe(true);
    expect(draft.humanReviewRequired).toBe(true);
    expect(draft.riskNotes.length).toBeGreaterThan(0);
    expect(JSON.stringify(draft)).not.toMatch(/FDA Approved|100% Safe|Medical Grade|稳赚|爆款必出|保证盈利/);
  });
});
