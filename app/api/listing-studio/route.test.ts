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
  const withBrief = body && typeof body === "object" && !Array.isArray(body)
    ? {
        briefVersion: "studio-creative-brief.v1",
        factsConfirmed: true,
        humanReviewRequired: true,
        ...body,
      }
    : body;
  return POST(request(withBrief));
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
      additionalRequirements: "",
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
      additionalRequirements: "",
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

});
