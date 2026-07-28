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

  it("accepts a valid real AI draft shape for future guarded route integration", () => {
    const result = validateAiListingPackDraft({
      ...validDraft(),
      source: "real_ai_draft",
      model: "deepseek-chat",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("real_ai_draft");
      expect(result.data.model).toBe("deepseek-chat");
      expect(result.data.humanReviewRequired).toBe(true);
    }
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

  it("uses every supported Studio preference in a deterministic English draft", () => {
    const input = {
      productName: "Foldable Laptop Stand",
      decisionSummary: "Aluminum desk stand with a fold-flat body.",
      riskLevel: "low",
      category: "Home Office",
      sellingPoints: ["Portable base", "Example Rival compatible"],
      studioPreferences: {
        targetMarket: "US" as const,
        outputLanguage: "en" as const,
        tone: "professional" as const,
        coreFunction: "Six height positions",
        targetAudience: "Remote workers",
        problemSolved: "Raises the screen for a clearer viewing angle",
        differentiators: ["Fold-flat body", "Silicone contact pads"],
        primaryKeywords: ["laptop stand"],
        secondaryKeywords: ["foldable laptop stand", "desk stand"],
        competitorKeywords: ["Example Rival"],
        confirmedFacts: [],
        unverifiedFacts: [],
        prohibitedClaims: [],
        listingObjective: "balanced" as const,
      },
    };

    const first = buildMockAiListingDraft(input);
    const second = buildMockAiListingDraft(input);
    const visibleCopy = [
      ...first.titles,
      ...first.bullets,
      first.description,
      ...first.keywords,
      ...first.sellingPoints,
    ].join(" ");

    expect(visibleCopy).toContain("US");
    expect(visibleCopy).toContain("Six height positions");
    expect(visibleCopy).toContain("Remote workers");
    expect(visibleCopy).toContain("Raises the screen for a clearer viewing angle");
    expect(visibleCopy).toContain("Fold-flat body");
    expect(visibleCopy).toContain("Silicone contact pads");
    expect(first.titles[0].toLocaleLowerCase()).toContain("laptop stand");
    expect(first.keywords).toEqual(expect.arrayContaining([
      "laptop stand",
      "foldable laptop stand",
      "desk stand",
    ]));
    expect(visibleCopy).not.toContain("Example Rival");
    expect(JSON.stringify(first)).not.toContain("Example Rival");
    expect({ ...first, generatedAt: "" }).toEqual({ ...second, generatedAt: "" });
  });

  it("uses confirmed facts and the objective while keeping pending and prohibited facts out of commercial copy", () => {
    const preferences = {
      targetMarket: "US" as const,
      outputLanguage: "en" as const,
      tone: "professional" as const,
      coreFunction: "Adjustable viewing angle",
      targetAudience: "Remote workers",
      problemSolved: "Raises the screen",
      differentiators: ["Fold-flat body"],
      primaryKeywords: ["laptop stand"],
      secondaryKeywords: ["foldable stand"],
      competitorKeywords: [],
      confirmedFacts: ["Frame weight is 520 g"],
      unverifiedFacts: ["Supports 20 kg"],
      prohibitedClaims: ["Military grade"],
      listingObjective: "balanced" as const,
    };
    const objectives = ["balanced", "seo", "conversion", "brand"] as const;
    const drafts = objectives.map((listingObjective) => buildMockAiListingDraft({
      productName: "Foldable Laptop Stand",
      category: "Home Office",
      studioPreferences: { ...preferences, listingObjective },
    }));
    const first = drafts[0];
    const commercialCopy = [
      ...first.titles,
      ...first.bullets,
      first.description,
      ...first.keywords,
      ...first.sellingPoints,
    ].join(" ");

    expect(commercialCopy).toContain("Frame weight is 520 g");
    expect(commercialCopy).not.toContain("Supports 20 kg");
    expect(first.riskNotes.join(" ")).toContain("Supports 20 kg");
    expect(JSON.stringify(first)).not.toContain("Military grade");
    expect(new Set(drafts.map((draft) => draft.description)).size).toBe(4);
    expect(JSON.stringify(drafts)).not.toMatch(/guaranteed (?:conversion|ranking)/i);
  });

  it("changes the full template for German output and applies the selected tone", () => {
    const base = {
      productName: "Laptopständer",
      decisionSummary: "Klappbarer Aluminiumständer.",
      category: "Homeoffice",
      studioPreferences: {
        targetMarket: "DE" as const,
        outputLanguage: "de" as const,
        tone: "concise" as const,
        coreFunction: "Sechs Höhenstufen",
        targetAudience: "Menschen im Homeoffice",
        problemSolved: "Hebt den Bildschirm an",
        differentiators: ["Flach zusammenklappbar"],
        primaryKeywords: ["Laptopständer"],
        secondaryKeywords: ["klappbarer Ständer"],
        competitorKeywords: [],
        confirmedFacts: [],
        unverifiedFacts: [],
        prohibitedClaims: [],
        listingObjective: "balanced" as const,
      },
    };
    const concise = buildMockAiListingDraft(base);
    const brand = buildMockAiListingDraft({
      ...base,
      studioPreferences: { ...base.studioPreferences, tone: "brand" as const },
    });

    expect(concise.description).toMatch(/Produktentwurf|manuell/i);
    expect(concise.bullets.join(" ")).toContain("Sechs Höhenstufen");
    expect(concise.bullets.join(" ")).toContain("Menschen im Homeoffice");
    expect(concise.description).not.toEqual(brand.description);
    expect(validateAiListingPackDraft(concise).ok).toBe(true);
    expect(validateAiListingPackDraft(brand).ok).toBe(true);
  });

  it("keeps the legacy mock call valid without Studio preferences", () => {
    const draft = buildMockAiListingDraft({
      productName: "Legacy Desk Stand",
      sellingPoints: ["Adjustable angle"],
    });

    expect(validateAiListingPackDraft(draft).ok).toBe(true);
    expect(draft.titles[0]).toContain("Legacy Desk Stand");
  });
});
