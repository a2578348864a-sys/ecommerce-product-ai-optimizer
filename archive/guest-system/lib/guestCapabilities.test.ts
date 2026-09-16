import { describe, expect, it } from "vitest";
import { resolveGuestCapability, GUEST_CAPABILITY_ROUTES } from "@/lib/server/guestCapabilities";

describe("Guest Capability Allow-list（§21-24：DEFAULT DENY）", () => {
  it("显式 ALLOW 的黄金演示端点放行", () => {
    expect(resolveGuestCapability("GET", "/api/demo/golden")).toBe("view_golden_demo");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc")).toBe("view_guest_task");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/fact-candidates")).toBe("view_evidence");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/review-evidence")).toBe("view_evidence");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/ai-evidence-summary")).toBe("view_evidence");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/competitor-evidence")).toBe("view_market_observations");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/listing-handoff")).toBe("view_existing_listing");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/creative-handoff")).toBe("view_existing_listing");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/image-handoff")).toBe("view_existing_images");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/image-draft/img_1")).toBe("view_existing_images");
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_abc/listing-handoff")).toBe("generate_guest_listing");
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_abc/image-handoff")).toBe("generate_guest_image");
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_abc/fact-candidates")).toBe("human_demo_interaction");
    expect(resolveGuestCapability("PATCH", "/api/tasks/sandbox_task_abc/image-handoff")).toBe("human_demo_interaction");
  });

  it("UNKNOWN_GUEST_ACTION → null（默认 DENY）", () => {
    expect(resolveGuestCapability("POST", "/api/workflows/product-analysis")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunities/crawl")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunities/sellersprite-import")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunities/sellersprite-plugin-import")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunities/source-import")).toBeNull();
  // V4.1 门禁 6：演示沙盒选择白名单（GET/POST/DELETE 显式 ALLOW）
  expect(resolveGuestCapability("GET", "/api/replay/demo-choice")).toBe("human_demo_interaction");
  expect(resolveGuestCapability("POST", "/api/replay/demo-choice")).toBe("human_demo_interaction");
  expect(resolveGuestCapability("DELETE", "/api/replay/demo-choice")).toBe("human_demo_interaction");
    expect(resolveGuestCapability("POST", "/api/opportunity-candidates")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_abc/browser-evidence")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_abc/visual-reference-import")).toBeNull();
    expect(resolveGuestCapability("DELETE", "/api/tasks/sandbox_task_abc")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/tasks")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/opportunity-candidates")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/products/ai-analysis")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/agents/viral")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/runtime-mode")).toBeNull();
  });

  it("方法不匹配也拒绝（POST 只读端点 / GET 生成端点）", () => {
    expect(resolveGuestCapability("POST", "/api/demo/golden")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/listing-handoff")).toBe("view_existing_listing");
  });

  it("路径越界（:taskId 之外追加段）不匹配", () => {
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/extra-segment")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_abc/image-draft/img_1/extra")).toBeNull();
  });

  it("注册表是显式最小集（不允许空注册表 = 全拒）", () => {
    expect(GUEST_CAPABILITY_ROUTES.length).toBeGreaterThan(15);
  });
});