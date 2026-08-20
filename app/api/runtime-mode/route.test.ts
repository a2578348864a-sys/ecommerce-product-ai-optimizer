import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/runtime-mode/route";
import { loadDemoAccessStore, saveDemoAccessStore } from "@/lib/server/demoAccess";

beforeEach(() => {
  process.env.DEMO_ACCESS_STORE_PATH = ".next/test-stores/runtime-mode.route.json";
  saveDemoAccessStore({ version: 1, accesses: [] });
});

afterEach(() => {
  delete process.env.QX_RUNTIME_MODE;
  delete process.env.DEMO_ACCESS_STORE_PATH;
});

describe("GET /api/runtime-mode", () => {
  it("public_showcase → 返回模式；GET 不创建任何 guest 记录（§12：HOME 无创建）", async () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const req = new NextRequest("http://127.0.0.1:3010/api/runtime-mode", { method: "GET" });
    const res = await GET(req);
    const json = await res.clone().json();
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("public_showcase");
    expect(json.noAuthOwner).toBe(false);
    expect(loadDemoAccessStore().accesses).toHaveLength(0);
  });

  it("显式 local_owner → noAuthOwner=true；缺省 → noAuthOwner=false", async () => {
    process.env.QX_RUNTIME_MODE = "local_owner";
    const req = new NextRequest("http://127.0.0.1:3005/api/runtime-mode", { method: "GET" });
    const res = await GET(req);
    const json = await res.clone().json();
    expect(json.mode).toBe("local_owner");
    expect(json.noAuthOwner).toBe(true);
    delete process.env.QX_RUNTIME_MODE;
    const res2 = await GET(new NextRequest("http://127.0.0.1:3005/api/runtime-mode", { method: "GET" }));
    const json2 = await res2.clone().json();
    expect(json2.mode).toBe("local_owner");
    expect(json2.noAuthOwner).toBe(false);
  });
});