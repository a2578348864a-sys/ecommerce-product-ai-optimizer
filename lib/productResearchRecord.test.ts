import { describe, expect, it } from "vitest";
import {
  appendProductResearchDecision,
  buildProductResearchHash,
  createInitialProductResearchRecord,
  parseProductResearchRecord,
  type ProductResearchHashInput,
} from "@/lib/productResearchRecord";

const HASH_INPUT: ProductResearchHashInput = {
  schema: "product-research-hash.v1",
  candidateId: "candidate-1",
  runId: "wf-run-12345678",
  contextHash: "a".repeat(64),
  inputHash: "b".repeat(64),
  resultHash: "c".repeat(64),
  workflowStatus: "completed",
  reviewState: {
    sourcingReviewed: true,
    riskReviewed: true,
    summaryReviewed: true,
    listingReviewed: true,
    reviewedCount: 4,
    totalReviewSteps: 4,
    allReviewed: true,
  },
};

const OWNER = { mode: "owner", actorRef: "owner:v1" } as const;

function initial() {
  return createInitialProductResearchRecord({
    candidateId: "candidate-1",
    runId: "wf-run-12345678",
    contextHash: "a".repeat(64),
    researchHash: buildProductResearchHash(HASH_INPUT),
    workflowStatus: "completed",
    reviewState: HASH_INPUT.reviewState,
    actor: OWNER,
    now: "2026-08-03T00:00:00.000Z",
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "All required evidence has been reviewed.",
      nextAction: "Prepare a structured creative handoff later.",
    },
  });
}

describe("product-research-record.v1", () => {
  it("creates revision 1 with one server-attributed append-only event", () => {
    const record = initial();

    expect(record).toMatchObject({
      schema: "product-research-record.v1",
      revision: 1,
      candidateId: "candidate-1",
      runId: "wf-run-12345678",
      latestDecision: {
        decisionId: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        researchHash: buildProductResearchHash(HASH_INPUT),
        status: "creative_ready",
        actor: OWNER,
      },
    });
    expect(record.decisionEvents).toHaveLength(1);
    expect(record.latestDecision).toEqual(record.decisionEvents[0]);
    expect(parseProductResearchRecord(record)).toEqual(record);
  });

  it("builds a stable hash from canonical server-verified inputs", () => {
    const reordered = {
      ...HASH_INPUT,
      reviewState: {
        allReviewed: true,
        totalReviewSteps: 4,
        reviewedCount: 4,
        listingReviewed: true,
        summaryReviewed: true,
        riskReviewed: true,
        sourcingReviewed: true,
      },
    } satisfies ProductResearchHashInput;

    expect(buildProductResearchHash(reordered)).toBe(buildProductResearchHash(HASH_INPUT));
    expect(buildProductResearchHash(HASH_INPUT)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects creative_ready unless the run completed and all four process reviews passed", () => {
    expect(() => createInitialProductResearchRecord({
      candidateId: "candidate-1",
      runId: "wf-run-12345678",
      contextHash: "a".repeat(64),
      researchHash: buildProductResearchHash({
        ...HASH_INPUT,
        reviewState: {
          ...HASH_INPUT.reviewState,
          listingReviewed: false,
          reviewedCount: 3,
          allReviewed: false,
        },
      }),
      workflowStatus: "completed",
      reviewState: {
        ...HASH_INPUT.reviewState,
        listingReviewed: false,
        reviewedCount: 3,
        allReviewed: false,
      },
      actor: OWNER,
      now: "2026-08-03T00:00:00.000Z",
      decision: {
        decisionId: "22222222-2222-4222-8222-222222222222",
        status: "creative_ready",
        reason: "Not yet safe.",
        nextAction: "",
      },
    })).toThrowError(expect.objectContaining({
      code: "creative_ready_not_allowed",
    }));
  });

  it("requires reason and nextAction for needs_information", () => {
    expect(() => createInitialProductResearchRecord({
      candidateId: "candidate-1",
      runId: "wf-run-12345678",
      contextHash: "a".repeat(64),
      researchHash: buildProductResearchHash(HASH_INPUT),
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T00:00:00.000Z",
      decision: {
        decisionId: "33333333-3333-4333-8333-333333333333",
        status: "needs_information",
        reason: "Need supplier evidence.",
        nextAction: "   ",
      },
    })).toThrowError(expect.objectContaining({
      code: "next_action_required",
    }));

    expect(() => createInitialProductResearchRecord({
      candidateId: "candidate-1",
      runId: "wf-run-12345678",
      contextHash: "a".repeat(64),
      researchHash: buildProductResearchHash(HASH_INPUT),
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T00:00:00.000Z",
      decision: {
        decisionId: "34444444-4444-4444-8444-444444444444",
        status: "abandoned",
        reason: "   ",
        nextAction: null,
      },
    })).toThrowError(expect.objectContaining({
      code: "reason_required",
    }));
  });

  it("allows only needs_information for a partial_failed workflow", () => {
    const reviewState = {
      ...HASH_INPUT.reviewState,
      listingReviewed: false,
      reviewedCount: 3,
      allReviewed: false,
    };
    const make = (status: "creative_ready" | "needs_information" | "abandoned") => (
      () => createInitialProductResearchRecord({
        candidateId: "candidate-1",
        runId: "wf-run-12345678",
        contextHash: "a".repeat(64),
        researchHash: buildProductResearchHash({
          ...HASH_INPUT,
          workflowStatus: "partial_failed",
          reviewState,
        }),
        workflowStatus: "partial_failed",
        reviewState,
        actor: OWNER,
        now: "2026-08-03T00:00:00.000Z",
        decision: {
          decisionId: status === "creative_ready"
            ? "71111111-1111-4111-8111-111111111111"
            : status === "abandoned"
              ? "72222222-2222-4222-8222-222222222222"
              : "73333333-3333-4333-8333-333333333333",
          status,
          reason: "The workflow needs more evidence.",
          nextAction: "Resolve the failed research step.",
        },
      })
    );

    expect(make("needs_information")).not.toThrow();
    expect(make("creative_ready")).toThrowError(expect.objectContaining({
      code: "partial_failed_requires_information",
    }));
    expect(make("abandoned")).toThrowError(expect.objectContaining({
      code: "partial_failed_requires_information",
    }));
  });

  it("increments revision, keeps history, and mirrors the final event", () => {
    const result = appendProductResearchDecision({
      record: initial(),
      expectedRevision: 1,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T01:00:00.000Z",
      decision: {
        decisionId: "44444444-4444-4444-8444-444444444444",
        status: "needs_information",
        reason: "The supplier certificate is still missing.",
        nextAction: "Collect the certificate before proceeding.",
      },
    });

    expect(result.kind).toBe("updated");
    expect(result.record.revision).toBe(2);
    expect(result.record.decisionEvents).toHaveLength(2);
    expect(result.record.latestDecision).toEqual(result.record.decisionEvents[1]);
    expect(result.record.latestDecision.revision).toBe(2);
    expect(result.record.latestDecision.researchHash).toBe(result.record.researchHash);
    expect(result.record.researchHash).toBe(initial().researchHash);
  });

  it("treats an identical decisionId and normalized payload as idempotent", () => {
    const current = initial();
    const result = appendProductResearchDecision({
      record: current,
      expectedRevision: 0,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T02:00:00.000Z",
      decision: {
        decisionId: current.latestDecision.decisionId,
        status: "creative_ready",
        reason: "  All required evidence has been reviewed.  ",
        nextAction: "Prepare a structured creative handoff later.",
      },
    });

    expect(result.kind).toBe("idempotent");
    expect(result.record).toEqual(current);
  });

  it("rejects decisionId reuse with a different payload and stale revisions", () => {
    const current = initial();
    expect(() => appendProductResearchDecision({
      record: current,
      expectedRevision: 1,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T02:00:00.000Z",
      decision: {
        decisionId: current.latestDecision.decisionId,
        status: "abandoned",
        reason: "Different payload.",
        nextAction: "",
      },
    })).toThrowError(expect.objectContaining({
      code: "decision_id_conflict",
    }));

    expect(() => appendProductResearchDecision({
      record: current,
      expectedRevision: 0,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T02:00:00.000Z",
      decision: {
        decisionId: "55555555-5555-4555-8555-555555555555",
        status: "abandoned",
        reason: "The opportunity no longer matches our constraints.",
        nextAction: "",
      },
    })).toThrowError(expect.objectContaining({
      code: "revision_conflict",
    }));
  });

  it("rejects forged actors, oversized text, invalid hashes, and malformed histories", () => {
    const record = initial();
    expect(parseProductResearchRecord({
      ...record,
      researchHash: "not-a-hash",
    })).toBeNull();
    expect(parseProductResearchRecord({
      ...record,
      latestDecision: { ...record.latestDecision, actor: { mode: "owner", actorRef: "client-forged" } },
    })).toBeNull();
    expect(parseProductResearchRecord({
      ...record,
      decisionEvents: Array.from({ length: 51 }, () => record.latestDecision),
    })).toBeNull();
    expect(parseProductResearchRecord({
      ...record,
      latestDecision: { ...record.latestDecision, reason: "x".repeat(1001) },
      decisionEvents: [{ ...record.latestDecision, reason: "x".repeat(1001) }],
    })).toBeNull();
    expect(parseProductResearchRecord({
      ...record,
      latestDecision: { ...record.latestDecision, researchHash: "f".repeat(64) },
      decisionEvents: [{ ...record.latestDecision, researchHash: "f".repeat(64) }],
    })).toBeNull();
  });

  it("rejects a structurally valid history whose UTF-8 size exceeds 128 KiB", () => {
    const record = initial();
    const decisionEvents = Array.from({ length: 50 }, (_, index) => ({
      ...record.latestDecision,
      decisionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revision: index + 1,
      reason: "中".repeat(1000),
      nextAction: "文".repeat(1000),
      decidedAt: new Date(Date.UTC(2026, 7, 3, 0, index)).toISOString(),
    }));
    const oversized = {
      ...record,
      revision: 50,
      updatedAt: decisionEvents[49].decidedAt,
      latestDecision: decisionEvents[49],
      decisionEvents,
    };

    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeGreaterThan(128 * 1024);
    expect(parseProductResearchRecord(oversized)).toBeNull();
  });

  it("normalizes reason and nextAction to NFC before persistence and idempotency comparison", () => {
    const decisionId = "77777777-7777-4777-8777-777777777777";
    const decomposedReason = "Cafe\u0301 evidence reviewed";
    const decomposedNextAction = "Re\u0301sume later";
    const first = appendProductResearchDecision({
      record: initial(),
      expectedRevision: 1,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T03:00:00.000Z",
      decision: {
        decisionId,
        status: "needs_information",
        reason: `  ${decomposedReason}  `,
        nextAction: `  ${decomposedNextAction}  `,
      },
    });
    expect(first.kind).toBe("updated");
    expect(first.record.latestDecision.reason).toBe(decomposedReason.normalize("NFC"));
    expect(first.record.latestDecision.nextAction).toBe(decomposedNextAction.normalize("NFC"));

    const replay = appendProductResearchDecision({
      record: first.record,
      expectedRevision: 1,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T04:00:00.000Z",
      decision: {
        decisionId,
        status: "needs_information",
        reason: decomposedReason.normalize("NFC"),
        nextAction: decomposedNextAction.normalize("NFC"),
      },
    });
    expect(replay.kind).toBe("idempotent");
    expect(replay.record.revision).toBe(2);
  });

  it("applies length validation after NFC normalization", () => {
    const normalizedThousand = "e\u0301".repeat(1000);
    const result = appendProductResearchDecision({
      record: initial(),
      expectedRevision: 1,
      workflowStatus: "completed",
      reviewState: HASH_INPUT.reviewState,
      actor: OWNER,
      now: "2026-08-03T05:00:00.000Z",
      decision: {
        decisionId: "88888888-8888-4888-8888-888888888888",
        status: "abandoned",
        reason: normalizedThousand,
        nextAction: null,
      },
    });
    expect(result.record.latestDecision.reason).toHaveLength(1000);
    expect(result.record.latestDecision.reason).toBe(result.record.latestDecision.reason.normalize("NFC"));
  });
});
