import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

/**
 * B3 契约：/api/opportunities 根路由（历史 A–E 批量分析）已下线 → 410。
 * 子路由（crawl / source-import / sellersprite-import / sellersprite-preview /
 * sellersprite-plugin-import）不受影响（各自 route.test.ts 覆盖）。
 */
describe("POST /api/opportunities legacy root — retired with 410", () => {
  it("returns 410 legacy_endpoint for a valid-shaped request", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": "token" },
      body: JSON.stringify({ rawText: "Phone Stand" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: { code: "legacy_endpoint" } });
  });

  it("returns 410 without parsing an invalid body (no side effects)", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": "token" },
      body: "{ not valid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(410);
  });
});
