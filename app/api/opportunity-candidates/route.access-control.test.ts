import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSellerSpriteCandidateSourceMeta,
  computeSellerSpriteRowHash,
} from "@/lib/server/sellerSpriteImportContract";

const mocks = vi.hoisted(() => ({
  checkAccessPassword: vi.fn(),
  getAccessContext: vi.fn(),
  listCandidates: vi.fn(),
  listSandboxCandidates: vi.fn(),
  sandboxCandidateToListItem: vi.fn((candidate: Record<string, unknown>) => ({
    ...candidate,
    sourceMode: "demo_sandbox",
    isSandbox: true,
  })),
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: mocks.checkAccessPassword,
  getAccessContext: mocks.getAccessContext,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxCandidates: mocks.listSandboxCandidates,
  createSandboxCandidate: vi.fn(),
  sandboxCandidateToListItem: mocks.sandboxCandidateToListItem,
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: vi.fn(),
  listCandidates: mocks.listCandidates,
  upsertCandidates: vi.fn(),
}));

import { GET } from "./route";

function createRequest(token: string) {
  const nextUrl = new URL("http://localhost/api/opportunity-candidates");
  return {
    method: "GET",
    url: nextUrl.toString(),
    nextUrl,
    headers: new Headers({ "x-access-token": token }),
  };
}

function candidate(id: string, name: string, demoAccessId?: string) {
  return {
    id,
    name,
    rawInput: name,
    link: null,
    score: 70,
    source: "人工录入",
    keyword: "",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "",
    status: "pending",
    sourceMetaJson: "{}",
    analysisJson: "{}",
    convertedTaskId: null,
    originProductBatchItemId: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    ...(demoAccessId ? { demoAccessId } : {}),
  };
}

function sellerSpriteCandidate(id: string, demoAccessId?: string) {
  const asin = "B0TEST0001";
  const title = "Powder sunscreen";
  const amazonUrl = `https://www.amazon.com/dp/${asin}`;
  return {
    ...candidate(id, title, demoAccessId),
    source: "SellerSprite",
    link: amazonUrl,
    sourceMetaJson: buildSellerSpriteCandidateSourceMeta({
      rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin, title, amazonUrl }),
      rowNumber: 2,
      asin,
      parentAsin: null,
      title,
      amazonUrl,
      imageUrl: null,
      priceUsd: 14.19,
      rating: 4.2,
      reviewCount: 6,
      brand: "Example",
      category: "Beauty",
      searchRank: null,
      estimatedMonthlySales: 26065,
      estimatedMonthlyRevenueUsd: 369862,
    }, "f".repeat(64), "2026-07-31T09:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAccessPassword.mockReturnValue(null);
  mocks.getAccessContext.mockImplementation((request: { headers: Headers }) => {
    const token = request.headers.get("x-access-token");
    if (token === "owner-token") return { mode: "owner", token };
    if (token === "visitor-a-token") return { mode: "demo", token, demoAccessId: "visitor-a" };
    if (token === "visitor-b-token") return { mode: "demo", token, demoAccessId: "visitor-b" };
    return null;
  });
  mocks.listCandidates.mockResolvedValue({
    items: [candidate("owner-candidate", "Owner candidate")],
    total: 1,
    hasMore: false,
    nextOffset: null,
  });
  mocks.listSandboxCandidates.mockImplementation((demoAccessId: string) => (
    demoAccessId === "visitor-a"
      ? [candidate("sandbox-a", "Visitor A candidate", "visitor-a")]
      : [candidate("sandbox-b", "Visitor B candidate", "visitor-b")]
  ));
});

describe("GET /api/opportunity-candidates access isolation", () => {
  it("Owner reads official candidates from Prisma-backed service", async () => {
    const response = await GET(createRequest("owner-token") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["owner-candidate"]);
    expect(body.items[0]).toMatchObject({
      sourceKind: "manual",
      marketplace: null,
      sourceIntegrity: "unverified",
      sourceReview: { integrity: "unverified" },
      researchAction: "research_blocked",
      researchBlockReasonCode: "candidate_not_ready",
    });
    expect(body.items[0]).not.toHaveProperty("sourceMetaJson");
    expect(body.items[0]).not.toHaveProperty("analysisJson");
    expect(body.items[0]).not.toHaveProperty("demoAccessId");
    expect(mocks.listCandidates).toHaveBeenCalledOnce();
    expect(mocks.listSandboxCandidates).not.toHaveBeenCalled();
  });

  it("Visitor does not query or receive Owner candidates", async () => {
    mocks.listSandboxCandidates.mockReturnValueOnce([]);

    const response = await GET(createRequest("visitor-a-token") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(mocks.listCandidates).not.toHaveBeenCalled();
  });

  it("Visitor A cannot read Visitor B candidates", async () => {
    const response = await GET(createRequest("visitor-a-token") as never);
    const body = await response.json();

    expect(mocks.listSandboxCandidates).toHaveBeenCalledWith("visitor-a");
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["sandbox-a"]);
    expect(body.items[0]).toMatchObject({
      sourceKind: "manual",
      marketplace: null,
      sourceIntegrity: "unverified",
      sourceReview: { integrity: "unverified" },
      researchAction: "research_blocked",
      researchBlockReasonCode: "candidate_not_ready",
    });
    expect(body.items[0]).not.toHaveProperty("sourceMetaJson");
    expect(body.items[0]).not.toHaveProperty("analysisJson");
    expect(JSON.stringify(body)).not.toContain("sandbox-b");
    expect(mocks.listCandidates).not.toHaveBeenCalled();
  });

  it("projects the same SellerSprite research action for Owner and Visitor", async () => {
    mocks.listCandidates.mockResolvedValueOnce({
      items: [sellerSpriteCandidate("owner-sellersprite")],
      total: 1,
      hasMore: false,
      nextOffset: null,
    });
    mocks.listSandboxCandidates.mockReturnValueOnce([
      sellerSpriteCandidate("sandbox-sellersprite", "visitor-a"),
    ]);

    const ownerBody = await (await GET(createRequest("owner-token") as never)).json();
    const visitorBody = await (await GET(createRequest("visitor-a-token") as never)).json();

    expect(ownerBody.items[0]).toMatchObject({
      sourceKind: "sellersprite_direct",
      researchAction: "research_available",
      researchBlockReasonCode: null,
    });
    expect(visitorBody.items[0]).toMatchObject({
      sourceKind: "sellersprite_direct",
      researchAction: "research_available",
      researchBlockReasonCode: null,
    });
    expect(JSON.stringify(ownerBody)).not.toContain("sourceFileSha256");
    expect(JSON.stringify(visitorBody)).not.toContain("sourceFileSha256");
  });
});
