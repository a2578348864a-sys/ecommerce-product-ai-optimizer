import { describe, expect, it } from "vitest";
import {
  buildStudioListingRequestCore,
  EMPTY_LISTING_INTENT,
  type ListingFormIntent,
} from "@/lib/client/studioListingRequest";

describe("buildStudioListingRequestCore", () => {
  it("wires every visible auxiliary field into the API request", () => {
    const intent: ListingFormIntent = {
      targetMarket: "DE",
      outputLanguage: "de",
      coreFunctions: "Six height positions",
      targetAudience: "Remote workers",
      problemsSolved: "Raises the screen",
      differentiators: "Fold-flat body, Silicone contact pads",
      primaryKeyword: "laptop stand",
      secondaryKeywords: "foldable stand; desk stand",
      competitorKeywords: "Example Rival",
      confirmedFacts: "Aluminum frame; Folds to 18 mm",
      unverifiedFacts: "Supports 20 kg",
      prohibitedClaims: "medical grade, guaranteed ranking",
      additionalRequirements: "Keep every bullet concise.",
      listingObjective: "seo",
      copyStyle: "brand",
    };

    expect(buildStudioListingRequestCore({
      productName: "  Foldable Laptop Stand ",
      description: " Aluminum desk stand. ",
      category: " Home Office ",
      intent,
      mode: "mock",
    })).toEqual({
      briefVersion: "studio-creative-brief.v1",
      factsConfirmed: true,
      humanReviewRequired: true,
      productName: "Foldable Laptop Stand",
      description: "Aluminum desk stand.",
      category: "Home Office",
      mode: "mock",
      targetMarket: "DE",
      outputLanguage: "de",
      tone: "brand",
      coreFunction: "Six height positions",
      targetAudience: "Remote workers",
      problemSolved: "Raises the screen",
      differentiators: ["Fold-flat body", "Silicone contact pads"],
      primaryKeywords: ["laptop stand"],
      secondaryKeywords: ["foldable stand", "desk stand"],
      competitorKeywords: ["Example Rival"],
      confirmedFacts: ["Aluminum frame", "Folds to 18 mm"],
      unverifiedFacts: ["Supports 20 kg"],
      prohibitedClaims: ["medical grade", "guaranteed ranking"],
      additionalRequirements: "Keep every bullet concise.",
      listingObjective: "seo",
    });
  });

  it("provides the supported default contract without unsupported language options", () => {
    expect(EMPTY_LISTING_INTENT).toMatchObject({
      targetMarket: "US",
      outputLanguage: "en",
      copyStyle: "professional",
      confirmedFacts: "",
      unverifiedFacts: "",
      prohibitedClaims: "",
      listingObjective: "balanced",
    });
  });
});
