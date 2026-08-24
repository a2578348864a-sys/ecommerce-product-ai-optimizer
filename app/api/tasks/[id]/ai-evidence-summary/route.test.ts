/**
 * RESEARCH_LISTING_CLOSURE_R2 — 契约：GET/POST /ai-evidence-summary 必须返回服务端生成的 businessModules。
 * 红灯先行：实现前本文件失败（route 当前不返回 businessModules）。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { GET as routeGet, POST as routePost } from "@/app/api/tasks/[id]/ai-evidence-summary/route";

const origEnv = vi.hoisted(() => {
  const orig = {
    sandbox: process.env.DEMO_SANDBOX_STORE_PATH,
    access: process.env.DEMO_ACCESS_STORE_PATH,
  };
  return orig;
});
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn(() => ({
    ok: true,
    context: { mode: "demo", token: "tok-demo-a", demoAccessId: "demo-access-a", isActive: true, isExpired: false, remainingAiCalls: 10 },
  })),
  requireOwnerOnly: vi.fn(() => ({ ok: true, context: { mode: "owner", token: "tok-owner" } })),
  ensureDemoAiQuota: vi.fn(() => ({ ok: true })),
  consumeDemoAiCalls: vi.fn(() => null),
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn(),
}));

import { callAiJson } from "@/lib/server/aiClient";

const NOW = "2026-08-15T00:00:00.000Z";
const DEMO = "demo-access-a";

const BASE_RESULT = {
  sourceMeta: {
    productBatchSnapshot: {
      asin: "B0TEST0001",
      marketplace: "amazon.com",
      reportType: "keyword_mining",
      capturedAt: NOW,
      productFacts: {
        productTitle: "Golden Test Bottle",
        brand: "Golden Brand",
        price: 24.99,
        rating: 4.6,
        reviews: 1234,
        estimatedMonthlySales: 228,
      },
    },
  },
  reviewEvidence: {
    schema: "review-evidence.v1",
    version: 1,
    dataset: {
      stats: { totalReviews: 1 },
      reviews: [{
        evidenceId: "voc-1",
        asin: "B0TEST0001",
        sourceProductRole: "current_candidate",
        reviewText: "Golden Test Bottle keeps water cold all day and the lid is sturdy.",
        rating: 4,
        capturedAt: NOW,
      }],
    },
    updatedAt: NOW,
  },
  decisionEvidence: {
    version: "decision-evidence-v1",
    generatedAt: NOW,
    historicalFallback: false,
    warnings: [],
    items: [
      {
        id: "ev-1", field: "price", label: "价格", value: 24.99, summary: "价格 24.99 USD",
        kind: "fact", sourceType: "candidate", status: "confirmed", capturedAt: NOW,
      },
      {
        id: "ev-2", field: "estimatedMonthlySales", label: "估算月销量", value: 228, summary: "估算月销量 228",
        kind: "estimate", sourceType: "candidate", status: "estimated", capturedAt: NOW,
      },
    ],
    missingData: [],
    conflicts: [],
  },
};

const GOLDEN_AI_OUTPUT = {
  facts: [
    { text: "商品价格为 24.99 USD", evidenceRefs: ["ev:ev-1"] },
    { text: "评分 4.6，评论 1234", evidenceRefs: ["ev:ev-1"] },
  ],
  estimates: [
    { text: "估算月销量 228", evidenceRefs: ["ev:ev-2"] },
  ],
  signals: [
    { text: "价格处于常见区间", evidenceRefs: ["ev:ev-1"] },
  ],
  risks: [
    { text: "缺货源与合规证据", evidenceRefs: ["ev:ev-1"] },
  ],
  conflicts: [],
  missing: [{ text: "采购价 unknown", evidenceRefs: [] }],
  nextSteps: [{ text: "补充供应商信息", evidenceRefs: [] }],
  noviceExplanation: {
    whatWeKnow: "已确认价格 24.99 USD、评分 4.6。",
    whatWeDontKnow: "采购价、MOQ、物流成本、合规均未知。",
    biggestRisk: "缺货源与合规证据。",
    why: "研究决定标记为待补信息。",
    nextToResearch: "补充供应商信息。",
  },
};

const SAVED_SUMMARY = {
  schema: "ai-evidence-summary.v1",
  runId: "11111111-1111-4111-8111-111111111111",
  model: "mock",
  gateResult: "pass",
  evidenceRefCoverage: { total: 4, withRefs: 3 },
  inputEvidenceHash: "a".repeat(64),
  startedAt: NOW,
  finishedAt: NOW,
  summary: {
    facts: [
      { id: "f1", type: "fact", text: "多条评论提到适合学校午餐", evidenceRefs: ["ev:voc:1"] },
      { id: "f2", type: "fact", text: "1688 供应报价较低 MOQ 500 件", evidenceRefs: ["ev:sourcing:2"] },
      { id: "f3", type: "estimate", text: "无依据的臆测", evidenceRefs: [] },
    ],
    estimates: [
      { id: "e1", type: "estimate", text: "物流与平台费用预估偏高", evidenceRefs: ["ev:browser:9"] },
    ],
    signals: [],
    risks: [
      { id: "r1", type: "risk", text: "存在交付延迟投诉", evidenceRefs: ["ev:voc:3"] },
    ],
    conflicts: [],
    missing: [{ id: "m1", type: "missing", text: "缺少竞品详细价格", evidenceRefs: [] }],
    nextSteps: [{ id: "n1", type: "nextStep", text: "评估供应商质量", evidenceRefs: ["ev:sourcing:4"] }],
  },
  noviceExplanation: {
    whatWeKnow: "已知概览",
    whatWeDontKnow: "未知概览",
    biggestRisk: "最大风险",
    why: "原因",
    nextToResearch: "下一步",
  },
  unverified: [],
  humanReviewResult: null,
  updatedAt: NOW,
};

let taskId: string;
let root: string;
/** R3：每个测试独立的 sandbox store 路径（隔离，避免共用 .next/test-stores 默认文件） */
let sandboxStorePath: string;
let originalSandboxEnv: string | undefined;
let originalAccessEnv: string | undefined;

function toStorageVersion(id: string) {
  const task = getSandboxTask(DEMO, id);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return createTrustedSandboxTask(DEMO, {
    type: "workflow",
    title: "Summary Route R2",
    platform: "amazon",
    productUrl: null,
    materialText: "",
    source: "demo",
    score: 0,
    level: "low",
    oneLineSummary: "",
    resultJson: JSON.stringify({ aiEvidenceSummary: SAVED_SUMMARY }),
    productLifecycle: "new_candidate",
    decisionStatus: "pending",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Parameters<typeof createTrustedSandboxTask>[1]);
}

/** R6：env 恢复逻辑（afterEach 与 sentinel 测试共用同一真实实现；undefined 才删、存在则精确恢复） */
function restoreTestEnv(sandboxOriginal: string | undefined, accessOriginal: string | undefined) {
  if (sandboxOriginal === undefined) delete process.env.DEMO_SANDBOX_STORE_PATH;
  else process.env.DEMO_SANDBOX_STORE_PATH = sandboxOriginal;
  if (accessOriginal === undefined) delete process.env.DEMO_ACCESS_STORE_PATH;
  else process.env.DEMO_ACCESS_STORE_PATH = accessOriginal;
}

beforeEach(async () => {
  vi.mocked(callAiJson).mockReset();
  root = mkdtempSync(join(tmpdir(), "ai-summary-route-r2-"));
  // R3 隔离：独立 store 文件，避免与其它测试共用默认 store（串扰/文件锁/EPERM）
  sandboxStorePath = join(root, "sandbox-store.json");
  originalSandboxEnv = process.env.DEMO_SANDBOX_STORE_PATH;
  originalAccessEnv = process.env.DEMO_ACCESS_STORE_PATH;
  process.env.DEMO_SANDBOX_STORE_PATH = sandboxStorePath;
  process.env.DEMO_ACCESS_STORE_PATH = join(root, "demo-access-store.json");
  const task = await makeTask();
  taskId = task.id;
});

afterEach(() => {
  // 恢复原环境变量；清理仅限本测试临时目录
  restoreTestEnv(originalSandboxEnv, originalAccessEnv);
  rmSync(root, { recursive: true, force: true });
});

describe("R2 契约：businessModules 由服务端唯一生成并返回", () => {
  it("GET 返回 businessModules（4 模块、结论项仅安全字段、无原始引用泄漏）", async () => {
    const response = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/ai-evidence-summary", { headers: { "x-access-token": "tok-demo-a" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    const modules = body.data.businessModules;
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.map((m: { key: string }) => m.key)).toEqual(["market", "buyers", "sourcing", "costRisk"]);
    const buyers = modules.find((m: { key: string }) => m.key === "buyers");
    expect(buyers.conclusion.length).toBeGreaterThan(0);
    for (const item of buyers.conclusion) {
      expect(typeof item.text).toBe("string");
      expect(typeof item.refCount).toBe("number");
      expect(["market", "buyer", "sourcing", "costRisk"]).toContain(item.evidenceTarget);
      expect(item).not.toHaveProperty("evidenceRefs");
    }
    const modulesJson = JSON.stringify(modules);
    expect(modulesJson).not.toContain("ev:voc:1");
    expect(modulesJson).not.toContain("runId");
    expect(modulesJson).not.toContain("11111111-");
    const market = modules.find((m: { key: string }) => m.key === "market");
    expect(market.missing.some((x: { text: string }) => x.text.includes("臆测"))).toBe(true);
    // POST 生成后同样有 businessModules
  });

  it("POST 返回 businessModules（生成后由服务端投影，安全字段）", async () => {
    vi.mocked(callAiJson).mockResolvedValue({
      ok: true,
      data: GOLDEN_AI_OUTPUT,
      providerCallStarted: true,
      diagnostics: {
        model: "deepseek-chat", thinkingMode: "disabled", maxTokens: 4000,
        providerHttpStatusClass: "success", finishReason: "stop",
        completionTokens: 10, reasoningTokens: 0, responseCharLength: 100,
        jsonParseStage: "passed", elapsedMs: 5,
      },
    });
    const task2 = await makeTask({ resultJson: JSON.stringify(BASE_RESULT) });
    const response = await routePost(
      new NextRequest("http://localhost/api/tasks/x/ai-evidence-summary", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-token": "tok-demo-a" },
        body: JSON.stringify({ expectedStorageVersion: toStorageVersion(task2.id) }),
      }),
      { params: Promise.resolve({ id: task2.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    const modules = body.data.businessModules;
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.map((m: { key: string }) => m.key)).toEqual(["market", "buyers", "sourcing", "costRisk"]);
    const market = modules.find((m: { key: string }) => m.key === "market");
    expect(market.conclusion.length).toBeGreaterThan(0);
    // 无依据项必须出现在 missing（采购价 → 成本与风险模块的缺口）
    const costRisk = modules.find((m: { key: string }) => m.key === "costRisk");
    expect(costRisk.missing.some((x: { text: string }) => x.text.includes("采购价"))).toBe(true);
    const modulesJson = JSON.stringify(modules);
    expect(modulesJson).not.toContain("ev:ev-1");
    expect(modulesJson).not.toContain("runId");
    for (const item of market.conclusion) {
      expect(item).not.toHaveProperty("evidenceRefs");
    }
  });
});

describe("R3 路由测试隔离：独立 sandbox store", () => {
  it("使用本测试临时目录的 store 文件（非默认共享文件），且隔离文件被实际写入", async () => {
    expect(process.env.DEMO_SANDBOX_STORE_PATH).toBe(sandboxStorePath);
    // createTrustedSandboxTask 已触发 store 写入 → 隔离文件存在
    expect(existsSync(sandboxStorePath)).toBe(true);
    const store = JSON.parse(readFileSync(sandboxStorePath, "utf8"));
    expect(Array.isArray(store.tasks)).toBe(true);
    expect(store.tasks.some((x: { id: string }) => x.id === taskId)).toBe(true);
    // 不读取不修改 data/demo-sandbox.json（本测试未触碰）
  });
});

describe("R4 P1-1：公开 DTO（完整响应 JSON 序列化扫描；禁止原始 summary/unverified/gateResult/内部字段）", () => {
  const FORBIDDEN = [
    "runId", "candidateId", "inputEvidenceHash", "promptVersion", "tokenUsage",
    "gateResult", "evidenceRefCoverage", "startedAt", "\"summary\"", "unverified",
    "\"model\"", "\"details\"", "\"humanReviewResult\"",
  ];
  const SAFE_TEXT = "缺少买家评论资料";
  it("GET 完整响应不包含内部对象与禁止字段；legacyCategories 安全投影存在且有界", async () => {
    const response = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/ai-evidence-summary", { headers: { "x-access-token": "tok-demo-a" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    const raw = JSON.stringify(body.data);
    for (const forbidden of FORBIDDEN) {
      expect(raw).not.toContain(forbidden);
    }
    // 不能只检查子对象——data 本身不得含原始 summary
    expect(body.data).not.toHaveProperty("summary");
    expect(body.data).not.toHaveProperty("unverified");
    expect(body.data).not.toHaveProperty("gateResult");
    // legacyCategories 存在且安全
    const lc = body.data.legacyCategories;
    expect(Array.isArray(lc)).toBe(true);
    for (const cat of lc) {
      expect(typeof cat.label).toBe("string");
      expect(Array.isArray(cat.items)).toBe(true);
      for (const item of cat.items) {
        expect(typeof item.text).toBe("string");
        expect(item).not.toHaveProperty("id");
        expect(item).not.toHaveProperty("evidenceRefs");
        expect(item.text.length).toBeLessThanOrEqual(200);
      }
      expect(cat.items.length).toBeLessThanOrEqual(20);
    }
    expect(lc.length).toBeLessThanOrEqual(7);
  });

  it("POST 完整响应同样安全：businessModules + legacyCategories + 无原始字段", async () => {
    vi.mocked(callAiJson).mockResolvedValue({
      ok: true,
      data: GOLDEN_AI_OUTPUT,
      providerCallStarted: true,
      diagnostics: {
        model: "deepseek-chat", thinkingMode: "disabled", maxTokens: 4000,
        providerHttpStatusClass: "success", finishReason: "stop",
        completionTokens: 10, reasoningTokens: 0, responseCharLength: 100,
        jsonParseStage: "passed", elapsedMs: 5,
      },
    });
    const task2 = await makeTask({ resultJson: JSON.stringify(BASE_RESULT) });
    const response = await routePost(
      new NextRequest("http://localhost/api/tasks/x/ai-evidence-summary", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-token": "tok-demo-a" },
        body: JSON.stringify({ expectedStorageVersion: toStorageVersion(task2.id) }),
      }),
      { params: Promise.resolve({ id: task2.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const raw = JSON.stringify(body.data);
    for (const forbidden of FORBIDDEN) {
      expect(raw).not.toContain(forbidden);
    }
    expect(body.data).not.toHaveProperty("summary");
    expect(body.data).not.toHaveProperty("unverified");
    expect(body.data).not.toHaveProperty("gateResult");
    expect(Array.isArray(body.data.legacyCategories)).toBe(true);
    expect(Array.isArray(body.data.businessModules)).toBe(true);
  });
});

describe("R5 P1-1：安全 DTO hasSummary 状态 + 前端消费者契约", () => {
  it("GET 无摘要任务（businessModules 空骨架）→ hasSummary=false；响应仍不含内部字段；空骨架不冒充已生成摘要", async () => {
    // 无摘要任务：resultJson 不含 aiEvidenceSummary
    const emptyTask = await makeTask({ resultJson: JSON.stringify({ sourceMeta: {} }) });
    const response = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/ai-evidence-summary", { headers: { "x-access-token": "tok-demo-a" } }),
      { params: Promise.resolve({ id: emptyTask.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.hasSummary).toBe(false);
    // 空骨架 4 模块存在但不冒充已生成（hasSummary false 即语义）
    expect(Array.isArray(body.data.businessModules)).toBe(true);
    expect(body.data.businessModules.length).toBe(4);
    const raw = JSON.stringify(body.data);
    for (const forbidden of ["runId", "inputEvidenceHash", "candidateId", "\"summary\"", "unverified", "\"model\""]) {
      expect(raw).not.toContain(forbidden);
    }
    expect(body.data).not.toHaveProperty("summary");
  });
  it("GET 有摘要任务 → hasSummary=true；legacyCategories 存在；businessModules 有结论", async () => {
    const response = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/ai-evidence-summary", { headers: { "x-access-token": "tok-demo-a" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    const body = await response.json();
    expect(body.data.hasSummary).toBe(true);
    expect(Array.isArray(body.data.legacyCategories)).toBe(true);
    const buyers = body.data.businessModules.find((m: { key: string }) => m.key === "buyers");
    expect(buyers.conclusion.length).toBeGreaterThan(0);
  });
});



describe("R5 P2-4b：DEMO_ACCESS_STORE_PATH / DEMO_SANDBOX_STORE_PATH 恢复准确性（afterAll 真实校验）", () => {
  afterAll(() => {
    // 所有测试的 afterEach 已执行：env 应恢复到模块加载时的原值（origEnv）
    const orig = origEnv;
    const sandbox = process.env.DEMO_SANDBOX_STORE_PATH;
    const access = process.env.DEMO_ACCESS_STORE_PATH;
    // 原值 undefined → 已删除；原值存在 → 精确恢复
    if (orig.sandbox === undefined) expect(sandbox).toBeUndefined();
    else expect(sandbox).toBe(orig.sandbox);
    if (orig.access === undefined) expect(access).toBeUndefined();
    else expect(access).toBe(orig.access);
  });
  it("beforeEach 已隔离设置（独立路径）", () => {
    expect(process.env.DEMO_SANDBOX_STORE_PATH).toBe(sandboxStorePath);
    expect(process.env.DEMO_ACCESS_STORE_PATH).toBe(join(root, "demo-access-store.json"));
  });
});describe("R6 sentinel：DEMO_ACCESS_STORE_PATH 两种原值情形的恢复（真实 restoreTestEnv）", () => {
  it("原值不存在（undefined）→ restoreTestEnv 后仍不存在（delete 语义）", () => {
    const env = "DEMO_ACCESS_STORE_PATH";
    const previous = process.env[env];
    try {
      process.env[env] = "C:/tmp/isolated-access.json";
      restoreTestEnv(undefined, undefined);
      expect(process.env[env]).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env[env];
      else process.env[env] = previous;
    }
  });
  it("原值存在（非 undefined）→ restoreTestEnv 精确恢复原值", () => {
    const env = "DEMO_ACCESS_STORE_PATH";
    const previous = process.env[env];
    try {
      const seeded = previous ?? "/tmp/seeded-access.json";
      process.env[env] = seeded;
      process.env[env] = "C:/tmp/isolated-access.json";
      restoreTestEnv(undefined, seeded);
      expect(process.env[env]).toBe(seeded);
    } finally {
      if (previous === undefined) delete process.env[env];
      else process.env[env] = previous;
    }
  });
});
