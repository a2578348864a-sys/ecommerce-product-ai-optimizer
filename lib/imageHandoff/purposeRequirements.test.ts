import { describe, expect, it } from "vitest";
import {
  REQUIRED_FACT_KIND_SOURCES,
  REQUIRED_FACT_KINDS_BY_PURPOSE,
  evaluatePurposeRequirements,
  hasDimensionEvidence,
  hasPackagingEvidence,
  hasSellingPointEvidence,
  hasUsageEvidence,
  isPurposeFactRequirementSatisfied,
  missingRequiredFactKinds,
  requiredFactKindsForPurpose,
  PURPOSE_SCENE_COMPATIBILITY,
  PURPOSE_REQUIREMENTS,
  type ConfirmedFactLike,
  type RequiredFactKind,
} from "@/lib/imageHandoff/purposeRequirements";

describe("hasPackagingEvidence", () => {
  it("字段白名单命中（quantity_or_pack_size）→ true", () => {
    expect(hasPackagingEvidence([{ field: "quantity_or_pack_size", label: "数量/包装", value: "1 个" }])).toBe(true);
  });

  it("字段白名单命中（packaging）→ true", () => {
    expect(hasPackagingEvidence([{ field: "packaging", label: "包装", value: "礼盒装" }])).toBe(true);
  });

  it("label/value 包装语义关键词命中 → true", () => {
    expect(hasPackagingEvidence([{ field: "brand", label: "品牌", value: "THERMOS 保温杯套装" }])).toBe(true);
    expect(hasPackagingEvidence([{ field: "brand", label: "包装方式", value: "礼盒" }])).toBe(true);
  });

  it("无包装证据（容量/品牌/材质等）→ false", () => {
    const facts = [
      { field: "brand", label: "品牌", value: "THERMOS" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "capacity", label: "容量", value: "12oz" },
      { field: "series_or_model", label: "系列/型号", value: "FUNTAINER Water" },
    ];
    expect(hasPackagingEvidence(facts)).toBe(false);
  });

  it("空事实 → false", () => {
    expect(hasPackagingEvidence([])).toBe(false);
  });
});

describe("evaluatePurposeRequirements", () => {
  it("packaging_bundle 无包装证据 → blocked（image_purpose_requires_packaging_evidence）", () => {
    const result = evaluatePurposeRequirements("packaging_bundle", [
      { field: "brand", label: "品牌", value: "THERMOS" },
      { field: "capacity", label: "容量", value: "12oz" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("image_purpose_requires_packaging_evidence");
      expect(result.message).toContain("包装/套装");
    }
  });

  it("packaging_bundle 有包装证据 → 放行", () => {
    expect(evaluatePurposeRequirements("packaging_bundle", [
      { field: "quantity_or_pack_size", label: "数量/包装", value: "1 个" },
    ]).ok).toBe(true);
  });

  it("white_studio 无证据要求 → 放行", () => {
    expect(evaluatePurposeRequirements("white_studio", []).ok).toBe(true);
  });

  it("custom 无证据要求 → 放行", () => {
    expect(evaluatePurposeRequirements("custom", []).ok).toBe(true);
  });
});

describe("Purpose 需求矩阵与场景兼容性", () => {
  it("矩阵覆盖全部 UI 主用途", () => {
    const purposes = ["white_studio", "selling_point_infographic", "lifestyle_in_use", "dimension_specification", "detail_closeup", "packaging_bundle", "usage_steps", "comparison", "custom"] as const;
    for (const purpose of purposes) {
      expect(PURPOSE_REQUIREMENTS[purpose]).toBeDefined();
    }
  });

  it("white_studio × 生活场景 = CONFLICT（场景必须忽略/禁用）", () => {
    expect(PURPOSE_SCENE_COMPATIBILITY.white_studio.outdoor_travel).toBe("CONFLICT");
    expect(PURPOSE_SCENE_COMPATIBILITY.white_studio.none).toBe("ALLOWED");
  });

  it("lifestyle_in_use 是独立主用途且允许场景辅助", () => {
    expect(PURPOSE_REQUIREMENTS.lifestyle_in_use.requiresEvidence).toBe(false);
    expect(PURPOSE_SCENE_COMPATIBILITY.lifestyle_in_use.home_lifestyle).toBe("ALLOWED");
  });

  it("packaging_bundle × outdoor_travel = ALLOWED（需包装证据）", () => {
    expect(PURPOSE_SCENE_COMPATIBILITY.packaging_bundle.outdoor_travel).toBe("ALLOWED");
  });

  it("detail_closeup × sports_fitness = IGNORED（场景弱辅助，detail 主权）", () => {
    expect(PURPOSE_SCENE_COMPATIBILITY.detail_closeup.sports_fitness).toBe("IGNORED");
  });

  it("dimension_specification 要求尺寸证据（矩阵定义）", () => {
    expect(PURPOSE_REQUIREMENTS.dimension_specification.requiresEvidence).toBe(true);
    expect(PURPOSE_REQUIREMENTS.dimension_specification.blockedCode).toBe("image_purpose_requires_dimensions");
  });
});

// ── V3 Evidence Gates Final Closure：尺寸/使用/卖点证据判定 ──────────────────

const THERMOS_IDENTITY_FACTS = [
  { field: "brand", label: "品牌", value: "THERMOS" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "series_or_model", label: "系列/型号", value: "FUNTAINER Water" },
  { field: "capacity", label: "容量", value: "12oz" },
  { field: "category", label: "类目", value: "Kitchen & Dining" },
];

describe("hasDimensionEvidence（尺寸证据；容量≠尺寸）", () => {
  it("Fixture A：width+height 字段 → true", () => {
    expect(hasDimensionEvidence([
      { field: "width", label: "宽度", value: "3.24 in" },
      { field: "height", label: "高度", value: "10.68 in" },
    ])).toBe(true);
  });

  it("带单位的尺寸文本（3.24\"W × 10.68\"H）→ true", () => {
    expect(hasDimensionEvidence([{ field: "brand", label: "尺寸", value: "3.24\"W × 10.68\"H" }])).toBe(true);
  });

  it("Fixture B：只有 capacity=24oz 无真实尺寸 → false（容量≠尺寸）", () => {
    expect(hasDimensionEvidence([{ field: "capacity", label: "容量", value: "24 oz" }])).toBe(false);
  });

  it("identity 事实（品牌/类型/容量）无尺寸 → false", () => {
    expect(hasDimensionEvidence(THERMOS_IDENTITY_FACTS)).toBe(false);
  });

  it("尺寸字段但值为空 → false", () => {
    expect(hasDimensionEvidence([{ field: "width", label: "宽度", value: "" }])).toBe(false);
  });
});

describe("hasUsageEvidence（使用方式证据；视觉推断不升级）", () => {
  it("Fixture C：usage_steps 字段 → true", () => {
    expect(hasUsageEvidence([{ field: "usage_steps", label: "使用步骤", value: "1. 打开杯盖 2. 按压吸管" }])).toBe(true);
  });

  it("使用方式语义（清洗方式）→ true", () => {
    expect(hasUsageEvidence([{ field: "brand", label: "清洗方式", value: "可手洗或机洗" }])).toBe(true);
  });

  it("Fixture D：只有视觉参考/身份事实 → false（看到按钮/吸管不算使用步骤）", () => {
    expect(hasUsageEvidence(THERMOS_IDENTITY_FACTS)).toBe(false);
    expect(hasUsageEvidence([{ field: "brand", label: "参考图可见", value: "带吸管和按钮" }])).toBe(false);
  });

  it("Fixture I：参考图视觉推断（有按钮/吸管）不构成 usage evidence", () => {
    const visualInference = [{ field: "brand", label: "参考图外观", value: "杯盖上有按钮与吸管结构" }];
    expect(hasUsageEvidence(visualInference)).toBe(false);
  });
});

describe("hasSellingPointEvidence（卖点证据；identity 不算）", () => {
  it("Fixture E：material=Stainless Steel → true", () => {
    expect(hasSellingPointEvidence([{ field: "material", label: "材质", value: "Stainless Steel" }])).toBe(true);
  });

  it("保温/防漏等语义（confirmed fact 非黑名单字段）→ true", () => {
    expect(hasSellingPointEvidence([{ field: "product_note", label: "保温特性", value: "双层真空保温" }])).toBe(true);
    expect(hasSellingPointEvidence([{ field: "features", label: "特性", value: "leakproof" }])).toBe(true);
  });

  it("Fixture F：只有 brand/title/product_type/capacity → false", () => {
    expect(hasSellingPointEvidence(THERMOS_IDENTITY_FACTS)).toBe(false);
  });

  it("Fixture G：VOC 说 keeps cold for 24 hours 但 confirmed 无此 claim → false（VOC 不升级）", () => {
    expect(hasSellingPointEvidence(THERMOS_IDENTITY_FACTS)).toBe(false);
  });

  it("Fixture H：AI Summary 说 Leakproof 但 confirmed 无 → false（AI Summary 不升级）", () => {
    const facts = [...THERMOS_IDENTITY_FACTS, { field: "ai_reference", label: "AI 摘要", value: "Leakproof" }];
    // ai_reference 不在卖点字段白名单，value "Leakproof" 命中语义 → 需排除非权威字段
    expect(hasSellingPointEvidence(facts)).toBe(false);
  });
});

describe("evaluatePurposeRequirements 三个 gate（服务端 fail-closed）", () => {
  it("SIZE_SPEC 无尺寸 → 409 image_purpose_requires_dimensions", () => {
    const result = evaluatePurposeRequirements("dimension_specification", THERMOS_IDENTITY_FACTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("image_purpose_requires_dimensions");
      expect(result.message).toContain("尺寸");
    }
  });

  it("SIZE_SPEC 有尺寸 → 放行", () => {
    expect(evaluatePurposeRequirements("dimension_specification", [
      { field: "width", label: "宽度", value: "3.24 in" },
      { field: "height", label: "高度", value: "10.68 in" },
    ]).ok).toBe(true);
  });

  it("USAGE_STEPS 无使用方式 → 409 image_purpose_requires_usage_facts", () => {
    const result = evaluatePurposeRequirements("usage_steps", THERMOS_IDENTITY_FACTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("image_purpose_requires_usage_facts");
      expect(result.message).toContain("使用方式");
    }
  });

  it("USAGE_STEPS 有使用方式 → 放行", () => {
    expect(evaluatePurposeRequirements("usage_steps", [
      { field: "usage_steps", label: "使用步骤", value: "打开杯盖即可饮用" },
    ]).ok).toBe(true);
  });

  it("INFOGRAPHIC 无卖点 → 409 image_purpose_requires_confirmed_claims", () => {
    const result = evaluatePurposeRequirements("selling_point_infographic", THERMOS_IDENTITY_FACTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("image_purpose_requires_confirmed_claims");
      expect(result.message).toContain("卖点");
    }
  });

  it("INFOGRAPHIC 有卖点 → 放行", () => {
    expect(evaluatePurposeRequirements("selling_point_infographic", [
      { field: "material", label: "材质", value: "Stainless Steel" },
    ]).ok).toBe(true);
  });

  it("scene 不绕过 gate（SIZE_SPEC+OUTDOOR 仍需尺寸）", () => {
    expect(evaluatePurposeRequirements("dimension_specification", THERMOS_IDENTITY_FACTS).ok).toBe(false);
  });
});

// ── 本轮新增：用途 → 事实种类同源映射（requiredFactKindsForPurpose / missingRequiredFactKinds）──

const ALL_PURPOSES = [
  "white_studio",
  "selling_point_infographic",
  "dimension_specification",
  "detail_closeup",
  "packaging_bundle",
  "usage_steps",
  "comparison",
  "custom",
] as const;

const FACT_SAMPLES: Array<{ name: string; facts: ConfirmedFactLike[] }> = [
  { name: "空事实", facts: [] },
  { name: "身份事实", facts: THERMOS_IDENTITY_FACTS },
  { name: "尺寸事实", facts: [{ field: "width", label: "宽度", value: "3.24 in" }] },
  { name: "容量事实（≠尺寸）", facts: [{ field: "capacity", label: "容量", value: "24 oz" }] },
  { name: "卖点事实", facts: [{ field: "material", label: "材质", value: "Stainless Steel" }] },
  { name: "包装事实", facts: [{ field: "quantity_or_pack_size", label: "数量/包装", value: "1 个" }] },
  { name: "使用方式事实", facts: [{ field: "usage_steps", label: "使用步骤", value: "打开杯盖即可饮用" }] },
  {
    name: "非权威来源（AI/VOC）",
    facts: [
      { field: "ai_reference", label: "AI 摘要", value: "Leakproof, 24oz, 礼盒装" },
      { field: "voc", label: "VOC", value: "尺寸偏小，包装精美" },
    ],
  },
  {
    name: "事实齐全",
    facts: [
      { field: "dimensions", label: "尺寸", value: "3.5\"L x 3.5\"W x 5.3\"H" },
      { field: "material", label: "材质", value: "Ceramic" },
      { field: "packaging", label: "包装", value: "Box of 4" },
      { field: "usage_steps", label: "使用步骤", value: "1. 打开杯盖 2. 按压吸管" },
    ],
  },
];

describe("用途 → 事实种类映射（与既有 evidence 判定同源，不新增第二套规则）", () => {
  it("只有既有需求矩阵声明 requiresEvidence 的用途才要求事实种类（不新增、不放宽门禁）", () => {
    for (const purpose of ALL_PURPOSES) {
      expect(
        requiredFactKindsForPurpose(purpose).length > 0,
        `用途 ${purpose} 的事实要求必须与 PURPOSE_REQUIREMENTS.requiresEvidence 一致`,
      ).toBe(PURPOSE_REQUIREMENTS[purpose].requiresEvidence);
      expect(REQUIRED_FACT_KINDS_BY_PURPOSE[purpose]).toBeDefined();
    }
  });

  it("每个事实种类都直接指向既有 evidence 判定函数（函数身份一致，而不是复制品）", () => {
    expect(REQUIRED_FACT_KIND_SOURCES.selling_point_fact.evidence).toBe(hasSellingPointEvidence);
    expect(REQUIRED_FACT_KIND_SOURCES.dimension_fact.evidence).toBe(hasDimensionEvidence);
    expect(REQUIRED_FACT_KIND_SOURCES.packaging_fact.evidence).toBe(hasPackagingEvidence);
    expect(REQUIRED_FACT_KIND_SOURCES.usage_fact.evidence).toBe(hasUsageEvidence);

    expect(REQUIRED_FACT_KIND_SOURCES.selling_point_fact.purpose).toBe("selling_point_infographic");
    expect(REQUIRED_FACT_KIND_SOURCES.dimension_fact.purpose).toBe("dimension_specification");
    expect(REQUIRED_FACT_KIND_SOURCES.packaging_fact.purpose).toBe("packaging_bundle");
    expect(REQUIRED_FACT_KIND_SOURCES.usage_fact.purpose).toBe("usage_steps");
  });

  it("缺失事实种类与 evaluatePurposeRequirements 的判定在全部用途 × 事实样本上完全一致", () => {
    let checked = 0;
    for (const purpose of ALL_PURPOSES) {
      for (const sample of FACT_SAMPLES) {
        const satisfied = isPurposeFactRequirementSatisfied(purpose, sample.facts);
        const gate = evaluatePurposeRequirements(purpose, sample.facts);
        expect(
          satisfied,
          `用途 ${purpose} × ${sample.name}：事实种类判定必须与服务端门禁一致`,
        ).toBe(gate.ok);
        expect(missingRequiredFactKinds(purpose, sample.facts).length === 0).toBe(gate.ok);
        checked += 1;
      }
    }
    expect(checked).toBe(ALL_PURPOSES.length * FACT_SAMPLES.length);
  });

  it("缺尺寸事实 → dimension_specification 侧不能宣布满足（容量 ≠ 尺寸）", () => {
    expect([...requiredFactKindsForPurpose("dimension_specification")]).toEqual(["dimension_fact"]);
    expect(missingRequiredFactKinds("dimension_specification", THERMOS_IDENTITY_FACTS)).toEqual(["dimension_fact"]);
    expect(missingRequiredFactKinds("dimension_specification", [{ field: "capacity", label: "容量", value: "24 oz" }]))
      .toEqual(["dimension_fact"]);
    expect(isPurposeFactRequirementSatisfied("dimension_specification", [{ field: "capacity", label: "容量", value: "24 oz" }])).toBe(false);

    expect(missingRequiredFactKinds("dimension_specification", [{ field: "width", label: "宽度", value: "3.24 in" }])).toEqual([]);
    expect(isPurposeFactRequirementSatisfied("dimension_specification", [{ field: "width", label: "宽度", value: "3.24 in" }])).toBe(true);
  });

  it("无事实门禁的用途（白底/特写/对比/自定义）不要求任何事实种类", () => {
    for (const purpose of ["white_studio", "detail_closeup", "comparison", "custom"] as const) {
      expect([...requiredFactKindsForPurpose(purpose)]).toEqual([]);
      expect(missingRequiredFactKinds(purpose, [])).toEqual([]);
      expect(isPurposeFactRequirementSatisfied(purpose, [])).toBe(true);
      expect(evaluatePurposeRequirements(purpose, []).ok).toBe(true);
    }
  });

  it("非权威来源（AI 摘要 / VOC）不得满足任何事实种类", () => {
    const nonAuthoritative: ConfirmedFactLike[] = [
      { field: "ai_reference", label: "AI 摘要", value: "Leakproof, 24oz, 礼盒装, 3.24 in" },
      { field: "voc", label: "VOC", value: "尺寸偏小，包装精美" },
    ];
    const kinds: RequiredFactKind[] = ["selling_point_fact", "dimension_fact", "packaging_fact", "usage_fact"];
    for (const kind of kinds) {
      expect(REQUIRED_FACT_KIND_SOURCES[kind].evidence(nonAuthoritative), `${kind} 不得由非权威来源满足`).toBe(false);
    }
    for (const purpose of ALL_PURPOSES) {
      expect(isPurposeFactRequirementSatisfied(purpose, nonAuthoritative)).toBe(evaluatePurposeRequirements(purpose, nonAuthoritative).ok);
    }
  });
});
