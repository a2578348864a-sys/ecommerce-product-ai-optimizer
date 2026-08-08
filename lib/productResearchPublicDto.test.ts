import { describe, expect, it } from "vitest";
import {
  PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH,
  projectTaskResultForBrowser,
  projectProductResearchDecisionStateForBrowser,
  toResearchHashFingerprint,
} from "@/lib/productResearchPublicDto";

const fullHash = "a".repeat(64);

function internalResult() {
  return {
    productName: "Synthetic product",
    sellingPoints: ["safe point"],
    finalReport: {
      verdict: "cautious",
      reason: "Safe summary.",
      futureSecretField: "must-not-leak",
      innocentLookingInternal: "must-not-leak",
    },
    agentOutputSnapshot: {
      version: "agent-output-v1",
      generatedAt: "2026-08-03T00:00:00.000Z",
      fallbackUsed: false,
      warnings: [],
      sourcingSnapshot: {
        supplierConclusion: "safe",
        sourceSignals: [],
        priceSignals: [],
        availabilitySignals: [],
        assumptions: [],
        missingInfo: [],
        confidence: "medium",
        futureSecretField: "must-not-leak",
        innocentLookingInternal: "must-not-leak",
      },
      riskSnapshot: {
        riskLevel: "unknown",
        riskFlags: [],
        complianceConcerns: [],
        ipConcerns: [],
        logisticsConcerns: [],
        safetyConcerns: [],
        riskReason: "safe",
        needsManualReview: true,
      },
      summarySnapshot: {
        decision: "unknown",
        decisionReason: "safe",
        targetUser: "safe",
        sellingPoints: [],
        concerns: [],
        confidence: "medium",
      },
      listingSnapshot: {
        titleDraft: "safe",
        bulletDrafts: [],
        keywordHints: [],
        imageIdeas: [],
        complianceNotes: [],
        missingInputs: [],
      },
      nextActionSnapshot: {
        primaryAction: "manual_review",
        actionLabel: "safe",
        checklist: [],
        blockingIssues: [],
        suggestedOwnerStep: "safe",
      },
      humanReviewSnapshot: {
        required: true,
        reasons: [],
        reviewFocus: [],
        defaultStatus: "needs_review",
      },
    },
    futureSecretField: "must-not-leak",
    unknownInternalNamespace: { actorRef: "must-not-leak" },
    researchVerification: { inputHash: fullHash, resultHash: fullHash },
    candidateToTask: { candidateId: "candidate-internal" },
    sourceMeta: {
      source: "opportunity",
      sourceTitle: "Synthetic source",
      candidateId: "candidate-internal",
      contextHash: fullHash,
      futureSecretField: "must-not-leak",
    },
    researchRecord: {
      schema: "product-research-record.v1",
      revision: 2,
      researchHash: fullHash,
      candidateId: "candidate-internal",
      runId: "run-internal",
      contextHash: fullHash,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      latestDecision: {
        revision: 2,
        status: "needs_information",
        reason: "Need a safe fact.",
        nextAction: "Collect it.",
        researchHash: fullHash,
        decisionId: "22222222-2222-4222-8222-222222222222",
        decidedAt: "2026-08-03T00:00:00.000Z",
        actor: { mode: "owner", actorRef: "owner:v1" },
      },
      decisionEvents: [{
        revision: 1,
        status: "creative_ready",
        reason: "Initial safe decision.",
        nextAction: null,
        researchHash: fullHash,
        decisionId: "11111111-1111-4111-8111-111111111111",
        decidedAt: "2026-08-03T00:00:00.000Z",
        actor: { mode: "owner", actorRef: "owner:v1" },
      }, {
        revision: 2,
        status: "needs_information",
        reason: "Need a safe fact.",
        nextAction: "Collect it.",
        researchHash: fullHash,
        decisionId: "22222222-2222-4222-8222-222222222222",
        decidedAt: "2026-08-03T00:00:00.000Z",
        actor: { mode: "owner", actorRef: "owner:v1" },
      }],
    },
  };
}

const forbiddenKeys = [
  "actorRef", "decisionId", "candidateId", "runId", "contextHash",
  "researchVerification", "inputHash", "resultHash", "researchHash",
  "futureSecretField", "unknownInternalNamespace",
] as const;

function expectNoForbiddenFields(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(fullHash);
  for (const key of forbiddenKeys) expect(serialized).not.toContain(`\"${key}\"`);
}

describe("product research browser DTO allowlist", () => {
  it.each(["list", "detail"] as const)("rejects arrays supplied to scalar fields for %s", (scope) => {
    const projected = projectTaskResultForBrowser({
      status: ["safe", "private-canary"],
      finalReport: {
        riskLevel: ["yellow", "private-canary"],
      },
      sourceMeta: {
        source: ["SellerSprite", "private-canary"],
      },
    }, scope) as Record<string, any>;

    expect(JSON.stringify(projected)).not.toContain("private-canary");
    expect(projected).not.toHaveProperty("status");
    if (scope === "detail") {
      expect(projected.finalReport).not.toHaveProperty("riskLevel");
      expect(projected.sourceMeta).not.toHaveProperty("source");
    } else {
      expect(projected).not.toHaveProperty("finalReport");
      expect(projected).not.toHaveProperty("sourceMeta");
    }
  });

  it("keeps list projections bounded to summaries instead of detail snapshots", () => {
    const projected = projectTaskResultForBrowser(internalResult(), "list") as Record<string, any>;
    const serialized = JSON.stringify(projected);

    expect(projected).not.toHaveProperty("finalReport");
    expect(projected).not.toHaveProperty("reviewState");
    expect(projected).not.toHaveProperty("agentOutputSnapshot");
    expect(projected).not.toHaveProperty("listingPackSnapshot");
    expect(projected).not.toHaveProperty("aiListingPackSnapshot");
    expect(projected).not.toHaveProperty("aiImageDraftSnapshot");
    expect(projected).not.toHaveProperty("sourceMeta");
    expect(projected.legacyListSummary.artifactSummary).toEqual({
      hasListing: false,
      hasImages: false,
      imageCount: 0,
    });
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(8 * 1024);
  });

  it("keeps a 50-item list projection below the response budget", () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: `synthetic-${index}`,
      result: projectTaskResultForBrowser(internalResult(), "list", {
        id: `synthetic-${index}`,
        type: "workflow",
        title: "Synthetic product",
        materialText: "Synthetic material",
        oneLineSummary: "Synthetic summary",
        level: "yellow",
        decisionStatus: "need_info",
      }),
    }));
    expect(Buffer.byteLength(JSON.stringify({ items }), "utf8")).toBeLessThanOrEqual(1024 * 1024);
  });

  it.each(["list", "detail"] as const)("defaults unknown and binding fields to denied for %s", (scope) => {
    const result = projectTaskResultForBrowser(internalResult(), scope) as Record<string, any>;
    expect(result.productName).toBe("Synthetic product");
    if (scope === "detail") {
      expect(result.sellingPoints).toEqual(["safe point"]);
      expect(result.finalReport).toEqual({ verdict: "cautious", reason: "Safe summary." });
      expect(result.agentOutputSnapshot.sourcingSnapshot).not.toHaveProperty("futureSecretField");
      expect(result.agentOutputSnapshot.sourcingSnapshot).not.toHaveProperty("innocentLookingInternal");
      expect(result.sourceMeta).toEqual({ source: "opportunity", sourceTitle: "Synthetic source" });
    } else {
      expect(result.legacyListSummary.details.sellingPoints).toEqual(["safe point"]);
      expect(result).not.toHaveProperty("finalReport");
      expect(result).not.toHaveProperty("agentOutputSnapshot");
      expect(result).not.toHaveProperty("sourceMeta");
    }
    expect(result.productResearchSummary).toMatchObject({
      schema: "product-research-record.v1",
      revision: 2,
      status: "needs_information",
      reasonSummary: "Need a safe fact.",
      nextActionSummary: "Collect it.",
      actorMode: "owner",
      researchHashFingerprint: "a".repeat(12),
      legacy: false,
    });
    expect(result).not.toHaveProperty("researchRecord");
    expectNoForbiddenFields(result);
  });

  it("does not leak a verification-only document without researchRecord", () => {
    const projected = projectTaskResultForBrowser({
      productName: "Synthetic",
      researchVerification: { inputHash: fullHash, resultHash: fullHash },
      futureSecretField: "must-not-leak",
    }, "detail");
    expect(projected).toEqual({ productName: "Synthetic" });
    expectNoForbiddenFields(projected);
  });

  it("projects dedicated decision state events with an explicit field allowlist", () => {
    const projected = projectProductResearchDecisionStateForBrowser({
      taskId: "task-public",
      legacy: false,
      readOnly: false,
      record: internalResult().researchRecord,
    }) as Record<string, any>;
    expect(projected.record.latestDecision).toEqual({
      revision: 2,
      status: "needs_information",
      reason: "Need a safe fact.",
      nextAction: "Collect it.",
      decidedAt: "2026-08-03T00:00:00.000Z",
      actorMode: "owner",
      researchHashFingerprint: "a".repeat(12),
    });
    expect(projected.record.decisionEvents).toHaveLength(2);
    expectNoForbiddenFields(projected);
  });

  it("never invents a fingerprint for invalid hashes", () => {
    expect(toResearchHashFingerprint("not-a-hash")).toBeNull();
    expect(toResearchHashFingerprint(null)).toBeNull();
    expect(PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH).toBe(12);
  });

  it("projects creativeHandoff as an allowlisted minimal signal (detail scope)", () => {
    const projected = projectTaskResultForBrowser({
      productName: "Synthetic product",
      creativeHandoff: {
        schema: "product-creative-handoff.v1",
        handoffId: "11111111-1111-4111-8111-111111111111",
        taskId: "task-internal",
        candidateId: "candidate-internal",
        currentRevision: 3,
        controlState: "active",
        createdAt: "2026-08-05T00:00:00.000Z",
        createdBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
        versions: [{ revision: 1, handoffFingerprint: "f".repeat(64) }],
        researchMode: "market_research_only",
        promotionEligible: false,
      },
    }, "detail") as Record<string, any>;

    expect(projected.creativeHandoff).toEqual({
      currentRevision: 3,
      controlState: "active",
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    // 不投影任何内部/创作内容（版本、事实、指纹、演员、引用）
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("subjectFingerprint");
    expect(serialized).not.toContain("versions");
    expect(serialized).not.toContain("handoffFingerprint");
    expect(serialized).not.toContain("confirmedFacts");
    expect(serialized).not.toContain("createdBy");
    expect(serialized).not.toContain("candidateId");
    expect(serialized).not.toContain("handoffId");
    expectNoForbiddenFields(projected);
  });

  it("does not project creativeHandoff in list scope", () => {
    const projected = projectTaskResultForBrowser({
      productName: "Synthetic product",
      creativeHandoff: { currentRevision: 1, controlState: "active", createdAt: "2026-08-05T00:00:00.000Z" },
    }, "list") as Record<string, any>;
    expect(projected).not.toHaveProperty("creativeHandoff");
  });

  it("projects only the selected image identity for detail history and keeps it out of lists", () => {
    const internalSelection = {
      version: 1,
      selectedImageId: "image-2",
      sourceHandoffRevision: 3,
      selectedAt: "2026-08-09T02:00:00.000Z",
      privatePrompt: "must-not-leak",
      providerMetadata: { requestId: "private-request" },
    };

    expect(projectTaskResultForBrowser({ imageStudioSelection: internalSelection }, "detail")).toEqual({
      imageStudioSelection: {
        version: 1,
        selectedImageId: "image-2",
        sourceHandoffRevision: 3,
        selectedAt: "2026-08-09T02:00:00.000Z",
      },
    });
    expect(projectTaskResultForBrowser({ imageStudioSelection: internalSelection }, "list"))
      .not.toHaveProperty("imageStudioSelection");
  });

  it("keeps a legacy Listing pack readable in detail without leaking private snapshot fields", () => {
    const pack = {
      source: "rule_based",
      generatedAt: "2026-08-01T00:00:00.000Z",
      titleDrafts: ["Safe historical title"],
      bulletPoints: ["Safe historical bullet"],
      coreKeywords: [{ keyword: "safe", intent: "core" }],
      longTailKeywords: [],
      scenarioKeywords: [],
      audienceKeywords: [],
      featureKeywords: [],
      sellingPoints: [],
      targetAudience: [],
      imageRequirements: [],
      priceSuggestion: "人工确认",
      riskTerms: [],
      prePublishChecklist: ["人工复核"],
      disclaimer: "历史草稿，仅供人工复核。",
    };
    const projected = projectTaskResultForBrowser({
      listingPackSnapshot: {
        version: 1,
        source: "rule_based",
        savedAt: "2026-08-01T01:00:00.000Z",
        pack,
        safety: { unverifiedClaimsSanitized: true, requiresHumanReview: true, autoListing: false },
        binding: { fingerprint: fullHash },
        actorRef: "owner:v1",
      },
    }, "detail") as Record<string, any>;

    expect(projected.listingPackSnapshot.pack.titleDrafts).toEqual(["Safe historical title"]);
    expect(projected.listingPackSnapshot.savedAt).toBe("2026-08-01T01:00:00.000Z");
    expect(projected.listingPackSnapshot).not.toHaveProperty("binding");
    expect(projected.listingPackSnapshot).not.toHaveProperty("actorRef");
    expectNoForbiddenFields(projected);
  });

  it("projects only safe product identity fields from candidate analysis context", () => {
    const projected = projectTaskResultForBrowser({
      candidateAnalysisContext: {
        sourceLabel: "SellerSprite",
        asin: "B0SAFE0001",
        productUrl: "https://example.com/product",
        contextHash: fullHash,
        candidateId: "private-candidate-id",
        reportPayload: { private: true },
      },
    }, "detail") as Record<string, any>;

    expect(projected.candidateAnalysisContext).toEqual({
      sourceLabel: "SellerSprite",
      asin: "B0SAFE0001",
      productUrl: "https://example.com/product",
    });
    expectNoForbiddenFields(projected);
  });

  it("drops creativeHandoff projections that are not valid handoff envelopes", () => {
    // 只投影白名单字段；畸形结构不返回幻影字段
    const projected = projectTaskResultForBrowser({
      productName: "Synthetic product",
      creativeHandoff: { broken: true },
    }, "detail") as Record<string, any>;
    expect(projected.creativeHandoff).toEqual({});
  });
});
