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

    // v11：无 researchCompletion（research-completion.v1）→ 不得判「已完成」；
    // 有正式决定载体（productResearchSummary）只是「待人工决定」。
    expect(withoutCreativeArtifacts).toEqual({
      key: "awaiting_decision",
      label: "待人工决定",
      researchSaved: true,
      humanDecisionExists: true,
    });
    expect(withCreativeArtifacts).toEqual(withoutCreativeArtifacts);
  });

  it("V3 Human Decision Authority: decisionStatus=continue + 无正式决定 → humanDecisionExists=false（Bentgo 回归）", () => {
    // Bentgo cmsw0bzti0004udte4dauumii：decisionStatus=continue 但无 researchRecord/humanDecision
    const bentgoLike = deriveResearchHistoryStatus({
      result: {
        candidateAnalysisContext: { sourceLabel: "Bentgo" },
        productName: "Bentgo Chill Kids",
      },
      decisionStatus: "continue",
      oneLineSummary: "",
    });
    expect(bentgoLike.humanDecisionExists).toBe(false);
    expect(bentgoLike).toMatchObject({ key: "incomplete", label: "研究记录待补充" });

    // 兼容列不能单独证明"人工决定已保存"
    const continueOnly = deriveResearchHistoryStatus({
      result: {},
      decisionStatus: "continue",
      oneLineSummary: "",
    });
    expect(continueOnly.humanDecisionExists).toBe(false);
    expect(continueOnly.label).toBe("研究记录待补充");
  });

  it("V3 Human Decision Authority: 正式决定载体（productResearchSummary / humanDecision）→ humanDecisionExists=true", () => {
    const viaVersionedSummary = deriveResearchHistoryStatus({
      result: {
        productResearchSummary: {
          schema: "product-research-record.v1",
          revision: 1,
          status: "creative_ready",
          reasonSummary: "ok",
        },
      },
      decisionStatus: "continue",
      oneLineSummary: "",
    });
    expect(viaVersionedSummary.humanDecisionExists).toBe(true);

    const viaHumanDecision = deriveResearchHistoryStatus({
      result: {
        humanDecision: { status: "continue", source: "user", confirmedItems: ["x"] },
      },
      decisionStatus: "pending",
      oneLineSummary: "",
    });
    expect(viaHumanDecision.humanDecisionExists).toBe(true);

    // pending + 正式决定 → true（contract 允许）
    const pendingWithFormal = deriveResearchHistoryStatus({
      result: {
        productResearchSummary: {
          schema: "product-research-record.v1",
          revision: 1,
          status: "needs_information",
          reasonSummary: "need more",
        },
      },
      decisionStatus: "pending",
      oneLineSummary: "",
    });
    expect(pendingWithFormal.humanDecisionExists).toBe(true);
  });

  it("P1-3：productResearchSummary.status=abandoned → 独立「已放弃」状态（不再「研究已完成」）", () => {
    const abandoned = deriveResearchHistoryStatus({
      result: {
        productResearchSummary: {
          schema: "product-research-record.v1",
          revision: 1,
          status: "abandoned",
          reasonSummary: "abandoned by user",
        },
      },
      decisionStatus: "continue",
      oneLineSummary: "research saved",
    });
    // v11：abandoned 终态只能由 researchCompletion 证明；summaryStatus=abandoned 无 completion → awaiting_decision
    expect(abandoned.key).toBe("awaiting_decision");
    expect(abandoned.label).toBe("待人工决定");
    // creative_ready 不回归
    const ready = deriveResearchHistoryStatus({
      result: {
        productResearchSummary: {
          schema: "product-research-record.v1",
          revision: 1,
          status: "creative_ready",
          reasonSummary: "ok",
        },
      },
      decisionStatus: "continue",
      oneLineSummary: "",
    });
    // v11：creative_ready 无 completion → 待人工决定
    expect(ready.key).toBe("awaiting_decision");
    expect(ready.label).toBe("待人工决定");
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
