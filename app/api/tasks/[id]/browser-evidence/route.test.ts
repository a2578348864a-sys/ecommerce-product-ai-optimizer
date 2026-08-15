import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { POST as routePost, GET as routeGet } from "@/app/api/tasks/[id]/browser-evidence/route";
import {
  BrowserEvidenceCollectError,
  collectBrowserEvidencePreview,
  type BrowserEvidenceCollectPreview,
} from "@/lib/server/browserEvidenceCollect";
import type { AmazonDetailPageExtraction } from "@/tools/collectors/amazon/detail-page-extract";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "browser-evidence-route-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

// demoGuard：可控返回 context（sandbox 任务走 requireAuthenticated 路径；guard 是同步函数）
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
  requireOwnerOnly: vi.fn(() => ({
    ok: true,
    context: { mode: "owner", token: "tok-owner" },
  })),
}));

// Prisma：owner 路径（非 sandbox taskId）的读/写；demo 路径不触碰
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
        return {
          id: where.id,
          type: "workflow",
          resultJson: task.resultJson,
          decisionStatus: "pending",
          updatedAt: task.updatedAt,
        };
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

// browserEvidenceCollect：只 mock 浏览器采集动作，PreviewStore 保持真实
vi.mock("@/lib/server/browserEvidenceCollect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/browserEvidenceCollect")>();
  return {
    ...actual,
    collectBrowserEvidencePreview: vi.fn(),
  };
});

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO = "demo-access-a";
const ASIN = "B0A1B2C3D4";

function visitorContext() {
  return { mode: "demo" as const, token: `tok-${DEMO}`, demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function toStorageVersion(taskId: string) {
  const task = getSandboxTask(DEMO, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

function extraction(asin = ASIN): AmazonDetailPageExtraction {
  return {
    schemaVersion: "amazon-detail-page-extraction.v1",
    expectedAsin: asin,
    urlAsin: asin,
    pageAsin: asin,
    entityBound: true,
    bindingProof: { urlMatchesExpected: true, pageAnchorMatchesExpected: true, productContainerFound: true },
    pageStatus: "ok",
    fields: {
      asin: { field: "asin", value: asin, status: "correct", reason: null },
      title: { field: "title", value: "John Boos Walnut Cutting Board", status: "correct", reason: null },
      price: { field: "price", value: 48.95, status: "correct", reason: null },
      bsr: { field: "bsr", value: 2541, status: "correct", reason: null },
      rating: { field: "rating", value: 4.2, status: "correct", reason: null },
      reviews: { field: "reviews", value: 4958, status: "correct", reason: null },
    },
    capturedAt: NOW,
    collectorVersion: "amazon-detail-page-extractor.v1",
  };
}

function preview(asin = ASIN): BrowserEvidenceCollectPreview {
  return {
    extraction: extraction(asin),
    navigation: {
      requestedUrl: `https://www.amazon.com/dp/${asin}?language=en_US`,
      finalUrl: `https://www.amazon.com/dp/${asin}?language=en_US`,
      httpStatus: 200,
      navigationElapsedMs: 2400,
      allowedFinalOrigin: true,
    },
  };
}

async function postJson(body: unknown, taskId: string, token = `tok-${DEMO}`) {
  const request = new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify(body),
  });
  return routePost(request, { params: Promise.resolve({ id: taskId }) });
}

let taskId: string;
let root: string;

beforeEach(async () => {
  vi.mocked(collectBrowserEvidencePreview).mockReset();
  root = mkdtempSync(join(tmpdir(), "browser-evidence-route-"));
  const task = await createTrustedSandboxTask(DEMO, {
    type: "workflow",
    title: "Browser Evidence Route Test",
    platform: "amazon",
    productUrl: `https://www.amazon.com/dp/${ASIN}`,
    materialText: "",
    source: "demo",
    score: 0,
    level: "low",
    oneLineSummary: "",
    resultJson: JSON.stringify({
      sourceMeta: { source: "opportunity", candidateId: "candidate-route-test" },
      candidateToTask: { version: 1, candidateId: "candidate-route-test" },
    }),
    productLifecycle: "new_candidate",
    decisionStatus: "pending",
  });
  taskId = task.id;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/tasks/[id]/browser-evidence", () => {
  it("returns null evidence, storageVersion and the bound task ASIN", async () => {
    const request = new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
      headers: { "x-access-token": `tok-${DEMO}` },
    });
    const response = await routeGet(request, { params: Promise.resolve({ id: taskId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.evidence).toBeNull();
    expect(body.data.taskAsin).toBe(ASIN);
    expect(body.data.storageVersion.resultJsonHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("POST collect (browser navigation)", () => {
  it("rejects tasks without a bound Amazon product URL", async () => {
    const unbound = await createTrustedSandboxTask(DEMO, {
      type: "workflow",
      title: "Unbound",
      platform: "amazon",
      productUrl: null,
      materialText: "",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "",
      resultJson: "{}",
      productLifecycle: "new_candidate",
      decisionStatus: "pending",
    });
    const response = await postJson({ action: "collect" }, unbound.id);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("task_asin_unbound");
    expect(vi.mocked(collectBrowserEvidencePreview)).not.toHaveBeenCalled();
  });

  it("returns a preview without persisting, then save persists it", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    const collect = await postJson({ action: "collect" }, taskId);
    expect(collect.status).toBe(200);
    const collectBody = await collect.json();
    expect(collectBody.ok).toBe(true);
    expect(collectBody.data.evidenceId).toMatch(/^[a-z0-9-]{8,64}$/i);
    expect(collectBody.data.preview.extraction.fields.price.value).toBe(48.95);
    expect(collectBody.data.preview.extraction.entityBound).toBe(true);
    // collect 不保存
    const readBack = await postJson({ action: "collect" }, taskId).then((r) => r.json());
    expect(readBack.ok).toBe(true);

    // save 前 namespace 仍为空（用 GET 验证未落库）
    const getRequest = new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
      headers: { "x-access-token": `tok-${DEMO}` },
    });
    const getBefore = await (await routeGet(getRequest, { params: Promise.resolve({ id: taskId }) })).json();
    expect(getBefore.data.evidence).toBeNull();

    const saved = await postJson({
      action: "save",
      evidenceId: collectBody.data.evidenceId,
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.data.kind).toBe("saved");
    expect(savedBody.data.evidence.snapshots).toHaveLength(1);
    expect(savedBody.data.evidence.candidateId).toBe("candidate-route-test");
    expect(savedBody.data.evidence.snapshots[0].confirmedBy).toEqual({ mode: "visitor", actorRef: `visitor:${DEMO}` });
    expect(savedBody.data.evidence.snapshots[0].fields).toMatchObject({
      asin: { value: ASIN, status: "correct" },
      price: { value: 48.95, status: "correct" },
    });
  });

  it("propagates browser-level fail-closed errors with friendly messages", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockRejectedValue(
      new BrowserEvidenceCollectError("page_blocked_captcha", 422, "页面要求验证码（CAPTCHA）。"),
    );
    const response = await postJson({ action: "collect" }, taskId);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("page_blocked_captcha");
    expect(body.error.message).toContain("验证码");
  });

  it("fail-closed when the final page redirects outside the allowlist origin", async () => {
    // 模拟：collect 阶段发现 final origin 不在 https://www.amazon.com 白名单
    vi.mocked(collectBrowserEvidencePreview).mockRejectedValue(
      new BrowserEvidenceCollectError("navigation_not_allowed", 502, "页面导航被重定向到白名单外地址，已停止采集。"),
    );
    const response = await postJson({ action: "collect" }, taskId);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("navigation_not_allowed");
    expect(body.error.message).toContain("白名单外");
  });

  it("fail-closed for login walls and unknown pages without persisting anything", async () => {
    for (const [code, status] of [
      ["page_blocked_login_wall", 422],
      ["page_unknown", 422],
      ["page_error", 422],
    ] as const) {
      vi.mocked(collectBrowserEvidencePreview).mockRejectedValue(
        new BrowserEvidenceCollectError(code, status, "blocked"),
      );
      const response = await postJson({ action: "collect" }, taskId);
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error.code).toBe(code);
    }
    // 全程未落库
    const getRequest = new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
      headers: { "x-access-token": `tok-${DEMO}` },
    });
    const getBody = await (await routeGet(getRequest, { params: Promise.resolve({ id: taskId }) })).json();
    expect(getBody.data.evidence).toBeNull();
  });
});

describe("POST save (human confirm + hard gates)", () => {
  it("rejects an unknown/expired evidenceId", async () => {
    const response = await postJson({
      action: "save",
      evidenceId: "no-such-evidence-123456",
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("preview_expired");
  });

  it("rejects an invalid evidenceId shape", async () => {
    const response = await postJson({
      action: "save",
      evidenceId: "!!",
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_evidence_id");
  });

  it("hard-rejects ASIN mismatch between page and bound task (no save button bypass)", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview("B0ZZZZZZZZ"));
    const collect = await postJson({ action: "collect" }, taskId);
    const collectBody = await collect.json();
    expect(collectBody.ok).toBe(true);
    const response = await postJson({
      action: "save",
      evidenceId: collectBody.data.evidenceId,
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("asin_mismatch");
    // 未落库
    const getRequest = new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
      headers: { "x-access-token": `tok-${DEMO}` },
    });
    const getBody = await (await routeGet(getRequest, { params: Promise.resolve({ id: taskId }) })).json();
    expect(getBody.data.evidence).toBeNull();
  });

  it("hard-rejects unbound extractions (entity not proven)", async () => {
    const broken = preview();
    broken.extraction = { ...broken.extraction, entityBound: false, pageAsin: null };
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(broken);
    const collect = await postJson({ action: "collect" }, taskId);
    const collectBody = await collect.json();
    const response = await postJson({
      action: "save",
      evidenceId: collectBody.data.evidenceId,
      expectedStorageVersion: toStorageVersion(taskId),
    }, taskId);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("asin_mismatch");
  });

  it("rejects stale storage versions with task_result_conflict", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    const collect = await postJson({ action: "collect" }, taskId);
    const collectBody = await collect.json();
    const response = await postJson({
      action: "save",
      evidenceId: collectBody.data.evidenceId,
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2000-01-01T00:00:00.000Z" },
    }, taskId);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("task_result_conflict");
  });

  it("is idempotent: same preview saved twice is a duplicate", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    const collect = await postJson({ action: "collect" }, taskId);
    const evidenceId = (await collect.json()).data.evidenceId;
    const first = await postJson({ action: "save", evidenceId, expectedStorageVersion: toStorageVersion(taskId) }, taskId);
    expect((await first.json()).data.kind).toBe("saved");
    // 重新采集（相同页面/capturedAt 语义）再保存 → 新 evidenceId 是全新预览，会追加为新快照；
    // 同 evidenceId 二次保存 → preview 已被消费
    const second = await postJson({ action: "save", evidenceId, expectedStorageVersion: toStorageVersion(taskId) }, taskId);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("preview_expired");
  });
});

describe("owner (Prisma) path", () => {
  const OWNER_TASK = "cmqtwpu3k0001eurv5pgur70p";

  beforeEach(() => {
    ownerState.tasks[OWNER_TASK] = {
      resultJson: JSON.stringify({
        sourceMeta: { source: "opportunity", candidateId: "candidate-owner-a" },
        candidateToTask: { version: 1, candidateId: "candidate-owner-a" },
      }),
      productUrl: `https://www.amazon.com/dp/${ASIN}`,
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
  });

  it("collects and saves via Prisma with confirmedBy.mode=owner", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    const collectResponse = await routePost(
      new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-token": "tok-owner" },
        body: JSON.stringify({ action: "collect" }),
      }),
      { params: Promise.resolve({ id: OWNER_TASK }) },
    );
    expect(collectResponse.status).toBe(200);
    const collectBody = await collectResponse.json();
    expect(collectBody.data.taskAsin ?? collectBody.ok).toBe(true);

    // expectedStorageVersion 从 owner 快照计算
    const snapshot = ownerState.tasks[OWNER_TASK];
    const version = {
      resultJsonHash: createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex"),
      updatedAt: snapshot.updatedAt,
    };
    const saveResponse = await routePost(
      new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-token": "tok-owner" },
        body: JSON.stringify({ action: "save", evidenceId: collectBody.data.evidenceId, expectedStorageVersion: version }),
      }),
      { params: Promise.resolve({ id: OWNER_TASK }) },
    );
    expect(saveResponse.status).toBe(200);
    const saveBody = await saveResponse.json();
    expect(saveBody.data.kind).toBe("saved");
    expect(saveBody.data.evidence.candidateId).toBe("candidate-owner-a");
    expect(saveBody.data.evidence.snapshots[0].confirmedBy).toEqual({ mode: "owner", actorRef: "owner:v1" });

    // GET 读回
    const getResponse = await routeGet(
      new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
        headers: { "x-access-token": "tok-owner" },
      }),
      { params: Promise.resolve({ id: OWNER_TASK }) },
    );
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.data.evidence.snapshots).toHaveLength(1);
    expect(getBody.data.evidence.snapshots[0].fields.price.value).toBe(48.95);
    expect(getBody.data.taskAsin).toBe(ASIN);
  });

  it("rejects owner writes to sandbox-shaped task ids", async () => {
    const response = await routePost(
      new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-token": "tok-owner" },
        body: JSON.stringify({ action: "collect" }),
      }),
      { params: Promise.resolve({ id: "sandbox_task_owner_spoof" }) },
    );
    // sandbox 前缀 → requireAuthenticated（owner 也可通过）→ demo 限定校验：owner 访问 sandbox 任务 → 404
    expect(response.status).toBe(404);
  });
});

describe("PreviewStore security binding", () => {
  it("Visitor B cannot save Visitor A's preview (cross-subject)", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    // A collect
    const collect = await postJson({ action: "collect" }, taskId, "tok-demo-a");
    const collectBody = await collect.json();
    expect(collectBody.ok).toBe(true);
    // B 用同一 evidenceId 保存 → 主体不匹配 → preview_expired
    const save = await postJson(
      { action: "save", evidenceId: collectBody.data.evidenceId, expectedStorageVersion: toStorageVersion(taskId) },
      taskId,
      "tok-visitor-b",
    );
    expect(save.status).toBe(409);
    expect((await save.json()).error.code).toBe("preview_expired");
  });

  it("a preview cannot be saved to a different task (cross-task)", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    const otherTask = await createTrustedSandboxTask(DEMO, {
      type: "workflow",
      title: "Other Task",
      platform: "amazon",
      productUrl: `https://www.amazon.com/dp/${ASIN}`,
      materialText: "",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "",
      resultJson: "{}",
      productLifecycle: "new_candidate",
      decisionStatus: "pending",
    });
    // A 在 taskId 采集
    const collect = await postJson({ action: "collect" }, taskId);
    const collectBody = await collect.json();
    // A 试图保存到 otherTask → 任务不匹配 → preview_expired
    const save = await postJson(
      { action: "save", evidenceId: collectBody.data.evidenceId, expectedStorageVersion: toStorageVersion(otherTask.id) },
      otherTask.id,
    );
    expect(save.status).toBe(409);
    expect((await save.json()).error.code).toBe("preview_expired");
  });

  it("owner cannot save a visitor's preview (cross-subject owner/visitor)", async () => {
    vi.mocked(collectBrowserEvidencePreview).mockResolvedValue(preview());
    const collect = await postJson({ action: "collect" }, taskId);
    const collectBody = await collect.json();
    // owner 尝试用 visitor 的 evidenceId（owner 不能访问 sandbox 任务，先走 404）
    const save = await routePost(
      new NextRequest("http://localhost/api/tasks/x/browser-evidence", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-token": "tok-owner" },
        body: JSON.stringify({ action: "save", evidenceId: collectBody.data.evidenceId, expectedStorageVersion: toStorageVersion(taskId) }),
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    // sandbox 任务 + owner 主体 → requireAuthenticated 通过但 demo 限定 → 404（不泄漏 Preview）
    expect(save.status).toBe(404);
  });
});
