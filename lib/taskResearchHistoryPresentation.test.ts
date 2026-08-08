import { describe, expect, it } from "vitest";
import {
  deriveCreativeMaterialStatus,
  deriveHistoricalArtifactSummary,
  deriveResearchHistoryStatus,
} from "@/lib/taskResearchHistoryPresentation";

describe("research history status", () => {
  it("depends on saved research and a human decision, not creative artifacts", () => {
    const savedResearch = {
      productResearchSummary: {
        schema: "product-research-record.v1",
        revision: 2,
        status: "creative_ready",
        reasonSummary: "The product is worth a controlled test.",
      },
      finalReport: {
        finalVerdict: "Proceed only after supplier verification.",
      },
    };

    const withoutCreativeArtifacts = deriveResearchHistoryStatus({
      result: savedResearch,
      decisionStatus: "pending",
      oneLineSummary: "Research saved.",
    });
    const withCreativeArtifacts = deriveResearchHistoryStatus({
      result: {
        ...savedResearch,
        creativeHandoff: { currentRevision: 9, controlState: "active" },
        aiListingPackSnapshot: { snapshotType: "ai_listing_pack" },
        aiImageDraftSnapshot: { items: [{ id: "image-1" }] },
      },
      decisionStatus: "pending",
      oneLineSummary: "Research saved.",
    });

    expect(withoutCreativeArtifacts).toEqual({
      key: "completed",
      label: "研究已完成",
      researchSaved: true,
      humanDecisionExists: true,
    });
    expect(withCreativeArtifacts).toEqual(withoutCreativeArtifacts);
  });

  it("projects creative material and generated artifacts as read-only history summaries", () => {
    const result = {
      creativeHandoff: { currentRevision: 3, controlState: "active" },
      aiListingPackSnapshot: {
        snapshotType: "ai_listing_pack",
        generatedAt: "2026-08-09T02:00:00.000Z",
      },
      aiImageDraftSnapshot: {
        items: [{ id: "image-1" }, { id: "image-2" }],
      },
      imageStudioSelection: {
        selectedImageId: "image-2",
      },
    };

    expect(deriveCreativeMaterialStatus(result)).toEqual({
      key: "available",
      label: "可用于创作",
    });
    expect(deriveHistoricalArtifactSummary(result)).toEqual({
      hasListing: true,
      listingUpdatedAt: "2026-08-09T02:00:00.000Z",
      hasImages: true,
      imageCount: 2,
      selectedImageId: "image-2",
    });
  });

  it("recognizes the bounded list DTO artifact summary without treating image plans as generated images", () => {
    expect(deriveHistoricalArtifactSummary({
      legacyListSummary: {
        presentation: { artifacts: [{ key: "image_plan", label: "图片方案" }] },
        artifactSummary: { hasListing: true, hasImages: true, imageCount: 2 },
      },
    })).toMatchObject({ hasListing: true, hasImages: true, imageCount: 2 });

    expect(deriveHistoricalArtifactSummary({
      legacyListSummary: {
        presentation: { artifacts: [{ key: "image_plan", label: "图片方案" }] },
        artifactSummary: { hasListing: false, hasImages: false, imageCount: 0 },
      },
    })).toMatchObject({ hasListing: false, hasImages: false, imageCount: 0 });
  });
});
