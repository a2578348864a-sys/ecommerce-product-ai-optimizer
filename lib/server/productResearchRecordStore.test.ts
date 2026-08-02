import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  appendProductResearchDecision,
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
} from "@/lib/productResearchRecord";

const mocks = vi.hoisted(() => ({
  recordFindFirst: vi.fn(),
  recordUpdateMany: vi.fn(),
  candidateFindFirst: vi.fn(),
  getSandboxTask: vi.fn(),
  getSandboxCandidate: vi.fn(),
  sandboxCas: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findFirst: mocks.recordFindFirst,
      updateMany: mocks.recordUpdateMany,
    },
    opportunityCandidate: {
      findFirst: mocks.candidateFindFirst,
    },
  },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_task_"),
  getSandboxTask: mocks.getSandboxTask,
  getSandboxCandidate: mocks.getSandboxCandidate,
  updateSandboxTaskResearchRecordCas: mocks.sandboxCas,
}));

import {
  getProductResearchDecisionState,
  updateProductResearchDecision,
} from "@/lib/server/productResearchRecordStore";

const verification = createProductResearchVerification({
  schema: PRODUCT_RESEARCH_HASH_SCHEMA,
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
});

const record = createInitialProductResearchRecord({
  candidateId: verification.candidateId,
  runId: verification.runId,
  contextHash: verification.contextHash,
  researchHash: buildProductResearchHash({
    ...verification,
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
  }),
  workflowStatus: verification.workflowStatus,
  reviewState: verification.reviewState,
  actor: { mode: "owner", actorRef: "owner:v1" },
  now: "2026-08-03T00:00:00.000Z",
  decision: {
    decisionId: "11111111-1111-4111-8111-111111111111",
    status: "creative_ready",
    reason: "All required evidence is reviewed.",
    nextAction: "Keep ready for a future handoff.",
  },
});

const resultJson = JSON.stringify({
  type: "workflow",
  researchRecord: record,
  researchVerification: verification,
});

function ownerTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    resultJson,
    decisionStatus: "continue",
    ...overrides,
  };
}

function sandboxTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "sandbox_task_1",
    demoAccessId: "visitor-a",
    updatedAt: "2026-08-03T00:00:00.000Z",
    resultJson,
    decisionStatus: "continue",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordFindFirst.mockResolvedValue(ownerTask());
  mocks.recordUpdateMany.mockResolvedValue({ count: 1 });
  mocks.candidateFindFirst.mockResolvedValue({ id: "candidate-1" });
  mocks.getSandboxTask.mockImplementation((demoAccessId: string, taskId: string) => (
    demoAccessId === "visitor-a" && taskId === "sandbox_task_1" ? sandboxTask() : null
  ));
  mocks.getSandboxCandidate.mockImplementation((demoAccessId: string, candidateId: string) => (
    demoAccessId === "visitor-a" && candidateId === "candidate-1"
      ? { id: candidateId, convertedTaskId: "sandbox_task_1" }
      : null
  ));
  mocks.sandboxCas.mockResolvedValue({ status: "updated", task: sandboxTask() });
});

describe("product research record store", () => {
  it("returns a read-only marker for legacy records without inventing a decision", async () => {
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask({ resultJson: '{"type":"workflow"}' }));

    await expect(getProductResearchDecisionState({ mode: "owner", token: "" }, "task-1"))
      .resolves.toEqual({ taskId: "task-1", legacy: true, readOnly: true, record: null });
  });

  it("rejects PATCH semantics for legacy records without creating a versioned namespace", async () => {
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask({ resultJson: '{"type":"workflow"}' }));

    await expect(updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 1,
      decision: {
        decisionId: "11111111-2222-4333-8444-555555555555",
        status: "needs_information",
        reason: "Legacy must stay read-only.",
        nextAction: "Open a new Candidate-bound research run.",
      },
    })).rejects.toMatchObject({
      code: "legacy_record_read_only",
      status: 409,
    });
    expect(mocks.recordUpdateMany).not.toHaveBeenCalled();
  });

  it("loads an Owner record only when Candidate binding and researchHash both verify", async () => {
    const state = await getProductResearchDecisionState({ mode: "owner", token: "" }, "task-1");

    expect(state).toMatchObject({ taskId: "task-1", legacy: false, readOnly: false });
    expect(state.record?.researchHash).toBe(record.researchHash);
    expect(mocks.candidateFindFirst).toHaveBeenCalledWith({
      where: { id: "candidate-1", convertedTaskId: "task-1" },
      select: { id: true },
    });
  });

  it("performs Owner storage CAS with id, old updatedAt, and old resultJson", async () => {
    const result = await updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 1,
      decision: {
        decisionId: "22222222-2222-4222-8222-222222222222",
        status: "needs_information",
        reason: "Supplier evidence is missing.",
        nextAction: "Collect the certificate.",
      },
      now: "2026-08-03T01:00:00.000Z",
    });

    expect(result.kind).toBe("updated");
    expect(result.state.record?.revision).toBe(2);
    expect(mocks.recordUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "task-1",
        updatedAt: new Date("2026-08-03T00:00:00.000Z"),
        resultJson,
      },
      data: {
        resultJson: expect.stringContaining('"revision":2'),
        decisionStatus: "need_info",
        updatedAt: new Date("2026-08-03T01:00:00.000Z"),
      },
    });
  });

  it("returns the safe current revision when Owner CAS loses a race", async () => {
    const concurrentRecord = appendProductResearchDecision({
      record,
      expectedRevision: 1,
      workflowStatus: verification.workflowStatus,
      reviewState: verification.reviewState,
      actor: { mode: "owner", actorRef: "owner:v1" },
      now: "2026-08-03T00:30:00.000Z",
      decision: {
        decisionId: "99999999-9999-4999-8999-999999999999",
        status: "needs_information",
        reason: "Another request won the race.",
        nextAction: "Refresh the record.",
      },
    }).record;
    mocks.recordUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.recordFindFirst
      .mockResolvedValueOnce(ownerTask())
      .mockResolvedValueOnce(ownerTask({
        resultJson: JSON.stringify({
          researchRecord: concurrentRecord,
          researchVerification: verification,
        }),
      }));

    await expect(updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 1,
      decision: {
        decisionId: "33333333-3333-4333-8333-333333333333",
        status: "abandoned",
        reason: "Stop this research.",
        nextAction: null,
      },
      now: "2026-08-03T01:00:00.000Z",
    })).rejects.toMatchObject({
      code: "research_record_conflict",
      status: 409,
      currentRevision: 2,
    });
  });

  it("does not write again for an identical decisionId retry", async () => {
    const result = await updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 0,
      decision: {
        decisionId: record.latestDecision.decisionId,
        status: record.latestDecision.status,
        reason: `  ${record.latestDecision.reason}  `,
        nextAction: record.latestDecision.nextAction,
      },
      now: "2026-08-03T01:00:00.000Z",
    });

    expect(result.kind).toBe("idempotent");
    expect(mocks.recordUpdateMany).not.toHaveBeenCalled();
  });

  it("uses the Visitor subject lock CAS and never reads Owner Prisma", async () => {
    const context = {
      mode: "demo" as const,
      token: "",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 0,
    };
    const result = await updateProductResearchDecision(context, "sandbox_task_1", {
      expectedRevision: 1,
      decision: {
        decisionId: "44444444-4444-4444-8444-444444444444",
        status: "abandoned",
        reason: "Stop this research.",
        nextAction: null,
      },
      now: "2026-08-03T01:00:00.000Z",
    });

    expect(result.kind).toBe("updated");
    expect(mocks.sandboxCas).toHaveBeenCalledWith("visitor-a", "sandbox_task_1", expect.objectContaining({
      expectedResultJson: resultJson,
      expectedUpdatedAt: "2026-08-03T00:00:00.000Z",
      decisionStatus: "rejected",
    }));
    expect(mocks.recordFindFirst).not.toHaveBeenCalled();
  });

  it("returns not_found for cross-identity task IDs", async () => {
    const visitor = {
      mode: "demo" as const,
      token: "",
      demoAccessId: "visitor-b",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 0,
    };
    await expect(getProductResearchDecisionState(visitor, "sandbox_task_1"))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(getProductResearchDecisionState(visitor, "task-1"))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(mocks.recordFindFirst).not.toHaveBeenCalled();
  });
});
