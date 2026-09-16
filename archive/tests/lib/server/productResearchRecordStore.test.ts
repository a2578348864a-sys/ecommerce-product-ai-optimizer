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
  recordFindUnique: vi.fn(),
  recordUpdateMany: vi.fn(),
  candidateFindFirst: vi.fn(),
  getSandboxTask: vi.fn(),
  getSandboxCandidate: vi.fn(),
  sandboxAtomic: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findFirst: mocks.recordFindFirst,
      findUnique: mocks.recordFindUnique,
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
}));
vi.mock("@/lib/server/demoSandboxTaskMutation.internal", () => ({
  mutateSandboxTaskResultJsonInternal: mocks.sandboxAtomic,
}));

import {
  getProductResearchDecisionState,
  updateProductResearchDecision,
  completeCurrentResearch,
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
    type: "workflow",
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
  mocks.recordFindUnique.mockResolvedValue(ownerTask());
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
  mocks.sandboxAtomic.mockImplementation(async (
    demoAccessId: string,
    taskId: string,
    action: (task: ReturnType<typeof sandboxTask>) => Promise<{ task: ReturnType<typeof sandboxTask>; value: unknown }>,
  ) => {
    if (demoAccessId !== "visitor-a" || taskId !== "sandbox_task_1") return { status: "not_found" };
    const output = await action(sandboxTask());
    return { status: "updated", task: output.task, value: output.value };
  });
});

describe("product research record store", () => {
  it("V3 Current Research Normalization: 无 researchRecord 的当前 Research → 可编辑（非 legacy、非只读）", async () => {
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask({ resultJson: '{"type":"workflow"}' }));

    await expect(getProductResearchDecisionState({ mode: "owner", token: "" }, "task-1"))
      .resolves.toEqual({ taskId: "task-1", legacy: false, readOnly: false, record: null });
  });

  it("V3 Current Research Normalization: 无 researchRecord 任务保存决定 → 创建正式研究记录（revision 1）", async () => {
    const noRecordTask = ownerTask({ resultJson: JSON.stringify({
      type: "workflow",
      candidateToTask: { version: 1, candidateId: "candidate-1", confirmation: "research_started", confirmedAt: "2026-08-17T00:00:00.000Z" },
    }) });
    mocks.recordFindFirst.mockResolvedValueOnce(noRecordTask);
    mocks.recordFindUnique.mockResolvedValueOnce(noRecordTask);
    mocks.candidateFindFirst.mockResolvedValueOnce({ id: "candidate-1" });

    const outcome = await updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 1,
      decision: {
        decisionId: "11111111-2222-4333-8444-555555555555",
        status: "needs_information",
        reason: "Current research needs one more source.",
        nextAction: "Collect the missing source.",
      },
    });
    expect(outcome.kind).toBe("created");
    expect(outcome.state.record?.revision).toBe(1);
    expect(outcome.state.readOnly).toBe(false);
    // 写入 record + verification + decisionStatus 同步（单次持久化）
    expect(mocks.recordUpdateMany).toHaveBeenCalled();
  });

  it("V3 Current Research Normalization: 无 researchRecord 且绑定缺失 → 拒绝创建（不伪造绑定）", async () => {
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask({ resultJson: '{"type":"workflow"}' }));

    await expect(updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 1,
      decision: {
        decisionId: "11111111-2222-4333-8444-555555555555",
        status: "needs_information",
        reason: "Missing binding must fail.",
        nextAction: null,
      },
    })).rejects.toMatchObject({
      code: "research_binding_invalid",
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
    expect(mocks.sandboxAtomic).toHaveBeenCalledWith(
      "visitor-a",
      "sandbox_task_1",
      expect.any(Function),
    );
    expect(mocks.recordFindFirst).not.toHaveBeenCalled();
    expect(mocks.recordFindUnique).not.toHaveBeenCalled();
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

  it("V3 Current Research Normalization: 完成研究（creative_ready）→ 写入 researchCompletion（completed）", async () => {
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask());
    mocks.recordFindUnique.mockResolvedValueOnce(ownerTask());

    const outcome = await completeCurrentResearch({ mode: "owner", token: "" }, "task-1", {
      now: "2026-08-03T01:00:00.000Z",
    });

    expect(outcome).toEqual({
      taskId: "task-1",
      lifecycle: "completed",
      researchRecord: true,
      completedAt: "2026-08-03T01:00:00.000Z",
      idempotent: false,
    });
    expect(mocks.recordUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", updatedAt: new Date("2026-08-03T00:00:00.000Z"), resultJson },
      data: expect.objectContaining({
        resultJson: expect.stringContaining('"researchCompletion"'),
        updatedAt: new Date("2026-08-03T01:00:00.000Z"),
      }),
    }));
  });

  it("V3 Current Research Normalization: 完成研究幂等（已 researchCompletion → 不重复写入）", async () => {
    const completedTask = ownerTask({ resultJson: JSON.stringify({
      researchRecord: record,
      researchVerification: verification,
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-03T00:30:00.000Z",
        decisionId: record.latestDecision.decisionId,
        revision: record.revision,
        finalStatus: record.latestDecision.status,
      },
    }) });
    mocks.recordFindFirst.mockResolvedValueOnce(completedTask);

    const outcome = await completeCurrentResearch({ mode: "owner", token: "" }, "task-1", {});
    expect(outcome).toMatchObject({ lifecycle: "completed", idempotent: true });
    expect(mocks.recordUpdateMany).not.toHaveBeenCalled();
  });

  it("V3 Current Research Normalization: needs_information 禁止完成研究", async () => {
    const needInfoRecord = appendProductResearchDecision({
      record,
      expectedRevision: 1,
      workflowStatus: verification.workflowStatus,
      reviewState: verification.reviewState,
      actor: { mode: "owner", actorRef: "owner:v1" },
      now: "2026-08-03T00:30:00.000Z",
      decision: {
        decisionId: "55555555-5555-4555-8555-555555555555",
        status: "needs_information",
        reason: "Current research needs one more source.",
        nextAction: "Collect the missing source.",
      },
    }).record;
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask({ resultJson: JSON.stringify({
      researchRecord: needInfoRecord,
      researchVerification: verification,
    }) }));

    await expect(completeCurrentResearch({ mode: "owner", token: "" }, "task-1", {}))
      .rejects.toMatchObject({ code: "research_need_info", status: 409 });
    expect(mocks.recordUpdateMany).not.toHaveBeenCalled();
  });

  it("V3 Current Research Normalization: 无 researchRecord 禁止完成研究（先保存人工决定）", async () => {
    mocks.recordFindFirst.mockResolvedValueOnce(ownerTask({ resultJson: '{"type":"workflow"}' }));

    await expect(completeCurrentResearch({ mode: "owner", token: "" }, "task-1", {}))
      .rejects.toMatchObject({ code: "research_decision_required", status: 409 });
    expect(mocks.recordUpdateMany).not.toHaveBeenCalled();
  });

  it("V3 Current Research Normalization: 完成后的记录 → 决定只读；禁止再次修改决定", async () => {
    const completedTask = ownerTask({ resultJson: JSON.stringify({
      researchRecord: record,
      researchVerification: verification,
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-03T00:30:00.000Z",
        decisionId: record.latestDecision.decisionId,
        revision: record.revision,
        finalStatus: record.latestDecision.status,
      },
    }) });

    mocks.recordFindFirst.mockResolvedValueOnce(completedTask);
    const state = await getProductResearchDecisionState({ mode: "owner", token: "" }, "task-1");
    expect(state.readOnly).toBe(true);

    mocks.recordFindFirst.mockResolvedValueOnce(completedTask);
    await expect(updateProductResearchDecision({ mode: "owner", token: "" }, "task-1", {
      expectedRevision: 1,
      decision: {
        decisionId: "66666666-6666-4666-8666-666666666666",
        status: "creative_ready",
        reason: "Should be blocked after completion.",
        nextAction: null,
      },
    })).rejects.toMatchObject({ code: "research_record_completed", status: 409 });
    expect(mocks.recordUpdateMany).not.toHaveBeenCalled();
  });
});
