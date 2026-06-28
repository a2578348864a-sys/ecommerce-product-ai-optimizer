/**
 * Core-4-Fix.1-Test — PATCH /api/tasks/[id]/listing-pack route tests
 */
import { describe, it, expect, vi } from "vitest";

// Mock prisma
vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock access password for owner auth
vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "test-pwd",
  getAccessContext: () => ({ mode: "owner", token: "tok_test" }),
  checkAccessPassword: () => null,
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: { mode: "owner" } }),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
  getSandboxTask: () => null,
  updateSandboxTask: () => null,
}));

import { prisma } from "@/lib/server/db";

const VALID_SNAPSHOT = {
  version: 1,
  source: "rule_based",
  generatedAt: "2025-01-01T00:00:00.000Z",
  productName: "Test Product",
  pack: { titleDrafts: ["Test"], bulletPoints: ["Test bullet"], coreKeywords: [], longTailKeywords: [], scenarioKeywords: [], audienceKeywords: [], featureKeywords: [], sellingPoints: [], targetAudience: [], imageRequirements: [], priceSuggestion: "", riskTerms: [], prePublishChecklist: [], disclaimer: "", source: "rule_based", generatedAt: "" },
  markdown: "# Test",
  safety: { unverifiedClaimsSanitized: true, requiresHumanReview: true, autoListing: false },
};

async function callPATCH(taskId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/tasks/[id]/listing-pack/route");
  const req = new Request(`http://localhost/api/tasks/${taskId}/listing-pack`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-access-token": "tok_test" },
    body: JSON.stringify(body),
  });
  // Pass body as raw JSON string in request
  return PATCH(req as any, { params: Promise.resolve({ id: taskId }) });
}

describe("PATCH /api/tasks/[id]/listing-pack", () => {
  it("saves valid listingPackSnapshot and returns savedAt", async () => {
    const mockFind = prisma.viralAnalysisRecord.findUnique as ReturnType<typeof vi.fn>;
    const mockUpdate = prisma.viralAnalysisRecord.update as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue({ resultJson: '{"existingField":"keep-me"}' });
    mockUpdate.mockResolvedValue({ id: "task-1" });

    const res = await callPATCH("task-1", { listingPackSnapshot: VALID_SNAPSHOT });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.id).toBe("task-1");
    expect(data.data.savedAt).toBeTruthy();

    // Verify resultJson merge preserved existing field
    const updateCall = mockUpdate.mock.calls[0][0];
    const merged = JSON.parse(updateCall.data.resultJson);
    expect(merged.existingField).toBe("keep-me");
    expect(merged.listingPackSnapshot).toBeTruthy();
    expect(merged.listingPackSnapshot.safety.autoListing).toBe(false);
    expect(merged.listingPackSnapshot.safety.requiresHumanReview).toBe(true);
    expect(merged.listingPackSnapshot.safety.unverifiedClaimsSanitized).toBe(true);
  });

  it("enforces safety fields even when client sends false values", async () => {
    const mockFind = prisma.viralAnalysisRecord.findUnique as ReturnType<typeof vi.fn>;
    const mockUpdate = prisma.viralAnalysisRecord.update as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue({ resultJson: '{}' });
    mockUpdate.mockResolvedValue({ id: "task-2" });

    const badSnapshot = {
      ...VALID_SNAPSHOT,
      safety: { unverifiedClaimsSanitized: false, requiresHumanReview: false, autoListing: true },
    };
    const res = await callPATCH("task-2", { listingPackSnapshot: badSnapshot });
    const data = await res.json();

    expect(res.status).toBe(200);
    const updateCall = mockUpdate.mock.calls[0][0];
    const merged = JSON.parse(updateCall.data.resultJson);
    expect(merged.listingPackSnapshot.safety.autoListing).toBe(false);
    expect(merged.listingPackSnapshot.safety.requiresHumanReview).toBe(true);
    expect(merged.listingPackSnapshot.safety.unverifiedClaimsSanitized).toBe(true);
  });

  it("returns 400 when listingPackSnapshot is missing", async () => {
    const res = await callPATCH("task-3", {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/listing-pack/route");
    const req = new Request("http://localhost/api/tasks/task-4/listing-pack", {
      method: "PATCH",
      headers: { "Content-Type": "text/plain", "x-access-token": "tok_test" },
      body: "not json",
    });
    const res = await PATCH(req as any, { params: Promise.resolve({ id: "task-4" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when task does not exist", async () => {
    const mockFind = prisma.viralAnalysisRecord.findUnique as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue(null);

    const res = await callPATCH("nonexistent", { listingPackSnapshot: VALID_SNAPSHOT });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("returns 400 when task id is missing", async () => {
    const res = await callPATCH("", { listingPackSnapshot: VALID_SNAPSHOT });
    expect(res.status).toBe(400);
  });
});
