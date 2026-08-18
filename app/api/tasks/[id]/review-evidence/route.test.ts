import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { POST as routePost, GET as routeGet } from "@/app/api/tasks/[id]/review-evidence/route";
import { callAiJson } from "@/lib/server/aiClient";
import { resolveSystemBrowser } from "@/tools/collectors/amazon/browser-control";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "review-evidence-route-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
  // 本地研究环境模拟：VOC 自动采集 capability gate 放行（公网 gate 由专用用例覆盖）
  process.env.LOCAL_ACQUISITION_ENABLED = "true";
});

// demoGuard：可控返回 context（guard 是同步函数；demo 按 token 区分主体）
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn((request: Request) => {
    const token = request.headers.get("x-access-token");
    if (token === "tok-owner") {
      return { ok: true, context: { mode: "owner", token: "tok-owner" } };
    }
    if (token === "tok-visitor-b") {
      return { ok: true, context: { mode: "demo", token: "tok-visitor-b", demoAccessId: "demo-access-b", isActive: true, isExpired: false, remainingAiCalls: 10 } };
    }
    return {
      ok: true,
      context: { mode: "demo", token: "tok-demo-a", demoAccessId: "demo-access-a", isActive: true, isExpired: false, remainingAiCalls: 10 },
    };
  }),
  requireOwnerOnly: vi.fn(() => ({ ok: true, context: { mode: "owner", token: "tok-owner" } })),
  ensureDemoAiQuota: vi.fn(() => ({ ok: true })),
  consumeDemoAiCalls: vi.fn(() => null),
}));

// Prisma：owner 路径（demo 路径不触碰）
const ownerState = vi.hoisted(() => ({
  tasks: {} as Record<string, { resultJson: string; productUrl: string | null; updatedAt: string }>,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const task = ownerState.tasks[where.id];
        if (!task) return null;
        return { id: where.id, resultJson: task.resultJson, productUrl: task.productUrl, updatedAt: task.updatedAt };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const task = ownerState.tasks[where.id];
        if (!task) return null;
        return { id: where.id, type: "workflow", resultJson: task.resultJson, decisionStatus: "pending", updatedAt: task.updatedAt };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { resultJson: string; updatedAt: Date } }) => {
        const task = ownerState.tasks[where.id];
        if (!task) return { count: 0 };
        ownerState.tasks[where.id] = { ...task, resultJson: data.resultJson, updatedAt: data.updatedAt.toISOString() };
        return { count: 1 };
      }),
    },
  },
}));

// aiClient：只 mock 真实 AI 调用（callAiJson 返回固定合法 VOC 输出）；analyzeVoc 全路径保持真实
vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn(),
}));

// Package C：半自动采集——mock 隔离浏览器会话（真实浏览器由授权 smoke 覆盖）
const collectState = vi.hoisted(() => ({
  session: {
    navigate: vi.fn(async () => ({ allowedFinalOrigin: true })),
    evaluateDomByValue: vi.fn(async () => [
      { rating: 5, date: "August 1, 2026", title: "Fits perfectly and feels premium." },
      { rating: 2, date: "July 15, 2026", title: "Assembly instructions are confusing." },
    ]),
    close: vi.fn(async () => ({})),
  },
  browser: { browser: "chrome", locationType: "system", executablePath: "C:\\fake\\chrome.exe" },
}));

vi.mock("@/tools/collectors/amazon/browser-control", () => ({
  resolveSystemBrowser: vi.fn(() => collectState.browser),
  openIsolatedPublicBrowserSession: vi.fn(async () => collectState.session),
}));

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO = "demo-access-a";
const ASIN = "B0A1B2C3D4";

function toStorageVersion(taskId: string, demoAccessId = DEMO) {
  const task = getSandboxTask(demoAccessId, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

async function postJson(body: unknown, taskId: string, token = `tok-${DEMO}`) {
  const request = new NextRequest("http://localhost/api/tasks/x/review-evidence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify(body),
  });
  return routePost(request, { params: Promise.resolve({ id: taskId }) });
}

function aiOk(data: unknown) {
  return {
    ok: true as const,
    data,
    error: { code: "", detail: null, message: "" },
    diagnostics: {
      model: "mock",
      thinkingMode: "disabled" as const,
      maxTokens: 8000,
      providerHttpStatusClass: "success" as const,
      finishReason: "stop",
      completionTokens: 10,
      reasoningTokens: 0,
      responseCharLength: 120,
      jsonParseStage: "passed" as const,
      elapsedMs: 5,
    },
    providerCallStarted: false,
  };
}

let taskId: string;
let root: string;

beforeEach(async () => {
  vi.mocked(callAiJson).mockReset();
  root = mkdtempSync(join(tmpdir(), "review-evidence-route-"));
  const task = await createTrustedSandboxTask(DEMO, {
    type: "workflow",
    title: "Review Route Test",
    platform: "amazon",
    productUrl: null,
    materialText: "",
    source: "demo",
    score: 0,
    level: "low",
    oneLineSummary: "",
    resultJson: JSON.stringify({
      sourceMeta: { source: "opportunity", candidateId: "candidate-route-review" },
      candidateToTask: { version: 1, candidateId: "candidate-route-review" },
    }),
    productLifecycle: "new_candidate",
    decisionStatus: "pending",
  });
  taskId = task.id;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/tasks/[id]/review-evidence", () => {
  it("returns empty evidence/analysis with storageVersion", async () => {
    const response = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/review-evidence", { headers: { "x-access-token": `tok-${DEMO}` } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.evidence).toBeNull();
    expect(body.data.analysis).toBeNull();
    expect(body.data.storageVersion.resultJsonHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("POST import", () => {
  it("imports reviews with outcome counts and updated storageVersion", async () => {
    const before = toStorageVersion(taskId).resultJsonHash;
    const response = await postJson({
      action: "import",
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [
        { asin: ASIN, sourceProductRole: "current_candidate", reviewText: "Great build quality.", rating: 5 },
        { asin: ASIN, sourceProductRole: "current_candidate", reviewText: "Hard to assemble.", rating: 2 },
      ],
    }, taskId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.outcome.importedCount).toBe(2);
    expect(body.data.evidence.dataset.stats.totalReviews).toBe(2);
    expect(body.data.storageVersion.resultJsonHash).not.toBe(before);
  });

  it("rejects invalid payloads and missing storage version", async () => {
    const bad = await postJson({ action: "import", expectedStorageVersion: toStorageVersion(taskId), reviews: [{ asin: "BAD", sourceProductRole: "current_candidate", reviewText: "x" }] }, taskId);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_asin");

    const noVersion = await postJson({ action: "import", reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "x" }] }, taskId);
    expect(noVersion.status).toBe(400);
    expect((await noVersion.json()).error.code).toBe("storage_version_required");
  });

  it("dedupes on re-import of the same review", async () => {
    const review = { asin: ASIN, sourceProductRole: "current_candidate" as const, reviewText: "Same text", rating: 4, reviewId: "R1" };
    await postJson({ action: "import", expectedStorageVersion: toStorageVersion(taskId), reviews: [review] }, taskId);
    const second = await postJson({ action: "import", expectedStorageVersion: toStorageVersion(taskId), reviews: [review] }, taskId);
    const body = await second.json();
    expect(body.data.outcome.duplicateCount).toBe(1);
    expect(body.data.outcome.importedCount).toBe(0);
  });
});

describe("POST analyze", () => {
  it("runs VOC analysis through the quota gate and saves run trace", async () => {
    const imported = await postJson({
      action: "import",
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "Love it.", rating: 5 }],
    }, taskId);
    const evidenceId = (await imported.json()).data.evidence.dataset.reviews[0].evidenceId as string;
    vi.mocked(callAiJson).mockResolvedValue(aiOk({
      positiveThemes: [{ label: "做工扎实", summary: "多位用户认可做工。", evidenceRefs: [evidenceId], limitations: null }],
      painPointThemes: [],
      usageScenarios: [],
      recurringRequests: [],
      conflicts: [],
      weakSignals: [],
      unknowns: ["样本仅 1 条。"],
      nextResearchSteps: ["补充评论后重跑。"],
    }));
    const response = await postJson({ action: "analyze", expectedStorageVersion: toStorageVersion(taskId) }, taskId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.analysis.runId).toMatch(/^[a-f0-9-]{8,64}$/);
    expect(body.data.gateResult).toBe("pass");
    expect(body.data.analysis.unknowns).toContain("样本仅 1 条。");
    // 主题数量 deterministic：1 条引用 → isolated
    expect(body.data.analysis.themes.positiveThemes[0].reviewCount).toBe(1);
    expect(body.data.analysis.themes.positiveThemes[0].strength).toBe("isolated");
    // 读取路径能看到分析
    const get = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/review-evidence", { headers: { "x-access-token": `tok-${DEMO}` } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect((await get.json()).data.analysis).not.toBeNull();
  });

  it("fails closed when there is no review data", async () => {
    const response = await postJson({ action: "analyze", expectedStorageVersion: toStorageVersion(taskId) }, taskId);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("no_review_data");
    expect(vi.mocked(callAiJson)).not.toHaveBeenCalled();
  });
});

describe("POST clear", () => {
  it("clears dataset and removes stale analysis", async () => {
    await postJson({
      action: "import",
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "Only", rating: 3 }],
    }, taskId);
    vi.mocked(callAiJson).mockResolvedValue(aiOk({
      positiveThemes: [], painPointThemes: [], usageScenarios: [], recurringRequests: [], conflicts: [], weakSignals: [],
      unknowns: ["x"], nextResearchSteps: [],
    }));
    await postJson({ action: "analyze", expectedStorageVersion: toStorageVersion(taskId) }, taskId);
    const cleared = await postJson({ action: "clear", expectedStorageVersion: toStorageVersion(taskId) }, taskId);
    expect((await cleared.json()).data.cleared).toBe(true);
    const get = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/review-evidence", { headers: { "x-access-token": `tok-${DEMO}` } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    const body = await get.json();
    expect(body.data.evidence.dataset.reviews).toHaveLength(0);
    expect(body.data.analysis).toBeNull();
  });
});

describe("isolation", () => {
  it("visitor B cannot read or write visitor A's sandbox task", async () => {
    await postJson({
      action: "import",
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "A's data", rating: 4 }],
    }, taskId);
    const response = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/review-evidence", { headers: { "x-access-token": "tok-visitor-b" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(404);
  });

  it("rejects stale storage versions with task_result_conflict", async () => {
    const stale = { resultJsonHash: "a".repeat(64), updatedAt: "2000-01-01T00:00:00.000Z" };
    const response = await postJson({
      action: "import",
      expectedStorageVersion: stale,
      reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "x", rating: 4 }],
    }, taskId);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("task_result_conflict");
  });
});

describe("POST collect / collect-confirm（Package C 半自动采集）", () => {
  beforeEach(() => {
    vi.mocked(collectState.session.navigate).mockReset();
    vi.mocked(collectState.session.navigate).mockResolvedValue({ allowedFinalOrigin: true });
    vi.mocked(collectState.session.evaluateDomByValue).mockReset();
    vi.mocked(collectState.session.evaluateDomByValue).mockResolvedValue([
      { rating: 5, date: "August 1, 2026", title: "Fits perfectly and feels premium." },
      { rating: 2, date: "July 15, 2026", title: "Assembly instructions are confusing." },
    ]);
    vi.mocked(collectState.session.close).mockReset();
  });

  it("collect returns preview items with dedupe marking（不写入）", async () => {
    // 先导入一条相同文本+日期 → collect 时该条标记 duplicate
    await postJson({
      action: "import",
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "Fits perfectly and feels premium.", rating: 5, reviewDate: "August 1, 2026" }],
    }, taskId);
    const response = await postJson({
      action: "collect",
      asins: [{ asin: ASIN, sourceProductRole: "current_candidate" }],
    }, taskId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.preview.items).toHaveLength(2);
    const duplicateItem = body.data.preview.items.find((item: { title: string }) => item.title.includes("Fits perfectly"));
    expect(duplicateItem.duplicate).toBe(true);
    // collect 不写入：evidence 仍只有 1 条
    const get = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/review-evidence", { headers: { "x-access-token": `tok-${DEMO}` } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect((await get.json()).data.evidence.dataset.reviews).toHaveLength(1);
  });

  it("collect-confirm writes browser-bound reviews with dedupe", async () => {
    const collect = await postJson({
      action: "collect",
      asins: [{ asin: ASIN, sourceProductRole: "current_candidate" }],
    }, taskId);
    const preview = (await collect.json()).data.preview;
    const confirm = await postJson({
      action: "collect-confirm",
      previewId: preview.previewId,
      selectedIndices: [0, 1],
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(confirm.status).toBe(200);
    const body = await confirm.json();
    expect(body.data.confirmed).toBe(true);
    const get = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/review-evidence", { headers: { "x-access-token": `tok-${DEMO}` } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    const evidence = (await get.json()).data.evidence;
    expect(evidence.dataset.reviews).toHaveLength(2);
    // browser 绑定标记
    expect(evidence.dataset.reviews.every((review: { sourceType: string }) => review.sourceType === "browser")).toBe(true);
    expect(evidence.dataset.reviews[0].entityBindingProof.binding).toBe("browser_verified");
    expect(evidence.dataset.reviews[0].collectorVersion).toMatch(/amazon-review-snippet-collector/);
    expect(evidence.dataset.sampling.method).toBe("manual_selected"); // 采样方法不变（manual 基准）
  });

  it("preview is single-use and bound to task/subject", async () => {
    const collect = await postJson({
      action: "collect",
      asins: [{ asin: ASIN, sourceProductRole: "current_candidate" }],
    }, taskId);
    const preview = (await collect.json()).data.preview;
    // 第一次确认成功
    const first = await postJson({
      action: "collect-confirm",
      previewId: preview.previewId,
      selectedIndices: [0],
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(first.status).toBe(200);
    // 重复使用同一 previewId → preview_expired
    const second = await postJson({
      action: "collect-confirm",
      previewId: preview.previewId,
      selectedIndices: [1],
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(second.status).toBe(400);
    expect((await second.json()).error.code).toBe("preview_expired");
  });

  it("rejects invalid collect payloads and invalid selection", async () => {
    const badAsin = await postJson({ action: "collect", asins: [{ asin: "BAD", sourceProductRole: "current_candidate" }] }, taskId);
    expect(badAsin.status).toBe(400);
    expect((await badAsin.json()).error.code).toBe("invalid_collect_payload");

    const tooMany = await postJson({
      action: "collect",
      asins: Array.from({ length: 4 }, (_, index) => ({ asin: `B0A${index}B2C3D4`, sourceProductRole: "current_candidate" })),
    }, taskId);
    expect(tooMany.status).toBe(400);

    const noSelection = await postJson({
      action: "collect-confirm",
      previewId: "none",
      selectedIndices: [],
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(noSelection.status).toBe(400);
    expect((await noSelection.json()).error.code).toBe("invalid_selection");
  });

  it("fails closed when browser unavailable（本地 runtime：409 acquisition_unavailable，非 503）", async () => {
    vi.mocked(resolveSystemBrowser).mockReturnValueOnce(null);
    const response = await postJson({
      action: "collect",
      asins: [{ asin: ASIN, sourceProductRole: "current_candidate" }],
    }, taskId);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("acquisition_unavailable");
  });

  it("public runtime（LOCAL_ACQUISITION_ENABLED 未开启）→ demo 主体 collect 200 演示回放（demo 分支）；import 仍可用", async () => {
    const saved = process.env.LOCAL_ACQUISITION_ENABLED;
    delete process.env.LOCAL_ACQUISITION_ENABLED;
    try {
      const collect = await postJson({
        action: "collect",
        asins: [{ asin: ASIN, sourceProductRole: "current_candidate" }],
      }, taskId);
      expect(collect.status).toBe(200);
      const body = await collect.json();
      expect(body.ok).toBe(true);
      expect(body.data.demo).toBe(true);
      expect(body.data.preview.items.length).toBeGreaterThan(0);
      expect(body.data.preview.items[0].asin.length).toBeGreaterThan(0);
      // 粘贴导入（server 能力）不受影响
      const imp = await postJson({
        action: "import",
        expectedStorageVersion: toStorageVersion(taskId),
        reviews: [{ asin: ASIN, sourceProductRole: "current_candidate", reviewText: "public paste still works", rating: 4 }],
      }, taskId);
      expect(imp.status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.LOCAL_ACQUISITION_ENABLED;
      else process.env.LOCAL_ACQUISITION_ENABLED = saved;
    }
  });
});
