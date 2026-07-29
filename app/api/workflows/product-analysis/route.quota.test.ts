import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { mode: "owner" | "demo" } = { mode: "demo" };
const mocks = vi.hoisted(() => ({
  reserveJob: vi.fn(),
  markStarted: vi.fn(),
  settleJob: vi.fn(),
  sourcing: vi.fn(),
  risk: vi.fn(),
  summary: vi.fn(),
  listing: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => state.mode === "demo"
    ? { ok: true, context: { mode: "demo", demoAccessId: "visitor-quota" } }
    : { ok: true, context: { mode: "owner", token: "owner-token" } },
  reserveDemoAiJob: mocks.reserveJob,
  markDemoAiJobProviderCallStarted: mocks.markStarted,
  settleDemoAiJob: mocks.settleJob,
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

const JOB_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function createRequest(options?: Record<string, boolean>, jobRequestId = JOB_REQUEST_ID) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/workflows/product-analysis",
    nextUrl: new URL("http://localhost:3000/api/workflows/product-analysis"),
    headers: new Headers(),
    json: async () => ({
      productName: "Desk Stand",
      source: "manual",
      jobRequestId,
      options,
    }),
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
  mocks.reserveJob.mockReturnValue({
    ok: true,
    reservation: {
      reservationId: "product-run-1",
      jobType: "product_research",
      jobRequestId: JOB_REQUEST_ID,
      quotaMetric: "ai_jobs_v1",
      providerCallsPlanned: 4,
      duplicate: false,
      status: "reserved",
    },
    snapshot: {
      id: "visitor-quota",
      maxAiCalls: 5,
      usedAiCalls: 1,
      remainingAiCalls: 4,
      isActive: true,
      quotaMetric: "ai_jobs_v1",
      maxAiJobs: 5,
      usedAiJobs: 1,
      remainingAiJobs: 4,
    },
  });
  mocks.markStarted.mockReturnValue({ ok: true });
  mocks.settleJob.mockReturnValue({
    ok: true,
    snapshot: {
      id: "visitor-quota",
      maxAiCalls: 5,
      usedAiCalls: 1,
      remainingAiCalls: 4,
      isActive: true,
      quotaMetric: "ai_jobs_v1",
      maxAiJobs: 5,
      usedAiJobs: 1,
      remainingAiJobs: 4,
    },
    status: "committed",
    duplicate: false,
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

describe("product-analysis Visitor AI-job quota settlement", () => {
  it("charges one product_research job while auditing all four Provider calls", async () => {
    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(mocks.reserveJob).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      {
        jobType: "product_research",
        jobRequestId: JOB_REQUEST_ID,
        providerCallsPlanned: 4,
        leaseMs: 240_000,
      },
    );
    expect(mocks.settleJob).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      expect.objectContaining({
        reservationId: "product-run-1",
        jobType: "product_research",
      }),
      {
        providerCallsStarted: 4,
        providerCallsCompleted: 4,
        providerCallsFailed: 0,
      },
    );
    expect(mocks.markStarted).toHaveBeenCalledTimes(4);
    expect(result.body.demoAccess).toMatchObject({
      usedAiJobs: 1,
      remainingAiJobs: 4,
      quotaMetric: "ai_jobs_v1",
    });
    expect(result.body.costGuard).toMatchObject({
      providerCallsPlanned: 4,
      providerCallsStarted: 4,
      providerCallsCompleted: 4,
      providerCallsFailed: 0,
    });
    expect(result.body.runProof).toEqual(expect.any(String));
  });

  it.each(["429", "timeout", "empty_response", "json_parse_error"])(
    "charges a started Provider call after %s fallback",
    async () => {
      mocks.reserveJob.mockReturnValueOnce({
        ok: true,
        reservation: {
          reservationId: "failure-run",
          jobType: "product_research",
          jobRequestId: JOB_REQUEST_ID,
          quotaMetric: "ai_jobs_v1",
          providerCallsPlanned: 1,
          duplicate: false,
          status: "reserved",
        },
        snapshot: null,
      });
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
      expect(mocks.settleJob).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "demo" }),
        expect.objectContaining({ reservationId: "failure-run" }),
        {
          providerCallsStarted: 1,
          providerCallsCompleted: 0,
          providerCallsFailed: 1,
        },
      );
    },
  );

  it("releases planned quota when failure happens before the Provider starts", async () => {
    mocks.reserveJob.mockReturnValueOnce({
      ok: true,
      reservation: {
        reservationId: "preflight-run",
        jobType: "product_research",
        jobRequestId: JOB_REQUEST_ID,
        quotaMetric: "ai_jobs_v1",
        providerCallsPlanned: 1,
        duplicate: false,
        status: "reserved",
      },
      snapshot: null,
    });
    mocks.sourcing.mockResolvedValueOnce(sourcingResult(false, "fallback"));

    await POST(createRequest({ runRisk: false, runSummary: false, runListing: false }) as never);

    expect(mocks.settleJob).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      expect.objectContaining({ reservationId: "preflight-run" }),
      {
        providerCallsStarted: 0,
        providerCallsCompleted: 0,
        providerCallsFailed: 0,
      },
    );
  });

  it("settles already-started calls when a later step throws unexpectedly", async () => {
    mocks.risk.mockRejectedValueOnce(new Error("pipeline interrupted"));

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("pipeline_error");
    expect(result.body.demoAccess).toMatchObject({
      usedAiJobs: 1,
      remainingAiJobs: 4,
    });
    expect(mocks.settleJob).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      expect.objectContaining({ reservationId: "product-run-1" }),
      {
        providerCallsStarted: 1,
        providerCallsCompleted: 1,
        providerCallsFailed: 0,
      },
    );
  });

  it("fails closed when the reservation cannot be settled", async () => {
    mocks.settleJob.mockReturnValueOnce({
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
    expect(mocks.reserveJob).not.toHaveBeenCalled();
    expect(mocks.settleJob).not.toHaveBeenCalled();
  });

  it("replays an already-settled idempotent job without calling any Provider", async () => {
    mocks.reserveJob.mockReturnValueOnce({
      ok: true,
      reservation: {
        reservationId: "product-run-1",
        jobType: "product_research",
        jobRequestId: JOB_REQUEST_ID,
        quotaMetric: "ai_jobs_v1",
        providerCallsPlanned: 4,
        duplicate: true,
        status: "committed",
        providerCallsStarted: 4,
        providerCallsCompleted: 4,
        providerCallsFailed: 0,
      },
      snapshot: {
        id: "visitor-quota",
        maxAiCalls: 5,
        usedAiCalls: 1,
        remainingAiCalls: 4,
        isActive: true,
        quotaMetric: "ai_jobs_v1",
        maxAiJobs: 5,
        usedAiJobs: 1,
        remainingAiJobs: 4,
      },
    });

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      idempotentReplay: true,
      aiJob: {
        jobType: "product_research",
        jobRequestId: JOB_REQUEST_ID,
        status: "committed",
      },
      demoAccess: { usedAiJobs: 1, remainingAiJobs: 4 },
    });
    expect(mocks.sourcing).not.toHaveBeenCalled();
    expect(mocks.risk).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.listing).not.toHaveBeenCalled();
  });

  it("returns a current zero-quota snapshot and starts no Provider for the sixth job", async () => {
    mocks.reserveJob.mockReturnValueOnce({
      ok: false,
      status: 403,
      code: "demo_ai_quota_exceeded",
      message: "额度已用完",
      snapshot: {
        id: "visitor-quota",
        maxAiCalls: 5,
        usedAiCalls: 5,
        remainingAiCalls: 0,
        isActive: true,
        quotaMetric: "ai_jobs_v1",
        maxAiJobs: 5,
        usedAiJobs: 5,
        remainingAiJobs: 0,
      },
    });

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(403);
    expect(result.body.demoAccess).toMatchObject({ usedAiJobs: 5, remainingAiJobs: 0 });
    expect(mocks.markStarted).not.toHaveBeenCalled();
    expect(mocks.sourcing).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed jobRequestId before reserving quota", async () => {
    const missing = await readJson(await POST(createRequest(undefined, "") as never));
    const malformed = await readJson(await POST(createRequest(undefined, "not-a-uuid") as never));

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mocks.reserveJob).not.toHaveBeenCalled();
    expect(mocks.sourcing).not.toHaveBeenCalled();
  });
});
