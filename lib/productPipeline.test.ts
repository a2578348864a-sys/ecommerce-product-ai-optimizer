import { describe, it, expect } from "vitest";
import { derivePipelineStatus, deriveNextAction, type PipelineInput } from "./productPipeline";

describe("lib/productPipeline - derivePipelineStatus", () => {
  const baseReviewedResult = {
    reviewState: { allReviewed: true, reviewedCount: 3 },
    profitSnapshot: { estimatedProfit: 100 },
    riskReviewSnapshot: { riskLevel: "low" },
  };

  it("case 1: legacy decisionStatus=continue -> ready_for_listing or listing_ready", () => {
    // 1a: without listingPrepSnapshot -> ready_for_listing
    const inputWithoutPrep: PipelineInput = {
      decisionStatus: "continue",
      level: "green",
      result: baseReviewedResult,
    };
    const statusWithoutPrep = derivePipelineStatus(inputWithoutPrep);
    expect(statusWithoutPrep).toBe("ready_for_listing");
    expect(["ready_for_listing", "listing_ready"]).toContain(statusWithoutPrep);

    // 1b: with listingPrepSnapshot -> listing_ready
    const inputWithPrep: PipelineInput = {
      decisionStatus: "continue",
      level: "green",
      result: {
        ...baseReviewedResult,
        listingPrepSnapshot: { title: "Test Title" },
      },
    };
    const statusWithPrep = derivePipelineStatus(inputWithPrep);
    expect(statusWithPrep).toBe("listing_ready");
    expect(["ready_for_listing", "listing_ready"]).toContain(statusWithPrep);
  });

  it("case 2: modern decisionStatus=creative_ready -> advances to correct ready state", () => {
    // 2a: normal reviewed flow -> ready_for_listing
    const modernInput: PipelineInput = {
      decisionStatus: "creative_ready",
      level: "green",
      result: baseReviewedResult,
    };
    const status = derivePipelineStatus(modernInput);
    expect(status).toBe("ready_for_listing");

    // 2b: normal reviewed flow with prep -> listing_ready
    const modernInputWithPrep: PipelineInput = {
      decisionStatus: "creative_ready",
      level: "green",
      result: {
        ...baseReviewedResult,
        listingPrepSnapshot: { title: "Test Title" },
      },
    };
    const statusWithPrep = derivePipelineStatus(modernInputWithPrep);
    expect(statusWithPrep).toBe("listing_ready");

    // 2c: high risk level human override -> ready_to_advance
    const highRiskInput: PipelineInput = {
      decisionStatus: "creative_ready",
      level: "high",
      result: baseReviewedResult,
    };
    const highRiskStatus = derivePipelineStatus(highRiskInput);
    expect(highRiskStatus).toBe("ready_to_advance");
  });

  it("case 3: needs_information -> not listing ready", () => {
    // 3a: reviewed but needs_information decision
    const inputNeedsInfo: PipelineInput = {
      decisionStatus: "needs_information",
      level: "green",
      result: baseReviewedResult,
    };
    const status = derivePipelineStatus(inputNeedsInfo);
    expect(status).not.toBe("ready_for_listing");
    expect(status).not.toBe("listing_ready");
    expect(status).toBe("ready_to_advance");

    // 3b: missing info -> needs_more_info
    const inputMissingInfo: PipelineInput = {
      decisionStatus: "needs_information",
      level: "green",
      result: {
        reviewState: { allReviewed: true, reviewedCount: 3 },
      },
    };
    const statusMissing = derivePipelineStatus(inputMissingInfo);
    expect(statusMissing).toBe("needs_more_info");
    expect(statusMissing).not.toBe("ready_for_listing");
    expect(statusMissing).not.toBe("listing_ready");

    // 3c: next action is not advance_to_listing or generate_listing_pack
    const nextAction = deriveNextAction(inputMissingInfo);
    expect(nextAction.key).not.toBe("advance_to_listing");
    expect(nextAction.key).not.toBe("generate_listing_pack");
  });

  it("abandoned modern contract -> abandoned", () => {
    const inputAbandoned: PipelineInput = {
      decisionStatus: "abandoned",
      level: "green",
      result: baseReviewedResult,
    };
    expect(derivePipelineStatus(inputAbandoned)).toBe("abandoned");
  });
});
