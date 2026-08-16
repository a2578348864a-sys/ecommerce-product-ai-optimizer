/**
 * V3.5 — Sourcing API Route 测试（auth 隔离 / search→preview→save 全链路 / fail-closed）
 *
 * 模式：mock demoGuard + demo sandbox store + 假 1688-cli（V35_1688_CLI_PATH）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { resetSourcingPreviewStoreForTests } from "@/lib/server/sourcingEvidence";
import { resetCliVersionCacheForTests, SOURCING_CLI_ENV_PATH } from "@/lib/server/sourcingAcquisition";
import { GET, POST } from "./route";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v35-sourcing-route-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const authState: { context: { mode: "demo"; demoAccessId: string } | { mode: "owner" } } = {
  context: { mode: "demo", demoAccessId: "demo-access-a" },
};

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: authState.context }),
  requireOwnerOnly: () => ({ ok: true, context: authState.context }),
}));

const DEMO = "demo-access-a";
const FAKE_CLI = `
const [cmd] = process.argv.slice(2);
if (cmd === "--version") { console.log("0.1.47"); process.exit(0); }
if (cmd === "whoami") { console.log(JSON.stringify({loggedIn:true})); process.exit(0); }
if (cmd === "search") { console.log(JSON.stringify({keyword:process.argv[3],total:2,offers:[{offerId:"674035283676",title:"测试保温杯A",price:{text:"¥16",min:16,max:16},supplier:{name:"测试供应商A",shopUrl:"http://shop-a.example.test",years:3},location:{province:"浙江",city:"武义县"},bizType:"生产加工",verified:{factory:true,business:false,superFactory:false},tags:[],demand:{orderCount:1},isP4P:false,turnover:"1",url:"https://detail.1688.com/offer/674035283676.html",image:"https://img.example.test/a.jpg"},{offerId:"930374004918",title:"测试保温杯B",price:{text:"¥16.5",min:16.5,max:16.5},supplier:{name:"测试供应商B",shopUrl:"http://shop-b.example.test",years:2},location:{province:"浙江",city:"金华市"},bizType:"生产加工",verified:{factory:true,business:false,superFactory:false},tags:[],demand:{orderCount:2},isP4P:false,turnover:"2",url:"https://detail.1688.com/offer/930374004918.html",image:"https://img.example.test/b.jpg"}]})); process.exit(0); }
if (cmd === "offer") { const id = process.argv[3]; console.log(JSON.stringify({offerId:id,title:"测试保温杯A",url:"https://detail.1688.com/offer/"+id+".html",priceRange:"￥21.30",priceMin:21.3,priceMax:21.3,unitName:"个",minOrderQty:1,priceTiers:[{minQty:1,price:16.5}],detailUrl:"https://itemcdn.example.test/fake",attributes:[],packageInfo:[],supplier:{name:"测试供应商A",loginId:"fake",memberId:null,userId:"FAKE-USER-ID"},freight:{receiveAddress:"某省某市"},saledCount:1,categoryId:"1",options:[],skus:[],mainImage:"https://img.example.test/a.jpg",images:[]})); process.exit(0); }
process.exit(2);
`;

let tempDir: string;
let cliPath: string;
let taskId: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "v35-sourcing-route-"));
  cliPath = join(tempDir, "fake-1688-cli.js");
  writeFileSync(cliPath, FAKE_CLI, "utf8");
  process.env[SOURCING_CLI_ENV_PATH] = cliPath;
  resetCliVersionCacheForTests();
  resetSourcingPreviewStoreForTests();
  taskId = (await createTrustedSandboxTask(DEMO, { type: "research" })).id;
  authState.context = { mode: "demo", demoAccessId: DEMO };
});

afterEach(() => {
  delete process.env[SOURCING_CLI_ENV_PATH];
  rmSync(tempDir, { recursive: true, force: true });
});

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/x/sourcing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ id: taskId }) };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function toStorageVersion() {
  const task = getSandboxTask(DEMO, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

describe("POST action=search（关键词搜索 → Preview）", () => {
  it("成功：返回 previewId + 候选（不写证据）", async () => {
    const response = await POST(request({ action: "search", keyword: "保温杯" }), context());
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.ok).toBe(true);
    const data = body.data as { preview: { previewId: string; candidates: unknown[]; method: string } };
    expect(data.preview.method).toBe("keyword");
    expect(data.preview.candidates).toHaveLength(2);
    expect(data.preview.previewId).toBeTruthy();
    // 未确认前无证据
    const getResponse = await GET(new NextRequest("http://localhost/api/tasks/x/sourcing"), context());
    const getBody = await json(getResponse);
    expect((getBody.data as { evidence: unknown }).evidence).toBeNull();
  });

  it("缺关键词 → INVALID_QUERY", async () => {
    const response = await POST(request({ action: "search" }), context());
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body.error as { code: string }).code).toBe("invalid_query");
  });

  it("工具未配置 → ACQUISITION_TOOL_NOT_AVAILABLE（清晰错误，非 500 mystery）", async () => {
    delete process.env[SOURCING_CLI_ENV_PATH];
    const response = await POST(request({ action: "search", keyword: "保温杯" }), context());
    const body = await json(response);
    expect(response.status).toBe(503);
    expect((body.error as { code: string }).code).toBe("acquisition_tool_not_available");
  });
});

describe("POST action=url / detail", () => {
  it("合法 1688 URL → 详情预览候选", async () => {
    const response = await POST(request({
      action: "url",
      url: "https://detail.1688.com/offer/930374004918.html",
    }), context());
    expect(response.status).toBe(200);
    const body = await json(response);
    const data = body.data as { preview: { method: string; candidates: { offerId: string }[] } };
    expect(data.preview.method).toBe("url");
    expect(data.preview.candidates[0].offerId).toBe("930374004918");
  });

  it("非法 URL（非 1688 域 / http）→ INVALID_URL", async () => {
    for (const url of ["https://evil.example.com/offer/930374004918.html", "http://detail.1688.com/offer/930374004918.html"]) {
      const response = await POST(request({ action: "url", url }), context());
      const body = await json(response);
      expect(response.status).toBe(400);
      expect((body.error as { code: string }).code).toBe("invalid_url");
    }
  });

  it("detail：非法 offerId → INVALID_OFFER_ID", async () => {
    const response = await POST(request({ action: "detail", offerId: "cart" }), context());
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body.error as { code: string }).code).toBe("invalid_offer_id");
  });
});

describe("POST action=save（Human Confirm 全链路）", () => {
  it("search → save → GET 有证据（含详情补全与实体绑定）", async () => {
    const searchResponse = await POST(request({ action: "search", keyword: "保温杯" }), context());
    const searchBody = await json(searchResponse);
    const previewId = (searchBody.data as { preview: { previewId: string } }).preview.previewId;

    const saveResponse = await POST(request({
      action: "save",
      previewId,
      selectedOfferIds: ["674035283676", "930374004918"],
      expectedStorageVersion: toStorageVersion(),
    }), context());
    expect(saveResponse.status).toBe(200);
    const saveBody = await json(saveResponse);
    const evidence = (saveBody.data as { evidence: { candidates: unknown[]; humanConfirmed: unknown[] } }).evidence;
    expect(evidence.candidates).toHaveLength(2);
    expect(evidence.humanConfirmed).toHaveLength(2);
    // 详情补全生效：displayedMoq 已从 detail 合并
    const first = evidence.candidates[0] as { displayedMoq: { value: number } | null };
    expect(first.displayedMoq?.value).toBe(1);

    const getResponse = await GET(new NextRequest("http://localhost/api/tasks/x/sourcing"), context());
    const getBody = await json(getResponse);
    expect((getBody.data as { evidence: { schema: string } }).evidence.schema).toBe("sourcing-evidence.v1");
  });

  it("缺 previewId → PREVIEW_REQUIRED", async () => {
    const response = await POST(request({ action: "save", selectedOfferIds: ["674035283676"], expectedStorageVersion: toStorageVersion() }), context());
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body.error as { code: string }).code).toBe("preview_required");
  });

  it("preview 过期/不存在 → PREVIEW_EXPIRED（410）", async () => {
    const response = await POST(request({
      action: "save",
      previewId: "no-such-preview",
      selectedOfferIds: ["674035283676"],
      expectedStorageVersion: toStorageVersion(),
    }), context());
    const body = await json(response);
    expect(response.status).toBe(410);
    expect((body.error as { code: string }).code).toBe("preview_expired");
  });

  it("未确认任何候选 → NO_CONFIRMED_CANDIDATES", async () => {
    const searchResponse = await POST(request({ action: "search", keyword: "保温杯" }), context());
    const searchBody = await json(searchResponse);
    const previewId = (searchBody.data as { preview: { previewId: string } }).preview.previewId;
    const response = await POST(request({
      action: "save",
      previewId,
      selectedOfferIds: [],
      expectedStorageVersion: toStorageVersion(),
    }), context());
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body.error as { code: string }).code).toBe("no_confirmed_candidates");
  });

  it("确认列表超出预览候选 → CANDIDATE_MISMATCH", async () => {
    const searchResponse = await POST(request({ action: "search", keyword: "保温杯" }), context());
    const searchBody = await json(searchResponse);
    const previewId = (searchBody.data as { preview: { previewId: string } }).preview.previewId;
    const response = await POST(request({
      action: "save",
      previewId,
      selectedOfferIds: ["99999999999"],
      expectedStorageVersion: toStorageVersion(),
    }), context());
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body.error as { code: string }).code).toBe("candidate_mismatch");
  });

  it("缺 storageVersion → STORAGE_VERSION_REQUIRED", async () => {
    const searchResponse = await POST(request({ action: "search", keyword: "保温杯" }), context());
    const searchBody = await json(searchResponse);
    const previewId = (searchBody.data as { preview: { previewId: string } }).preview.previewId;
    const response = await POST(request({ action: "save", previewId, selectedOfferIds: ["674035283676"] }), context());
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body.error as { code: string }).code).toBe("storage_version_required");
  });

  it("未知 action（含写命令名）→ INVALID_ACTION", async () => {
    for (const action of ["cart", "order", "checkout", "inquiry", "login", "image-search", "hack"]) {
      const response = await POST(request({ action }), context());
      const body = await json(response);
      expect(response.status).toBe(400);
      expect((body.error as { code: string }).code).toBe("invalid_action");
    }
  });
});

describe("GET（状态读取）", () => {
  it("返回 evidence（null）+ storageVersion + 分能力登录状态（F3：cli/image 独立）", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks/x/sourcing"), context());
    expect(response.status).toBe(200);
    const body = await json(response);
    const data = body.data as {
      evidence: unknown;
      storageVersion: { resultJsonHash: string };
      toolStatus: { loggedIn: boolean; cli: { loggedIn: boolean }; image: { extensionAvailable: boolean; reasonCode: string } };
    };
    expect(data.evidence).toBeNull();
    expect(data.storageVersion.resultJsonHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.toolStatus.loggedIn).toBe(true);
    // F3：CLI 能力独立于 image 能力（顶层字段向后兼容）
    expect(data.toolStatus.cli.loggedIn).toBe(true);
    expect(typeof data.toolStatus.image.extensionAvailable).toBe("boolean");
    expect(typeof data.toolStatus.image.reasonCode).toBe("string");
  });

  it("Visitor B 无法读取 Visitor A 的沙箱任务（sandbox 隔离）", async () => {
    authState.context = { mode: "demo", demoAccessId: "demo-access-b" };
    const response = await GET(new NextRequest("http://localhost/api/tasks/x/sourcing"), context());
    const body = await json(response);
    expect(response.status).toBe(404);
    expect((body.error as { code: string }).code).toBe("not_found");
  });
});
