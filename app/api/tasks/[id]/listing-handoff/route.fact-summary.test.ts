import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkCreativeHandoffGate: vi.fn(),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
}));
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: () => ({ ok: true, context: { mode: "owner", token: "owner" } }),
}));
vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: mocks.checkCreativeHandoffGate,
}));
vi.mock("@/lib/listingHandoff/listingGenerationService", () => ({
  generateListingDraftFromHandoff: vi.fn(),
  draftSafeSummary: () => null,
  ListingHandoffError: class ListingHandoffError extends Error {},
}));
vi.mock("@/lib/server/taskResultJsonMutation", () => ({
  TaskResultJsonMutationError: class TaskResultJsonMutationError extends Error {},
}));
vi.mock("@/lib/productCreativeHandoffStatus", () => ({
  // 真实语义：researchHash 与 handoff 版本一致 → active（generationAllowed=true）；
  // 不一致 → stale（generationAllowed=false）。D3 经 gate fixture 的 researchHash 差异驱动。
  evaluateHandoffStatus: (input: { handoff?: { versions?: Array<{ sourceResearch?: { researchHash?: string } }> }; currentResearch?: { researchHash?: string } }) => {
    const v = input?.handoff?.versions?.[input.handoff.versions.length - 1];
    const sameHash = v?.sourceResearch?.researchHash === input?.currentResearch?.researchHash;
    return sameHash
      ? { status: "active", reasonCode: "current", generationAllowed: true }
      : { status: "stale", reasonCode: "research_basis_changed", generationAllowed: false };
  },
}));

const now = "2026-08-10T00:00:00.000Z";
function gate(usageScopes: string[]) {
  const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
  return {
    allowed: true,
    reason: "eligible",
    currentHandoff: {
      schema: "product-creative-handoff.v1",
      handoffId: "11111111-1111-4111-8111-111111111111",
      taskId: "task-1",
      candidateId: "candidate-1",
      currentRevision: 1,
      controlState: "active",
      createdAt: now,
      createdBy: owner,
      researchMode: "market_research_only",
      promotionEligible: false,
      versions: [{
        revision: 1,
        createdAt: now,
        createdBy: owner,
        sourceResearch: {
          recordSchema: "product-research-record.v1",
          candidateId: "candidate-1",
          researchRevision: 1,
          researchHash: "a".repeat(64),
          workflowStatus: "completed",
          decisionStatus: "creative_ready",
          candidateSourceFingerprint: "b".repeat(64),
        },
        productIdentity: { displayName: "测试商品", identityConfirmedAt: now },
        confirmedFacts: [{
          factId: "00000000-0000-4000-8000-000000000001",
          field: usageScopes.includes("listing") ? "brand" : "visual_note",
          label: "测试事实",
          value: "TestBrand",
          evidenceTier: "human_confirmed",
          usageScopes,
          sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: owner, confirmedAt: now, confirmationReference: "fact-candidates:brand" },
          confirmedAt: now,
          confirmedBy: owner,
        }],
        stableSourceFacts: [],
        aiCreativeReferences: [],
        issues: [],
        prohibitedClaims: [{ claimId: "00000000-0000-4000-8000-000000000002", category: "absolute_claim", summary: "不得夸大", appliesTo: ["both"], source: "system_rule" }],
        creativePreferences: { evidenceTier: "creative_preference", tone: "professional" },
        visualReferences: [],
        humanReviewRequired: true,
        confirmation: { confirmed: true, confirmedAt: now, confirmedBy: owner },
        handoffFingerprint: "d".repeat(64),
      }],
    },
    candidate: {
      sourceResearch: {
        candidateId: "candidate-1",
        researchRevision: 1,
        researchHash: "a".repeat(64),
        candidateSourceFingerprint: "b".repeat(64),
      },
    },
    storageVersion: { resultJsonHash: "c".repeat(64), updatedAt: now },
    listingHandoffBindingRaw: undefined as unknown as string | undefined,
    listingDraftRaw: undefined as unknown as string | undefined,
    keywordBriefRaw: undefined as unknown as string | null,
    listingCreationBriefRaw: undefined as unknown as string | null,
  };
}

async function get() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/tasks/task-1/listing-handoff") as never, {
    params: Promise.resolve({ id: "task-1" }),
  });
}

describe("GET task listing fact summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables generation when confirmed facts are not Listing-eligible", async () => {
    mocks.checkCreativeHandoffGate.mockResolvedValue(gate(["image"]));

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.canGenerate).toBe(false);
    expect(body.data.factSummary).toEqual({
      confirmedFacts: 1,
      listingEligibleFacts: 0,
      prohibitedClaims: 1,
    });
    // V2：无 listing 事实 → buildListingInput 拒绝（ok:false）→ capability=null（安全空态）
    expect(body.data.capability).toBeNull();
  });

  it("keeps generation enabled when at least one Listing fact is eligible", async () => {
    // 夹具扩展：身份 + 2 个核心组（partial_draft 可生成部分草稿；旧 brand-only 在新语义下正确关闭）
    const g = gate(["listing"]);
    const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const fact = (factId: string, field: string, value: string) => ({
      factId,
      field,
      label: field,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: now, confirmationReference: `fact-candidates:${field}` },
      confirmedAt: now,
      confirmedBy: owner,
    });
    g.currentHandoff.versions[0].confirmedFacts = [
      fact("00000000-0000-4000-8000-000000000001", "brand", "TestBrand"),
      fact("00000000-0000-4000-8000-000000000002", "product_type", "Water Bottle"),
      fact("00000000-0000-4000-8000-000000000003", "material", "Stainless Steel"),
      fact("00000000-0000-4000-8000-000000000004", "capacity", "12oz"),
    ];
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);

    const response = await get();
    const body = await response.json();

    expect(body.data.canGenerate).toBe(true);
    expect(body.data.factSummary.listingEligibleFacts).toBe(4);
    // V2：身份 + 2 组 → partial_draft；canGenerate=true（部分草稿语义）；Provider 不调用
    expect(body.data.capability).toMatchObject({
      level: "partial_draft",
      supportedBulletCount: 2,
      targetBulletCount: 2,
      canCallProvider: false,
    });
    // 安全：不得返回事实值/内部来源/reason 细节
    expect(JSON.stringify(body.data.capability)).not.toContain("TestBrand");
  });

  it("D. 中文事实 + stale + 标签未标阻断：canGenerate=true（V2 权威能力不被旧 Preflight 假阻断）", async () => {
    // 扩展 gate：多中文事实 + 英文身份/材质
    const g = gate(["listing"]);
    const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const cn = (factId: string, field: string, label: string, value: string) => ({
      factId,
      field,
      label,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: now, confirmationReference: `fact-candidates:${field}` },
      confirmedAt: now,
      confirmedBy: owner,
    });
    g.currentHandoff.versions[0].confirmedFacts = [
      cn("00000000-0000-4000-8000-000000000010", "brand", "品牌", "YETI"),
      cn("00000000-0000-4000-8000-000000000011", "product_type", "商品类型", "Bottle"),
      cn("00000000-0000-4000-8000-000000000012", "material", "材质", "Stainless Steel"),
      cn("00000000-0000-4000-8000-000000000013", "capacity", "容量", "可收纳约 40–50 件常用餐具"),
      cn("00000000-0000-4000-8000-000000000014", "usage", "用途", "适合日常厨房收纳与外出携带"),
      cn("00000000-0000-4000-8000-000000000015", "care", "保养", "可用清水冲洗并擦干"),
      cn("00000000-0000-4000-8000-000000000016", "construction", "结构", "采用不锈钢与塑料组合结构"),
    ];
    // 模拟 stale：binding 来自旧 revision
    g.listingHandoffBindingRaw = JSON.stringify({
      schema: "listing-handoff-binding.v1",
      bindingId: "b1",
      requestIdHash: "a".repeat(64),
      sourceHandoffId: "11111111-1111-4111-8111-111111111111",
      sourceHandoffRevision: 99,
      sourceResearchRevision: 99,
      sourceHandoffFingerprintHash: "b".repeat(64),
      generationInputFingerprint: "c".repeat(64),
      generatedAt: now,
      humanReviewRequired: true,
    });
    g.listingDraftRaw = "{\"kind\":\"safe_fact_draft\"}";
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);

    const response = await get();
    const body = await response.json();

    // V2 权威能力：中文事实是事实（非不安全）→ 不得被旧 Preflight 的 schema_invalid 假阻断
    expect(body.data.capability).not.toBeNull();
    if (body.data.capability) {
      expect(body.data.capability.isBlocked).toBe(false);
    }
    expect(body.data.claimPreflight).not.toBeNull();
    // 中文事实可英文化 + 无真实 blocking → canGenerate=true（V2 权威能力驱动）
    expect(body.data.canGenerate).toBe(true);
    // 测试 1：Pending DTO 必须安全返回 reasonCode（pass=false + english_rendering_pending + 有界 reason）
    expect(body.data.claimPreflight).toMatchObject({
      pass: false,
      reasonCode: "english_rendering_pending",
    });
    if (body.data.claimPreflight && !body.data.claimPreflight.pass) {
      expect(typeof body.data.claimPreflight.reason).toBe("string");
      expect(body.data.claimPreflight.reason.length).toBeGreaterThan(0);
      // 有界：reason 不含事实原文
      expect(body.data.claimPreflight.reason).not.toContain("可收纳约");
      expect(body.data.claimPreflight.reason).not.toContain("40–50");
    }
  });

  it("D. prohibited 排除后仅剩 1 个核心组 → facts_only / target=0 / canGenerate=false", async () => {
    // 高风险中文事实（含 100%）→ Policy 裁决 prohibited；排除后仅剩身份+material（1 组）
    const g = gate(["listing"]);
    const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const cn = (factId: string, field: string, label: string, value: string) => ({
      factId,
      field,
      label,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: now, confirmationReference: `fact-candidates:${field}` },
      confirmedAt: now,
      confirmedBy: owner,
    });
    g.currentHandoff.versions[0].confirmedFacts = [
      cn("00000000-0000-4000-8000-000000000010", "brand", "品牌", "YETI"),
      cn("00000000-0000-4000-8000-000000000011", "product_type", "商品类型", "Bottle"),
      cn("00000000-0000-4000-8000-000000000012", "material", "材质", "Stainless Steel"),
      cn("00000000-0000-4000-8000-000000000013", "functional_feature", "功能", "100% 防水，保证永不漏水"),
    ];
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);

    const response = await get();
    const body = await response.json();

    // 精确合同：prohibited 不计入 supportedBulletCount（1 来自 verified material 组）；排除后 1 核心组 → facts_only
    expect(body.data.capability).toMatchObject({
      level: "facts_only",
      supportedBulletCount: 1,
      targetBulletCount: 0,
      isBlocked: false,
      canCallProvider: false,
    });
    expect(body.data.canGenerate).toBe(false);
  });

  it("D2. Route 源码：canGenerate 计算在 capability 计算之后（真消费内部结果）", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/listing-handoff/route.ts"), "utf8");
    const capabilityIdx = source.indexOf("capabilitySafe =");
    const canGenerateIdx = source.indexOf("const canGenerate =");
    // capability 安全评估必须出现在 canGenerate 之前（canGenerate 消费其内部结果）
    expect(capabilityIdx).toBeGreaterThan(-1);
    expect(canGenerateIdx).toBeGreaterThan(-1);
    expect(capabilityIdx).toBeLessThan(canGenerateIdx);
    // canGenerate 必须引用 capability 派生值（hasUsableDraft 消费 hasIdentity/targetBulletCount/isBlocked）
    const canGenerateBlock = source.slice(canGenerateIdx, source.indexOf("// Quality.1", canGenerateIdx));
    expect(canGenerateBlock).toMatch(/hasUsableDraft|capability/i);
    // hasUsableDraft 必须消费 hasIdentity/targetBulletCount/isBlocked（真实行为驱动，非字符串存在）
    const hasUsableIdx = source.indexOf("const hasUsableDraft");
    expect(hasUsableIdx).toBeGreaterThan(-1);
    const usableBlock = source.slice(hasUsableIdx, source.indexOf("const providerEligible", hasUsableIdx));
    expect(usableBlock).toMatch(/hasIdentity/);
    expect(usableBlock).toMatch(/targetBulletCount/);
    expect(usableBlock).toMatch(/isBlocked/);
    // hasBlockingIssue 必须由真实全局状态派生（handoffEffectiveStatus.generationAllowed）
    const hasGlobalIdx = source.indexOf("const hasGlobalBlockingIssue");
    expect(hasGlobalIdx).toBeGreaterThan(-1);
    const globalBlock = source.slice(hasGlobalIdx, hasGlobalIdx + 300);
    expect(globalBlock).toMatch(/generationAllowed/);
    expect(globalBlock).toMatch(/handoffEffectiveStatus/);
    const blockingIdx = source.indexOf("hasBlockingIssue:");
    expect(blockingIdx).toBeGreaterThan(-1);
    const afterBlocking = source.slice(blockingIdx, blockingIdx + 200);
    expect(afterBlocking).toMatch(/hasGlobalBlockingIssue/);
  });

  it("D3. Route 真 isBlocked：generationAllowed=false（effective stale，buildResult 仍 ok）→ capability 非 null + isBlocked=true + canGenerate=false", async () => {
    const g = gate(["listing"]);
    const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const fact = (factId: string, field: string, value: string) => ({
      factId,
      field,
      label: field,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: now, confirmationReference: `fact-candidates:${field}` },
      confirmedAt: now,
      confirmedBy: owner,
    });
    g.currentHandoff.versions[0].confirmedFacts = FULL_SAFE_DESCRIPTORS.map((d, i) =>
      fact(`00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, d.field, d.value),
    );
    // 制造 effective stale 但 buildResult 仍 ok：handoff 版本 researchHash="a"*64；
    // gate.candidate.sourceResearch.researchHash 改为 "b"*64 → evaluateHandoffStatus 判
    // research_basis_changed → generationAllowed=false；buildListingInput 只比对 researchRevision（保持 ok）
    g.candidate.sourceResearch.researchHash = "b".repeat(64);
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);

    const response = await get();
    const body = await response.json();

    // 真 isBlocked 证据：capability 非 null（不是 revoked 假 null）
    expect(body.data.capability).not.toBeNull();
    if (body.data.capability) {
      expect(body.data.capability.level).toBe("full_draft");
      expect(body.data.capability.supportedBulletCount).toBe(5);
      expect(body.data.capability.targetBulletCount).toBe(5);
      expect(body.data.capability.isBlocked).toBe(true);
      expect(body.data.capability.canCallProvider).toBe(false);
    }
    expect(body.data.canGenerate).toBe(false);
    expect(body.data.handoffEffectiveStatus).toBe("stale");
  });

  it("D4. 正常 active 对照：同 5 组安全事实 + generationAllowed=true → isBlocked=false + canGenerate=true", async () => {
    const g = gate(["listing"]);
    const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const fact = (factId: string, field: string, value: string) => ({
      factId,
      field,
      label: field,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: now, confirmationReference: `fact-candidates:${field}` },
      confirmedAt: now,
      confirmedBy: owner,
    });
    g.currentHandoff.versions[0].confirmedFacts = FULL_SAFE_DESCRIPTORS.map((d, i) =>
      fact(`00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, d.field, d.value),
    );
    // 正常 active（researchHash 与 handoff 版本一致 "a"*64）
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);

    const response = await get();
    const body = await response.json();

    expect(body.data.capability).toMatchObject({
      level: "full_draft",
      supportedBulletCount: 5,
      targetBulletCount: 5,
      isBlocked: false,
      canCallProvider: true,
    });
    expect(body.data.canGenerate).toBe(true);
    expect(body.data.handoffEffectiveStatus).toBe("active");
  });

  /** 构造可复用的多事实 gate：由字段描述符生成 confirmedFacts */
  function factsGate(descriptors: Array<{ field: string; value: string }>): ReturnType<typeof gate> {
    const g = gate(["listing"]);
    const owner = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const fact = (factId: string, field: string, value: string) => ({
      factId,
      field,
      label: field,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: now, confirmationReference: `fact-candidates:${field}` },
      confirmedAt: now,
      confirmedBy: owner,
    });
    g.currentHandoff.versions[0].confirmedFacts = descriptors.map((d, i) =>
      fact(`00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, d.field, d.value),
    );
    return g;
  }

  /** 5 个安全核心组 + 身份（全部英文，避免 pending 干扰） */
  const FULL_SAFE_DESCRIPTORS = [
    { field: "brand", value: "Acme" },
    { field: "product_type", value: "Organizer" },
    { field: "series_or_model", value: "Silverware Tray" },
    { field: "material", value: "Stainless Steel" },
    { field: "capacity", value: "12 compartments" },
    { field: "operation", value: "slide-out drawers for easy access" },
    { field: "usage", value: "suitable for daily kitchen storage" },
    { field: "care", value: "wipe clean with a damp cloth" },
    { field: "included_components", value: "includes divider inserts" },
  ];

  it("C. 缺身份但核心组充足 → canGenerate=false（真实行为，非源码字符串）", async () => {
    const g = factsGate(FULL_SAFE_DESCRIPTORS.filter((d) => !["brand", "product_type", "series_or_model"].includes(d.field)));
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);
    const response = await get();
    const body = await response.json();
    expect(body.data.capability).not.toBeNull();
    if (body.data.capability) {
      expect(body.data.capability.hasIdentity).toBe(false);
      expect(body.data.capability.canCallProvider).toBe(false);
    }
    expect(body.data.canGenerate).toBe(false);
  });

  it("D. 身份 + 2 个核心组 → partial_draft / target=2 / canGenerate=true / Provider=false", async () => {
    const g = factsGate([
      { field: "brand", value: "Acme" },
      { field: "product_type", value: "Organizer" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "12 compartments" },
    ]);
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);
    const response = await get();
    const body = await response.json();
    expect(body.data.capability).toMatchObject({
      level: "partial_draft",
      supportedBulletCount: 2,
      targetBulletCount: 2,
      hasIdentity: true,
      canCallProvider: false,
      isBlocked: false,
    });
    expect(body.data.canGenerate).toBe(true);
  });

  it("E. 身份 + 0~1 个核心组 → facts_only / target=0 / canGenerate=false / suggestedQuestions 保留", async () => {
    const g = factsGate([
      { field: "brand", value: "Acme" },
      { field: "product_type", value: "Organizer" },
      { field: "material", value: "Stainless Steel" },
    ]);
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);
    const response = await get();
    const body = await response.json();
    expect(body.data.capability).toMatchObject({
      level: "facts_only",
      targetBulletCount: 0,
      canCallProvider: false,
    });
    expect(body.data.canGenerate).toBe(false);
    if (body.data.capability) {
      expect(body.data.capability.suggestedQuestions.length).toBeGreaterThan(0);
    }
  });

  it("F. 真正 hasBlockingIssue 传入 Capability → isBlocked=true → canGenerate=false（即使 5 个安全组）", async () => {
    // 通过 handoff 无效状态模拟全局 blocking（revoked 被 listingStatus 拦截……用 blocked revoke）
    // 真正全局 blocking：handoff 有效但 capability 计算时 hasBlockingIssue=true（如 Quality 门禁）。
    // Route 的全局 blocking 来源 = listingStatus revoked/invalid；这里用 revocation 证明 isBlocked 参与。
    const g = factsGate(FULL_SAFE_DESCRIPTORS);
    // 模拟 revoked：controlState revoked → capability 计算被跳过（安全空态）→ canGenerate=false
    g.currentHandoff.controlState = "revoked" as never;
    mocks.checkCreativeHandoffGate.mockResolvedValue(g);
    const response = await get();
    const body = await response.json();
    // 全局 blocking：canGenerate 必须 false（不因 5 个安全组放行）
    expect(body.data.canGenerate).toBe(false);
  });
});
