import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  ensureDemoAiQuota: vi.fn(),
  consumeDemoAiCalls: vi.fn(),
  reserveDemoAiCalls: vi.fn(),
  markDemoAiProviderCallStarted: vi.fn(),
  settleDemoAiCalls: vi.fn(),
  getLatestDemoSnapshot: vi.fn(),
  generateRealAiListingDraft: vi.fn(),
  listingEnabled: false,
  visitorListingEnabled: false,
  taskCreate: vi.fn(),
  taskUpdate: vi.fn(),
  candidateUpdate: vi.fn(),
  listingHistoryCreate: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  ensureDemoAiQuota: mocks.ensureDemoAiQuota,
  consumeDemoAiCalls: mocks.consumeDemoAiCalls,
  reserveDemoAiCalls: mocks.reserveDemoAiCalls,
  markDemoAiProviderCallStarted: mocks.markDemoAiProviderCallStarted,
  settleDemoAiCalls: mocks.settleDemoAiCalls,
  getLatestDemoSnapshot: mocks.getLatestDemoSnapshot,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: { create: mocks.taskCreate, update: mocks.taskUpdate },
    opportunityCandidate: { update: mocks.candidateUpdate },
    listingCopyHistory: { create: mocks.listingHistoryCreate },
  },
}));

vi.mock("@/lib/server/aiListingGenerator", () => ({
  generateRealAiListingDraft: mocks.generateRealAiListingDraft,
}));

vi.mock("@/lib/server/realAiListingGate", () => ({
  isRealAiListingEnabled: () => mocks.listingEnabled,
  isRealAiVisitorListingEnabled: () => mocks.visitorListingEnabled,
}));

const VALID_REAL_PACK = {
  source: "real_ai_draft",
  version: 1,
  generatedAt: "2026-07-26T00:00:00.000Z",
  model: "fake",
  humanReviewRequired: true,
  titles: ["Safe test title"],
  bullets: ["Safe test bullet"],
  description: "Safe test description.",
  keywords: ["safe"],
  sellingPoints: ["Safe test point"],
  riskNotes: ["Manual review required."],
  complianceWarnings: ["Manual review required."],
  blockedClaims: [],
  reviewChecklist: ["Review before publishing."],
};

const OWNER_CONTEXT = { mode: "owner" as const, token: "test-token" };
const VISITOR_CONTEXT = {
  mode: "demo" as const,
  token: "visitor-token",
  demoAccessId: "visitor-1",
  isActive: true,
  isExpired: false,
  remainingAiCalls: 2,
};

let testRoot = "";

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "listing-studio-route-"));
});

afterAll(() => {
  delete process.env.AI_IMAGE_DRAFT_LEDGER_PATH;
  delete process.env.STUDIO_LISTING_RESULT_STORE_ROOT;
  rmSync(testRoot, { recursive: true, force: true });
});

function request(body: unknown) {
  return new NextRequest("http://localhost/api/listing-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "test-token" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/listing-studio/route");
  return POST(request(body));
}

describe("POST /api/listing-studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const caseRoot = join(testRoot, randomUUID());
    process.env.AI_IMAGE_DRAFT_LEDGER_PATH = join(caseRoot, "ledger.json");
    process.env.STUDIO_LISTING_RESULT_STORE_ROOT = join(caseRoot, "results");
    mocks.listingEnabled = false;
    mocks.visitorListingEnabled = false;
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: OWNER_CONTEXT,
    });
    mocks.ensureDemoAiQuota.mockReturnValue({ ok: true });
    mocks.consumeDemoAiCalls.mockReturnValue(null);
    mocks.reserveDemoAiCalls.mockImplementation((context) => ({
      ok: true,
      reservation: context.mode === "demo" ? { reservationId: "text-reservation", plannedCount: 1 } : null,
    }));
    mocks.markDemoAiProviderCallStarted.mockReturnValue({ ok: true });
    mocks.settleDemoAiCalls.mockReturnValue({ ok: true, snapshot: null });
    mocks.getLatestDemoSnapshot.mockReturnValue(null);
    mocks.generateRealAiListingDraft.mockImplementation(async (_context, options) => {
      await options?.onProviderCallStart?.();
      return { ok: true, data: VALID_REAL_PACK };
    });
  });

  it("rejects unauthenticated requests before generation", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "Please sign in.",
    });

    const response = await post({ productName: "Desk stand" });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid_access");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("stays in mock mode when the server real-AI switch is enabled but mode is omitted", async () => {
    mocks.listingEnabled = true;

    const response = await post({ productName: "Desk stand" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.meta.mode).toBe("mock");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("uses the complete normalized preference contract in Mock mode", async () => {
    const response = await post({
      productName: "Foldable Laptop Stand",
      description: "Aluminum stand for desk use.",
      category: "Home Office",
      targetMarket: "US",
      outputLanguage: "en",
      tone: "professional",
      coreFunction: "Six height positions",
      targetAudience: "Remote workers",
      problemSolved: "Raises the screen",
      differentiators: ["Fold-flat body"],
      primaryKeywords: ["laptop stand"],
      secondaryKeywords: ["foldable desk stand"],
      competitorKeywords: ["Example Rival"],
      confirmedFacts: ["Frame weight is 520 g"],
      unverifiedFacts: ["Supports 20 kg"],
      prohibitedClaims: ["Military grade"],
      listingObjective: "seo",
    });
    const body = await response.json();
    const listing = body.data.listingPack;
    const visibleCopy = [
      ...listing.titles,
      ...listing.bullets,
      listing.description,
      ...listing.keywords,
      ...listing.sellingPoints,
    ].join(" ");

    expect(response.status).toBe(200);
    expect(body.data.meta.input).toEqual({
      targetMarket: "US",
      outputLanguage: "en",
      tone: "professional",
      coreFunction: "Six height positions",
      targetAudience: "Remote workers",
      problemSolved: "Raises the screen",
      differentiators: ["Fold-flat body"],
      primaryKeywords: ["laptop stand"],
      secondaryKeywords: ["foldable desk stand"],
      competitorKeywords: ["Example Rival"],
      confirmedFacts: ["Frame weight is 520 g"],
      unverifiedFacts: ["Supports 20 kg"],
      prohibitedClaims: ["Military grade"],
      listingObjective: "seo",
    });
    expect(visibleCopy).toContain("Six height positions");
    expect(visibleCopy).toContain("Remote workers");
    expect(visibleCopy).toContain("laptop stand");
    expect(visibleCopy).toContain("Frame weight is 520 g");
    expect(visibleCopy).not.toContain("Supports 20 kg");
    expect(visibleCopy).not.toContain("Example Rival");
    expect(JSON.stringify(listing)).not.toContain("Example Rival");
    expect(listing.riskNotes.join(" ")).toContain("Supports 20 kg");
    expect(JSON.stringify(listing)).not.toContain("Military grade");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("rejects mode=real without explicit confirmation", async () => {
    mocks.listingEnabled = true;

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("real_ai_confirmation_required");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("rejects confirmed real mode while the server gate is disabled", async () => {
    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("real_ai_disabled");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("blocks Visitor real listing generation when the Visitor feature gate is disabled", async () => {
    mocks.listingEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: VISITOR_CONTEXT });

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("visitor_listing_generation_disabled");
    expect(mocks.reserveDemoAiCalls).not.toHaveBeenCalled();
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("rejects a real request when the Visitor quota reservation fails", async () => {
    mocks.listingEnabled = true;
    mocks.visitorListingEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: VISITOR_CONTEXT });
    mocks.reserveDemoAiCalls.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_ai_quota_exceeded",
      message: "Quota exhausted.",
    });

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("demo_ai_quota_exceeded");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
    expect(mocks.settleDemoAiCalls).not.toHaveBeenCalled();
  });

  it("reserves, records Provider start, and settles one Visitor call on success", async () => {
    mocks.listingEnabled = true;
    mocks.visitorListingEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: VISITOR_CONTEXT });
    const reservation = { reservationId: "text-reservation", plannedCount: 1 };
    mocks.reserveDemoAiCalls.mockReturnValue({ ok: true, reservation });
    mocks.settleDemoAiCalls.mockReturnValue({
      ok: true,
      snapshot: { remainingAiCalls: 1 },
    });

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.meta.mode).toBe("real");
    expect(body.data.meta.saved).toBe(false);
    expect(body.data.listingPack.humanReviewRequired).toBe(true);
    expect(mocks.reserveDemoAiCalls).toHaveBeenCalledWith(VISITOR_CONTEXT, 1);
    expect(mocks.markDemoAiProviderCallStarted).toHaveBeenCalledWith(VISITOR_CONTEXT, reservation, 1);
    expect(mocks.settleDemoAiCalls).toHaveBeenCalledWith(VISITOR_CONTEXT, reservation, 1);
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
  });

  it("passes the same complete Studio context to the fake Real generator", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const response = await post({
      productName: "Foldable Laptop Stand",
      description: "Aluminum stand for desk use.",
      category: "Home Office",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
      targetMarket: "DE",
      outputLanguage: "de",
      tone: "brand",
      coreFunction: "Six height positions",
      targetAudience: "Remote workers",
      problemSolved: "Raises the screen",
      differentiators: ["Fold-flat body"],
      primaryKeywords: ["laptop stand"],
      secondaryKeywords: ["foldable desk stand"],
      competitorKeywords: ["Example Rival"],
      confirmedFacts: ["Frame weight is 520 g"],
      unverifiedFacts: ["Supports 20 kg"],
      prohibitedClaims: ["Military grade"],
      listingObjective: "seo",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.meta.input).toMatchObject({
      targetMarket: "DE",
      outputLanguage: "de",
      tone: "brand",
      listingObjective: "seo",
    });
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        productName: "Foldable Laptop Stand",
        decisionSummary: "Aluminum stand for desk use.",
        category: "Home Office",
        studioPreferences: {
          targetMarket: "DE",
          outputLanguage: "de",
          tone: "brand",
          coreFunction: "Six height positions",
          targetAudience: "Remote workers",
          problemSolved: "Raises the screen",
          differentiators: ["Fold-flat body"],
          primaryKeywords: ["laptop stand"],
          secondaryKeywords: ["foldable desk stand"],
          competitorKeywords: ["Example Rival"],
          confirmedFacts: ["Frame weight is 520 g"],
          unverifiedFacts: ["Supports 20 kg"],
          prohibitedClaims: ["Military grade"],
          listingObjective: "seo",
        },
      }),
      expect.objectContaining({ onProviderCallStart: expect.any(Function) }),
    );
  });

  it("refunds the reservation when the Provider never starts", async () => {
    mocks.listingEnabled = true;
    mocks.visitorListingEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: VISITOR_CONTEXT });
    const reservation = { reservationId: "text-reservation", plannedCount: 1 };
    mocks.reserveDemoAiCalls.mockReturnValue({ ok: true, reservation });
    mocks.generateRealAiListingDraft.mockResolvedValue({
      ok: false,
      error: { code: "ai_provider_error", message: "Provider preflight failed." },
    });

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("ai_provider_error");
    expect(mocks.markDemoAiProviderCallStarted).not.toHaveBeenCalled();
    expect(mocks.settleDemoAiCalls).toHaveBeenCalledWith(VISITOR_CONTEXT, reservation, 0);
  });

  it("keeps a started Provider call charged when it later fails", async () => {
    mocks.listingEnabled = true;
    mocks.visitorListingEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: VISITOR_CONTEXT });
    const reservation = { reservationId: "text-reservation", plannedCount: 1 };
    mocks.reserveDemoAiCalls.mockReturnValue({ ok: true, reservation });
    mocks.generateRealAiListingDraft.mockImplementation(async (_context, options) => {
      await options?.onProviderCallStart?.();
      return { ok: false, error: { code: "ai_timeout", message: "Timed out." } };
    });

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("ai_timeout");
    expect(mocks.settleDemoAiCalls).toHaveBeenCalledWith(VISITOR_CONTEXT, reservation, 1);
  });

  it("replays a completed result without calling the Provider or reserving quota twice", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const body = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
    };

    expect((await post(body)).status).toBe(200);
    const duplicate = await post(body);
    const duplicateBody = await duplicate.json();

    expect(duplicate.status).toBe(200);
    expect(duplicateBody.data.meta.duplicate).toBe(true);
    expect(duplicateBody.data.listingPack).toEqual(VALID_REAL_PACK);
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
    expect(mocks.reserveDemoAiCalls).toHaveBeenCalledTimes(1);
  });

  it("recovers a stored result when the durable ledger commit was interrupted", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const body = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
    };

    expect((await post(body)).status).toBe(200);
    const ledgerPath = process.env.AI_IMAGE_DRAFT_LEDGER_PATH || "";
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.entries[0].status = "provider_called";
    ledger.entries[0].providerStage = "provider_called";
    writeFileSync(ledgerPath, JSON.stringify(ledger), "utf8");

    const recovered = await post(body);
    const recoveredBody = await recovered.json();

    expect(recovered.status).toBe(200);
    expect(recoveredBody.data.meta.duplicate).toBe(true);
    expect(recoveredBody.data.listingPack).toEqual(VALID_REAL_PACK);
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
    expect(mocks.reserveDemoAiCalls).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(ledgerPath, "utf8")).entries[0].status).toBe("committed");
  });

  it("replays a validated paid result even when a post-persist failure marked the ledger non-refundable", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const body = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
    };
    expect((await post(body)).status).toBe(200);
    const ledgerPath = process.env.AI_IMAGE_DRAFT_LEDGER_PATH || "";
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.entries[0].status = "failed_non_refundable";
    ledger.entries[0].providerCostConsumed = true;
    writeFileSync(ledgerPath, JSON.stringify(ledger), "utf8");

    const recovered = await post(body);

    expect(recovered.status).toBe(200);
    expect((await recovered.json()).data.meta.duplicate).toBe(true);
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a corrupt stored result without a second Provider call", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const body = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
    };
    expect((await post(body)).status).toBe(200);
    const resultRoot = process.env.STUDIO_LISTING_RESULT_STORE_ROOT || "";
    const [resultFile] = readdirSync(resultRoot);
    writeFileSync(join(resultRoot, resultFile), "{}", "utf8");

    const duplicate = await post(body);

    expect(duplicate.status).toBe(500);
    expect((await duplicate.json()).error.code).toBe("studio_result_store_corrupt");
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
  });

  it("closes a stale result-less request without calling the Provider again", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const body = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
    };
    expect((await post(body)).status).toBe(200);
    const resultRoot = process.env.STUDIO_LISTING_RESULT_STORE_ROOT || "";
    const [resultFile] = readdirSync(resultRoot);
    unlinkSync(join(resultRoot, resultFile));
    const ledgerPath = process.env.AI_IMAGE_DRAFT_LEDGER_PATH || "";
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.entries[0].status = "provider_called";
    ledger.entries[0].providerStage = "provider_called";
    ledger.entries[0].updatedAt = "2020-01-01T00:00:00.000Z";
    writeFileSync(ledgerPath, JSON.stringify(ledger), "utf8");

    const duplicate = await post(body);

    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("studio_request_already_failed");
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(ledgerPath, "utf8")).entries[0].status).toBe("failed_non_refundable");
  });

  it("rejects one idempotency key reused with different semantics", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const base = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
    };

    expect((await post(base)).status).toBe(200);
    const conflict = await post({ ...base, description: "A different product context" });

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("studio_request_conflict");
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
  });

  it("includes Studio preferences in the idempotency semantics", async () => {
    mocks.listingEnabled = true;
    const idempotencyKey = randomUUID();
    const base = {
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey,
      tone: "professional",
    };

    expect((await post(base)).status).toBe(200);
    const conflict = await post({ ...base, tone: "brand" });

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("studio_request_conflict");
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent real request in the same authenticated scope", async () => {
    mocks.listingEnabled = true;
    let releaseProvider: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    mocks.generateRealAiListingDraft.mockImplementation(async (_context, options) => {
      await options?.onProviderCallStart?.();
      signalStarted?.();
      await providerRelease;
      return { ok: true, data: VALID_REAL_PACK };
    });

    const first = post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });
    await providerStarted;
    const second = await post({
      productName: "Desk lamp",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });
    releaseProvider?.();

    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("studio_request_in_progress");
    expect((await first).status).toBe(200);
    expect(mocks.generateRealAiListingDraft).toHaveBeenCalledTimes(1);
  });

  it("propagates schema validation failures without returning Provider output", async () => {
    mocks.listingEnabled = true;
    mocks.generateRealAiListingDraft.mockResolvedValue({
      ok: false,
      error: { code: "ai_schema_invalid", message: "Invalid schema." },
    });

    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("ai_schema_invalid");
    expect(body.data).toBeUndefined();
  });

  it("filters unsupported claims from Mock output and requires human review", async () => {
    const response = await post({
      productName: "Desk stand",
      sellingPoints: "FDA Approved,100% Safe",
    });
    const body = await response.json();
    const listing = body.data.listingPack;
    const visible = [
      ...listing.titles,
      ...listing.bullets,
      listing.description,
      ...listing.sellingPoints,
    ].join(" ");

    expect(response.status).toBe(200);
    expect(listing.humanReviewRequired).toBe(true);
    expect(visible).not.toMatch(/FDA Approved|100% Safe/);
    expect(listing.blockedClaims.length).toBeGreaterThan(0);
  });

  it("returns invalid_json for malformed JSON", async () => {
    const { POST } = await import("@/app/api/listing-studio/route");
    const response = await POST(new NextRequest("http://localhost/api/listing-studio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("rejects unknown modes and unsupported fields instead of silently changing semantics", async () => {
    const invalidMode = await post({ productName: "Desk stand", mode: "REAL" });
    const unsupported = await post({ productName: "Desk stand", provider: "force-real" });

    expect(invalidMode.status).toBe(400);
    expect((await invalidMode.json()).error.code).toBe("invalid_mode");
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error.code).toBe("unsupported_request_field");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("rejects overlong, excessive, and nested Studio input before generation", async () => {
    const overlong = await post({ productName: "x".repeat(201) });
    const excessive = await post({
      productName: "Desk stand",
      secondaryKeywords: Array.from({ length: 13 }, (_, index) => `keyword-${index}`),
    });
    const nested = await post({
      productName: "Desk stand",
      coreFunction: { text: "Adjustable" },
    });

    expect(overlong.status).toBe(400);
    expect((await overlong.json()).error.code).toBe("invalid_studio_input");
    expect(excessive.status).toBe(400);
    expect((await excessive.json()).error.code).toBe("invalid_studio_input");
    expect(nested.status).toBe(400);
    expect((await nested.json()).error.code).toBe("invalid_studio_input");
    expect(mocks.generateRealAiListingDraft).not.toHaveBeenCalled();
  });

  it("rejects malformed idempotency keys before quota reservation", async () => {
    mocks.listingEnabled = true;
    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: "not-a-uuid",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_idempotency_key");
    expect(mocks.reserveDemoAiCalls).not.toHaveBeenCalled();
  });

  it("never creates or updates Task, Candidate, or Listing history records", async () => {
    mocks.listingEnabled = true;
    const response = await post({
      productName: "Desk stand",
      mode: "real",
      confirmRealAi: true,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(200);
    expect(mocks.taskCreate).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.candidateUpdate).not.toHaveBeenCalled();
    expect(mocks.listingHistoryCreate).not.toHaveBeenCalled();
  });
});
