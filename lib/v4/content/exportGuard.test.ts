import { describe, expect, it } from "vitest";
import { exportBlocker } from "./exportGuard";

describe("exportGuard（门禁 7）", () => {
  it("Listing blocked → content_blocked", () => {
    const b = exportBlocker(JSON.stringify({ listing: { blocked: true }, images: { checks: { overallStatus: "blocked" } } }));
    expect(b).toEqual({ code: "content_blocked", message: expect.stringContaining("不可导出") });
  });
  it("图片视觉检查 overallStatus=blocked → content_blocked", () => {
    const b = exportBlocker(JSON.stringify({ listing: { blocked: false }, images: { checks: { overallStatus: "blocked", checks: [] } } }));
    expect(b?.code).toBe("content_blocked");
  });
  it("任一 pass=false → content_blocked（资产级，不允许 run 级掩盖）", () => {
    const b = exportBlocker(JSON.stringify({ listing: { blocked: false }, images: { checks: { overallStatus: "pass", checks: [{ check: "identity", pass: false }] } } }));
    expect(b?.code).toBe("content_blocked");
  });
  it("Listing 通过 + 图片通过 → 无阻断（合法中间态）", () => {
    const b = exportBlocker(JSON.stringify({ listing: { blocked: false }, images: { checks: { overallStatus: "pass", checks: [{ check: "identity", pass: true }] } } }));
    expect(b).toBeNull();
  });
  it("null/非 JSON/非对象 → 无阻断（fail-open 仅限无法解析，业务层另有校验）", () => {
    expect(exportBlocker(null)).toBeNull();
    expect(exportBlocker("{ not json")).toBeNull();
    expect(exportBlocker(JSON.stringify("str"))).toBeNull();
  });
});
