/**
 * LISTING_CREATION_BRIEF：独立 Route 行为测试（5 条核心正向/兼容）。
 * 不 mock listingBrief / buildListingBrief / route；仅 mock Gate 与 mutateTaskResultJson。
 * 认证使用 QX_RUNTIME_MODE=local_owner（免密回环，不触发 guest quota / 真实 Provider）。
 * Gate fixture 结构复制自 route.fact-summary.test.ts 的 gate()（真实最小结构）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

vi.hoisted(() => {
  process.env.QX_RUNTIME_MODE = "local_owner";
});

const gateMock = vi.fn();
vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: (...args: unknown[]) => gateMock(...args),
}));
const mutateMock = vi.fn();
vi.mock("@/lib/server/taskResultJsonMutation", () => ({
  mutateTaskResultJson: (...args: unknown[]) => mutateMock(...args),
  TaskResultJsonMutationError: class TaskResultJsonMutationError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message); }
  },
}));

import { GET, POST } from "@/app/api/tasks/[id]/listing-handoff/route";

const TASK_ID = "task-lb-1";
const REV = 1;
const NOW = "2026-08-27T04:00:00.000Z";
const OWNER = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
const LEGAL = {
  schema: "listing-creation-brief.v1",
  coreSellingPoint: "Comfortable everyday sipping",
  targetAudience: "Daily commuters",
  useScenario: "Office and travel",
  differentiation: "Simple daily hydration",
  contentEmphasis: "Natural and practical tone",
};

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let capturedMutationResult: Record<string, unknown> | null = null;
let capturedSerializedResult = "";
let capturedMutationWriter: string | null = null;
type CapturedMutate = (c: Record<string, unknown>, s: Readonly<import("@/lib/server/taskResultJsonMutation").TaskResultJsonSnapshot>) => Promise<{ result: Record<string, unknown>; value: Record<string, unknown> }>;
let capturedMutateCallback: CapturedMutate | null = null;

function gateResult(raw?: unknown, revision = REV, keywordBriefRaw?: unknown) {
  return {
    allowed: true,
    reason: "eligible",
    handoffContractInvalid: false,
    ledgerInvalid: false,
    currentHandoff: {
      schema: "product-creative-handoff.v1",
      handoffId: "11111111-1111-4111-8111-111111111111",
      taskId: TASK_ID,
      candidateId: "candidate-lb",
      currentRevision: revision,
      controlState: "active",
      createdAt: NOW,
      createdBy: OWNER,
      researchMode: "market_research_only",
      promotionEligible: false,
      versions: [{
        revision: revision,
        createdAt: NOW,
        createdBy: OWNER,
        sourceResearch: {
          recordSchema: "product-research-record.v1",
          candidateId: "candidate-lb",
          researchRevision: 1,
          researchHash: "a".repeat(64),
          workflowStatus: "completed",
          decisionStatus: "creative_ready",
          candidateSourceFingerprint: "b".repeat(64),
        },
        productIdentity: { displayName: "测试商品", identityConfirmedAt: NOW },
        confirmedFacts: [{
          factId: "00000000-0000-4000-8000-000000000001",
          field: "brand", label: "品牌", value: "TestBrand",
          evidenceTier: "human_confirmed", usageScopes: ["listing"],
          sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: OWNER, confirmedAt: NOW },
          confirmedAt: NOW, confirmedBy: OWNER,
        }],
        stableSourceFacts: [],
        aiCreativeReferences: [],
        issues: [],
        prohibitedClaims: [],
        creativePreferences: { evidenceTier: "creative_preference", tone: "professional" },
        visualReferences: [],
        humanReviewRequired: true,
        confirmation: { confirmed: true, confirmedAt: NOW, confirmedBy: OWNER },
        handoffFingerprint: "d".repeat(64),
      }],
    },
    handoff: undefined,
    candidate: {
      sourceResearch: {
        candidateId: "candidate-lb",
        researchRevision: 1,
        researchHash: "a".repeat(64),
        candidateSourceFingerprint: "b".repeat(64),
      },
    },
    creativeContext: null,
    researchRevision: 1,
    storageVersion: { resultJsonHash: "c".repeat(64), updatedAt: NOW },
    listingHandoffBindingRaw: undefined,
    listingDraftRaw: undefined,
    keywordBriefRaw: keywordBriefRaw,
    imageHandoffBindingRaw: undefined,
    imageDraftRaw: undefined,
    imageStudioSelectionRaw: undefined,
    listingCreationBriefRaw: raw,
  };
}

function req(url: string, body?: unknown, method = "GET"): NextRequest {
  return new NextRequest(url, body === undefined
    ? { method, headers: { "content-type": "application/json" } }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function params() { return Promise.resolve({ id: TASK_ID }); }

function installMutate(current: Record<string, unknown>, updatedAt = "2026-08-27T05:00:00.000Z") {
  mutateMock.mockImplementation(async (mutationInput: { writer: string; mutate: CapturedMutate }) => {
    capturedMutationWriter = mutationInput.writer;
    capturedMutateCallback = mutationInput.mutate;
    const snapshot: import("@/lib/server/taskResultJsonMutation").TaskResultJsonSnapshot = { id: TASK_ID, type: "workflow", updatedAt: NOW, resultJson: JSON.stringify(current), decisionStatus: "continue" };
    const next = await mutationInput.mutate(current, snapshot); // POST 内部唯一一次真实执行
    capturedMutationResult = structuredClone(next.result);
    capturedSerializedResult = JSON.stringify(next.result);
    return { resultJson: capturedSerializedResult, updatedAt, value: next.value };
  });
}

describe("listing-brief save + GET chain", () => {
  beforeEach(() => { vi.clearAllMocks(); capturedMutationResult = null; capturedSerializedResult = ""; capturedMutationWriter = null; capturedMutateCallback = null; });

  it("1. GET 合法回读：规范化 DTO，无泄漏", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    const res = await GET(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.listingBrief).toEqual(LEGAL);
    expect(JSON.stringify(body.data)).not.toContain('"resultJson":');
    expect(JSON.stringify(body.data)).not.toContain("writer");
    expect(JSON.stringify(body.data)).not.toContain("requestId");
  });

  it("1b. GET 已确认关键词方案有界投影：≤10 词 / 去重 / 无内部字段", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL, REV, {
      schema: "listing-keyword-brief.v1",
      primaryKeyword: "drawer organizer",
      supportingKeywords: ["cutlery tray organizer", "silverware holder", "drawer organizer", "silverware holder"],
      source: "manual",
      backendSearchTerms: ["internal-secret-term-1"],
      capturedAt: "2026-08-27T04:00:00.000Z",
    }));
    const res = await GET(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const summary = body.data.keywordBriefPlanSummary;
    expect(summary).not.toBeNull();
    // 词面：主词 + 辅助词去重后 ≤ 10 词；重复词只出现一次
    expect(Array.isArray(summary.terms)).toBe(true);
    expect(summary.terms.length).toBeLessThanOrEqual(10);
    expect(summary.terms.length).toBe(3);
    expect(summary.terms).toContain("drawer organizer");
    expect(summary.terms).toContain("cutlery tray organizer");
    expect(summary.terms).toContain("silverware holder");
    expect(new Set(summary.terms.map((v: string) => v.toLowerCase())).size).toBe(summary.terms.length);
    // 有界：不返回 backend 搜索词原文 / 内部 id / 账本字段
    const raw = JSON.stringify(summary);
    expect(raw).not.toContain("internal-secret-term-1");
    expect(raw).not.toContain("backendSearchTerms");
    expect(raw).not.toContain("provenance");
    expect(raw).not.toContain("requestId");
  });

  it("2. GET 畸形历史值 → 200 且 listingBrief=null", async () => {
    gateMock.mockResolvedValue(gateResult({ schema: "wrong-version", coreSellingPoint: ["not text"] }));
    const res = await GET(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.listingBrief).toBeNull();
    expect(JSON.stringify(body.data)).not.toContain("wrong-version");
  });

  it("3. 保存合法 Brief：唯一字段变更 + 真实 hash", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    const current: Record<string, unknown> = {
      listingDraft: { keep: true },
      listingKeywordBrief: { keep: "keyword" },
      unrelatedNamespace: { nested: [1, 2, 3] },
    };
    installMutate(current);
    const body = { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify(current)), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL };
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", body, "POST"), { params: params() });
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(capturedMutationResult?.listingCreationBrief).toMatchObject({ schema: LEGAL.schema, coreSellingPoint: LEGAL.coreSellingPoint });
    expect(capturedMutationResult?.listingDraft).toEqual({ keep: true });
    expect(capturedMutationResult?.listingKeywordBrief).toEqual({ keep: "keyword" });
    expect(capturedMutationResult?.unrelatedNamespace).toEqual({ nested: [1, 2, 3] });
    expect(data.currentHandoffRevision).toBe(REV);
    expect(data.storageVersion.resultJsonHash).toBe(sha(capturedSerializedResult));
    expect(data.storageVersion.updatedAt).toBe("2026-08-27T05:00:00.000Z");
  });

  it("4. 空表单保存：真正删除字段（非 undefined 伪删除）", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    const current: Record<string, unknown> = { listingCreationBrief: LEGAL, unrelatedNamespace: { keep: 1 } };
    installMutate(current);
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify(current)), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: {} }, "POST"), { params: params() });
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(Object.prototype.hasOwnProperty.call(capturedMutationResult, "listingCreationBrief")).toBe(false);
    expect(capturedMutationResult?.unrelatedNamespace).toEqual({ keep: 1 });
    expect(data.listingBrief).toBeNull();
  });

  it("5. 保存不修改输入对象", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    const current: Record<string, unknown> = { listingDraft: { keep: true }, unrelatedNamespace: { nested: [1, 2, 3] } };
    installMutate(current);
    const body = { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify(current)), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL };
    const bodySnapshot = JSON.stringify(body);
    const currentSnapshot = JSON.stringify(current);
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", body, "POST"), { params: params() });
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).toBe(bodySnapshot);
    expect(JSON.stringify(current)).toBe(currentSnapshot);
  });
  it("6. 未知顶层字段 → 400 unknown_field，Gate/mutate 未调用", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    installMutate({});
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify({})), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL, unexpectedField: "should reject" }, "POST"), { params: params() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unknown_field");
    expect(gateMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });
  it("7. confirmed 缺失 → 400 confirmation_required，Gate/mutate 未调用", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    installMutate({});
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify({})), updatedAt: NOW }, expectedHandoffRevision: REV, listingBrief: LEGAL }, "POST"), { params: params() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("confirmation_required");
    expect(gateMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });
  it("8. expectedStorageVersion 无效 → 400 invalid_storage_version", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    installMutate({});
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: "short", updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL }, "POST"), { params: params() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_storage_version");
    expect(gateMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });
  it("9. expectedHandoffRevision 无效 → 400 invalid_handoff_revision", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    installMutate({});
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify({})), updatedAt: NOW }, expectedHandoffRevision: 0, confirmed: true, listingBrief: LEGAL }, "POST"), { params: params() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_handoff_revision");
    expect(gateMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });
  it("10. 服务端 revision 冲突 → 409 handoff_revision_conflict，不进 mutate", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL, REV + 1));
    installMutate({});
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify({})), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL }, "POST"), { params: params() });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("handoff_revision_conflict");
    expect(mutateMock).not.toHaveBeenCalled();
  });
  it("11. storage CAS 冲突 → 409 task_result_conflict，current 未变，无写入结果", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    const current: Record<string, unknown> = { unrelatedNamespace: { keep: 1 } };
    installMutate(current);
    const before = JSON.stringify(current);
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: "f".repeat(64), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL }, "POST"), { params: params() });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("task_result_conflict");
    expect(JSON.stringify(current)).toBe(before);
    expect(capturedMutationResult).toBeNull();
  });
  it("12. 非法 Brief 被真实校验器拒绝 → 400 真实错误码，Gate/mutate 未调用", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    installMutate({});
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify({})), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: { schema: "wrong-version", coreSellingPoint: "Guaranteed number one product" } }, "POST"), { params: params() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_listing_brief");
    expect(gateMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("13. 保存回调真实经过 applyTaskResultJsonMutation namespace 门禁：writer 字面量、自有键写入、他键保持、越权真实拒绝", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server/taskResultJsonMutation")>("@/lib/server/taskResultJsonMutation");
    const {
      PRODUCT_RESEARCH_HASH_SCHEMA,
      createProductResearchVerification,
      createInitialProductResearchRecord,
      buildProductResearchHash,
    } = await import("@/lib/productResearchRecord");
    const verification = createProductResearchVerification({
      schema: PRODUCT_RESEARCH_HASH_SCHEMA,
      candidateId: "candidate-lb-real",
      runId: "run-lb-real",
      contextHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      resultHash: "c".repeat(64),
      workflowStatus: "completed",
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
    });
    const researchRecord = createInitialProductResearchRecord({
      candidateId: verification.candidateId,
      runId: verification.runId,
      contextHash: verification.contextHash,
      researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
      workflowStatus: verification.workflowStatus,
      reviewState: verification.reviewState,
      actor: { mode: "owner", actorRef: "owner:v1" },
      now: NOW,
      decision: { decisionId: "22222222-2222-4222-8222-222222222222", status: "creative_ready", reason: "ok", nextAction: null },
    });
    const current: Record<string, unknown> = {
      researchRecord,
      researchVerification: verification,
      listingKeywordBrief: { keep: "keyword" },
      unrelatedNamespace: { nested: [1, 2, 3] },
    };
    gateMock.mockResolvedValue(gateResult(LEGAL));
    installMutate(current);
    const res = await POST(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff", { action: "save_listing_brief", expectedStorageVersion: { resultJsonHash: sha(JSON.stringify(current)), updatedAt: NOW }, expectedHandoffRevision: REV, confirmed: true, listingBrief: LEGAL }, "POST"), { params: params() });
    expect(res.status).toBe(200);
    // writer 必须是裸字面量（无 as 断言；tsc 已把未注册写者变成编译错误）
    expect(capturedMutationWriter).toBe("listing-creation-brief");
    expect(capturedMutateCallback).toBeTruthy();
    // 真实 mutation 门禁执行 Route 捕获到的保存回调（本条不经 vi.mock 的 mutateTaskResultJson）
    const applied = await actual.applyTaskResultJsonMutation({
      currentResultJson: JSON.stringify(current),
      writer: "listing-creation-brief",
      snapshot: { id: TASK_ID, type: "workflow", updatedAt: new Date(NOW), resultJson: JSON.stringify(current), decisionStatus: "continue" },
      mutate: capturedMutateCallback!,
    });
    const savedDoc = JSON.parse(applied.resultJson);
    expect(savedDoc.listingCreationBrief).toMatchObject({ schema: LEGAL.schema, coreSellingPoint: LEGAL.coreSellingPoint });
    expect(savedDoc.listingKeywordBrief).toEqual({ keep: "keyword" });
    expect(savedDoc.unrelatedNamespace).toEqual({ nested: [1, 2, 3] });
    expect(savedDoc.researchRecord).toEqual(researchRecord);
    // 同一 writer 越权触碰 keyword brief namespace → 真实门禁必须拒绝
    await expect(actual.applyTaskResultJsonMutation({
      currentResultJson: JSON.stringify(current),
      writer: "listing-creation-brief",
      snapshot: { id: TASK_ID, type: "workflow", updatedAt: new Date(NOW), resultJson: JSON.stringify(current), decisionStatus: "continue" },
      mutate: (document) => ({ result: { ...document, listingCreationBrief: { schema: LEGAL.schema }, listingKeywordBrief: { hijack: true } }, value: "saved" }),
    })).rejects.toMatchObject({ code: "namespace_contract_invalid", status: 500 });
  });

  it("14. GET 正常 eligible 分支：raw 合法 schema → data.listingBrief 规范化五字段，DTO 无 raw/内部字段，不发生写", async () => {
    gateMock.mockResolvedValue(gateResult(LEGAL));
    const res = await GET(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.listingBrief).toBeDefined();
    expect(body.data.listingBrief).toEqual(LEGAL);
    const projected = body.data.listingBrief as { schema?: string; coreSellingPoint?: string; targetAudience?: string; useScenario?: string; differentiation?: string; contentEmphasis?: string };
    expect(projected.coreSellingPoint).toBe(LEGAL.coreSellingPoint);
    expect(projected.targetAudience).toBe(LEGAL.targetAudience);
    expect(projected.useScenario).toBe(LEGAL.useScenario);
    expect(projected.differentiation).toBe(LEGAL.differentiation);
    expect(projected.contentEmphasis).toBe(LEGAL.contentEmphasis);
    expect(JSON.stringify(body.data)).not.toContain("listingCreationBriefRaw");
    expect(JSON.stringify(body.data)).not.toContain("'resultJson':");
    expect(JSON.stringify(body.data)).not.toContain("requestId");
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("15. 持久化往返契约：合法 schema + 五字段经真实 buildListingBrief 必须接受（防持久化值被拒回退）", async () => {
    const { buildListingBrief } = await vi.importActual<typeof import("@/lib/listingHandoff/listingBrief")>("@/lib/listingHandoff/listingBrief");
    const persisted = { ...LEGAL };
    const result = buildListingBrief(persisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brief?.schema).toBe("listing-creation-brief.v1");
      expect(result.brief?.coreSellingPoint).toBe(LEGAL.coreSellingPoint);
      expect(result.brief?.targetAudience).toBe(LEGAL.targetAudience);
      expect(result.brief?.useScenario).toBe(LEGAL.useScenario);
      expect(result.brief?.differentiation).toBe(LEGAL.differentiation);
      expect(result.brief?.contentEmphasis).toBe(LEGAL.contentEmphasis);
    }
    const wrong = buildListingBrief({ schema: "wrong-version", coreSellingPoint: "x" });
    expect(wrong.ok).toBe(false);
    const unknown = buildListingBrief({ ...LEGAL, extraField: "nope" });
    expect(unknown.ok).toBe(false);
  });
});
describe("HISTORICAL_KEYWORD_READ_GUARD：route GET 用当前 Brief 投影历史草稿关键词", () => {
  const DIRTY_RAW = {
    draftKind: "structured_listing_draft",
    humanReviewRequired: true,
    generatedAt: "2026-08-26T00:00:00.000Z",
    source: "deterministic_composition_v1",
    version: 1,
    composerVersion: "listing-composer-v1",
    generationPolicyVersion: "listing-generation-policy-v1",
    polishApplied: false,
    polishModel: null,
    titles: ["ukeetap UTO001 Drawer Organizer Plastic Silver"],
    bullets: [
      "The organizer is made of durable plastic.",
      "Multiple compartments keep your flatware and kitchen tools in order.",
      "For care, rinse the tray and wipe dry with a soft cloth.",
      "The expandable frame adjusts to fit standard kitchen drawer widths.",
      "Non-slip feet help keep the storage unit in place during daily use.",
    ],
    description: "The ukeetap UTO001 is a plastic organizer. It fits most medium kitchen drawers.",
    keywords: ["drawer organizer", "kitchen drawer organizer", "Plastic Organizer", "Holds approximately 40-50 pieces of cutlery Organizer"],
    backendSearchTerms: ["drawer organizer", "plastic organizer caddy"],
    sellingPoints: ["x"],
    providerAttempted: false,
    providerSucceeded: false,
    fallbackApplied: false,
    factSafe: true,
    copyQuality: true,
    listingUnqualified: false,
  };
  const CURRENT_BRIEF = {
    schema: "listing-keyword-brief.v1",
    primaryKeyword: "silverware organizer",
    supportingKeywords: ["drawer organizer", "kitchen drawer organizer"],
    backendSearchTerms: ["drawer organizer"],
    source: "sellersprite",
    capturedAt: "2026-08-27T04:00:00.000Z",
  };

  it("GET 历史脏草稿：keywords 只保留当前 Brief 合法词、正文保留、提示可见、无脏词原文", async () => {
    gateMock.mockResolvedValue({ ...gateResult(LEGAL, REV, CURRENT_BRIEF), listingDraftRaw: DIRTY_RAW });
    const res = await GET(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const draft = body.data.draft;
    expect(draft).not.toBeNull();
    expect(draft.keywords).toEqual(["drawer organizer", "kitchen drawer organizer"]);
    expect(draft.backendSearchTerms).toEqual(["drawer organizer"]);
    expect(draft.bullets.length).toBe(5);
    expect(draft.listingUnqualified).toBe(false);
    expect(draft.historicalKeywordFilteredNotice).toContain("已按当前规则过滤");
    const draftDump = JSON.stringify(draft);
    expect(draftDump).not.toContain("Plastic Organizer");
    expect(draftDump).not.toContain("Holds approximately");
    expect(draftDump).not.toContain("resultJsonHash");
  });

  it("GET 无有效 Brief：历史 keywords/backend 投影为空", async () => {
    gateMock.mockResolvedValue({ ...gateResult(LEGAL, REV, undefined), listingDraftRaw: DIRTY_RAW });
    const res = await GET(req("http://127.0.0.1:3010/api/tasks/" + TASK_ID + "/listing-handoff"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.draft.keywords).toEqual([]);
    expect(body.data.draft.backendSearchTerms).toEqual([]);
  });
});
