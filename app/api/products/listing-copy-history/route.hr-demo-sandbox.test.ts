import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerOnly: vi.fn(),
  createListingCopyHistory: vi.fn(),
  listListingCopyHistories: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "test-pwd",
}));

vi.mock("@/lib/server/listingCopyHistoryStore", () => ({
  createListingCopyHistory: mocks.createListingCopyHistory,
  listListingCopyHistories: mocks.listListingCopyHistories,
}));

async function callGET() {
  const { GET } = await import("./route");
  const req = new Request("http://localhost/api/products/listing-copy-history", {
    headers: { "x-access-token": "demo-token" },
  });
  return GET(req as any);
}

async function callPOST() {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/products/listing-copy-history", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "demo-token" },
    body: JSON.stringify({ productName: "Phone Stand", data: { titles: ["Phone Stand"] } }),
  });
  return POST(req as any);
}

describe("HR demo sandbox guard for listing copy history collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/db");
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "demo cannot access official listing history",
    });
  });

  it("blocks demo from reading official listing copy history", async () => {
    const res = await callGET();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.listListingCopyHistories).not.toHaveBeenCalled();
  });

  it("blocks demo from creating official listing copy history", async () => {
    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.createListingCopyHistory).not.toHaveBeenCalled();
  });
});
