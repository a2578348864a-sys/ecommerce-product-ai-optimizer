import { describe, expect, it } from "vitest";
import type { ListingV5Strategy } from "./types";
import { projectStrategyReferenceForProvider } from "./generation";

function strategy(overrides: Partial<ListingV5Strategy> = {}): ListingV5Strategy {
  return {
    version: "listing-v5.strategy.v1",
    referenceOnly: true,
    researchRevision: 1,
    targetAudience: ["Households decorating for Halloween who want small indoor accents rather than outdoor props"],
    purchaseMotivations: [],
    painPoints: [],
    useCases: ["Placing seasonal accents on a coffee table"],
    primaryAngle: "A softer vintage aesthetic as an alternative to scary decor",
    secondaryAngles: ["Indoor styling unlike large porch displays", "A clear seasonal direction"],
    tone: ["Warm and home-styling oriented"],
    keywordIntent: { primary: ["halloween decor"], secondary: ["fall decor"], backendOnly: [] },
    bulletAngles: [{ role: "core_outcome", shopperValue: "Show the seasonal look" }],
    avoidClaims: [],
    ...overrides,
  };
}

describe("Strategy reference projection", () => {
  it("removes comparison targets while preserving positive framing fields", () => {
    const projected = projectStrategyReferenceForProvider(strategy());
    const executableReference = JSON.stringify({
      targetAudience: projected.targetAudience,
      primaryAngle: projected.primaryAngle,
      secondaryAngles: projected.secondaryAngles,
      useCases: projected.useCases,
      tone: projected.tone,
    });

    expect(projected.referenceOnly).toBe(true);
    expect(projected.targetAudience).toEqual(["Households decorating for Halloween who want small indoor accents"]);
    expect(projected.primaryAngle).toBe("A softer vintage aesthetic");
    expect(projected.secondaryAngles).toEqual(["Indoor styling", "A clear seasonal direction"]);
    expect(projected.useCases).toEqual(["Placing seasonal accents on a coffee table"]);
    expect(projected.tone).toEqual(["Warm and home-styling oriented"]);
    expect(executableReference).not.toMatch(/\b(?:instead of|rather than|alternative to|unlike|better than)\b/i);
    expect(executableReference).not.toMatch(/\bnot\s+\w+/i);
  });

  it("does not pass negative style framing into the executable reference", () => {
    const projected = projectStrategyReferenceForProvider(strategy({
      targetAudience: ["Shoppers who are not scary-style buyers"],
      primaryAngle: "Not a horror prop for the room",
      secondaryAngles: ["Never a creepy display"],
    }));

    const executableReference = JSON.stringify({
      targetAudience: projected.targetAudience,
      primaryAngle: projected.primaryAngle,
      secondaryAngles: projected.secondaryAngles,
    });
    expect(executableReference).not.toMatch(/\bnot\s+scary\b/i);
    expect(executableReference).not.toMatch(/\bnever\s+creepy\b/i);
    expect(executableReference).not.toMatch(/\bhorror\b/i);
  });
});
