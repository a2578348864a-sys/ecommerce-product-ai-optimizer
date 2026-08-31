/**
 * V3R（Research→Creative Consistency）— Listing Claim Preflight 测试（Fix 3：UI/Generate 同源）
 *
 * 契约① LISTENING_READINESS：
 * - preflight 与服务端 Generate 事实校验同源（同一确定性校验链）；
 * - pass=false 时 reason 为面向用户的人话阻断原因（blockingReasons）；
 * - 路由 canGenerate 已并入 preflight（route 源码级断言）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { preflightListingClaimSafety } from "@/lib/listingHandoff/listingClaimPreflight";

const routeSource = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/listing-handoff/route.ts"), "utf8");
const uiSource = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");
const preflightSource = readFileSync(resolve(process.cwd(), "lib/listingHandoff/listingClaimPreflight.ts"), "utf8");

function buildHandoff(overrides: Record<string, unknown> = {}) {
  const now = "2026-08-05T00:00:00.000Z";
  const owner = { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" };
  const fact = (factId: string, field: string, label: string, value: string | number) => ({
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
  return {
    schema: "product-creative-handoff.v1",
    handoffId: "11111111-1111-4111-8111-111111111111",
    taskId: "task-test",
    candidateId: "candidate-test",
    currentRevision: 1,
    controlState: "active" as const,
    createdAt: now,
    createdBy: owner,
    researchMode: "market_research_only",
    promotionEligible: false,
    versions: [{
      revision: 1,
      createdAt: now,
      createdBy: owner,
      sourceResearch: { recordSchema: "product-research-record.v1", candidateId: "candidate-test", researchRevision: 1, researchHash: "a".repeat(64), workflowStatus: "completed", decisionStatus: "creative_ready", candidateSourceFingerprint: "b".repeat(64) },
      productIdentity: { displayName: "Test", identityConfirmedAt: now },
      confirmedFacts: [
        fact("00000000-0000-4000-8000-000000000001", "brand", "品牌", "TestBrand"),
        fact("00000000-0000-4000-8000-000000000002", "product_type", "商品类型", "Water Bottle"),
        fact("00000000-0000-4000-8000-000000000003", "material", "材质", "Stainless Steel"),
        fact("00000000-0000-4000-8000-000000000004", "capacity", "容量", "12oz"),
        fact("00000000-0000-4000-8000-000000000005", "functional_feature", "功能特性", "Push-button lid for one-hand opening"),
      ],
      stableSourceFacts: [],
      aiCreativeReferences: [],
      issues: [],
      prohibitedClaims: [],
      creativePreferences: { evidenceTier: "creative_preference", tone: "professional" },
      visualReferences: [],
      humanReviewRequired: true,
      confirmation: { confirmed: true, confirmedAt: now, confirmedBy: owner },
      handoffFingerprint: "d".repeat(64),
    }],
    ...overrides,
  };
}

describe("preflightListingClaimSafety（契约① LISTENING_READINESS）", () => {
  it("pass：足量可 Listing 事实 → 预演通过（与服务端 Generate 同源）", () => {
    const result = preflightListingClaimSafety({ handoff: buildHandoff() as never, researchRevision: 1 });
    expect(result.pass).toBe(true);
  });

  /** 中文事实夹具（英文身份/材质 + 中文功能事实；显式高风险确认） */
  function cnHandoff(values: Record<string, string> = {}, opts: { onlyMinimal?: boolean } = {}) {
    const owner = { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const cnFact = (factId: string, field: string, label: string, value: string) => ({
      factId,
      field,
      label,
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: "2026-08-05T00:00:00.000Z", confirmationReference: `fact-candidates:${field}` },
      confirmedAt: "2026-08-05T00:00:00.000Z",
      confirmedBy: owner,
    });
    const base = buildHandoff().versions[0];
    const coreFacts = opts.onlyMinimal ? [
      // 仅身份 + 材质（不足以生成部分草稿）
      cnFact("00000000-0000-4000-8000-000000000010", "brand", "品牌", "YETI"),
      cnFact("00000000-0000-4000-8000-000000000011", "product_type", "商品类型", "Bottle"),
      cnFact("00000000-0000-4000-8000-000000000012", "material", "材质", "Stainless Steel"),
    ] : [
      cnFact("00000000-0000-4000-8000-000000000010", "brand", "品牌", "YETI"),
      cnFact("00000000-0000-4000-8000-000000000011", "product_type", "商品类型", "Bottle"),
      cnFact("00000000-0000-4000-8000-000000000012", "material", "材质", "Stainless Steel"),
      cnFact("00000000-0000-4000-8000-000000000013", "capacity", "容量", "可收纳约 40–50 件常用餐具"),
      cnFact("00000000-0000-4000-8000-000000000014", "usage", "用途", "适合日常厨房收纳与外出携带"),
      cnFact("00000000-0000-4000-8000-000000000015", "care", "保养", "可用清水冲洗并擦干"),
      cnFact("00000000-0000-4000-8000-000000000016", "construction", "结构", "采用不锈钢与塑料组合结构"),
    ];
    return buildHandoff({
      versions: [{
        ...base,
        confirmedFacts: [
          ...coreFacts,
          ...Object.entries(values).map(([field, value], i) =>
            cnFact(`00000000-0000-4000-8000-00000000002${i}`, field, field, value),
          ),
        ],
      }],
    });
  }

  it("A. 普通中文事实 → english_rendering_pending（不 schema_invalid，也不伪装完整通过）", () => {
    const result = preflightListingClaimSafety({ handoff: cnHandoff() as never, researchRevision: 1 });
    // 精确合同：中文事实尚未英文化 → pending（非 pass，非 blocked，非 schema_invalid）
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reasonCode).toBe("english_rendering_pending");
      expect(result.reason).toContain("英文化");
    }
  });

  it("B. 中文高风险事实 + 充足安全事实 → 不全局 blocked（prohibited 被排除，剩余安全事实仍 pending）", () => {
    // 一条 prohibited + 足够的安全事实（material/capacity/usage/care/construction/operation/included_components）
    const result = preflightListingClaimSafety({
      handoff: cnHandoff({
        functional_feature: "100% 防水，保证永不漏水",
        operation: "一键开合盖子方便取放",
        included_components: "含收纳篮与分隔片",
      }) as never,
      researchRevision: 1,
    });
    // prohibited 单条不得全局阻断：剩余安全事实充足 → pending（中文待英文化），非全局 blocked
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reasonCode).toBe("english_rendering_pending");
      expect(result.reason).toContain("英文化");
    }
  });

  it("B2. 中文高风险事实 + 安全事实不足 → blocked（能力不足，非洗白）", () => {
    // 只有身份 + 材质 + 一条 prohibited 高风险（无足够 verified 核心组）
    const result = preflightListingClaimSafety({
      handoff: cnHandoff({ functional_feature: "100% 防水，保证永不漏水" }, { onlyMinimal: true }) as never,
      researchRevision: 1,
    });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      // 安全事实能力不足 → blocked（不是 pass/pending）
      expect(result.reasonCode).toBe("blocked");
    }
  });

  it("C. 真正英文 unsupported/prohibited 反例继续被拦截（无放宽）", () => {
    const owner = { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" };
    const fact = (factId: string, field: string, value: string) => ({
      factId, field, label: field, value,
      evidenceTier: "human_confirmed",
      usageScopes: ["listing", "internal"],
      sourceRef: { sourceKind: "user_confirmation", sourceField: field, confirmedBy: owner, confirmedAt: "2026-08-05T00:00:00.000Z", confirmationReference: `fact-candidates:${field}` },
      confirmedAt: "2026-08-05T00:00:00.000Z",
      confirmedBy: owner,
    });
    const handoff = buildHandoff({
      versions: [{
        ...buildHandoff().versions[0],
        confirmedFacts: [
          fact("00000000-0000-4000-8000-000000000001", "brand", "TestBrand"),
          fact("00000000-0000-4000-8000-000000000002", "product_type", "Water Bottle"),
          // 英文风险词（guaranteed + 100% 均属 DEFAULT_CANNOT_SAY 词面）——无足够其他安全核心组
          fact("00000000-0000-4000-8000-000000000005", "functional_feature", "Guaranteed to keep water cold for 12 hours"),
        ],
        prohibitedClaims: [{ claimId: "p1", category: "absolute_claim", summary: "Guaranteed", appliesTo: ["both"], source: "system_rule" }],
      }],
    });
    const result = preflightListingClaimSafety({ handoff: handoff as never, researchRevision: 1 });
    // 精确合同：英文 prohibited 排除后安全事实能力不足 → 必须 blocked（不洗白、不 pending、不放宽）
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reasonCode).toBe("blocked");
    }
  });

  it("blocked：handoff 不可用（revoked）→ pass=false + 人话原因", () => {
    const handoff = buildHandoff({ controlState: "revoked", revokedAt: "2026-08-05T01:00:00.000Z", revokeReasonCode: "explicit_user_revoke" });
    const result = preflightListingClaimSafety({ handoff: handoff as never, researchRevision: 1 });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reasonCode).toBe("handoff_revoked");
      expect(result.reason).toContain("已撤回");
    }
  });

  it("blocked：research revision 不匹配 → pass=false", () => {
    const result = preflightListingClaimSafety({ handoff: buildHandoff() as never, researchRevision: 99 });
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.reasonCode).toBe("handoff_stale");
  });

  it("blocked：无任何可 Listing 事实 → pass=false（listing_input_empty）", () => {
    const handoff = buildHandoff({
      versions: [{
        ...buildHandoff().versions[0],
        confirmedFacts: [
          {
            factId: "00000000-0000-4000-8000-000000000006",
            field: "price",
            label: "参考价格 (USD)",
            value: 13.99,
            evidenceTier: "human_confirmed",
            usageScopes: ["internal"], // market 信号：internal-only，不可 Listing
            sourceRef: { sourceKind: "user_confirmation", sourceField: "price", confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" }, confirmedAt: "2026-08-05T00:00:00.000Z", confirmationReference: "fact-candidates:price" },
            confirmedAt: "2026-08-05T00:00:00.000Z",
            confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
          },
        ],
      }],
    });
    const result = preflightListingClaimSafety({ handoff: handoff as never, researchRevision: 1 });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reasonCode).toBe("listing_input_empty");
      expect(result.reason).toContain("没有可用于 Listing 的事实");
    }
  });

  it("同源断言：route canGenerate 并入 preflight；preflight 复用 Generate 同一校验链", () => {
    // route：canGenerate 必须包含 preflight 判定
    expect(routeSource).toContain("preflightListingClaimSafety");
    expect(routeSource).toContain("claimPreflight.pass");
    expect(routeSource).toContain("claimPreflight");
    // route 返回 blockingReasons（人话）给 UI
    expect(routeSource).toContain("claimPreflight.reason");
    // preflight 复用 Generate 阶段 B 的同一确定性校验链
    for (const name of ["buildListingInputFromCreativeHandoff", "buildDeterministicListingPackDraft", "validateAiListingPackDraft", "filterListingClaims", "verifyListingClaims", "listingClaimsHaveEvidence"]) {
      expect(preflightSource).toContain(name);
    }
    // UI 展示阻断原因（不再让用户点击生成后才失败）
    expect(uiSource).toContain("claim-preflight-blocked");
    expect(uiSource).toContain("claimPreflight.reason");
  });
});
