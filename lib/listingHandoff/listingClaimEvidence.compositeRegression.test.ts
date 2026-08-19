/**
 * V3R P1-01 — Composite Claim Provenance Regression（FIRST_DIVERGENCE_POINT 固化）
 *
 * 根因：verifyListingClaims 第 7 步剥离顺序与词边界。
 * - 旧顺序（fragments 先于短值）：长值（included_components "…Digital Kitchen Scale…"）的
 *   单 token 片段（kitchen）拆坏其他原子事实完整值（series_or_model "Food Kitchen"）→
 *   残留碎片误判 unclassified_factual_claim（Etekcity Listing 全链阻断）。
 * - 无 u flag 的 (?<!\p{L}\p{N})：非 u 模式下 \p 是 identity escape，前向词边界失效，
 *   短值 red 可拆坏长值词 covered → "cove" 残留（BrüMate AI 草稿被拒）。
 *
 * 修复：
 * 1. 剥离顺序 = 完整长事实 → 短字段完整值 → fragments（逐字短语残留最后处理）；
 * 2. 剥离正则 = (?<!\p{L}\p{N})value 带 "u" flag（前向词边界真正生效，值后允许字段词后缀，
 *    如 "黑色款"=值+后缀、24 oz容量=值+字段词，均为合法组合）。
 *
 * 原则：多个已确认 Atomic Facts 确定性组合成的 Composite Claim（Title/Bullet），
 * 每个 segment 剥离后可证明完全来自 confirmedFacts（rest 为空或仅字段词/连接词）→ 允许；
 * 无法证明（rest 残留非证据词）→ 该 segment 拒绝（Fail Closed on Claim），不阻塞整个 Listing。
 */
import { describe, expect, it } from "vitest";
import { buildListingInputFromCreativeHandoff } from "@/lib/listingHandoff/listingGenerationInput";
import { buildDeterministicListingPackDraft } from "@/lib/listingHandoff/listingComposition";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";

function handoff(overrides: Record<string, unknown> = {}) {
  const now = "2026-08-20T00:00:00.000Z";
  const owner = { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" };
  const fact = (factId: string, field: string, label: string, value: string | number) => ({
    factId,
    field,
    label,
    value,
    evidenceTier: "human_confirmed",
    usageScopes: ["internal", "listing", "image"],
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
        fact("00000000-0000-4000-8000-000000000001", "brand", "品牌", "Etekcity"),
        fact("00000000-0000-4000-8000-000000000002", "series_or_model", "系列/型号", "Food Kitchen"),
        fact("00000000-0000-4000-8000-000000000003", "capacity", "容量", "11lb"),
        fact("00000000-0000-4000-8000-000000000004", "product_type", "商品类型", "Scale, Digital Weight Grams and Ounces for Weight Loss, Baking, Cooking, Keto and Meal Prep"),
        fact("00000000-0000-4000-8000-000000000005", "material", "材质", "Stainless Steel"),
        fact("00000000-0000-4000-8000-000000000006", "color_or_variant", "颜色/款式", "Stainless Steel"),
        fact("00000000-0000-4000-8000-000000000007", "functional_feature", "功能特性", "Backlit Display"),
        fact("00000000-0000-4000-8000-000000000008", "included_components", "随附组件", "1 x Digital Kitchen Scale; 2 x 1.5V AAA Batteries (Pre-Installed); 1 x QSG"),
        fact("00000000-0000-4000-8000-000000000009", "quantity_or_pack_size", "数量/包装", "1 Count"),
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

async function buildInput(overrides: Record<string, unknown> = {}) {
  const build = buildListingInputFromCreativeHandoff(handoff(overrides) as never, 1);
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error(build.message);
  // 模拟英文渲染成功（全英文事实原样保留；避免测试环境无 AI 时 run-on 字段触发 AI 补标点）
  const englishRenderings = {
    schema: "listing-english-rendering.v1" as const,
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    source: "literal" as const,
    renderings: build.input.productFacts.map((f) => ({
      factId: f.field,
      field: f.field,
      sourceValue: f.value,
      english: f.value,
    })),
  };
  return { ...build.input, englishRenderings };
}

describe("P1-01 Etekcity composite claim（确定性组合可追溯）", () => {
  it("Title = brand+series+capacity+material+product_type+color 全组合 → 通过（无 unclassified_factual_claim）", async () => {
    const input = await buildInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    expect(draft.titles[0]).toContain("Etekcity Food Kitchen 11lb Stainless Steel Scale");
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok).toBe(true);
    const filtered = schema.ok ? filterListingClaims(schema.data, { prohibitedClaims: input.prohibitedClaims, customClaimLabel: "Handoff prohibited claim" }) : null;
    const evidence = filtered ? verifyListingClaims(filtered.cleaned, input) : null;
    expect(evidence).not.toBeNull();
    expect(evidence!.unsupportedClaims).toEqual([]);
    expect(listingClaimsHaveEvidence(evidence!)).toBe(true);
  });

  it("Bullets（functional + included_components 组合）→ 通过", async () => {
    const input = await buildInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    expect(draft.bullets.length).toBeGreaterThan(0);
    const schema = validateAiListingPackDraft(draft);
    const filtered = schema.ok ? filterListingClaims(schema.data, { prohibitedClaims: input.prohibitedClaims, customClaimLabel: "Handoff prohibited claim" }) : null;
    const evidence = filtered ? verifyListingClaims(filtered.cleaned, input) : null;
    expect(evidence!.unsupportedClaims).toEqual([]);
  });

  it("Keywords（facts 组合词，含 product_type 长值）→ 通过", async () => {
    const input = await buildInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    expect(draft.keywords.length).toBeGreaterThan(0);
    const schema = validateAiListingPackDraft(draft);
    const filtered = schema.ok ? filterListingClaims(schema.data, { prohibitedClaims: input.prohibitedClaims, customClaimLabel: "Handoff prohibited claim" }) : null;
    const evidence = filtered ? verifyListingClaims(filtered.cleaned, input) : null;
    expect(evidence!.unsupportedClaims).toEqual([]);
  });
});

describe("P1-01 词边界（u flag）", () => {
  it("短值剥离不误伤同段其他证据值内部（covered 场景由 Etekcity title 覆盖）", async () => {
    // 核心场景已由「Etekcity Title 组合」用例覆盖：material=Stainless Steel 与
    // product_type 长值同段组合时不再产生 cove/kitchen 类残留。
    // 此处验证词边界行为：短值 red 不得剥离 covered 中的 red（前向断言 (?<!\p{L}\p{N})）
    const input = await buildInput();
    const { verifyListingClaims: v } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
    const aiLike = {
      ...input,
      productFacts: [
        ...input.productFacts,
        { field: "color_or_variant", label: "颜色/款式", value: "red" },
      ],
    };
    // 段 "covered red"：covered 无证据（本 input 无 covered 值）→ 整段拒绝是正确行为；
    // 但剥离不得把 red 从 covered 里拆出（若拆出，rest 只剩 covered 残留同样拒绝——无法直接观测）。
    // 直接验证 rest 剥离原语：red 不得匹配 covered 内部。
    const evidence = v({ titles: [], bullets: ["covered red"], description: "", keywords: [], sellingPoints: [], riskNotes: [] } as never, aiLike);
    // 无论拒绝与否，错误信息不得是 "cove " 残片（即 covered 未被 red 拆坏）——covered 整词保留在段中
    for (const u of evidence.unsupportedClaims) {
      expect(u.text).not.toContain("cove ");
      expect(u.text).toContain("covered");
    }
  });
});
