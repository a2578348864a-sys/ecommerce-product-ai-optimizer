import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { mode: "owner" | "demo" } = { mode: "demo" };
const mocks = vi.hoisted(() => ({
  reserveJourney: vi.fn(),
  commitJourney: vi.fn(),
  releaseJourney: vi.fn(),
  buildIdentity: vi.fn(() => "manual:desk-stand"),
  sourcing: vi.fn(),
  risk: vi.fn(),
  summary: vi.fn(),
  listing: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => state.mode === "demo"
    ? { ok: true, context: { mode: "demo", demoAccessId: "visitor-quota" } }
    : { ok: true, context: { mode: "owner", token: "owner-token" } },
}));

vi.mock("@/lib/server/demoProductJourneyQuota", () => ({
  buildProductJourneyIdentity: mocks.buildIdentity,
  reserveDemoProductJourney: mocks.reserveJourney,
  commitDemoProductJourney: mocks.commitJourney,
  releaseDemoProductJourney: mocks.releaseJourney,
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
const RESERVED_SNAPSHOT = {
  id: "visitor-quota",
  label: "Visitor",
  expiresAt: null,
  isActive: true,
  quotaMetric: "product_journeys_v1",
  maxProducts: 5,
  usedProducts: 0,
  reservedProducts: 1,
  remainingProducts: 4,
};
const COMMITTED_SNAPSHOT = {
  ...RESERVED_SNAPSHOT,
  usedProducts: 1,
  reservedProducts: 0,
};

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

function sourcingResult(status: "completed" | "fallback" = "completed") {
  return {
    providerCallStarted: true,
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

function riskResult() {
  return {
    providerCallStarted: true,
    status: "completed",
    warnings: [],
    data: { overallLevel: "yellow", summary: "risk", blacklistMatches: [], beginnerFriendly: true, complianceWarnings: [] },
  };
}

function summaryResult() {
  return {
    providerCallStarted: true,
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

function listingResult() {
  return {
    providerCallStarted: true,
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
  mocks.reserveJourney.mockReturnValue({
    ok: true,
    duplicate: false,
    status: "reserved",
    snapshot: RESERVED_SNAPSHOT,
  });
  mocks.commitJourney.mockReturnValue({
    ok: true,
    duplicate: false,
    status: "committed",
    snapshot: COMMITTED_SNAPSHOT,
  });
  mocks.releaseJourney.mockReturnValue({
    ok: true,
    duplicate: false,
    status: "released",
    snapshot: { ...RESERVED_SNAPSHOT, reservedProducts: 0, remainingProducts: 5 },
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

describe("product-analysis Visitor product-journey quota", () => {
  it("reserves one product chain, audits Provider calls, and commits after research is established", async () => {
    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(mocks.buildIdentity).toHaveBeenCalledWith({ candidateId: null, productName: "Desk Stand" });
    expect(mocks.reserveJourney).toHaveBeenCalledWith(
      "visitor-quota",
      "manual:desk-stand",
      JOB_REQUEST_ID,
      { leaseMs: 240_000 },
    );
    expect(mocks.commitJourney).toHaveBeenCalledWith("visitor-quota", "manual:desk-stand", JOB_REQUEST_ID);
    expect(mocks.releaseJourney).not.toHaveBeenCalled();
    expect(result.body.demoAccess).toMatchObject({ usedProducts: 1, remainingProducts: 4 });
    expect(result.body.productJourney).toMatchObject({
      identity: "manual:desk-stand",
      status: "committed",
      quotaMetric: "product_journeys_v1",
    });
    expect(result.body.costGuard).toMatchObject({
      providerCallsPlanned: 4,
      providerCallsStarted: 4,
      providerCallsCompleted: 4,
      providerCallsFailed: 0,
      quotaMetric: "product_journeys_v1",
    });
  });

  it("releases the slot when every research step falls back and no usable chain is established", async () => {
    mocks.sourcing.mockImplementationOnce(async (_name, _description, options) => {
      await options?.onProviderCallStart?.();
      return sourcingResult("fallback");
    });

    const result = await readJson(await POST(createRequest({
      runRisk: false,
      runSummary: false,
      runListing: false,
    }) as never));

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("failed");
    expect(mocks.releaseJourney).toHaveBeenCalledWith("visitor-quota", "manual:desk-stand", JOB_REQUEST_ID);
    expect(mocks.commitJourney).not.toHaveBeenCalled();
  });

  it("releases the slot when a system error interrupts establishment", async () => {
    mocks.risk.mockRejectedValueOnce(new Error("pipeline interrupted"));

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("pipeline_error");
    expect(mocks.releaseJourney).toHaveBeenCalledWith("visitor-quota", "manual:desk-stand", JOB_REQUEST_ID);
    expect(mocks.commitJourney).not.toHaveBeenCalled();
  });

  it("fails closed if the successful chain cannot be committed", async () => {
    mocks.commitJourney.mockReturnValueOnce({
      ok: false,
      code: "product_journey_reservation_missing",
      message: "missing reservation",
      snapshot: RESERVED_SNAPSHOT,
    });

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("product_journey_reservation_missing");
    expect(result.body.runProof).toBeUndefined();
  });

  it("does not reserve, commit, or release Visitor product slots for Owner", async () => {
    state.mode = "owner";

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(mocks.reserveJourney).not.toHaveBeenCalled();
    expect(mocks.commitJourney).not.toHaveBeenCalled();
    expect(mocks.releaseJourney).not.toHaveBeenCalled();
  });

  it("replays a committed same-product journey without another Provider call", async () => {
    mocks.reserveJourney.mockReturnValueOnce({
      ok: true,
      duplicate: true,
      status: "committed",
      snapshot: COMMITTED_SNAPSHOT,
    });

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      idempotentReplay: true,
      productJourney: { status: "committed", quotaMetric: "product_journeys_v1" },
      demoAccess: { usedProducts: 1, remainingProducts: 4 },
    });
    expect(mocks.sourcing).not.toHaveBeenCalled();
    expect(mocks.risk).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.listing).not.toHaveBeenCalled();
  });

  it("rejects the sixth distinct product before any Provider starts", async () => {
    mocks.reserveJourney.mockReturnValueOnce({
      ok: false,
      code: "visitor_product_quota_exhausted",
      message: "该访客码的 5 个商品体验名额已全部使用。",
      snapshot: { ...COMMITTED_SNAPSHOT, usedProducts: 5, remainingProducts: 0 },
    });

    const result = await readJson(await POST(createRequest() as never));

    expect(result.status).toBe(403);
    expect(result.body.error.message).toBe("该访客码的 5 个商品体验名额已全部使用。");
    expect(result.body.demoAccess).toMatchObject({ usedProducts: 5, remainingProducts: 0 });
    expect(mocks.sourcing).not.toHaveBeenCalled();
  });

  it("rejects a malformed request id before reserving a product slot", async () => {
    const missing = await readJson(await POST(createRequest(undefined, "") as never));
    const malformed = await readJson(await POST(createRequest(undefined, "not-a-uuid") as never));

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mocks.reserveJourney).not.toHaveBeenCalled();
    expect(mocks.sourcing).not.toHaveBeenCalled();
  });
});
