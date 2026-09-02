import { describe, expect, it } from "vitest";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";

function baseInput(overrides: Partial<ListingGenerationInput> = {}): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [
      { field: "weight", label: "重量", value: "500g" },
      { field: "material", label: "材质", value: "ABS" },
      { field: "dimension", label: "尺寸", value: "20cm" },
    ],
    stableSourceFacts: [],
    creativeReferences: ["适合户外风格"],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...overrides,
  };
}

function baseDraft(overrides: Partial<AiListingPackDraft> = {}): AiListingPackDraft {
  return {
    source: "mock_ai_draft",
    version: 1,
    generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock",
    humanReviewRequired: true,
    titles: ["Draft title"],
    bullets: [],
    description: "Draft description.",
    keywords: [],
    sellingPoints: [],
    riskNotes: [],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [],
    ...overrides,
  };
}

/** 规格第六节：数字（weight=500g → 输出 500g 通过；输出 800g 拒绝） */
describe("Claim Evidence Mapping — 数字", () => {
  it("D1. 文本含事实中的数值 → 通过", () => {
    const draft = baseDraft({ bullets: ["重量 500g 便于携带"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
    expect(listingClaimsHaveEvidence(result)).toBe(true);
  });

  it("D2. 文本含事实中不存在的数值 → 拒绝（number_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["重量 800g 便于携带"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_numeric_claim");
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });

  it("D3. 无数字事实时文本发明数字 → 拒绝（number_invented_without_fact）", () => {
    const input = baseInput({ productFacts: [{ field: "productName", label: "商品名", value: "Stand" }] });
    const draft = baseDraft({ bullets: ["仅 9.9 美元"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_numeric_claim");
  });
});

/** 规格第六节：材质（ABS → ABS材质 通过；航空级ABS 拒绝） */
describe("Claim Evidence Mapping — 材质", () => {
  it("M1. 文本含事实材质 → 通过", () => {
    const draft = baseDraft({ bullets: ["ABS 材质外壳"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("M2. 材质被扩写（航空级 ABS）→ 拒绝（unsupported_material）", () => {
    const draft = baseDraft({ bullets: ["航空级 ABS 外壳"] });
    const result = verifyListingClaims(draft, baseInput());
    // "航空级"是材质等级扩写 → unsupported_material_claim
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_material_claim");
  });

  it("M3. 无材质事实时出现材质断言 → 拒绝", () => {
    const input = baseInput({ productFacts: [{ field: "productName", label: "商品名", value: "Stand" }] });
    const draft = baseDraft({ bullets: ["优质金属用料"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_material_claim");
  });
});

/** 规格第六节：尺寸（20cm 通过；超大尺寸 拒绝） */
describe("Claim Evidence Mapping — 尺寸", () => {
  it("S1. 文本含事实尺寸 → 通过", () => {
    const draft = baseDraft({ bullets: ["尺寸 20cm 适合桌面"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("S2. 无证据定性词（超大尺寸）→ 拒绝（unsupported_qualifier）", () => {
    const input = baseInput({ productFacts: [{ field: "productName", label: "商品名", value: "Stand" }] });
    const draft = baseDraft({ bullets: ["超大尺寸设计"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_dimension_claim");
  });
});

/** 规格第六节：认证（无认证事实 → 已认证 拒绝） */
describe("Claim Evidence Mapping — 认证", () => {
  it("C1. 无认证事实输出认证声称 → 拒绝（certification_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["已通过 CE 认证"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_certification_claim");
  });

  it("C2. 有认证事实时输出认证 → 通过（值原样）", () => {
    const input = baseInput({ productFacts: [
      { field: "certification", label: "认证", value: "CE" },
    ] });
    const draft = baseDraft({ bullets: ["CE 认证"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：性能（无性能事实 → 提升50% 拒绝） */
describe("Claim Evidence Mapping — 性能", () => {
  it("P1. 无性能事实输出性能声称 → 拒绝（performance_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["提升 50% 效果"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_performance_claim");
  });

  it("P2. 有性能事实时输出性能值 → 通过（仅值原样，性能修饰词拒绝）", () => {
    const input = baseInput({ productFacts: [
      { field: "performance", label: "性能", value: "50%" },
    ] });
    // 仅值原样 → 通过
    const r1 = verifyListingClaims(baseDraft({ bullets: ["50%"] }), input);
    expect(r1.unsupportedClaims).toEqual([]);
    // 性能修饰词（提升）+ 值 → 拒绝（修饰无依据）
    const r2 = verifyListingClaims(baseDraft({ bullets: ["性能提升 50%"] }), input);
    expect(r2.unsupportedClaims.length).toBeGreaterThan(0);
  });
});

/** 规格第六节：兼容性（无兼容事实 → 兼容iPhone 拒绝） */
describe("Claim Evidence Mapping — 兼容性", () => {
  it("CP1. 无兼容事实输出兼容声称 → 拒绝（compatibility_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["兼容 iPhone 15"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_compatibility_claim");
  });

  it("CP2. 有兼容事实时输出兼容 → 通过（值原样）", () => {
    const input = baseInput({ productFacts: [
      { field: "compatibility", label: "兼容性", value: "iPhone 15" },
    ] });
    const draft = baseDraft({ bullets: ["iPhone 15"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：AI Reference（适合户外风格 → 专为户外设计 拒绝） */
describe("Claim Evidence Mapping — AI Reference", () => {
  it("R1. 参考事实化改写 → 拒绝（ai_reference_factualized）", () => {
    const draft = baseDraft({ bullets: ["专为户外设计"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("ai_reference_fact_claim");
  });

  it("R2. 参考仅用于措辞（非事实化）→ 通过", () => {
    const draft = baseDraft({ titles: ["Draft title"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：Unknown（未知材质 → 输出具体材质 拒绝） */
describe("Claim Evidence Mapping — Unknown", () => {
  it("U1. 未知项被补全 → 拒绝（unknown_completed）", () => {
    const input = baseInput({ unknowns: ["材质待确认"] });
    const draft = baseDraft({ bullets: ["采用不锈钢材质"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toContain("unknown_fact_claim");
  });
});

/** 规格第六节：Conflict（尺寸 A/B → 输出选择 A 拒绝） */
describe("Claim Evidence Mapping — Conflict", () => {
  it("CF1. 冲突项被单方裁定 → 拒绝（conflict_adjudicated）", () => {
    const input = baseInput({ unknowns: ["尺寸 A/B 冲突"] });
    const draft = baseDraft({ bullets: ["采用尺寸 A"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("conflict_fact_claim");
  });

  it("CF2. 冲突项仅提示人工确认（说明性）→ 通过", () => {
    const input = baseInput({ unknowns: ["尺寸 A/B 冲突"] });
    const draft = baseDraft({ bullets: ["尺寸存在冲突，需人工确认"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：文案调整（结构/语气/非事实营销表达允许） */
describe("Claim Evidence Mapping — 文案调整", () => {
  it("W1. 非事实营销表达（结构/语气调整）→ 通过", () => {
    const draft = baseDraft({ bullets: ["简洁现代的设计", "实用之选"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("W2. 说明性文本（草稿未发布/需人工审核）→ 不触发证据检查", () => {
    const draft = baseDraft({ bullets: ["This is a draft for human review only; nothing is certified or approved."] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });
});

describe("R3 confirmed facts 自然组合", () => {
  const brumateInput = baseInput({
    productFacts: [
      { field: "brand", label: "品牌", value: "BrüMate" },
      { field: "series_or_model", label: "系列/型号", value: "Rise" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "capacity", label: "容量", value: "18oz" },
      { field: "material", label: "材质", value: "Silicone" },
      { field: "color_or_variant", label: "颜色/款式", value: "Red" },
      {
        field: "functional_feature",
        label: "功能特性",
        value: "Leakproof SoftSip silicone straw with covered cap",
      },
    ],
  });

  it("多个 confirmed facts 与事实原文短语自然组合 → PASS", () => {
    const result = verifyListingClaims(baseDraft({
      titles: ["BrüMate Rise Water Bottle 18oz with SoftSip Silicone Straw, Red"],
    }), brumateInput);
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("事实组合后追加未确认兼容性 → FAIL", () => {
    const result = verifyListingClaims(baseDraft({
      titles: ["BrüMate Rise Water Bottle 18oz with SoftSip Silicone Straw, Red"],
      bullets: ["Fits most cup holders"],
    }), brumateInput);
    expect(result.unsupportedClaims.some((claim) => claim.reason === "unsupported_compatibility_claim")).toBe(true);
  });

  it("事实组合后追加未确认性能 → FAIL", () => {
    const result = verifyListingClaims(baseDraft({
      titles: ["BrüMate Rise Water Bottle 18oz with SoftSip Silicone Straw, Red"],
      bullets: ["Easy to squeeze with a spill-resistant drinking experience"],
    }), brumateInput);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });
});

/** 纯函数性质 */
describe("Claim Evidence Mapping — 纯函数性质", () => {
  it("PF1. 同输入同输出（确定性）", () => {
    const draft = baseDraft({ bullets: ["重量 800g"] });
    const input = baseInput();
    const a = verifyListingClaims(draft, input);
    const b = verifyListingClaims(draft, input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("PF2. 不修改输入", () => {
    const draft = baseDraft({ bullets: ["重量 800g"] });
    const input = baseInput();
    const draftBefore = JSON.stringify(draft);
    const inputBefore = JSON.stringify(input);
    verifyListingClaims(draft, input);
    expect(JSON.stringify(draft)).toBe(draftBefore);
    expect(JSON.stringify(input)).toBe(inputBefore);
  });
});

/** 规格第六节：prohibitedClaims 原样与同义改写 */
describe("Claim Evidence Mapping — Prohibited Claims", () => {
  it("PR1. 禁止声明原样输出 → 拒绝（prohibited_claim）", () => {
    const input = baseInput({ prohibitedClaims: ["不承诺任何销量"] });
    const draft = baseDraft({ bullets: ["本产品不承诺任何销量表现"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toContain("prohibited_claim");
  });

  it("PR2. 禁止声明同义改写（token 全含但乱序）→ 拒绝（prohibited_claim）", () => {
    // 乱序改写：两个 token 都完整出现但顺序颠倒（不会原样命中整句）
    const input = baseInput({ prohibitedClaims: ["保证盈利，稳赚不赔"] });
    const draft = baseDraft({ bullets: ["稳赚不赔，保证盈利的选择"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toContain("prohibited_claim");
  });
});

/** P1 回归：已确认长文本事实完整原样复述，不得被高风险关键词误杀 */
describe("Claim Evidence Mapping — P1 完整复述放行顺序", () => {
  const SUNSCREEN_FACT = "SPF 30 广谱防晒，防水防汗（80分钟），矿物粉质清爽不油腻，自带粉刷方便补涂。";
  const sunscreenInput = (): ListingGenerationInput => baseInput({
    productFacts: [
      { field: "functional_feature", label: "功能特性", value: SUNSCREEN_FACT },
    ],
  });

  it("P1-1. 本次真实失败回归：functional_feature 完整复述 → supported", () => {
    const draft = baseDraft({ description: `${SUNSCREEN_FACT}` });
    const result = verifyListingClaims(draft, sunscreenInput());
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.supportedClaims.length).toBeGreaterThan(0);
    expect(listingClaimsHaveEvidence(result)).toBe(true);
  });

  it("P1-2. 非法强化（100%防水）仍必须拦截", () => {
    const draft = baseDraft({ bullets: ["100%防水"] });
    const result = verifyListingClaims(draft, sunscreenInput());
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    // 0b 绝对化 fail-closed 先拦截（100% → unsupported_absolute_claim）；
    // 即使绕过绝对化，6 步也会以 unsupported_performance_claim 拦截。两者都是拒绝。
    expect(["unsupported_absolute_claim", "unsupported_performance_claim"]).toContain(result.unsupportedClaims[0].reason);
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });

  it("P1-3. 非法强化（全天候绝对防水）仍必须拦截", () => {
    const draft = baseDraft({ bullets: ["全天候绝对防水"] });
    const result = verifyListingClaims(draft, sunscreenInput());
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });

  it("P1-4. 部分拼接/扩写（防水防汗长达全天）不得误放", () => {
    const input = baseInput({ productFacts: [{ field: "functional_feature", label: "功能特性", value: "防水防汗（80分钟）" }] });
    const draft = baseDraft({ bullets: ["防水防汗长达全天"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });

  it("P1-5. Listing Brief 不构成 Evidence：brief 词附着事实词（非完整复述）→ FAIL", () => {
    // "适合夏日户外"是 brief 营销方向；附着到事实词"防水防汗（80分钟）"后整段
    // 不再等于完整证据值 → 必须拒绝，brief 不得为事实背书。
    const draft = baseDraft({
      bullets: ["防水防汗（80分钟）适合夏日户外"],
    });
    const result = verifyListingClaims(draft, sunscreenInput());
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });

  it("P1-6. brief 词不得扩展完整复述：事实复述 + 追加 brief 强化 → 整段 FAIL", () => {
    // 完整事实复述通过（supported），但一旦追加 brief 强化词"高效防晒"，
    // 整段不再等于证据值 → 6 步 pureModifier 拒绝，brief 不能获得事实权限。
    const draft = baseDraft({
      description: SUNSCREEN_FACT,
      bullets: [`${SUNSCREEN_FACT.replace(/。$/, "，高效防晒。")}`],
    });
    const result = verifyListingClaims(draft, sunscreenInput());
    const exactBullet = result.unsupportedClaims.find((c) => c.text.includes("高效防晒"));
    expect(exactBullet).toBeDefined();
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });
});

import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { validateRuntimeQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";
import { buildListingClaimEvidenceIndex } from "@/lib/listingHandoff/listingClaimEvidenceResolver";

describe("R6 独立证明：Claim Evidence 单独拦截未确认硬属性", () => {
  function naturalInput() {
    return {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [
        { field: "brand", label: "品牌", value: "Owala" },
        { field: "product_type", label: "类型", value: "Water Bottle" },
        { field: "material", label: "材质", value: "Stainless Steel" },
        { field: "capacity", label: "容量", value: "24 oz" },
        { field: "color_or_variant", label: "颜色", value: "Blue" },
        { field: "construction", label: "结构", value: "double-wall vacuum insulation" },
        { field: "functional_feature", label: "功能", value: "straw lid with push-open mechanism" },
      ],
      stableSourceFacts: [],
      creativeReferences: [],
      prohibitedClaims: ["BPA-free"],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
    } as unknown as ListingGenerationInput;
  }
  const GOOD_BULLETS = [
    "The straw lid with push-open mechanism for everyday use.",
    "The double-wall vacuum insulation for easy cleaning with water.",
  ];
  function draftWithBadBullet(): AiListingPackDraft {
    // 仅额外混入一条未确认硬属性：保温 12 小时（数字值无任何已确认证据）
    return {
      schema: "ai-listing-pack.v1",
      version: 1,
      generatedAt: "2026-08-25T00:00:00.000Z",
      source: "mock_ai_draft",
      model: "mock",
      humanReviewRequired: true,
      titles: ["Owala 24 oz Stainless Steel Water Bottle, Blue"],
      bullets: [
        "The straw lid with push-open mechanism for everyday use.",
        "The double-wall vacuum insulation for easy cleaning with water.",
        "The Owala bottle in Blue for everyday use.",
        "The Owala bottle with Stainless Steel for everyday use.",
        "double-wall vacuum insulation keeps cold for 12 hours in the bottle.",
      ],
      description: "The Owala bottle with Stainless Steel and 24 oz for everyday use. The Owala bottle with Blue for easy cleaning with water.",
      keywords: ["Owala", "Water Bottle", "Stainless Steel", "24 oz", "Blue"],
      sellingPoints: ["Stainless Steel material for everyday use."],
      riskNotes: ["请人工复核。"],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: ["请人工核对。"],
    } as unknown as AiListingPackDraft;
  }
  it("四层：Schema 通过；Runtime Quality 通过；filter 不提前删除；仅 verifyListingClaims 单独拒绝「保温 12 小时」", async () => {
    const input = naturalInput();
    const draft = draftWithBadBullet();
    // 1) Schema 通过
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok, JSON.stringify(schema)).toBe(true);
    // 2) Runtime Quality 通过（8-30 词/锚点/描述/去重 全满足）
    const quality = validateRuntimeQualityContract({
      title: draft.titles[0] ?? "",
      bullets: draft.bullets,
      description: draft.description,
      keywords: draft.keywords,
      facts: input.productFacts.map((f) => ({ factId: String((f as { field: string }).field), field: String((f as { field: string }).field), label: String((f as { label: string }).label), value: String((f as { value: string }).value) })),
      usedFactIds: input.productFacts.map((f) => String((f as { field: string }).field)),
    });
    expect(quality.ok, JSON.stringify(quality.issues)).toBe(true);
    // 3) filterListingClaims 不提前删除该句（坏句仍保留在 cleaned 中）
    const filtered = filterListingClaims(draft, {
      prohibitedClaims: input.prohibitedClaims,
      customClaimLabel: "Handoff prohibited claim",
    }).cleaned;
    expect(filtered.bullets.some((b) => b.includes("12 hours"))).toBe(true);
    // 4) verifyListingClaims 单独拒绝该未确认硬属性
    const evidence = verifyListingClaims(draft, input);
    const bad = evidence.unsupportedClaims.find((u) => u.text.includes("12 hours"));
    expect(bad, JSON.stringify(evidence.unsupportedClaims)).toBeDefined();
  });
});

/* ──────────────────────────────────────────────────────────────
 * 自然英文完整句 × Claim Evidence 安全合同
 *
 * 核心命题：中性连接词（is / has / measures / weighs / includes / For care …）
 * 只能在「确切事实值已被剥离之后」的受控语法位置放行；
 * 任何夹带未确认内容词（lid / liner / durable / 12 hours / 认证）的句子必须照旧拒绝。
 * 判定面向句法位置，不面向商品名或完整句字符串。
 * ────────────────────────────────────────────────────────────── */

function ceInput(facts: Array<{ field: string; label: string; value: string }>): ListingGenerationInput {
  return baseInput({ productFacts: facts as ListingGenerationInput["productFacts"] });
}

/** 受控句所需的已确认事实（英文渲染后的值） */
const ORG_CONSTRUCTION = { field: "construction", label: "构造", value: "built with an expandable multi-compartment design in molded plastic" };
const ORG_CAPACITY_STORES = { field: "capacity", label: "容量", value: "stores about 40 to 50 pieces of cutlery" };
const ORG_CAPACITY_OZ = { field: "capacity", label: "容量", value: "24 oz" };
const ORG_DIMENSIONS = { field: "dimensions", label: "尺寸", value: '3.5"L x 3.5"W x 5.3"H' };
const ORG_WEIGHT = { field: "weight", label: "重量", value: "4 ounces" };
const ORG_CARE = { field: "care", label: "保养", value: "rinse with clean water and wipe dry" };
const ORG_TYPE = { field: "product_type", label: "商品类型", value: "Organizer" };
const ORG_MATERIAL = { field: "material", label: "材质", value: "Plastic" };

type CeCase = {
  name: string;
  bullet: string;
  facts: Array<{ field: string; label: string; value: string }>;
  /** true = 必须通过 Claim Evidence；false = 必须被拒 */
  supported: boolean;
  reason?: string;
};

const NATURAL_SENTENCE_CASES: CeCase[] = [
  // ── 正例：事实值确切存在时，受控位置的连接词必须放行 ──
  { name: "P1 分词补语 + 系动词", bullet: "The Organizer is built with an expandable multi-compartment design in molded plastic.", facts: [ORG_TYPE, ORG_CONSTRUCTION], supported: true },
  { name: "P2 三单谓语（值自带谓语）", bullet: "The Organizer stores about 40 to 50 pieces of cutlery.", facts: [ORG_TYPE, ORG_CAPACITY_STORES], supported: true },
  { name: "P3 has a capacity of（名词规格值 + 真实谓语）", bullet: "The Organizer has a capacity of 24 oz.", facts: [ORG_TYPE, ORG_CAPACITY_OZ], supported: true },
  { name: "P4 measures / weighs（尺寸与重量真实谓语）", bullet: 'The Organizer measures 3.5"L x 3.5"W x 5.3"H and weighs 4 ounces.', facts: [ORG_TYPE, ORG_DIMENSIONS, ORG_WEIGHT], supported: true },
  { name: "P5 For care 祈使引导语", bullet: "For care, rinse with clean water and wipe dry.", facts: [ORG_TYPE, ORG_CARE], supported: true },
  // ── 负例：同一句型但无对应事实值 → 照旧拒绝（连接词不是免死金牌）──
  { name: "N1 同 P1 句型但无 construction 事实", bullet: "The Organizer is built with an expandable multi-compartment design in molded plastic.", facts: [ORG_TYPE], supported: false },
  { name: "N2 同 P3 句型但无 capacity 事实", bullet: "The Organizer has a capacity of 24 oz.", facts: [ORG_TYPE], supported: false },
  { name: "N3 同 P5 句型但无 care 事实", bullet: "For care, rinse with clean water and wipe dry.", facts: [ORG_TYPE], supported: false },
  // ── 负例：谓语宾语夹带未确认内容词 ──
  { name: "N4 已确认 Plastic，却追加未确认 lid", bullet: "The Organizer is made of Plastic and includes a lid.", facts: [ORG_TYPE, ORG_MATERIAL], supported: false, reason: "unclassified_factual_claim" },
  { name: "N5 Trash Can：Can 是商品名的一部分，不是谓语", bullet: "The Trash Can with a liner for storage.", facts: [{ field: "product_type", label: "商品类型", value: "Trash Can" }], supported: false },
  { name: "N6 从句中的 is 不得洗白主句残片", bullet: "The Organizer with a lid that is durable.", facts: [ORG_TYPE], supported: false, reason: "unclassified_factual_claim" },
  // ── 负例：数字 / 性能 / 认证 / 绝对承诺 ──
  { name: "N7 虚构数字 + 性能声明", bullet: "The Organizer is made of Plastic and keeps food cold for 12 hours.", facts: [ORG_TYPE, ORG_MATERIAL], supported: false },
  { name: "N8 未确认认证", bullet: "The Organizer is made of Plastic and is FDA approved.", facts: [ORG_TYPE, ORG_MATERIAL], supported: false },
  { name: "N9 未确认组件数量", bullet: "The Organizer includes 3 compartments.", facts: [ORG_TYPE], supported: false },
];

describe("自然英文完整句 × Claim Evidence 安全合同", () => {
  for (const c of NATURAL_SENTENCE_CASES) {
    it((c.supported ? "绿：" : "红：") + c.name, () => {
      const result = verifyListingClaims(
        baseDraft({ bullets: [c.bullet], description: "" }),
        ceInput(c.facts),
      );
      const rejected = result.unsupportedClaims.length > 0;
      if (c.supported) {
        expect(rejected, "自然句被误拒：" + JSON.stringify(result.unsupportedClaims)).toBe(false);
      } else {
        expect(rejected, "未确认内容被放行：" + c.bullet).toBe(true);
        if (c.reason) {
          expect(result.unsupportedClaims.some((u) => u.reason === c.reason), "原因码应为 " + c.reason + "；实际=" + JSON.stringify(result.unsupportedClaims)).toBe(true);
        }
      }
    });
  }

  it("红：禁止声明（prohibited）仍被拦，不因自然句型放行", () => {
    const result = verifyListingClaims(
      baseDraft({ bullets: ["The Organizer is made of Plastic and is leakproof."], description: "" }),
      ceInput([ORG_TYPE, ORG_MATERIAL]),
    );
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("绿：ukeetap 五条精确自然句整体通过 Claim Evidence", () => {
    const result = verifyListingClaims(
      baseDraft({
        bullets: [
          "The Organizer is built with an expandable multi-compartment design in molded plastic.",
          "The Organizer stores about 40 to 50 pieces of cutlery.",
          "The Organizer expands or collapses to the sides according to the drawer width.",
          "The Organizer is suitable for daily kitchen storage and carrying.",
          "For care, rinse with clean water and wipe dry.",
        ],
        description: "",
      }),
      ceInput([
        ORG_TYPE,
        ORG_CONSTRUCTION,
        ORG_CAPACITY_STORES,
        { field: "operation", label: "使用方式", value: "expands or collapses to the sides according to the drawer width" },
        { field: "usage", label: "适用场景", value: "suitable for daily kitchen storage and carrying" },
        ORG_CARE,
      ]),
    );
    expect(result.unsupportedClaims, JSON.stringify(result.unsupportedClaims)).toEqual([]);
  });
});

describe("消费者自然句窄受控语法（body/mechanism/control + from/through/its/as + uses）", () => {
  const F = (pairs: Array<[string, string]>) =>
    pairs.map(([field, value]) => ({ field, label: field, value }));
  const FACT = {
    brand: ["brand", "Acme"] as [string, string],
    type: ["product_type", "Water Bottle"] as [string, string],
    material: ["material", "Plastic"] as [string, string],
    operation: ["operation", "Latch"] as [string, string],
    feature: ["functional_feature", "Push Button"] as [string, string],
  };
  const cases: Array<{ name: string; bullet: string; facts: Array<[string, string]>; supported: boolean; reason?: string }> = [
    { name: "P1 The Water Bottle body is made from plastic.", bullet: "The Water Bottle body is made from plastic.", facts: [FACT.brand, FACT.type, FACT.material, FACT.operation, FACT.feature], supported: true },
    { name: "P2 The Water Bottle opens through its latch mechanism.", bullet: "The Water Bottle opens through its latch mechanism.", facts: [FACT.brand, FACT.type, FACT.operation], supported: true },
    { name: "P3 The Water Bottle uses a push button as a control.", bullet: "The Water Bottle uses a push button as a control.", facts: [FACT.brand, FACT.type, FACT.operation, FACT.feature], supported: true },
    { name: "N1 ...and guarantees durability.", bullet: "The Water Bottle body is made from plastic and guarantees durability.", facts: [FACT.brand, FACT.type, FACT.material], supported: false },
    { name: "N2 ...and never leaks.", bullet: "The Water Bottle opens through its latch mechanism and never leaks.", facts: [FACT.brand, FACT.type, FACT.operation], supported: false },
    { name: "N3 ...for waterproof performance.", bullet: "The Water Bottle uses a push button as a control for waterproof performance.", facts: [FACT.brand, FACT.type, FACT.operation, FACT.feature], supported: false },
    { name: "N4 ...for easy use.", bullet: "The Water Bottle opens through its latch mechanism for easy use.", facts: [FACT.brand, FACT.type, FACT.operation], supported: false },
    { name: "N5 ...and works with every lid.", bullet: "The Water Bottle uses a push button as a control and works with every lid.", facts: [FACT.brand, FACT.type, FACT.operation, FACT.feature], supported: false },
  ];
  for (const c of cases) {
    it((c.supported ? "绿：" : "红：") + c.name, () => {
      const li = ceInput(F(c.facts));
      const result = verifyListingClaims(
        baseDraft({ bullets: [c.bullet], description: "" }),
        li,
      );
      const rejected = result.unsupportedClaims.length > 0;
      if (c.supported) {
        expect(rejected, "自然句被误拒：" + JSON.stringify(result.unsupportedClaims)).toBe(false);
      } else {
        expect(rejected, "未确认内容被放行：" + c.bullet).toBe(true);
      }
    });
  }
});

describe("care 分号子句与 Claim Evidence 兼容（CE-Closure）", () => {
  const CARE_EN = "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent";
  const CARE_ZH = "可用湿布擦拭，必要时使用温水和中性清洁剂清洁";
  const careInput = (extra: Array<{ field: string; label: string; value: string }> = []): ListingGenerationInput => {
    const facts = [
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "care", label: "清洁保养", value: CARE_ZH },
      ...extra,
    ];
    return baseInput({
      productFacts: facts as ListingGenerationInput["productFacts"],
      englishRenderings: {
        schema: "listing-english-rendering.v1",
        renderings: facts.map((f) => ({ factId: f.field, field: f.field, sourceValue: f.value, english: f.field === "care" ? CARE_EN : f.value })),
        generatedAt: "2026-09-02T00:00:00.000Z",
        source: "literal" as const,
      },
    });
  };
  const draftOf = (bullets: string[], description = "d"): AiListingPackDraft =>
    baseDraft({ bullets, description });

  it("CLS1 修前红：care 分号句被 splitSegments 切成两段 → unclassified_factual_claim（降级 safe_fact_draft）", () => {
    // 真实红证据：两段均无完整 evidence 值且含祈使动词 → 拒绝
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent."]),
      careInput(),
    );
    // 修复后：同 factRef 分号子句逐字继承 → 放行
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(true);
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("CLS2 阶段B编辑后同样通过（编辑不改变 factRefs）", () => {
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent."]),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result)).toBe(true);
  });

  it("CLS3 反例：Food Safe / Waterproof / Sturdy / 1 Count 仍失败", () => {
    const result = verifyListingClaims(
      draftOf(["The Organizer is Food Safe and Waterproof and Sturdy and 1 Count."]),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS4 反例：ideal / perfect 无证据词仍失败", () => {
    const result = verifyListingClaims(
      draftOf(["The Organizer is ideal and perfect for you."]),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS5 反例：两个不同事实机械拼接（care 值未完整出现）仍失败", () => {
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; rinse the lid."]),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS6 反例：跨字段借用（care 值只在描述，五点中片段）仍失败", () => {
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth."], "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent."),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS7 反例：care 值完整出现 + 新收益词挂靠事实主体 → 新段仍失败", () => {
    // 纯中性句 "It is ideal for you." 属既有中性通道边界（无事实信号→中性允许，由 Copy Quality 兜底）；
    // 本反例验证：新收益词挂靠事实主体（The Organizer is ideal...）时 CE 必须拒绝（unclassified_factual_claim）。
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent. The Organizer is ideal for you."]),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS8 反例：仅借分号同形但值不同（另一事实）仍失败", () => {
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent. Wipe with a dry cloth."]),
      careInput(),
    );
    // "Wipe with a dry cloth" 无证据 → 拒绝
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS9 反例：去掉 care factRef（无该事实）→ care 句必须失败", () => {
    const noCare = baseInput({
      productFacts: [{ field: "product_type", label: "商品类型", value: "Organizer" }] as ListingGenerationInput["productFacts"],
      englishRenderings: { schema: "listing-english-rendering.v1", renderings: [], generatedAt: "2026-09-02T00:00:00.000Z", source: "literal" as const },
    });
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent."]),
      noCare,
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
    expect(result.unsupportedClaims[0].reason).toBe("unclassified_factual_claim");
  });

  it("CLS10 反例：care 值注入新数值（12 hours）→ 必须失败", () => {
    const bad = baseInput({
      productFacts: [
        { field: "product_type", label: "商品类型", value: "Organizer" },
        { field: "care", label: "清洁保养", value: "可用湿布擦拭，必要时使用温水和中性清洁剂清洁" },
      ] as ListingGenerationInput["productFacts"],
      englishRenderings: {
        schema: "listing-english-rendering.v1",
        renderings: [
          { factId: "product_type", field: "product_type", sourceValue: "Organizer", english: "Organizer" },
          { factId: "care", field: "care", sourceValue: "可用湿布擦拭，必要时使用温水和中性清洁剂清洁", english: "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent. It keeps clean for 12 hours." },
        ],
        generatedAt: "2026-09-02T00:00:00.000Z",
        source: "literal" as const,
      },
    });
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent. It keeps clean for 12 hours."]),
      bad,
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });

  it("CLS11 反例：care 值注入 ideal（挂事实主体）→ 必须失败", () => {
    const result = verifyListingClaims(
      draftOf(["Wipe with a damp cloth; if necessary, clean with warm water and mild detergent. The Organizer is ideal for you."]),
      careInput(),
    );
    expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(false);
  });
});

/* ──────────────────────────────────────────────────────────────
 * 反4 表驱动红测：semicolonSubclauseEvidence 的「逐字等于」安全边界
 *
 * 安全规则（现有实现）：仅当 claim 段精确等于同一已确认事实的某个分号子句
 * （normalize 后逐字相等、子句 ≥3 有效词），且完整事实值原文出现在同字段文本，
 * 才继承该 factRef。
 *
 * 本组矩阵：精确子句必须通过；部分关键词 / 相似句 / 同字段任意句 / 追加词 /
 * 机械拼接必须全部失败。
 * 若把实现放宽为「同字段即继承」或「substring 即继承」，本组负例必须真实变红。
 * ────────────────────────────────────────────────────────────── */

describe("反4：分号子句继承安全边界矩阵（放宽实现必须真实红）", () => {
  const CARE_EN = "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent";
  const CARE_ZH = "可用湿布擦拭，必要时使用温水和中性清洁剂清洁";
  const makeInput = (extra: Array<{ field: string; label: string; value: string }> = []): ListingGenerationInput => {
    const facts = [
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "care", label: "清洁保养", value: CARE_ZH },
      ...extra,
    ];
    return baseInput({
      productFacts: facts as ListingGenerationInput["productFacts"],
      englishRenderings: {
        schema: "listing-english-rendering.v1",
        renderings: facts.map((f) => ({
          factId: f.field,
          field: f.field,
          sourceValue: f.value,
          english: f.field === "care" ? CARE_EN : f.value,
        })),
        generatedAt: "2026-09-02T00:00:00.000Z",
        source: "literal" as const,
      },
    });
  };
  const draftOf = (bullets: string[], description = "d"): AiListingPackDraft =>
    baseDraft({ bullets, description });

  const MATRIX: Array<{ name: string; bullet: string; input: ListingGenerationInput; expectSupported: boolean }> = [
    // ── 正例：字段文本含完整值原文（分号整句）→ 切出的每个子句段逐字继承同一 factRef ──
    { name: "P1 精确子句继承（完整值整句，两子句各自命中）", bullet: "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent.", input: makeInput(), expectSupported: true },
    // ── 负例：跨字段借用（值完整存在于 care 事实，但本字段文本无完整值原文；子句词面不得从别处借）──
    { name: "N8 跨字段借用（本字段仅子句词面，无完整值原文）→ 必须拒绝", bullet: "Wipe with a damp cloth.", input: makeInput(), expectSupported: false },
    // ── 负例：部分关键词（子句的子串但不是整句逐字）──
    { name: "N1 子集词面（缺 mild detergent）→ 必须拒绝", bullet: "If necessary, clean with warm water.", input: makeInput(), expectSupported: false },
    // ── 负例：相似句（换词/换序/加冠词）──
    { name: "N2 相似句（with→using）→ 必须拒绝", bullet: "Wipe using a damp cloth.", input: makeInput(), expectSupported: false },
    { name: "N3 相似句（加 a mild）→ 必须拒绝", bullet: "If necessary, clean with warm water and a mild detergent.", input: makeInput(), expectSupported: false },
    // ── 负例：同字段任意句（字段确有 care 值，但句子不是任何子句）──
    { name: "N4 同字段任意句（care 字段存在但句非子句）→ 必须拒绝", bullet: "Follow all care instructions before first use.", input: makeInput(), expectSupported: false },
    // ── 负例：子句 + 追加内容（超出证据值范围）──
    { name: "N5 精确子句 + 追加词（thoroughly）→ 必须拒绝", bullet: "Wipe with a damp cloth thoroughly.", input: makeInput(), expectSupported: false },
    { name: "N6 第二子句 + 追加收益声明（and it stays fresh）→ 必须拒绝", bullet: "If necessary, clean with warm water and mild detergent and it stays fresh.", input: makeInput(), expectSupported: false },
    // ── 负例：两个事实机械拼接（分号两侧来自不同事实）──
    { name: "N7 机械拼接（care 子句 + 无证据段）→ 必须拒绝", bullet: "Wipe with a damp cloth. The Organizer keeps silverware organized.", input: makeInput(), expectSupported: false },
  ];

  for (const c of MATRIX) {
    it((c.expectSupported ? "绿：" : "红：") + c.name, () => {
      const result = verifyListingClaims(draftOf([c.bullet]), c.input);
      if (c.expectSupported) {
        expect(listingClaimsHaveEvidence(result), JSON.stringify(result.unsupportedClaims)).toBe(true);
        expect(result.unsupportedClaims).toEqual([]);
      } else {
        expect(listingClaimsHaveEvidence(result), "被放宽实现错误放行：" + c.bullet).toBe(false);
        expect(result.unsupportedClaims.length).toBeGreaterThan(0);
      }
    });
  }
});
