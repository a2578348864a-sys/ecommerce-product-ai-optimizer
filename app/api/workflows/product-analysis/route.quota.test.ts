import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { mode: "owner" | "demo" } = { mode: "demo" };
const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  markStarted: vi.fn(),
  settle: vi.fn(),
  sourcing: vi.fn(),
  risk: vi.fn(),
  summary: vi.fn(),
  listing: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => state.mode === "demo"
    ? { ok: true, context: { mode: "demo", demoAccessId: "visitor-quota" } }
    : { ok: true, context: { mode: "owner", token: "owner-token" } },
  reserveDemoAiCalls: mocks.reserve,
  markDemoAiProviderCallStarted: mocks.markStarted,
  settleDemoAiCalls: mocks.settle,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: { opportunityCandidate: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxCandidateId: () => false,
  getSandboxCandidate: () => null,
}));

vi.mock("@/lib/workflows/productAnalysis", () => ({
  PRODUCT_ANALYSIS_AI_TIMEOUT_MS: 45_000,
  runSourcingStep: mocks.sourcing,
  runRiskStep: mocks.risk,
  runSummaryStep: mocks.summary,
  runListingStep: mocks.listing,
}));

import { POST } from "./route";

function createRequest(options?: Record<string, boolean>) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/workflows/product-analysis",
    nextUrl: new URL("http://localhost:3000/api/workflows/product-analysis"),
    headers: new Headers(),
    json: async () => ({ productName: "Desk Stand", source: "manual", options }),
  };
}

function sourcingResult(providerCallStarted = true, status: "completed" | "fallback" = "completed") {
  return {
    providerCallStarted,
    status,
    warnings: status === "fallback" ? ["mock provider failure"] : [],
    data: {
      feasibility: "medium",
      summary: "sourcing",
      searchKeywords: [],
      moqEstimate: "10",
      beginnerFriendly: true,
      beginnerFit: "medium",
      complianceBarrier: "low",
      logisticsDifficulty: "low",
      afterSalesRisk: "low",
      suggestedEntryLevel: "beginner",
      nextSteps: [],
    },
  };
}

function riskResult(providerCallStarted = true) {
  return {
    providerCallStarted,
    status: "completed",
    warnings: [],
    data: { overallLevel: "yellow", summary: "risk", blacklistMatches: [], beginnerFriendly: true, complianceWarnings: [] },
  };
}

function summaryResult(providerCallStarted = true) {
  return {
    providerCallStarted,
    status: "completed",
    warnings: [],
    data: {
      verdict: "review",
      confidence: "medium",
      summary: "summary",
      reasons: [],
      risks: [],
      nextSteps: [],
      beginnerTip: "review",
      downgraded: false,
      downgradeReasons: [],
      parseFailed: false,
    },
  };
}

function listingResult(providerCallStarted = true) {
  return {
    providerCallStarted,
    status: "completed",
    warnings: [],
    data: { title: "Desk Stand", keywords: ["desk stand"], complianceNotes: ["review"] },
  };
}

async function readJson(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", "product-analysis-quota-test-password");
  vi.clearAllMocks();
  state.mode = "demo";
  mocks.reserve.mockReturnValue({ ok: true, reservation: { reservationId: "product-run-1", plannedCount: 4 } });
  mocks.markStarted.mockReturnValue({ ok: true });
  mocks.settle.mockReturnValue({
    ok: true,
    snapshot: { id: "visitor-quota", maxAiCalls: 10, usedAiCalls: 4, remainingAiCalls: 6, isActive: true },
  });
  mocks.sourcing.mockImplementation(async (_name, _description, options) => {
    await options?.onProviderCallStart?.();
    return sourcingResult();
  });
  mocks.risk.mockImplementation(async (_name, _description, options) => {
    await options?.onProviderCallStart?.();
    return riskResult();
  });
  mocks.summary.mockImplementation(async (_name, _description, _sourcing, _risk, options) => {
    await options?.onProviderCallStart?.();
    return summaryResult();
  });
  mocks.listing.mockImplementation(async (_name, _summary, options) => {
    await options?.onProviderCallStart?.();
    return listingResult();
  });
});

describe("product-analysis Visitor Provider-call quota settlement", () => {
  it("reserves the planned steps and charges every started Provider call", async () => {
    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      4,
      { leaseMs: 240_000 },
    );
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      { reservationId: "product-run-1", plannedCount: 4 },
      4,
    );
    expect(mocks.markStarted).toHaveBeenCalledTimes(4);
    expect(result.body.runProof).toEqual(expect.any(String));
  });

  it.each(["429", "timeout", "empty_response", "json_parse_error"])(
    "charges a started Provider call after %s fallback",
    async () => {
      mocks.reserve.mockReturnValueOnce({ ok: true, reservation: { reservationId: "failure-run", plannedCount: 1 } });
      mocks.sourcing.mockImplementationOnce(async (_name, _description, options) => {
        await options?.onProviderCallStart?.();
        return sourcingResult(true, "fallback");
      });

      const result = await readJson(await POST(createRequest({
        runRisk: false,
        runSummary: false,
        runListing: false,
      }) as never));

      expect(result.status).toBe(200);
      expect(result.body.status).toBe("failed");
      expect(mocks.settle).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "demo" }),
        { reservationId: "failure-run", plannedCount: 1 },
        1,
      );
    },
  );

  it("releases planned quota when failure happens before the Provider starts", async () => {
    mocks.reserve.mockReturnValueOnce({ ok: true, reservation: { reservationId: "preflight-run", plannedCount: 1 } });
    mocks.sourcing.mockResolvedValueOnce(sourcingResult(false, "fallback"));

    await POST(createRequest({ runRisk: false, runSummary: false, runListing: false }) as never);

    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      { reservationId: "preflight-run", plannedCount: 1 },
      0,
    );
  });

  it("settles already-started calls when a later step throws unexpectedly", async () => {
    mocks.risk.mockRejectedValueOnce(new Error("pipeline interrupted"));

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("pipeline_error");
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      { reservationId: "product-run-1", plannedCount: 4 },
      1,
    );
  });

  it("fails closed when the reservation cannot be settled", async () => {
    mocks.settle.mockReturnValueOnce({
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "missing reservation",
    });

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("demo_ai_quota_reservation_missing");
    expect(result.body.runProof).toBeUndefined();
  });

  it("does not reserve or settle Visitor quota for Owner", async () => {
    state.mode = "owner";

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
