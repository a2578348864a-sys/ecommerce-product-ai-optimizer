import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// 1x1 透明 PNG（真实 magic bytes），与 sellerSpriteProductImage.test 同 fixture
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_PNG_SHA256 = "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 与 visualReferenceCandidates.buildVisualSelectionId 一致的确定性重建 */
function buildSelectionId(input: {
  subjectKind: "owner" | "visitor";
  taskId: string;
  candidateId: string;
  researchRevision: number;
  contentHash: string;
}) {
  const canonical = JSON.stringify({
    schema: "creative-handoff-visual-selection-id:v1",
    subjectKind: input.subjectKind,
    taskId: input.taskId,
    candidateId: input.candidateId,
    researchRevision: input.researchRevision,
    category: "visual",
    contentFingerprint: input.contentHash.slice(0, 24),
  });
  return `visual:${sha256(canonical).slice(0, 24)}`;
}

// ── 环境 ────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  ownerToken: "owner-token-1",
  visitorAToken: "visitor-a-token",
  visitorBToken: "visitor-b-token",
  // 任务表：id → { demoAccessId? | userId?, resultJson }
  tasks: {} as Record<string, { userId?: string; demoAccessId?: string; resultJson: string }>,
  // 候选表：id → { demoAccessId?, sourceMetaJson, analysisJson, convertedTaskId }
  candidates: {} as Record<string, { demoAccessId?: string; sourceMetaJson: string; analysisJson: string; convertedTaskId?: string | null }>,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const task = state.tasks[where.id];
        if (!task) return null;
        return { id: where.id, userId: task.userId ?? null, demoAccessId: task.demoAccessId ?? null, resultJson: task.resultJson, updatedAt: "2026-08-06T00:00:00.000Z" };
      }),
    },
    opportunityCandidate: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const candidate = state.candidates[where.id];
        if (!candidate) return null;
        return { id: where.id, name: "Test Product", sourceMetaJson: candidate.sourceMetaJson, analysisJson: candidate.analysisJson, convertedTaskId: candidate.convertedTaskId ?? null };
      }),
      $queryRaw: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn(async (request: Request) => {
    const token = request.headers.get("x-access-token");
    if (!token) return { ok: false, status: 401, code: "invalid_access", message: "请先登录后再操作。" };
    if (token === state.ownerToken) return { ok: true, context: { mode: "owner", token } };
    if (token === state.visitorAToken) return { ok: true, context: { mode: "demo", token, demoAccessId: "visitor-a" } };
    if (token === state.visitorBToken) return { ok: true, context: { mode: "demo", token, demoAccessId: "visitor-b" } };
    return { ok: false, status: 401, code: "invalid_access", message: "请先登录后再操作。" };
  }),
  requireOwnerOnly: vi.fn(),
}));

// demoSandbox：真实 store 逻辑太重，这里只 mock 边界（isSandboxTaskId 真实前缀 + getSandboxTask 按 demoAccessId）
vi.mock("@/lib/server/demoSandbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/demoSandbox")>();
  return {
    ...actual,
    getSandboxTask: vi.fn((demoAccessId: string, taskId: string) => {
      const task = state.tasks[taskId];
      if (!task || task.demoAccessId !== demoAccessId) return null;
      return { id: taskId, demoAccessId, title: "Test", resultJson: task.resultJson, updatedAt: "2026-08-06T00:00:00.000Z" };
    }),
    getSandboxCandidate: vi.fn((demoAccessId: string, candidateId: string) => {
      const candidate = state.candidates[candidateId];
      if (!candidate || candidate.demoAccessId !== demoAccessId) return null;
      return { id: candidateId, demoAccessId, name: "Test Product", sourceMetaJson: candidate.sourceMetaJson, analysisJson: candidate.analysisJson, convertedTaskId: candidate.convertedTaskId ?? null };
    }),
  };
});

// 研究记录构造（与 save-task 写入格式一致的最小可解析快照）
function makeResultJson(candidateId: string, revision = 1): string {
  const decisionEvent = {
    decisionId: "00000000-0000-4000-8000-000000000001",
    revision,
    status: "creative_ready" as const,
    reason: "synthetic acceptance fixture",
    nextAction: "proceed",
    researchHash: "a".repeat(64),
    decidedAt: "2026-08-06T00:00:00.000Z",
    actor: { mode: "owner", actorRef: "owner:v1" },
  };
  return JSON.stringify({
    researchRecord: {
      schema: "product-research-record.v1",
      revision,
      researchHash: "a".repeat(64),
      candidateId,
      runId: "wf-test",
      contextHash: "b".repeat(64),
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
      latestDecision: decisionEvent,
      decisionEvents: [decisionEvent],
    },
    researchVerification: {
      schema: "product-research-verification.v1",
      candidateId,
      runId: "wf-test",
      contextHash: "b".repeat(64),
      inputHash: "d".repeat(64),
      resultHash: "e".repeat(64),
      workflowStatus: "completed",
      reviewState: {
        sourcingReviewed: true,
        riskReviewed: true,
        summaryReviewed: true,
        listingReviewed: true,
        reviewedCount: 4,
        totalReviewSteps: 4,
        allReviewed: true,
      },
    },
  });
}

// 候选快照构造（product-batch 格式，含真实 PNG dataUrl）
function makeCandidate(asin = "B0TEST0001"): string {
  const productKey = `amazon:US:${asin}`;
  const candidateIdentityHash = sha256(`sellersprite-candidate-identity:v1:${productKey}`);
  const dataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
  return JSON.stringify({
    schema: "candidate-source-meta-v2",
    originKind: "seller_sprite_product_batch",
    productKey,
    itemIdentityHash: candidateIdentityHash,
    capturedAt: "2026-08-06T00:00:00.000Z",
    imageSnapshot: {
      status: "cached",
      mimeType: "image/png",
      sizeBytes: TINY_PNG.length,
      sha256: TINY_PNG_SHA256,
      base64: TINY_PNG.toString("base64"),
    },
    productImageSnapshot: {
      version: "product-batch-product-image.v1",
      source: "sellersprite_product_batch",
      status: "available",
      productKey,
      candidateIdentityHash,
      mimeType: "image/png",
      bytes: TINY_PNG.length,
      contentHash: TINY_PNG_SHA256,
      dataUrl,
      capturedAt: "2026-08-06T00:00:00.000Z",
    },
  });
}

const OWNER_TASK = "task-owner-1";
const OWNER_CANDIDATE = "cand-owner-1";
const VISITOR_A_TASK = "sandbox_task_visitora1";
const VISITOR_A_CANDIDATE = "sandbox_candidate_visitora1";
const VISITOR_B_TASK = "sandbox_task_visitorb1";
const VISITOR_B_CANDIDATE = "sandbox_candidate_visitorb1";

function ref(taskId: string, subjectKind: "owner" | "visitor", candidateId: string, revision = 1) {
  return buildSelectionId({ subjectKind, taskId, candidateId, researchRevision: revision, contentHash: TINY_PNG_SHA256 });
}

import { GET } from "@/app/api/tasks/[id]/visual-reference-preview/route";

async function callGET(taskId: string, refValue: string, token: string) {
  const request = new Request(`http://localhost/api/tasks/${encodeURIComponent(taskId)}/visual-reference-preview?ref=${encodeURIComponent(refValue)}`, {
    headers: { "x-access-token": token },
  });
  return GET(request as never, { params: Promise.resolve({ id: taskId }) });
}

describe("Secure Visual Reference Preview", () => {
  it("Owner 可查看自己任务的批准参考图", async () => {
    state.tasks[OWNER_TASK] = { userId: "owner:v1", resultJson: makeResultJson(OWNER_CANDIDATE) };
    state.candidates[OWNER_CANDIDATE] = {
      sourceMetaJson: makeCandidate(),
      analysisJson: "{}",
      convertedTaskId: OWNER_TASK,
    };
    const response = await callGET(OWNER_TASK, ref(OWNER_TASK, "owner", OWNER_CANDIDATE), state.ownerToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // 缓存隔离：private, no-store（无 immutable / max-age / 任何缓存指令）
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).equals(TINY_PNG)).toBe(true);
  });

  it("Visitor A 可查看自己的任务（Sandbox）", async () => {
    state.tasks[VISITOR_A_TASK] = { demoAccessId: "visitor-a", resultJson: makeResultJson(VISITOR_A_CANDIDATE) };
    state.candidates[VISITOR_A_CANDIDATE] = {
      demoAccessId: "visitor-a",
      sourceMetaJson: makeCandidate(),
      analysisJson: "{}",
      convertedTaskId: VISITOR_A_TASK,
    };
    const response = await callGET(VISITOR_A_TASK, ref(VISITOR_A_TASK, "visitor", VISITOR_A_CANDIDATE), state.visitorAToken);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).equals(TINY_PNG)).toBe(true);
  });

  it("Visitor B 访问 A 的图片 → 404（跨 Visitor 隔离）", async () => {
    state.tasks[VISITOR_B_TASK] = { demoAccessId: "visitor-b", resultJson: makeResultJson(VISITOR_B_CANDIDATE) };
    state.candidates[VISITOR_B_CANDIDATE] = {
      demoAccessId: "visitor-b",
      sourceMetaJson: makeCandidate(),
      analysisJson: "{}",
      convertedTaskId: VISITOR_B_TASK,
    };
    // B 尝试用 A 的 taskId + A 的 ref（B 未登录 A 的 sandbox）
    const response = await callGET(VISITOR_A_TASK, ref(VISITOR_A_TASK, "visitor", VISITOR_A_CANDIDATE), state.visitorBToken);
    expect(response.status).toBe(404);
    // B 用 A 的 taskId 但构造自己的 subjectKind 重建（错位）也应 404
    const response2 = await callGET(VISITOR_A_TASK, ref(VISITOR_A_TASK, "visitor", VISITOR_A_CANDIDATE), state.visitorBToken);
    expect(response2.status).toBe(404);
  });

  it("未登录 → 401", async () => {
    const response = await callGET(OWNER_TASK, ref(OWNER_TASK, "owner", OWNER_CANDIDATE), "");
    expect(response.status).toBe(401);
  });

  it("Visitor 访问 Owner 正式任务 → 404（访客隔离）", async () => {
    const response = await callGET(OWNER_TASK, ref(OWNER_TASK, "owner", OWNER_CANDIDATE), state.visitorAToken);
    expect(response.status).toBe(404);
  });

  it("错误 ref 格式 → 400 invalid_reference", async () => {
    const response = await callGET(OWNER_TASK, "visual:not-a-hash", state.ownerToken);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_reference");
  });

  it("重建不匹配（contentHash 不同）→ 404", async () => {
    const wrongRef = buildSelectionId({
      subjectKind: "owner",
      taskId: OWNER_TASK,
      candidateId: OWNER_CANDIDATE,
      researchRevision: 1,
      contentHash: "b".repeat(64),
    });
    const response = await callGET(OWNER_TASK, wrongRef, state.ownerToken);
    expect(response.status).toBe(404);
  });

  it("候选未转换到该任务 → 404", async () => {
    state.candidates["cand-unlinked"] = {
      sourceMetaJson: makeCandidate(),
      analysisJson: "{}",
      convertedTaskId: null,
    };
    state.tasks["task-unlinked"] = { userId: "owner:v1", resultJson: makeResultJson("cand-unlinked") };
    const response = await callGET("task-unlinked", ref("task-unlinked", "owner", "cand-unlinked"), state.ownerToken);
    expect(response.status).toBe(404);
  });

  it("任务不存在 → 404", async () => {
    const response = await callGET("task-ghost", ref("task-ghost", "owner", OWNER_CANDIDATE), state.ownerToken);
    expect(response.status).toBe(404);
  });

  it("候选已绑定其他任务 → 404（跨任务复用拒绝）", async () => {
    state.tasks["task-owner-2"] = { userId: "owner:v1", resultJson: makeResultJson(OWNER_CANDIDATE) };
    state.candidates[OWNER_CANDIDATE].convertedTaskId = "task-owner-2";
    const response = await callGET(OWNER_TASK, ref(OWNER_TASK, "owner", OWNER_CANDIDATE), state.ownerToken);
    expect(response.status).toBe(404);
    // 恢复
    state.candidates[OWNER_CANDIDATE].convertedTaskId = OWNER_TASK;
  });

  it("task 层快照（SellerSprite 用户导入路径）可读：候选层无快照时回退 task resultJson.sourceMeta", async () => {
    // 候选层无快照（analysisJson={}），快照在 task resultJson.sourceMeta.candidateSnapshot.productImageSnapshot
    state.tasks[OWNER_TASK] = { userId: "owner:v1", resultJson: (() => {
      const rj = JSON.parse(makeResultJson(OWNER_CANDIDATE));
      rj.sourceMeta = {
        source: "opportunity",
        candidateId: OWNER_CANDIDATE,
        candidateSnapshot: {
          version: 1,
          id: OWNER_CANDIDATE,
          name: "Test Product",
          status: "worth_analyzing",
          capturedAt: "2026-08-06T00:00:00.000Z",
          productImageSnapshot: {
            version: "product-batch-product-image.v1",
            source: "sellersprite_product_batch",
            status: "available",
            productKey: "amazon:US:B0TEST0001",
            candidateIdentityHash: sha256("sellersprite-candidate-identity:v1:amazon:US:B0TEST0001"),
            mimeType: "image/png",
            bytes: TINY_PNG.length,
            contentHash: TINY_PNG_SHA256,
            dataUrl: `data:image/png;base64,${TINY_PNG.toString("base64")}`,
            capturedAt: "2026-08-06T00:00:00.000Z",
          },
        },
      };
      return JSON.stringify(rj);
    })() };
    state.candidates[OWNER_CANDIDATE] = {
      sourceMetaJson: makeCandidate(),
      analysisJson: "{}",
      convertedTaskId: OWNER_TASK,
    };
    const response = await callGET(OWNER_TASK, ref(OWNER_TASK, "owner", OWNER_CANDIDATE), state.ownerToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).equals(TINY_PNG)).toBe(true);
  });
});
