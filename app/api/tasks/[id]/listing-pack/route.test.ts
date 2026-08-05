import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  appendProductResearchDecision,
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
} from "@/lib/productResearchRecord";

const authState = vi.hoisted(() => ({ mode: "owner" as "owner" | "demo" }));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "test-pwd",
  getAccessContext: () => ({ mode: "owner", token: "tok_test" }),
  checkAccessPassword: () => null,
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => authState.mode === "demo"
    ? { ok: true, context: { mode: "demo", demoAccessId: "demo-hr" } }
    : { ok: true, context: { mode: "owner" } },
  requireOwnerOnly: () => authState.mode === "demo"
    ? { ok: false, status: 403, code: "demo_action_forbidden", message: "demo cannot write official data" }
    : { ok: true, context: { mode: "owner" } },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
}));
vi.mock("@/lib/server/demoSandboxTaskMutation.internal", () => ({
  mutateSandboxTaskResultJsonInternal: vi.fn(),
}));

// PR2-2 Final-Fix (BLOCKER-1): 默认 gate 返回有效 binding（模拟已通过新流程保存过的任务）
const gateState = vi.hoisted(() => ({
  hasBinding: true,
  binding: {
    schema: "listing-handoff-binding.v1",
    sourceHandoffId: "handoff-1",
    sourceHandoffRevision: 1,
    sourceHandoffFingerprintHash: "a".repeat(64),
    sourceResearchRevision: 1,
    generationInputFingerprint: "b".repeat(64),
    generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock-listing-provider-v1",
    generationSource: "creative_handoff",
    humanReviewRequired: true,
    requestIdHash: "c".repeat(64),
  },
}));

vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: vi.fn(async () => ({
    allowed: true,
    reason: "eligible",
    currentHandoff: {
      schema: "product-creative-handoff.v1",
      handoffId: "handoff-1",
      controlState: "active",
      currentRevision: 1,
      versions: [{ revision: 1 }],
    },
    listingHandoffBindingRaw: gateState.hasBinding ? gateState.binding : undefined,
  })),
}));

import { prisma } from "@/lib/server/db";

const VALID_SNAPSHOT = {
  version: 1,
  source: "rule_based",
  generatedAt: "2025-01-01T00:00:00.000Z",
  productName: "Test Product",
  pack: { titleDrafts: ["Test"], bulletPoints: ["Test bullet"] },
  markdown: "# Test",
  safety: { unverifiedClaimsSanitized: true, requiresHumanReview: true, autoListing: false },
};

function ownerSnapshot(resultJson: string, id = "task-1") {
  return {
    id,
    type: "workflow",
    updatedAt: new Date("2026-08-03T03:00:00.000Z"),
    resultJson,
    decisionStatus: "continue",
  };
}

function versionedResult(revision: 1 | 2) {
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
  const initial = createInitialProductResearchRecord({
    candidateId: verification.candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-08-03T01:00:00.000Z",
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "Initial decision.",
      nextAction: null,
    },
  });
  const record = revision === 1 ? initial : appendProductResearchDecision({
    record: initial,
    expectedRevision: 1,
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-08-03T02:00:00.000Z",
    decision: {
      decisionId: "22222222-2222-4222-8222-222222222222",
      status: "needs_information",
      reason: "New evidence is required.",
      nextAction: "Collect the evidence.",
    },
  }).record;
  return JSON.stringify({
    unknownNamespace: { keep: true },
    researchRecord: record,
    researchVerification: verification,
  });
}

async function callPATCH(taskId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/tasks/[id]/listing-pack/route");
  return PATCH(new Request(`http://localhost/api/tasks/${taskId}/listing-pack`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-access-token": "tok_test" },
    body: JSON.stringify(body),
  }) as never, { params: Promise.resolve({ id: taskId }) });
}

describe("PATCH /api/tasks/[id]/listing-pack", () => {
  beforeEach(() => {
    authState.mode = "owner";
    vi.clearAllMocks();
    vi.mocked(prisma.viralAnalysisRecord.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it("saves only listingPackSnapshot and preserves unknown fields", async () => {
    vi.mocked(prisma.viralAnalysisRecord.findUnique).mockResolvedValue(ownerSnapshot('{"existingField":"keep-me"}') as never);
    const res = await callPATCH("task-1", { listingPackSnapshot: VALID_SNAPSHOT });
    const data = await res.json();
    const updateCall = vi.mocked(prisma.viralAnalysisRecord.updateMany).mock.calls[0][0] as never as { data: { resultJson: string } };
    const merged = JSON.parse(updateCall.data.resultJson);

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ ok: true, data: { id: "task-1" } });
    expect(merged.existingField).toBe("keep-me");
    expect(merged.listingPackSnapshot.safety).toMatchObject({
      autoListing: false,
      requiresHumanReview: true,
      unverifiedClaimsSanitized: true,
    });
  });

  it("enforces safety fields even when the client sends unsafe values", async () => {
    vi.mocked(prisma.viralAnalysisRecord.findUnique).mockResolvedValue(ownerSnapshot("{}") as never);
    const res = await callPATCH("task-2", {
      listingPackSnapshot: {
        ...VALID_SNAPSHOT,
        safety: { unverifiedClaimsSanitized: false, requiresHumanReview: false, autoListing: true },
      },
    });
    const call = vi.mocked(prisma.viralAnalysisRecord.updateMany).mock.calls[0][0] as never as { data: { resultJson: string } };
    expect(res.status).toBe(200);
    expect(JSON.parse(call.data.resultJson).listingPackSnapshot.safety).toMatchObject({
      autoListing: false,
      requiresHumanReview: true,
      unverifiedClaimsSanitized: true,
    });
  });

  it("rejects a stale Listing Pack writer instead of overwriting revision 2", async () => {
    const staleResult = versionedResult(1);
    const latestResult = versionedResult(2);
    let storedResultJson = staleResult;
    (vi.mocked(prisma.viralAnalysisRecord.findUnique) as any).mockImplementation(async () => {
      const snapshot = ownerSnapshot(storedResultJson, "task-race");
      storedResultJson = latestResult;
      return snapshot as never;
    });
    (vi.mocked(prisma.viralAnalysisRecord.updateMany) as any).mockImplementation(async (args: unknown) => {
      const input = args as never as { where: { resultJson: string }; data: { resultJson: string } };
      if (storedResultJson !== input.where.resultJson) return { count: 0 } as never;
      storedResultJson = input.data.resultJson;
      return { count: 1 } as never;
    });

    const res = await callPATCH("task-race", { listingPackSnapshot: VALID_SNAPSHOT });
    const current = JSON.parse(storedResultJson);
    expect(res.status).toBe(409);
    expect(current.researchRecord.revision).toBe(2);
    expect(current.researchRecord.decisionEvents).toHaveLength(2);
    expect(current.unknownNamespace).toEqual({ keep: true });
  });

  it("fails closed for malformed resultJson", async () => {
    vi.mocked(prisma.viralAnalysisRecord.findUnique).mockResolvedValue(ownerSnapshot("{bad") as never);
    const res = await callPATCH("task-bad", { listingPackSnapshot: VALID_SNAPSHOT });
    expect(res.status).toBe(409);
    expect(vi.mocked(prisma.viralAnalysisRecord.updateMany)).not.toHaveBeenCalled();
  });

  it("validates request errors and missing tasks", async () => {
    expect((await callPATCH("task-3", {})).status).toBe(400);
    expect((await callPATCH("", { listingPackSnapshot: VALID_SNAPSHOT })).status).toBe(400);
    vi.mocked(prisma.viralAnalysisRecord.findUnique).mockResolvedValue(null);
    expect((await callPATCH("missing", { listingPackSnapshot: VALID_SNAPSHOT })).status).toBe(404);
  });

  it("rejects invalid JSON", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/listing-pack/route");
    const res = await PATCH(new Request("http://localhost/api/tasks/task-4/listing-pack", {
      method: "PATCH",
      body: "not json",
    }) as never, { params: Promise.resolve({ id: "task-4" }) });
    expect(res.status).toBe(400);
  });

  it("blocks Visitor from saving an official task before storage access", async () => {
    authState.mode = "demo";
    const res = await callPATCH("task-official", { listingPackSnapshot: VALID_SNAPSHOT });
    expect(res.status).toBe(403);
    expect(vi.mocked(prisma.viralAnalysisRecord.findUnique)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.viralAnalysisRecord.updateMany)).not.toHaveBeenCalled();
  });

  // ── PR2-2 Final-Fix (BLOCKER-1): 旧路径封堵测试 ──

  it("rejects legacy listing-pack save when no Handoff binding exists", async () => {
    authState.mode = "owner";
    gateState.hasBinding = false;
    try {
      const res = await callPATCH("task-1", { listingPackSnapshot: VALID_SNAPSHOT });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("handoff_required");
      expect(vi.mocked(prisma.viralAnalysisRecord.updateMany)).not.toHaveBeenCalled();
    } finally {
      gateState.hasBinding = true;
    }
  });

  it("rejects listing-pack save when binding is malformed — fail-closed", async () => {
    authState.mode = "owner";
    gateState.hasBinding = true;
    gateState.binding = { schema: "listing-handoff-binding.v1", broken: true } as never;
    try {
      const res = await callPATCH("task-1", { listingPackSnapshot: VALID_SNAPSHOT });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("handoff_required");
      expect(vi.mocked(prisma.viralAnalysisRecord.updateMany)).not.toHaveBeenCalled();
    } finally {
      gateState.binding = {
        schema: "listing-handoff-binding.v1",
        sourceHandoffId: "handoff-1",
        sourceHandoffRevision: 1,
        sourceHandoffFingerprintHash: "a".repeat(64),
        sourceResearchRevision: 1,
        generationInputFingerprint: "b".repeat(64),
        generatedAt: "2026-08-05T00:00:00.000Z",
        model: "mock-listing-provider-v1",
        generationSource: "creative_handoff",
        humanReviewRequired: true,
        requestIdHash: "c".repeat(64),
      };
    }
  });
});
