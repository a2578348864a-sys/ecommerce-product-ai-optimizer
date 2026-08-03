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
  it.each(["list", "detail"] as const)("defaults unknown and binding fields to denied for %s", (scope) => {
    const result = projectTaskResultForBrowser(internalResult(), scope) as Record<string, any>;
    expect(result.productName).toBe("Synthetic product");
    expect(result.sellingPoints).toEqual(["safe point"]);
    expect(result.finalReport).toEqual({ verdict: "cautious", reason: "Safe summary." });
    expect(result.agentOutputSnapshot.sourcingSnapshot).not.toHaveProperty("futureSecretField");
    expect(result.agentOutputSnapshot.sourcingSnapshot).not.toHaveProperty("innocentLookingInternal");
    expect(result.sourceMeta).toEqual({ source: "opportunity", sourceTitle: "Synthetic source" });
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
});
