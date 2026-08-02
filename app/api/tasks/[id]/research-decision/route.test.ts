import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  getState: vi.fn(),
  updateDecision: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/productResearchRecordStore", () => ({
  ProductResearchStoreError: class ProductResearchStoreError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      message: string,
      public readonly currentRevision?: number,
    ) {
      super(message);
    }
  },
  getProductResearchDecisionState: mocks.getState,
  updateProductResearchDecision: mocks.updateDecision,
}));

function request(method = "GET", body?: unknown) {
  return new Request("http://localhost/api/tasks/task-1/research-decision", {
    method,
    headers: { "Content-Type": "application/json", "x-access-token": "test-token" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const context = { params: Promise.resolve({ id: "task-1" }) };

function versionedRecord() {
  const event = {
    decisionId: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    status: "needs_information",
    reason: "Need supplier evidence.",
    nextAction: "Collect the certificate.",
    researchHash: "d".repeat(64),
    decidedAt: "2026-08-03T00:00:00.000Z",
    actor: { mode: "owner", actorRef: "owner:v1" },
  };
  return {
    schema: "product-research-record.v1",
    revision: 1,
    researchHash: "d".repeat(64),
    candidateId: "candidate-secret-id",
    runId: "workflow-internal-id",
    contextHash: "c".repeat(64),
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    latestDecision: event,
    decisionEvents: [event],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner", token: "" } });
  mocks.getState.mockResolvedValue({ taskId: "task-1", legacy: true, readOnly: true, record: null });
  mocks.updateDecision.mockResolvedValue({
    kind: "updated",
    state: {
      taskId: "task-1",
      legacy: false,
      readOnly: false,
      record: { ...versionedRecord(), revision: 2 },
    },
  });
});

describe("/api/tasks/[id]/research-decision", () => {
  it("returns a safe legacy read-only marker without inventing a decision", async () => {
    const { GET } = await import("./route");
    const response = await GET(request() as never, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.data).toEqual({ taskId: "task-1", legacy: true, readOnly: true, record: null });
  });

  it("returns decision history without internal bindings, actor references, or idempotency IDs", async () => {
    mocks.getState.mockResolvedValueOnce({
      taskId: "task-1",
      legacy: false,
      readOnly: false,
      record: versionedRecord(),
    });
    const { GET } = await import("./route");
    const response = await GET(request() as never, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.record).toMatchObject({
      schema: "product-research-record.v1",
      revision: 1,
      researchHash: "d".repeat(64),
      latestDecision: {
        revision: 1,
        status: "needs_information",
        actorMode: "owner",
      },
    });
    expect(JSON.stringify(body)).not.toContain("candidate-secret-id");
    expect(JSON.stringify(body)).not.toContain("workflow-internal-id");
    expect(JSON.stringify(body)).not.toContain("contextHash");
    expect(JSON.stringify(body)).not.toContain("actorRef");
    expect(JSON.stringify(body)).not.toContain("decisionId");
  });

  it("authenticates before reading or updating records", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "login required",
    });
    const { PATCH } = await import("./route");
    const response = await PATCH(request("PATCH", {}) as never, context);

    expect(response.status).toBe(401);
    expect(mocks.updateDecision).not.toHaveBeenCalled();
  });

  it("rejects client actor/time fields instead of trusting them", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(request("PATCH", {
      expectedRevision: 1,
      decisionId: "22222222-2222-4222-8222-222222222222",
      status: "abandoned",
      reason: "Stop.",
      nextAction: null,
      actor: { mode: "owner", actorRef: "forged" },
      researchHash: "e".repeat(64),
      decidedAt: "2026-08-03T00:00:00.000Z",
    }) as never, context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_research_decision_request");
    expect(mocks.updateDecision).not.toHaveBeenCalled();
  });

  it("passes only the normalized decision contract to storage", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(request("PATCH", {
      expectedRevision: 1,
      decisionId: "22222222-2222-4222-8222-222222222222",
      status: "needs_information",
      reason: "Need supplier evidence.",
      nextAction: "Collect the certificate.",
    }) as never, context);

    expect(response.status).toBe(200);
    expect(mocks.updateDecision).toHaveBeenCalledWith(
      { mode: "owner", token: "" },
      "task-1",
      {
        expectedRevision: 1,
        decision: {
          decisionId: "22222222-2222-4222-8222-222222222222",
          status: "needs_information",
          reason: "Need supplier evidence.",
          nextAction: "Collect the certificate.",
        },
      },
    );
  });

  it("returns only the safe current revision on a CAS conflict", async () => {
    const { ProductResearchStoreError } = await import("@/lib/server/productResearchRecordStore");
    mocks.updateDecision.mockRejectedValueOnce(
      new ProductResearchStoreError("research_record_conflict", 409, "refresh", 3),
    );
    const { PATCH } = await import("./route");
    const response = await PATCH(request("PATCH", {
      expectedRevision: 1,
      decisionId: "22222222-2222-4222-8222-222222222222",
      status: "abandoned",
      reason: "Stop.",
      nextAction: null,
    }) as never, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: "research_record_conflict",
      message: "refresh",
      currentRevision: 3,
    });
    expect(JSON.stringify(body)).not.toContain("resultJson");
  });
});
