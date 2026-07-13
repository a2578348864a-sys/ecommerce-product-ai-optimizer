import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeSourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  saveSignedCandidates: vi.fn(),
  saveLegacyCandidates: vi.fn(),
  upsertCandidates: vi.fn(),
  saveSignedSandboxCandidates: vi.fn(),
  saveLegacySandboxCandidates: vi.fn(),
  createSandboxCandidate: vi.fn(),
}));

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "candidate-route-signed-test-password",
  checkAccessPassword: vi.fn(),
  getAccessContext: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxCandidates: vi.fn(),
  createSandboxCandidate: mocks.createSandboxCandidate,
  saveSignedSandboxCandidates: mocks.saveSignedSandboxCandidates,
  saveLegacySandboxCandidates: mocks.saveLegacySandboxCandidates,
  sandboxCandidateToListItem: vi.fn((item) => item),
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: vi.fn((value) => ["pending", "worth_analyzing", "analyzed", "paused", "rejected"].includes(value)),
  listCandidates: vi.fn(),
  upsertCandidates: mocks.upsertCandidates,
  saveSignedCandidates: mocks.saveSignedCandidates,
  saveLegacyCandidates: mocks.saveLegacyCandidates,
}));

import { createSourceProof } from "@/lib/server/sourceProof";
import { POST } from "./route";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");

function signedItem(options: { subject?: string; title?: string; evidenceId?: string; proofNow?: number } = {}) {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: options.evidenceId ?? "route-evidence-a",
    origin: "public_url",
    capturedAt: "2026-07-11T11:59:00.000Z",
    submittedUrl: "https://example.com/feed.xml",
    finalUrl: "https://example.com/feed.xml",
    candidateUrl: "https://example.com/products/widget",
    sourceRelation: "document_item",
    sourceHost: "example.com",
    sourceType: "rss",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: "application/rss+xml",
      robots: "allowed",
      redirectCount: 0,
    },
    observations: {
      title: options.title ?? "Foldable Widget Stand",
      categoryHint: "Desk accessories",
      signalText: "Portable lightweight generic metal stand",
      priceText: null,
      hasImage: null,
    },
    extractionSignals: ["rss_item"],
  });
  const ruleAssessment = assessSourceEvidenceV2(sourceEvidence, "2026-07-11T11:59:30.000Z");
  const sourceProof = createSourceProof({
    subject: options.subject ?? "owner",
    evidenceHash: createEvidenceHash(sourceEvidence),
    assessmentHash: createAssessmentHash(ruleAssessment),
    sourceType: sourceEvidence.sourceType,
    now: options.proofNow ?? NOW,
  });
  return {
    name: "client forged name",
    score: 100,
    status: "analyzed",
    sourceMetaJson: JSON.stringify({ forged: true }),
    analysisJson: JSON.stringify({ forged: true }),
    sourceEvidence,
    ruleAssessment,
    sourceProof,
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/opportunity-candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW + 1_000);
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner" } });
  mocks.saveSignedCandidates.mockImplementation(async (items) => ({
    items,
    created: items.length,
    updated: 0,
    unchanged: 0,
  }));
  mocks.saveSignedSandboxCandidates.mockImplementation((_: string, items) => ({
    items,
    created: items.length,
    unchanged: 0,
  }));
  mocks.saveLegacySandboxCandidates.mockImplementation((_: string, items) => ({
    items,
    created: items.length,
  }));
  mocks.saveLegacyCandidates.mockImplementation(async (items) => ({ items, created: items.length, updated: 0 }));
  mocks.upsertCandidates.mockImplementation(async (items) => ({ items, created: items.length, updated: 0 }));
});

describe("POST /api/opportunity-candidates signed source", () => {
  it("routes an Owner signed batch to the transaction service with server-derived fields", async () => {
    const response = await POST(request({ items: [signedItem()] }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, created: 1, updated: 0, unchanged: 0, sourceMode: "signed_source_v2" });
    expect(body.items[0]).toMatchObject({
      sourceIntegrity: "verified_public",
      sourceReview: { integrity: "verified_public" },
    });
    expect(body.items[0]).not.toHaveProperty("sourceMetaJson");
    expect(body.items[0]).not.toHaveProperty("analysisJson");
    expect(mocks.saveSignedCandidates).toHaveBeenCalledOnce();
    expect(mocks.saveSignedCandidates.mock.calls[0][0][0]).toMatchObject({
      name: "Foldable Widget Stand",
      score: 72,
      status: "pending",
    });
    expect(mocks.upsertCandidates).not.toHaveBeenCalled();
    expect(mocks.saveSignedSandboxCandidates).not.toHaveBeenCalled();
  });

  it("routes a Visitor signed batch only to its own Sandbox", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    const response = await POST(request({ items: [signedItem({ subject: "demo:visitor-a" })] }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, created: 1, unchanged: 0, isSandbox: true });
    expect(body.items[0]).toMatchObject({
      sourceIntegrity: "verified_public",
      sourceReview: { integrity: "verified_public" },
    });
    expect(body.items[0]).not.toHaveProperty("sourceMetaJson");
    expect(body.items[0]).not.toHaveProperty("analysisJson");
    expect(mocks.saveSignedSandboxCandidates).toHaveBeenCalledWith("visitor-a", expect.any(Array));
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
    expect(mocks.upsertCandidates).not.toHaveBeenCalled();
  });

  it("rejects Visitor A proof when Visitor B submits it", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-b" },
    });

    const response = await POST(request({
      items: [signedItem({ subject: "demo:visitor-a" })],
    }) as never);

    expect(response.status).toBe(409);
    expect(mocks.saveSignedSandboxCandidates).not.toHaveBeenCalled();
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["Owner", { mode: "owner" } as const, "owner"],
    ["Visitor", { mode: "demo", demoAccessId: "visitor-a" } as const, "demo:visitor-a"],
  ])("rejects the whole %s batch when one signed item is not a product Candidate", async (_label, context, subject) => {
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context });
    const response = await POST(request({
      items: [
        signedItem({ subject, title: "Foldable Widget Stand", evidenceId: "route-product" }),
        signedItem({ subject, title: "Privacy Policy", evidenceId: "route-rejected" }),
      ],
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_batch_invalid" } });
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
    expect(mocks.saveSignedSandboxCandidates).not.toHaveBeenCalled();
    expect(mocks.saveLegacyCandidates).not.toHaveBeenCalled();
    expect(mocks.saveLegacySandboxCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["partial trio", () => {
      const item = signedItem();
      return { ...item, sourceProof: undefined };
    }],
    ["mixed batch", () => [signedItem(), { name: "manual" }]],
    ["tampered Evidence", () => {
      const item = signedItem();
      return { ...item, sourceEvidence: { ...item.sourceEvidence, observations: { ...item.sourceEvidence.observations, title: "tampered" } } };
    }],
    ["expired proof", () => signedItem({ proofNow: NOW - 2 * 60 * 60 * 1_000 })],
  ])("returns 409 and calls no persistence service for %s", async (_label, build) => {
    const value = build();
    const items = Array.isArray(value) ? value : [value];
    const response = await POST(request({ items }) as never);

    expect(response.status).toBe(409);
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
    expect(mocks.saveSignedSandboxCandidates).not.toHaveBeenCalled();
    expect(mocks.upsertCandidates).not.toHaveBeenCalled();
    expect(mocks.createSandboxCandidate).not.toHaveBeenCalled();
  });

  it("maps an Owner source conflict to 409 without leaking internals", async () => {
    mocks.saveSignedCandidates.mockRejectedValue(Object.assign(new Error("internal duplicate row ids"), {
      code: "candidate_source_conflict",
    }));

    const response = await POST(request({ items: [signedItem()] }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(JSON.stringify(body)).not.toContain("internal duplicate row ids");
  });

  it("returns a generic 500 and writes nothing when the strict Sandbox store is unavailable", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    mocks.saveSignedSandboxCandidates.mockImplementation(() => {
      throw new Error("DEMO_SANDBOX_STORE_INVALID at private path");
    });

    const response = await POST(request({
      items: [signedItem({ subject: "demo:visitor-a" })],
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ ok: false, error: { code: "server_error" } });
    expect(JSON.stringify(body)).not.toContain("private path");
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
  });

  it("keeps legacy save compatible but discards client source and analysis JSON", async () => {
    const response = await POST(request({ items: [{
      name: "Manual Product",
      score: 66,
      sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", secret: "forged" }),
      analysisJson: JSON.stringify({ trusted: true }),
    }] }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, sourceMode: "legacy_unverified" });
    const input = mocks.saveLegacyCandidates.mock.calls[0][0][0];
    expect(input.sourceMetaJson).toContain("legacy_unverified");
    expect(input.sourceMetaJson).not.toContain("secret");
    expect(input.analysisJson).toContain("legacy_unverified");
    expect(input.analysisJson).not.toContain("trusted");
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
    expect(mocks.upsertCandidates).not.toHaveBeenCalled();
  });

  it("maps a legacy downgrade conflict to 409 with no alternate write path", async () => {
    mocks.saveLegacyCandidates.mockRejectedValue(Object.assign(new Error("signed downgrade blocked"), {
      code: "candidate_source_conflict",
    }));

    const response = await POST(request({ items: [{ name: "Manual Product" }] }) as never);

    expect(response.status).toBe(409);
    expect(mocks.upsertCandidates).not.toHaveBeenCalled();
    expect(mocks.saveSignedCandidates).not.toHaveBeenCalled();
  });
});
