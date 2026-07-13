import { beforeEach, describe, expect, it, vi } from "vitest";

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
    source: "test",
    keyword: "",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "",
    status: "pending",
    sourceMetaJson: "{}",
    analysisJson: "{}",
    createdAt: "2026-07-11T00:00:00.000Z",
    ...(demoAccessId ? { demoAccessId } : {}),
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
      sourceIntegrity: "unverified",
      sourceReview: { integrity: "unverified" },
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
      sourceIntegrity: "unverified",
      sourceReview: { integrity: "unverified" },
    });
    expect(body.items[0]).not.toHaveProperty("sourceMetaJson");
    expect(body.items[0]).not.toHaveProperty("analysisJson");
    expect(JSON.stringify(body)).not.toContain("sandbox-b");
    expect(mocks.listCandidates).not.toHaveBeenCalled();
  });
});
