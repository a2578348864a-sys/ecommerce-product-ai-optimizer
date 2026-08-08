import { describe, expect, it } from "vitest";
import { parseStudioListingInput } from "./studioListingInput";

const VALID_MANUAL_BRIEF = {
  briefVersion: "studio-creative-brief.v1",
  productName: "Foldable laptop stand",
  targetMarket: "US",
  confirmedFacts: ["Aluminium frame", "Six height positions"],
  unverifiedFacts: ["Supports 20 kg"],
  prohibitedClaims: ["Military grade"],
  targetAudience: "Remote workers",
  tone: "professional",
  additionalRequirements: "Keep the copy concise.",
  factsConfirmed: true,
  humanReviewRequired: true,
  mode: "mock",
} as const;

describe("studio-creative-brief.v1 Listing contract", () => {
  it("accepts a confirmed manual brief and keeps confirmed and unverified material separate", () => {
    const parsed = parseStudioListingInput(VALID_MANUAL_BRIEF);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.briefVersion).toBe("studio-creative-brief.v1");
    expect(parsed.data.factsConfirmed).toBe(true);
    expect(parsed.data.humanReviewRequired).toBe(true);
    expect(parsed.data.additionalRequirements).toBe("Keep the copy concise.");
    expect(parsed.data.preferences.confirmedFacts).toEqual([
      "Aluminium frame",
      "Six height positions",
    ]);
    expect(parsed.data.preferences.unverifiedFacts).toEqual(["Supports 20 kg"]);
  });

  it("rejects a manual brief until the user explicitly confirms its facts", () => {
    const parsed = parseStudioListingInput({
      ...VALID_MANUAL_BRIEF,
      factsConfirmed: false,
    });

    expect(parsed).toEqual({
      ok: false,
      error: {
        code: "studio_brief_confirmation_required",
        message: "请确认商品事实由你提供或确认，生成结果仅作为待人工复核的草稿。",
      },
    });
  });

  it("rejects attempts to smuggle Task, Candidate, revision, or authority fields into Manual mode", () => {
    for (const field of ["taskId", "candidateId", "researchRevision", "creativeHandoff"] as const) {
      const parsed = parseStudioListingInput({ ...VALID_MANUAL_BRIEF, [field]: "forged" });
      expect(parsed.ok, field).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe("unsupported_request_field");
    }
  });
});
