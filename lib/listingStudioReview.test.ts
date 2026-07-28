import { describe, expect, it } from "vitest";
import {
  buildListingGenerationReadiness,
  buildListingJsonExport,
  buildListingStudioReview,
  buildListingTxtExport,
} from "@/lib/listingStudioReview";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { StudioListingPreferences } from "@/lib/studioListingInput";

const preferences: StudioListingPreferences = {
  targetMarket: "US",
  outputLanguage: "en",
  tone: "professional",
  coreFunction: "Six height positions",
  targetAudience: "Remote workers",
  problemSolved: "Raises the screen",
  differentiators: ["Fold-flat body", "Silicone contact pads"],
  primaryKeywords: ["laptop stand"],
  secondaryKeywords: ["foldable desk stand", "home office stand"],
  competitorKeywords: ["Example Rival"],
  confirmedFacts: ["Frame weight is 520 g"],
  unverifiedFacts: [],
  prohibitedClaims: ["Military grade"],
  listingObjective: "balanced",
};

const listingPack: AiListingPackDraft = {
  source: "mock_ai_draft",
  version: 1,
  generatedAt: "2026-07-26T00:00:00.000Z",
  model: "mock",
  humanReviewRequired: true,
  titles: ["Laptop Stand for a Home Office"],
  bullets: [
    "Six height positions help remote workers raise the screen.",
    "The fold-flat body stores easily between sessions.",
    "Material details still require review.",
  ],
  description: "A foldable desk stand with silicone contact pads for a tidy workspace.",
  keywords: ["laptop stand", "foldable desk stand"],
  sellingPoints: ["Six height positions", "Fold-flat body", "Silicone contact pads"],
  riskNotes: ["Manual review required."],
  complianceWarnings: ["Blocked unverified listing claims."],
  blockedClaims: ["FDA Approved"],
  reviewChecklist: ["Check supplier documents."],
};

describe("buildListingStudioReview", () => {
  it("reports exact title and description character counts", () => {
    const review = buildListingStudioReview(listingPack, preferences);

    expect(review.title.characterCount).toBe(listingPack.titles[0].length);
    expect(review.description.characterCount).toBe(listingPack.description.length);
  });

  it("calculates target keyword coverage without treating competitor terms as targets", () => {
    const review = buildListingStudioReview(listingPack, preferences);

    expect(review.keywords.targets).toEqual([
      "laptop stand",
      "foldable desk stand",
      "home office stand",
    ]);
    expect(review.keywords.covered).toEqual(["laptop stand", "foldable desk stand"]);
    expect(review.keywords.uncovered).toEqual(["home office stand"]);
    expect(review.keywords.suggested).toEqual(["home office stand"]);
    expect(review.keywords.targets).not.toContain("Example Rival");
  });

  it("maps a bullet only to selling-point text that actually appears in that bullet", () => {
    const review = buildListingStudioReview(listingPack, preferences);

    expect(review.bullets[0].matchedSellingPoints).toEqual(["Six height positions"]);
    expect(review.bullets[1].matchedSellingPoints).toEqual(["Fold-flat body"]);
    expect(review.bullets[2].matchedSellingPoints).toEqual([]);
  });

  it("reports competitor leakage separately and never recommends competitor terms", () => {
    const leaked = {
      ...listingPack,
      description: `${listingPack.description} Compare with Example Rival manually.`,
    };
    const review = buildListingStudioReview(leaked, preferences);

    expect(review.keywords.competitorTerms).toEqual(["Example Rival"]);
    expect(review.keywords.competitorLeaks).toEqual(["Example Rival"]);
    expect(review.keywords.suggested).not.toContain("Example Rival");
  });

  it("surfaces only actual blocked claims and warnings from the generated pack", () => {
    const review = buildListingStudioReview(listingPack, preferences);

    expect(review.risk.blockedClaims).toEqual(["FDA Approved"]);
    expect(review.risk.complianceWarnings).toEqual(["Blocked unverified listing claims."]);
    expect(review.risk.riskNotes).toEqual(["Manual review required."]);
  });

  it("counts every target keyword by actual output region and total occurrences", () => {
    const countedPack: AiListingPackDraft = {
      ...listingPack,
      titles: ["Laptop Stand laptop stand"],
      bullets: [
        "Laptop stand and foldable desk stand.",
        "Another laptop stand use.",
      ],
      description: "A laptop stand for a home office stand.",
      keywords: ["laptop stand", "foldable desk stand", "laptop stand"],
    };
    const review = buildListingStudioReview(countedPack, preferences);

    expect(review.keywords.matrix).toEqual([
      {
        keyword: "laptop stand",
        kind: "primary",
        title: 2,
        bullet: 2,
        description: 1,
        searchTerms: 2,
        total: 7,
      },
      {
        keyword: "foldable desk stand",
        kind: "secondary",
        title: 0,
        bullet: 1,
        description: 0,
        searchTerms: 1,
        total: 2,
      },
      {
        keyword: "home office stand",
        kind: "secondary",
        title: 0,
        bullet: 0,
        description: 1,
        searchTerms: 0,
        total: 1,
      },
    ]);
  });

  it("identifies missing input facts and exposes no fabricated score", () => {
    const review = buildListingStudioReview(listingPack, {
      ...preferences,
      coreFunction: "",
      targetAudience: "",
      problemSolved: "",
      differentiators: [],
    });

    expect(review.missingFacts).toEqual([
      "coreFunction",
      "targetAudience",
      "problemSolved",
      "differentiators",
    ]);
    expect(review).not.toHaveProperty("score");
    expect(review).not.toHaveProperty("aiScore");
  });
});

describe("Listing readiness and browser-only export", () => {
  it("reports deterministic information completeness without presenting an AI score", () => {
    const readiness = buildListingGenerationReadiness({
      productName: "Foldable Laptop Stand",
      description: "",
      preferences: {
        ...preferences,
        confirmedFacts: [],
        coreFunction: "",
        primaryKeywords: [],
        prohibitedClaims: [],
      },
    });

    expect(readiness.totalCount).toBe(8);
    expect(readiness.completedCount).toBe(3);
    expect(readiness.completionPercent).toBe(38);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      "description",
      "confirmedFacts",
      "coreFunction",
      "primaryKeywords",
      "prohibitedClaims",
    ]);
    expect(readiness).not.toHaveProperty("score");
    expect(readiness).not.toHaveProperty("aiScore");
  });

  it("builds deterministic TXT and structured JSON from the current result only", () => {
    const txt = buildListingTxtExport(listingPack);
    const json = buildListingJsonExport(listingPack);

    expect(txt).toContain("TITLE");
    expect(txt).toContain(listingPack.titles[0]);
    expect(txt).toContain("BULLET POINTS");
    expect(txt).toContain("SEARCH TERMS");
    expect(JSON.parse(json)).toEqual(listingPack);
  });
});
