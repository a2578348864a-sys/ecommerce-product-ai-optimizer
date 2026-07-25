import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  listSandboxCandidates: vi.fn(),
  getSandboxCandidate: vi.fn(),
  sandboxCandidateToListItem: vi.fn((candidate: Record<string, unknown>) => ({
    ...candidate,
    updatedAt: candidate.createdAt,
    convertedTaskId: candidate.convertedTaskId ?? null,
    lastActionAt: candidate.lastActionAt ?? null,
    sourceIntegrity: "unverified",
    sourceMode: "demo_sandbox",
    isSandbox: true,
    canEdit: true,
    canDelete: true,
  })),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: (value: unknown) => (
    typeof value === "string"
    && ["pending", "worth_analyzing", "analyzed", "paused", "rejected"].includes(value)
  ),
  listCandidates: mocks.listCandidates,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxCandidates: mocks.listSandboxCandidates,
  getSandboxCandidate: mocks.getSandboxCandidate,
  isSandboxCandidateId: (id: string) => id.startsWith("sandbox_"),
  sandboxCandidateToListItem: mocks.sandboxCandidateToListItem,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    opportunityCandidate: {
      findUnique: mocks.findUnique,
    },
  },
}));

import { createScopedOpportunityStore } from "@/lib/server/opportunityStore";
import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";

function sandboxCandidate(
  id: string,
  name: string,
  score: number,
  status = "pending",
) {
  return {
    id,
    demoAccessId: "visitor-a",
    name,
    rawInput: name,
    link: null,
    score,
    source: "test",
    keyword: "",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "",
    status,
    sourceMetaJson: "{}",
    analysisJson: "{}",
    createdAt: "2026-07-24T00:00:00.000Z",
    convertedTaskId: null,
    lastActionAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("legacy scoped opportunity store", () => {
  it("binds Owner reads to the existing Prisma-backed candidate service", async () => {
    const expected = {
      items: [{ id: "candidate-owner" }],
      total: 1,
      hasMore: false,
      nextOffset: null,
    };
    mocks.listCandidates.mockResolvedValueOnce(expected);

    const store = createScopedOpportunityStore({ mode: "owner", token: "owner-token" });
    const query = { status: "pending", q: "alpha", sort: "score", limit: 20, offset: 2 };
    const result = await store.candidates.list(query);

    expect(result).toBe(expected);
    expect(mocks.listCandidates).toHaveBeenCalledWith(query);
    expect(mocks.listSandboxCandidates).not.toHaveBeenCalled();
    expect(store).not.toHaveProperty("scopeId");
    expect(store.candidates).not.toHaveProperty("scopeId");
  });

  it("binds Visitor list reads to its existing JSON Sandbox partition", async () => {
    mocks.listSandboxCandidates.mockReturnValueOnce([
      sandboxCandidate("sandbox_low", "Alpha low", 40),
      sandboxCandidate("sandbox_other", "Beta high", 99),
      sandboxCandidate("sandbox_high", "Alpha high", 80),
      sandboxCandidate("sandbox_rejected", "Alpha rejected", 90, "rejected"),
    ]);

    const store = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 2,
    });
    const result = await store.candidates.list({
      status: "pending",
      q: "ALPHA",
      sort: "score",
      limit: 1,
      offset: 0,
    });

    expect(mocks.listSandboxCandidates).toHaveBeenCalledWith("visitor-a");
    expect(result).toMatchObject({
      total: 2,
      hasMore: true,
      nextOffset: 1,
    });
    expect(result.items.map((item) => item.id)).toEqual(["sandbox_high"]);
    expect(mocks.listCandidates).not.toHaveBeenCalled();
  });

  it("preserves Visitor default order and ignores an invalid status filter", async () => {
    mocks.listSandboxCandidates.mockReturnValueOnce([
      sandboxCandidate("sandbox_newer", "Newer", 40),
      sandboxCandidate("sandbox_older", "Older", 99, "rejected"),
    ]);
    const store = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 2,
    });

    const result = await store.candidates.list({
      status: "unknown-status",
      limit: 50,
      offset: 0,
    });

    expect(result.items.map((item) => item.id)).toEqual(["sandbox_newer", "sandbox_older"]);
    expect(result).toMatchObject({
      total: 2,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("returns the current empty Visitor page contract", async () => {
    mocks.listSandboxCandidates.mockReturnValueOnce([]);
    const store = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 2,
    });

    await expect(store.candidates.list({ limit: 50, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("keeps Visitor authoritative reads inside the bound demoAccessId", async () => {
    mocks.getSandboxCandidate.mockImplementation((demoAccessId: string, candidateId: string) => (
      demoAccessId === "visitor-a" && candidateId === "sandbox_a"
        ? sandboxCandidate("sandbox_a", "Visitor A", 70)
        : null
    ));

    const visitorA = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-a-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 1,
    });

    await expect(visitorA.candidates.getAuthoritative("sandbox_b")).resolves.toBeNull();
    await expect(visitorA.candidates.getAuthoritative("sandbox_a")).resolves.toMatchObject({
      id: "sandbox_a",
      name: "Visitor A",
    });
    expect(mocks.getSandboxCandidate).toHaveBeenNthCalledWith(1, "visitor-a", "sandbox_b");
    expect(mocks.getSandboxCandidate).toHaveBeenNthCalledWith(2, "visitor-a", "sandbox_a");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("keeps Owner authoritative reads on Prisma and rejects Sandbox IDs", async () => {
    const ownerCandidate = {
      id: "candidate-owner",
      name: "Owner candidate",
      rawInput: "Owner candidate",
      link: null,
      score: 80,
      source: "test",
      keyword: "",
      riskLevel: "",
      riskLabel: "",
      summaryLabel: "",
      status: "pending",
      sourceMetaJson: "{}",
      analysisJson: "{}",
    };
    mocks.findUnique.mockResolvedValueOnce(ownerCandidate);
    const store = createScopedOpportunityStore({ mode: "owner", token: "owner-token" });

    await expect(store.candidates.getAuthoritative("sandbox_a")).resolves.toBeNull();
    await expect(store.candidates.getAuthoritative("candidate-owner")).resolves.toEqual(ownerCandidate);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "candidate-owner" },
      select: {
        id: true,
        name: true,
        rawInput: true,
        link: true,
        score: true,
        source: true,
        keyword: true,
        riskLevel: true,
        riskLabel: true,
        summaryLabel: true,
        status: true,
        sourceMetaJson: true,
        analysisJson: true,
      },
    });
    expect(mocks.getSandboxCandidate).not.toHaveBeenCalled();
  });

  it("rejects an Owner ID for Visitor without querying either backend", async () => {
    const store = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 1,
    });

    await expect(store.candidates.getAuthoritative("candidate-owner")).resolves.toBeNull();
    expect(mocks.getSandboxCandidate).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("preserves not-found for both legacy backends", async () => {
    mocks.getSandboxCandidate.mockReturnValueOnce(null);
    mocks.findUnique.mockResolvedValueOnce(null);
    const owner = createScopedOpportunityStore({ mode: "owner", token: "owner-token" });
    const visitor = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 1,
    });

    await expect(owner.candidates.getAuthoritative("candidate-missing")).resolves.toBeNull();
    await expect(visitor.candidates.getAuthoritative("sandbox_missing")).resolves.toBeNull();
  });

  it("rejects local draft IDs before either legacy backend is queried", async () => {
    const owner = createScopedOpportunityStore({ mode: "owner", token: "owner-token" });
    const visitor = createScopedOpportunityStore({
      mode: "demo",
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 1,
    });

    await expect(owner.candidates.getAuthoritative("opp-local-draft")).resolves.toBeNull();
    await expect(visitor.candidates.getAuthoritative("opp-local-draft")).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.getSandboxCandidate).not.toHaveBeenCalled();
  });

  it("keeps the compatibility authority entry and scoped store on one behavior", async () => {
    const candidate = sandboxCandidate("sandbox_a", "Visitor A", 70);
    mocks.getSandboxCandidate.mockReturnValue(candidate);
    const context = {
      mode: "demo" as const,
      token: "visitor-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 1,
    };

    const compatibilityResult = await getAuthoritativeCandidate(context, "sandbox_a");
    const scopedResult = await createScopedOpportunityStore(context)
      .candidates
      .getAuthoritative("sandbox_a");

    expect(scopedResult).toEqual(compatibilityResult);
    expect(scopedResult).toEqual({
      id: "sandbox_a",
      name: "Visitor A",
      rawInput: "Visitor A",
      link: null,
      score: 70,
      source: "test",
      keyword: "",
      riskLevel: "",
      riskLabel: "",
      summaryLabel: "",
      status: "pending",
      sourceMetaJson: "{}",
      analysisJson: "{}",
    });
  });
});

describe("legacy scoped opportunity store architecture", () => {

  it("keeps each legacy Candidate read rule in one production module", () => {
    const authority = readFileSync(
      resolve(process.cwd(), "lib/server/candidateAuthority.ts"),
      "utf8",
    );
    const adapter = readFileSync(
      resolve(process.cwd(), "lib/server/legacyScopedOpportunityStore.ts"),
      "utf8",
    );
    const legacyRead = readFileSync(
      resolve(process.cwd(), "lib/server/legacyCandidateRead.ts"),
      "utf8",
    );
    const route = readFileSync(
      resolve(process.cwd(), "app/api/opportunity-candidates/route.ts"),
      "utf8",
    );

    expect(authority).not.toMatch(/@\/lib\/server\/(?:db|demoSandbox)/);
    expect(authority).not.toContain("isLocalDraftCandidateId");
    expect(adapter).not.toContain("isLocalDraftCandidateId");
    expect(route).not.toContain("listSandboxCandidates");
    expect(legacyRead).toContain("isLocalDraftCandidateId");
    expect(legacyRead).toContain("listSandboxCandidates");
    expect(legacyRead).toContain("AUTHORITATIVE_CANDIDATE_SELECT");
  });

  it("keeps the server read modules free of HTTP, React, and naked scopeId", () => {
    const sources = [
      "lib/server/opportunityScope.ts",
      "lib/server/scopedOpportunityStore.ts",
      "lib/server/legacyCandidateRead.ts",
      "lib/server/legacyScopedOpportunityStore.ts",
      "lib/server/opportunityStore.ts",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");

    expect(sources).not.toMatch(/from ["'](?:react|next\/server)["']/);
    expect(sources).not.toContain("NextRequest");
    expect(sources).not.toContain("NextResponse");
    expect(sources).not.toContain("scopeId");
  });
});
