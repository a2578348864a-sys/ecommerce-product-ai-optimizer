import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerOnly: vi.fn(),
  deleteListingCopyHistory: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "test-pwd",
}));

vi.mock("@/lib/server/listingCopyHistoryStore", () => ({
  deleteListingCopyHistory: mocks.deleteListingCopyHistory,
}));

async function callDELETE() {
  const { DELETE } = await import("./route");
  const req = new Request("http://localhost/api/products/listing-copy-history/history-1", {
    method: "DELETE",
    headers: { "x-access-token": "demo-token" },
  });
  return DELETE(req as any, { params: Promise.resolve({ id: "history-1" }) });
}

describe("HR demo sandbox guard for listing copy history delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/db");
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "demo cannot delete official listing history",
    });
  });

  it("blocks demo from deleting official listing copy history", async () => {
    const res = await callDELETE();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.deleteListingCopyHistory).not.toHaveBeenCalled();
  });
});
