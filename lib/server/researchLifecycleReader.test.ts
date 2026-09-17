import { describe, expect, it } from "vitest";
import {
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  type ProductResearchHashInput,
  type ProductResearchReviewState,
} from "@/lib/productResearchRecord";
import {
  getResearchLifecycleState,
  type ResearchLifecycleReaderInput,
} from "@/lib/server/researchLifecycleReader";

const reviewState: ProductResearchReviewState = {
  sourcingReviewed: false,
  riskReviewed: false,
  summaryReviewed: false,
  listingReviewed: false,
  reviewedCount: 0,
  totalReviewSteps: 0,
  allReviewed: true,
};

const hashInput: ProductResearchHashInput = {
  schema: "product-research-hash.v1",
  candidateId: "candidate-1",
  runId: "run-1",
  contextHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  resultHash: "d".repeat(64),
  workflowStatus: "completed",
  reviewState,
};

function modernResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateToTask: { candidateId: "candidate-1" },
    candidateAnalysisContext: { candidate: { id: "candidate-1" } },
    ...overrides,
  };
}

function validResearchState() {
  const researchHash = buildProductResearchHash(hashInput);
  const verification = createProductResearchVerification(hashInput);
  const record = createInitialProductResearchRecord({
    candidateId: hashInput.candidateId,
    runId: hashInput.runId,
    contextHash: hashInput.contextHash,
    researchHash,
    workflowStatus: hashInput.workflowStatus,
    reviewState,
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "ready",
      nextAction: null,
    },
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-09-08T00:00:00.000Z",
  });
  return { record, verification };
}

function read(input: Partial<ResearchLifecycleReaderInput> & { result: unknown }) {
  return getResearchLifecycleState(input);
}

describe("getResearchLifecycleState", () => {
  it("case 1: classifies a new modern task as created", () => {
    const snapshot = read({ result: modernResult() });
    expect(snapshot.phase).toBe("created");
    expect(snapshot.collectionStatus).toBe("not_started");
    expect(snapshot.nextAction).toBe("开始补齐研究资料。");
  });

  it("case 2: reports an active orchestrator as collecting", () => {
    const snapshot = read({
      result: modernResult(),
      runtimeCollection: { status: "running" },
    });
    expect(snapshot.phase).toBe("collecting");
    expect(snapshot.collectionStatus).toBe("running");
  });

  it("case 3: exposes pending preview as awaiting confirmation", () => {
    const snapshot = read({
      result: modernResult({ browserEvidence: { snapshots: [{ fields: { title: { value: "Hook" } } }] } }),
      runtimeCollection: { status: "awaiting_confirmation", pendingPreview: true },
    });
    expect(snapshot.phase).toBe("awaiting_confirmation");
    expect(snapshot.confirmationStatus).toBe("pending");
    expect(snapshot.blockers).toContain("pending_confirmation");
  });

  it("case 4: reports confirmed facts without a decision as awaiting decision", () => {
    const snapshot = read({
      result: modernResult({
        factCandidates: {
          schema: "fact-candidates.v1",
          version: 1,
          confirmed: [{
            candidateId: "product_title:brand",
            field: "brand",
            label: "品牌",
            value: "Acme",
            sourceKind: "product_title",
            sourceRef: "product_title.derived",
            humanConfirmationRequired: true,
            confirmedAt: "2026-09-08T00:00:00.000Z",
            confirmedBy: "owner:v1",
          }],
          updatedAt: "2026-09-08T00:00:00.000Z",
        },
      }),
    });
    expect(snapshot.phase).toBe("awaiting_decision");
    expect(snapshot.confirmationStatus).toBe("confirmed");
  });

  it("case 5: maps needs_information to an incomplete decision", () => {
    const { record, verification } = validResearchState();
    const needsInfo = {
      ...record,
      latestDecision: { ...record.latestDecision, status: "needs_information" as const },
      decisionEvents: [{ ...record.decisionEvents[0], status: "needs_information" as const }],
    };
    const snapshot = read({ result: modernResult({ researchRecord: needsInfo, researchVerification: verification }) });
    expect(snapshot.phase).toBe("awaiting_decision");
    expect(snapshot.decisionStatus).toBe("needs_information");
    expect(snapshot.creativeReadiness).toBe("not_ready");
  });

  it("case 6: creative_ready without completion is ready to complete but blocked", () => {
    const { record, verification } = validResearchState();
    const snapshot = read({ result: modernResult({ researchRecord: record, researchVerification: verification }) });
    expect(snapshot.phase).toBe("ready_to_complete");
    expect(snapshot.blockers).toContain("research_not_completed");
    expect(snapshot.creativeReadiness).toBe("blocked");
  });

  it("case 7: completed, verified, bound creative-ready research is ready", () => {
    const { record, verification } = validResearchState();
    const completion = {
      schema: "research-completion.v1",
      status: "completed",
      completedAt: "2026-09-08T00:00:00.000Z",
      decisionId: record.latestDecision.decisionId,
      revision: record.revision,
      finalStatus: "creative_ready",
    };
    const snapshot = read({
      result: modernResult({ researchRecord: record, researchVerification: verification, researchCompletion: completion }),
      candidateBindingValid: true,
    });
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.creativeReadiness).toBe("ready");
    expect(snapshot.blockers).toEqual([]);
  });

  it("case 8: marks completed research stale when evidence hash changes", () => {
    const { record, verification } = validResearchState();
    const completion = {
      schema: "research-completion.v1",
      status: "completed",
      completedAt: "2026-09-08T00:00:00.000Z",
      decisionId: record.latestDecision.decisionId,
      revision: record.revision,
      finalStatus: "creative_ready",
      evidenceHash: "0".repeat(64),
    };
    const snapshot = read({
      result: modernResult({
        researchRecord: record,
        researchVerification: verification,
        researchCompletion: completion,
        browserEvidence: { snapshots: [{ fields: { title: { value: "Changed" } } }] },
      }),
      candidateBindingValid: true,
    });
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.stale).toBe(true);
    expect(snapshot.blockers).toContain("research_stale_requires_reconfirmation");
  });

  it("case 9: preserves abandoned as a terminal blocked state", () => {
    const { record, verification } = validResearchState();
    const abandoned = {
      ...record,
      latestDecision: { ...record.latestDecision, status: "abandoned" as const },
      decisionEvents: [{ ...record.decisionEvents[0], status: "abandoned" as const }],
    };
    const snapshot = read({ result: modernResult({ researchRecord: abandoned, researchVerification: verification }) });
    expect(snapshot.phase).toBe("abandoned");
    expect(snapshot.decisionStatus).toBe("abandoned");
    expect(snapshot.creativeReadiness).toBe("blocked");
  });

  it("case 10: modern latest decision wins over DB compatibility status", () => {
    const { record, verification } = validResearchState();
    const snapshot = read({
      result: modernResult({ researchRecord: record, researchVerification: verification }),
      decisionStatus: "pending",
    });
    expect(snapshot.decisionStatus).toBe("creative_ready");
  });

  it("case 11: ignores humanDecision when a modern record exists", () => {
    const { record, verification } = validResearchState();
    const snapshot = read({
      result: modernResult({
        researchRecord: record,
        researchVerification: verification,
        humanDecision: { status: "needs_information" },
      }),
    });
    expect(snapshot.decisionStatus).toBe("creative_ready");
    expect(snapshot.phase).toBe("ready_to_complete");
  });

  it("case 12: product lifecycle does not imply research completion", () => {
    const snapshot = read({
      result: modernResult({ productLifecycle: { status: "ready_to_test" } }),
    });
    expect(snapshot.completionStatus).toBe("not_completed");
    expect(snapshot.phase).not.toBe("completed");
    expect(snapshot.creativeReadiness).not.toBe("ready");
  });

  it("case 13: completion remains readable without runtime projection", () => {
    const { record, verification } = validResearchState();
    const completion = {
      schema: "research-completion.v1",
      status: "completed",
      completedAt: "2026-09-08T00:00:00.000Z",
      decisionId: record.latestDecision.decisionId,
      revision: record.revision,
      finalStatus: "creative_ready",
    };
    const snapshot = read({
      result: modernResult({ researchRecord: record, researchVerification: verification, researchCompletion: completion }),
      candidateBindingValid: true,
    });
    expect(snapshot.creativeReadiness).toBe("ready");
  });

  it("case 14: legacy compatibility is blocked and never promoted", () => {
    const snapshot = read({ result: { finalReport: { title: "legacy" } }, decisionStatus: "continue" });
    expect(snapshot.contractMode).toBe("legacy");
    expect(snapshot.decisionStatus).toBe("creative_ready");
    expect(snapshot.creativeReadiness).toBe("blocked");
    expect(snapshot.blockers).toContain("legacy_not_supported");
  });

  it("case 15: invalid versioned verification fails closed", () => {
    const { record } = validResearchState();
    const snapshot = read({
      result: modernResult({
        researchRecord: record,
        researchVerification: { schema: "research-verification.v1", broken: true },
      }),
    });
    expect(snapshot.contractMode).toBe("invalid");
    expect(snapshot.phase).toBe("blocked");
    expect(snapshot.creativeReadiness).toBe("blocked");
  });

  it("case 15b: an explicitly malformed verification namespace also fails closed", () => {
    const snapshot = read({
      result: modernResult({ researchVerification: { schema: "wrong-version" } }),
    });
    expect(snapshot.phase).toBe("blocked");
    expect(snapshot.contractMode).toBe("invalid");
    expect(snapshot.blockers).toContain("research_verification_invalid");
  });

  it("case 16: VOC, competitor and keyword evidence never counts as confirmed facts", () => {
    const snapshot = read({
      result: modernResult({
        vocAnalysis: { themes: ["organization"] },
        competitorEvidence: { patterns: ["heavy duty"] },
        keywordEvidence: { terms: ["storage organizer"] },
      }),
    });
    expect(snapshot.confirmationStatus).not.toBe("confirmed");
    expect(snapshot.phase).toBe("awaiting_decision");
  });

  it("does not mutate the input result", () => {
    const result = modernResult({ vocAnalysis: { themes: ["organization"] } });
    const before = JSON.parse(JSON.stringify(result));
    getResearchLifecycleState({ result });
    expect(result).toEqual(before);
  });
});
