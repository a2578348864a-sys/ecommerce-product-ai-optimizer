import { describe, expect, it } from "vitest";
import { buildVisualAssetPlan } from "./visualAssetPlan";
import {
  REQUIRED_FACT_KIND_SOURCES,
  evaluatePurposeRequirements,
  isPurposeFactRequirementSatisfied,
  missingRequiredFactKinds,
  requiredFactKindsForPurpose,
  type ConfirmedFactLike,
  type RequiredFactKind,
} from "@/lib/imageHandoff/purposeRequirements";
import { SLOT_PROMPT_RECIPES, resolveSlotRecipe } from "@/lib/imageHandoff/slotPromptRecipes";

describe("buildVisualAssetPlan", () => {
  it("无参考图且无事实时，整体为 concept，白底主图与特写图 blocked", () => {
    const plan = buildVisualAssetPlan({
      hasApprovedVisualReference: false,
      confirmedFacts: [],
    });

    expect(plan.version).toBe("visual-asset-plan.v1");
    expect(plan.overallLevel).toBe("concept");
    expect(plan.hasApprovedReference).toBe(false);

    const mainSlot = plan.slots.find((s) => s.slotId === "slot-main");
    expect(mainSlot?.readiness).toBe("blocked_needs_visual_reference");

    const dimSlot = plan.slots.find((s) => s.slotId === "slot-dimension-specs");
    expect(dimSlot?.readiness).toBe("blocked_needs_facts");

    const lifeSlot = plan.slots.find((s) => s.slotId === "slot-lifestyle-scene");
    expect(lifeSlot?.readiness).toBe("ready");
  });

  it("有参考图且有尺寸事实时，尺寸图与主图变为 ready", () => {
    const plan = buildVisualAssetPlan({
      hasApprovedVisualReference: true,
      confirmedFacts: [
        { field: "dimensions", label: "尺寸", value: "3.5\"L x 3.5\"W x 5.3\"H" },
        { field: "material", label: "材质", value: "Stainless Steel" },
        { field: "functional_feature", label: "功能", value: "Vacuum Insulated" },
      ],
    });

    expect(plan.hasApprovedReference).toBe(true);

    const mainSlot = plan.slots.find((s) => s.slotId === "slot-main");
    expect(mainSlot?.readiness).toBe("ready");

    const dimSlot = plan.slots.find((s) => s.slotId === "slot-dimension-specs");
    expect(dimSlot?.readiness).toBe("ready");

    const sellSlot = plan.slots.find((s) => s.slotId === "slot-selling-points");
    expect(sellSlot?.readiness).toBe("ready");

    const detailSlot = plan.slots.find((s) => s.slotId === "slot-detail-closeup");
    expect(detailSlot?.readiness).toBe("ready");

    // 缺少包装事实
    const packSlot = plan.slots.find((s) => s.slotId === "slot-packaging-bundle");
    expect(packSlot?.readiness).toBe("blocked_needs_facts");
  });

  it("事实齐全时触发全部可用槽位与 final 分级", () => {
    const plan = buildVisualAssetPlan({
      hasApprovedVisualReference: true,
      confirmedFacts: [
        { field: "dimensions", label: "尺寸", value: "10 x 5 x 2 cm" },
        { field: "material", label: "材质", value: "Ceramic" },
        { field: "functional_feature", label: "功能", value: "Microwave Safe" },
        { field: "packaging", label: "包装", value: "Box of 4" },
        { field: "operation", label: "使用方式", value: "Push button to open" },
      ],
    });

    expect(plan.overallLevel).toBe("final");
    expect(plan.readyCount).toBe(7);
    expect(plan.totalCount).toBe(7);

    const usageSlot = plan.slots.find((s) => s.slotId === "slot-usage-steps");
    expect(usageSlot).toBeDefined();
    expect(usageSlot?.readiness).toBe("ready");
  });
});

// ── 前后端事实判定同源：visualAssetPlan(readiness) ⇔ purposeRequirements(gate) ⇔ recipe.requiredFactKinds ──

const IDENTITY_ONLY_FACTS: ConfirmedFactLike[] = [
  { field: "brand", label: "品牌", value: "THERMOS" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "capacity", label: "容量", value: "24 oz" },
];

const FACT_SCENARIOS: Array<{ name: string; facts: ConfirmedFactLike[] }> = [
  { name: "无事实", facts: [] },
  { name: "仅身份事实（品牌/类型/容量）", facts: IDENTITY_ONLY_FACTS },
  { name: "仅尺寸事实", facts: [{ field: "dimensions", label: "尺寸", value: "3.5\"L x 3.5\"W x 5.3\"H" }] },
  { name: "仅卖点事实", facts: [{ field: "material", label: "材质", value: "Stainless Steel" }] },
  { name: "仅包装事实", facts: [{ field: "packaging", label: "包装", value: "Box of 4" }] },
  { name: "仅使用方式事实", facts: [{ field: "usage_steps", label: "使用步骤", value: "1. 打开杯盖 2. 按压吸管" }] },
  {
    name: "事实齐全",
    facts: [
      { field: "dimensions", label: "尺寸", value: "10 x 5 x 2 cm" },
      { field: "material", label: "材质", value: "Ceramic" },
      { field: "packaging", label: "包装", value: "Box of 4" },
      { field: "operation", label: "使用方式", value: "Push button to open" },
    ],
  },
];

/** 规划槽位 → 该槽位实际会使用的配方（与 VisualAssetPlanCard / ImageHandoffSection 的解析方式一致） */
function recipeForSlot(slot: { slotType: string; suggestedPurpose: string; suggestedScene: string; suggestedStylePresetId: string }) {
  return resolveSlotRecipe({
    slotType: slot.slotType,
    primaryPurpose: slot.suggestedPurpose,
    lifestyleScene: slot.suggestedScene,
    stylePresetId: slot.suggestedStylePresetId,
  });
}

/** 用既有 evidence 判定函数检查配方声明的事实种类是否已被当前事实满足 */
function unsatisfiedFactKinds(kinds: readonly RequiredFactKind[], facts: ConfirmedFactLike[]): RequiredFactKind[] {
  return kinds.filter((kind) => !REQUIRED_FACT_KIND_SOURCES[kind].evidence(facts));
}

describe("visualAssetPlan 与 purposeRequirements 事实判定同源", () => {
  for (const scenario of FACT_SCENARIOS) {
    it(`[${scenario.name}] 槽位 blocked_needs_facts ⇔ 该槽位配方 requiredFactKinds 未满足（双向）`, () => {
      for (const hasApprovedVisualReference of [false, true]) {
        const plan = buildVisualAssetPlan({ confirmedFacts: scenario.facts, hasApprovedVisualReference });
        for (const slot of plan.slots) {
          const recipe = recipeForSlot(slot);
          const unsatisfied = unsatisfiedFactKinds(recipe.requiredFactKinds, scenario.facts);
          expect(
            slot.readiness === "blocked_needs_facts",
            `槽位 ${slot.slotId}（参考图=${hasApprovedVisualReference}）规划结论与配方事实依赖必须一致`,
          ).toBe(unsatisfied.length > 0);
        }
      }
    });

    it(`[${scenario.name}] 事实门禁槽位的 readiness 与 evaluatePurposeRequirements 完全一致`, () => {
      const plan = buildVisualAssetPlan({ confirmedFacts: scenario.facts, hasApprovedVisualReference: false });
      for (const slot of plan.slots) {
        const recipe = recipeForSlot(slot);
        if (recipe.requiredFactKinds.length === 0) continue; // 无事实依赖的槽位不参与门禁等价断言
        expect(
          slot.readiness === "blocked_needs_facts",
          `槽位 ${slot.slotId}（用途 ${slot.suggestedPurpose}）规划结论必须与服务端门禁一致`,
        ).toBe(!evaluatePurposeRequirements(slot.suggestedPurpose, scenario.facts).ok);
      }
    });

    it(`[${scenario.name}] requiredFactKinds 非空的槽位等于 purposeRequirements 对该用途的派生结果`, () => {
      const plan = buildVisualAssetPlan({ confirmedFacts: scenario.facts, hasApprovedVisualReference: false });
      for (const slot of plan.slots) {
        const recipe = recipeForSlot(slot);
        if (recipe.requiredFactKinds.length === 0) continue;
        expect(
          [...recipe.requiredFactKinds],
          `槽位 ${slot.slotId} 的事实种类必须直接派生自 purposeRequirements`,
        ).toEqual([...requiredFactKindsForPurpose(slot.suggestedPurpose)]);
      }
    });
  }

  it("缺尺寸事实：dimension_specs 槽位在规划侧与服务端门禁侧都必须 blocked（两侧都不宣布满足）", () => {
    const plan = buildVisualAssetPlan({ confirmedFacts: IDENTITY_ONLY_FACTS, hasApprovedVisualReference: true });
    const dimSlot = plan.slots.find((s) => s.slotType === "dimension_specs");
    expect(dimSlot).toBeDefined();
    expect(dimSlot?.readiness).toBe("blocked_needs_facts");

    expect([...SLOT_PROMPT_RECIPES.dimension_specs.requiredFactKinds]).toEqual(["dimension_fact"]);
    expect(unsatisfiedFactKinds(SLOT_PROMPT_RECIPES.dimension_specs.requiredFactKinds, IDENTITY_ONLY_FACTS)).toEqual(["dimension_fact"]);
    expect(missingRequiredFactKinds("dimension_specification", IDENTITY_ONLY_FACTS)).toEqual(["dimension_fact"]);
    expect(isPurposeFactRequirementSatisfied("dimension_specification", IDENTITY_ONLY_FACTS)).toBe(false);

    const gate = evaluatePurposeRequirements("dimension_specification", IDENTITY_ONLY_FACTS);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe("image_purpose_requires_dimensions");
    }

    // 容量（24oz）不算尺寸：两侧都不得因为容量而放行
    expect(missingRequiredFactKinds("dimension_specification", [{ field: "capacity", label: "容量", value: "24 oz" }]))
      .toEqual(["dimension_fact"]);
  });

  it("补齐尺寸事实：规划侧与服务端门禁侧同时放行（同源、同结论）", () => {
    const withDimensions: ConfirmedFactLike[] = [{ field: "width", label: "宽度", value: "3.24 in" }];
    const plan = buildVisualAssetPlan({ confirmedFacts: withDimensions, hasApprovedVisualReference: true });
    const dimSlot = plan.slots.find((s) => s.slotType === "dimension_specs");
    expect(dimSlot?.readiness).toBe("ready");
    expect(unsatisfiedFactKinds(SLOT_PROMPT_RECIPES.dimension_specs.requiredFactKinds, withDimensions)).toEqual([]);
    expect(isPurposeFactRequirementSatisfied("dimension_specification", withDimensions)).toBe(true);
    expect(evaluatePurposeRequirements("dimension_specification", withDimensions).ok).toBe(true);
  });

  it("无事实依赖的槽位（白底主图/细节特写/生活场景）requiredFactKinds 为空，不被事实门禁宣称满足", () => {
    for (const id of ["main_white_studio", "detail_closeup", "lifestyle_in_use"] as const) {
      expect([...SLOT_PROMPT_RECIPES[id].requiredFactKinds]).toEqual([]);
    }

    // 生活场景槽位在既有规划中是构图概念探索槽位（readiness 恒为 ready，不读取任何 has*Evidence 结果）：
    // 这是既有行为，本轮不改动，因此它的 requiredFactKinds 也保持为空，避免凭空宣布或收紧事实门禁。
    for (const scenario of FACT_SCENARIOS) {
      const plan = buildVisualAssetPlan({ confirmedFacts: scenario.facts, hasApprovedVisualReference: false });
      for (const slotType of ["main_white_studio", "detail_closeup", "lifestyle_in_use"] as const) {
        const slot = plan.slots.find((s) => s.slotType === slotType);
        expect(slot?.readiness, `${slotType} 无事实依赖，不应被事实门禁阻止`).not.toBe("blocked_needs_facts");
      }
    }
  });
});
