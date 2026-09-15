import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SLOT_PROMPT_RECIPES,
  deriveSlotRecipeVersion,
  formatSlotRecipeBlock,
  resolveSlotRecipe,
  type ResolveSlotRecipeInput,
  type SlotPromptRecipe,
  type SlotPromptRecipeContent,
  type SlotPromptRecipeId,
} from "@/lib/imageHandoff/slotPromptRecipes";
import {
  REQUIRED_FACT_KIND_SOURCES,
  hasDimensionEvidence,
  hasPackagingEvidence,
  hasSellingPointEvidence,
  hasUsageEvidence,
  requiredFactKindsForPurpose,
} from "@/lib/imageHandoff/purposeRequirements";
import { findImageStyleFactLeak } from "@/lib/imageStyleLibrary";

describe("Slot Prompt Recipes Specification", () => {
  const allRecipeIds: SlotPromptRecipeId[] = [
    "main_white_studio",
    "selling_points",
    "dimension_specs",
    "detail_closeup",
    "lifestyle_in_use",
    "packaging_bundle",
    "usage_steps",
  ];

  it("覆盖全部 7 个核心视觉槽位，且字段完备", () => {
    for (const id of allRecipeIds) {
      const recipe = SLOT_PROMPT_RECIPES[id];
      expect(recipe).toBeDefined();
      expect(recipe.id).toBe(id);
      expect(recipe.name).toBeTruthy();
      expect(recipe.businessGoal).toBeTruthy();
      expect(recipe.composition).toBeTruthy();
      expect(recipe.cameraLanguage).toBeTruthy();
      expect(recipe.lighting).toBeTruthy();
      expect(recipe.environment).toBeTruthy();
      expect(recipe.textPolicy).toBeTruthy();
      expect(recipe.negativeConstraints.length).toBeGreaterThan(0);
      expect(recipe.templateId).toBe(id);
      expect(recipe.description).toBeTruthy();
      expect(recipe.objective).toBe(recipe.businessGoal);
      expect(recipe.promptTemplate).toContain(recipe.composition);
      expect(recipe.mustKeepRules).toEqual(expect.arrayContaining([
        "Preserve the exact product structure shown in the approved reference image.",
        "Do not add accessories, components or units that are not confirmed.",
      ]));
      expect(recipe.forbiddenRules).toEqual(recipe.negativeConstraints);
    }
  });

  it("统一模板合同使用七个唯一 templateId，且每个模板都会改变实际 Prompt 配方", () => {
    const recipes = allRecipeIds.map((id) => SLOT_PROMPT_RECIPES[id]);
    expect(new Set(recipes.map((recipe) => recipe.templateId)).size).toBe(7);
    expect(new Set(recipes.map((recipe) => recipe.promptTemplate)).size).toBe(7);
    for (const recipe of recipes) {
      const block = formatSlotRecipeBlock(recipe);
      expect(block).toContain(`Template ID: ${recipe.templateId}`);
      expect(block).toContain("Must Keep Rules:");
      expect(block).toContain("Forbidden Rules:");
    }
  });

  it("Slot 2 (核心卖点图) 与 Slot 3 (尺寸规格图) 明确要求排版留白，Slot 3 引入真实感知参照物且严禁直接绘制文字与假标尺", () => {
    const slot2 = SLOT_PROMPT_RECIPES.selling_points;
    expect(slot2.textPolicy).toContain("RESERVED LAYOUT SPACE");
    expect(slot2.textPolicy).toContain("Do NOT generate simulated text");
    expect(slot2.composition).toContain("negative space reserved");

    const slot3 = SLOT_PROMPT_RECIPES.dimension_specs;
    expect(slot3.textPolicy).toContain("CLEAN SCALE TEMPLATE");
    expect(slot3.textPolicy).toContain("Do NOT render dimension numbers");
    expect(slot3.textPolicy).toContain("ready for vector overlays");
    expect(slot3.composition).toContain("recognized, standard everyday physical object");
    expect(slot3.composition).toContain("standard smartphone");
    expect(slot3.negativeConstraints).toContain("no plain isolated product on blank white background without scale reference context");
  });

  it("Slot 7 (使用步骤与操作指引) 明确要求分步流程、留白标注区域与手部安全负面规则，绝不退化为白底主图", () => {
    const slot7 = SLOT_PROMPT_RECIPES.usage_steps;
    expect(slot7).toBeDefined();
    expect(slot7.id).toBe("usage_steps");
    expect(slot7.textPolicy).toContain("RESERVED STEP CAPTIONS");
    expect(slot7.textPolicy).toContain("Do NOT generate simulated numbers, text, arrows or icons");
    expect(slot7.composition).toContain("Multi-step sequential layout");
    expect(slot7.negativeConstraints.some((c) => c.includes("human hands"))).toBe(true);
    expect(slot7.negativeConstraints.some((c) => c.includes("single-step plain product photo"))).toBe(true);
  });

  it("Slot 1 (白底合规主图) 严格约束 RGB 255 纯白底与接触阴影", () => {
    const slot1 = SLOT_PROMPT_RECIPES.main_white_studio;
    expect(slot1.environment).toContain("RGB 255, 255, 255");
    expect(slot1.composition).toContain("contact shadow");
    expect(slot1.composition).toContain("85%");
  });

  it("resolveSlotRecipe 能够根据 slotType 或意图组合确定性解析", () => {
    // 1. slotType 优先
    expect(resolveSlotRecipe({ slotType: "main_white_studio" }).id).toBe("main_white_studio");
    expect(resolveSlotRecipe({ slotType: "slot-dimension-specs" }).id).toBe("dimension_specs");
    expect(resolveSlotRecipe({ slotType: "selling_points" }).id).toBe("selling_points");
    expect(resolveSlotRecipe({ slotType: "detail_closeup" }).id).toBe("detail_closeup");
    expect(resolveSlotRecipe({ slotType: "packaging_bundle" }).id).toBe("packaging_bundle");
    expect(resolveSlotRecipe({ slotType: "lifestyle_in_use" }).id).toBe("lifestyle_in_use");
    expect(resolveSlotRecipe({ slotType: "usage_steps" }).id).toBe("usage_steps");
    expect(resolveSlotRecipe({ slotType: "slot-usage-steps" }).id).toBe("usage_steps");

    // 2. 意图组合推断
    expect(resolveSlotRecipe({ primaryPurpose: "white_studio" }).id).toBe("main_white_studio");
    expect(resolveSlotRecipe({ primaryPurpose: "dimension_specification" }).id).toBe("dimension_specs");
    expect(resolveSlotRecipe({ primaryPurpose: "detail_closeup" }).id).toBe("detail_closeup");
    expect(resolveSlotRecipe({ primaryPurpose: "packaging_bundle" }).id).toBe("packaging_bundle");
    expect(resolveSlotRecipe({ primaryPurpose: "usage_steps" }).id).toBe("usage_steps");
    expect(resolveSlotRecipe({ primaryPurpose: "selling_point_infographic", lifestyleScene: "none" }).id).toBe("selling_points");
    expect(resolveSlotRecipe({ primaryPurpose: "selling_point_infographic", lifestyleScene: "home_lifestyle" }).id).toBe("lifestyle_in_use");
  });

  it("视觉资产规划中全部 7 个槽位 100% 独立映射，绝无 fallback 或重复冲突", async () => {
    const { buildVisualAssetPlan } = await import("@/lib/imageHandoff/visualAssetPlan");
    const plan = buildVisualAssetPlan({
      productName: "THERMOS Food Jar",
      confirmedFacts: [
        { field: "brand", label: "品牌", value: "THERMOS" },
        { field: "capacity", label: "容量", value: "10oz" },
        { field: "operation", label: "使用方式", value: "Push button latch to open" },
      ],
    });
    expect(plan.slots.length).toBe(7);
    const resolvedIds = plan.slots.map((slot) => {
      const recipe = resolveSlotRecipe({
        slotType: slot.slotType,
        primaryPurpose: slot.suggestedPurpose,
        lifestyleScene: slot.suggestedScene,
        stylePresetId: slot.suggestedStylePresetId,
      });
      return recipe.id;
    });
    expect(new Set(resolvedIds).size).toBe(7);
    expect(resolvedIds).toEqual([
      "main_white_studio",
      "selling_points",
      "dimension_specs",
      "detail_closeup",
      "lifestyle_in_use",
      "packaging_bundle",
      "usage_steps",
    ]);
  });

  it("全部槽位配方不泄漏商品事实黑名单词汇（无硬性材质、性能与认证声明）", () => {
    for (const recipe of Object.values(SLOT_PROMPT_RECIPES)) {
      const text = [
        recipe.composition,
        recipe.cameraLanguage,
        recipe.lighting,
        recipe.environment,
        recipe.textPolicy,
        ...recipe.negativeConstraints,
      ].join(" ");
      const leaks = findImageStyleFactLeak(text);
      expect(leaks).toEqual([]);
    }
  });

  it("formatSlotRecipeBlock 产出结构清晰的文本块", () => {
    const block = formatSlotRecipeBlock(SLOT_PROMPT_RECIPES.main_white_studio);
    expect(block).toContain("=== 槽位视觉配方（SLOT RECIPE: 白底合规主图 / main_white_studio）===");
    expect(block).toContain("Business Goal:");
    expect(block).toContain("Composition:");
    expect(block).toContain("Camera & Lens:");
    expect(block).toContain("Lighting Setup:");
    expect(block).toContain("Environment & Surface:");
    expect(block).toContain("Text & UI Space:");
    expect(block).toContain("Slot Negative Rules:");
  });

  describe("Real Image Provider 4 Key Slot Prompts", () => {
    // 动态导入避免循环依赖
    it("Slot 1 (白底合规主图) 真实 Provider Prompt 完整包含事实、槽位配方与负面约束", async () => {
      const { buildProductVisualPrompt } = await import("@/lib/imageHandoff/realImageProvider");
      const prompt = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [{ field: "brand", label: "品牌", value: "THERMOS" }],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "main_white_studio",
        primaryPurpose: "white_studio",
        lifestyleScene: "neutral_studio",
        stylePresetId: "amazon_clean_hero",
      } as never);

      expect(prompt).toContain("CURRENT VISUAL SLOT: 白底合规主图 (main_white_studio)");
      expect(prompt).toContain("RGB 255, 255, 255");
      expect(prompt).toContain("PRIMARY CREATIVE PURPOSE: Clean white studio/hero product shot");
      expect(prompt).toContain("Style preset: 高级白底 (amazon_clean_hero)");
      expect(prompt).toContain("Confirmed facts for context only:");
      expect(prompt).toContain("TARGET PRODUCT IDENTITY (HARD CONSTRAINT)");
      expect(prompt).toContain("Approved reference summaries: thermos ref");
    });

    it("Slot 2 (核心卖点信息图) 真实 Provider Prompt 明确要求留白并禁止生成文字与假标签", async () => {
      const { buildProductVisualPrompt } = await import("@/lib/imageHandoff/realImageProvider");
      const prompt = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [{ field: "brand", label: "品牌", value: "THERMOS" }],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "selling_points",
        primaryPurpose: "selling_point_infographic",
        lifestyleScene: "kitchen_counter",
        stylePresetId: "feature_board",
      } as never);

      expect(prompt).toContain("CURRENT VISUAL SLOT: 核心卖点信息图 (selling_points)");
      expect(prompt).toContain("RESERVED LAYOUT SPACE");
      expect(prompt).toContain("Do NOT render text, badges, callout arrows or claims");
      expect(prompt).toContain("Style preset: 卖点视觉 (feature_board)");
    });

    it("Slot 3 (尺寸规格与空间图) 真实 Provider Prompt 明确要求比例环境并禁止生成假数字/标尺", async () => {
      const { buildProductVisualPrompt } = await import("@/lib/imageHandoff/realImageProvider");
      const prompt = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [{ field: "brand", label: "品牌", value: "THERMOS" }],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "dimension_specs",
        primaryPurpose: "dimension_specification",
        lifestyleScene: "desk_workspace",
        stylePresetId: "feature_board",
      } as never);

      expect(prompt).toContain("CURRENT VISUAL SLOT: 尺寸规格与空间图 (dimension_specs)");
      expect(prompt).toContain("CLEAN SCALE TEMPLATE");
      expect(prompt).toContain("Do NOT render dimension numbers, measurement lines, rulers or arrows");
      expect(prompt).toContain("recognized, standard everyday physical object");
      expect(prompt).toContain("standard smartphone");
      expect(prompt).toContain("no plain isolated product on blank white background without scale reference context");
      expect(prompt).toContain("Style preset: 卖点视觉 (feature_board)");
    });

    it("Slot 5 (真实生活使用场景图) 真实 Provider Prompt 包含场景上下文并维持主用途领先", async () => {
      const { buildProductVisualPrompt } = await import("@/lib/imageHandoff/realImageProvider");
      const prompt1 = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [
          { field: "brand", label: "品牌", value: "THERMOS" },
          { field: "capacity", label: "容量", value: "10oz" },
          { field: "material", label: "材质", value: "Stainless Steel" },
          { field: "color", label: "颜色", value: "Pink" },
          { field: "care", label: "清洗方式", value: "Dishwasher Safe" },
        ],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "main_white_studio",
        primaryPurpose: "white_studio",
        lifestyleScene: "neutral_studio",
        stylePresetId: "amazon_clean_hero",
      } as never);

      const prompt2 = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [
          { field: "brand", label: "品牌", value: "THERMOS" },
          { field: "capacity", label: "容量", value: "10oz" },
          { field: "material", label: "材质", value: "Stainless Steel" },
          { field: "color", label: "颜色", value: "Pink" },
          { field: "care", label: "清洗方式", value: "Dishwasher Safe" },
        ],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "selling_points",
        primaryPurpose: "selling_point_infographic",
        lifestyleScene: "kitchen_counter",
        stylePresetId: "feature_board",
      } as never);

      const prompt3 = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [
          { field: "brand", label: "品牌", value: "THERMOS" },
          { field: "capacity", label: "容量", value: "10oz" },
          { field: "material", label: "材质", value: "Stainless Steel" },
          { field: "color", label: "颜色", value: "Pink" },
          { field: "care", label: "清洗方式", value: "Dishwasher Safe" },
        ],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "dimension_specs",
        primaryPurpose: "dimension_specification",
        lifestyleScene: "desk_workspace",
        stylePresetId: "feature_board",
      } as never);

      const prompt5 = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [
          { field: "brand", label: "品牌", value: "THERMOS" },
          { field: "capacity", label: "容量", value: "10oz" },
          { field: "material", label: "材质", value: "Stainless Steel" },
          { field: "color", label: "颜色", value: "Pink" },
          { field: "care", label: "清洗方式", value: "Dishwasher Safe" },
        ],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "lifestyle_in_use",
        primaryPurpose: "white_studio",
        lifestyleScene: "outdoor_travel",
        stylePresetId: "outdoor_story",
      } as never);

      expect(prompt5).toContain("CURRENT VISUAL SLOT: 真实生活使用场景图 (lifestyle_in_use)");
      expect(prompt5).toContain("Authentic, clean and tidy lifestyle environment");
      expect(prompt5).toContain("Style preset: 户外故事 (outdoor_story)");
      expect(prompt5).toContain("SECONDARY SCENE: Outdoor/travel environment as supporting context only");
    });

    it("Slot 7 (使用步骤与操作指引) 真实 Provider Prompt 包含分步构图、操作区域与手部防畸变负面约束", async () => {
      const { buildProductVisualPrompt } = await import("@/lib/imageHandoff/realImageProvider");
      const prompt7 = buildProductVisualPrompt({
        schema: "image-generation-input.v1",
        mode: "product_visual_draft",
        source: { handoffRevision: 1, researchRevision: 1 },
        targetProduct: { displayName: "THERMOS Food Jar", brand: "THERMOS", productType: "Food Jar" },
        productFacts: [
          { field: "brand", label: "品牌", value: "THERMOS" },
          { field: "capacity", label: "容量", value: "10oz" },
        ],
        approvedVisualReferences: [{ referenceFingerprint: "f6d376", summary: "thermos ref", selectionId: "s1", approvedAt: "2026-01-01" }],
        compositionReferences: [],
        creativePreferences: {},
        prohibitedVisualClaims: [],
        unknowns: [],
        humanReviewRequired: true,
        researchMode: "market_research_only",
        promotionEligible: false,
        slotType: "usage_steps",
        primaryPurpose: "usage_steps",
        lifestyleScene: "kitchen_counter",
        stylePresetId: "feature_board",
      } as never);

      expect(prompt7).toContain("CURRENT VISUAL SLOT: 使用步骤与操作指引 (usage_steps)");
      expect(prompt7).toContain("Multi-step sequential layout");
      expect(prompt7).toContain("RESERVED STEP CAPTIONS");
      expect(prompt7).toContain("no distorted or malformed human hands");
      expect(prompt7).toContain("no single-step plain product photo masking as a multi-step sequence");
      expect(prompt7).not.toContain("main_white_studio");
    });
  });
});

// ── 本轮新增：机器可读字段（recipeVersion / buyerQuestion / requiredFactKinds / textAllowed / backgroundPolicy）──

const ALL_RECIPE_IDS: SlotPromptRecipeId[] = [
  "main_white_studio",
  "selling_points",
  "dimension_specs",
  "detail_closeup",
  "lifestyle_in_use",
  "packaging_bundle",
  "usage_steps",
];

const BACKGROUND_POLICIES = ["pure_white", "neutral", "scene"] as const;

/** 去掉 recipeVersion 自身，得到可重新派生的配方内容（哈希输入不含自指字段） */
function withoutRecipeVersion(recipe: SlotPromptRecipe): SlotPromptRecipeContent {
  const { recipeVersion, ...content } = recipe;
  void recipeVersion;
  return content;
}

/** 测试侧按契约独立复现：sha256(recipeId + "|" + 规范化序列化(全部 recipe 字段)).slice(0, 8) */
function expectedRecipeVersion(recipe: SlotPromptRecipe): string {
  const canonical = JSON.stringify([
    recipe.id,
    recipe.name,
    recipe.businessGoal,
    recipe.composition,
    recipe.cameraLanguage,
    recipe.lighting,
    recipe.environment,
    recipe.textPolicy,
    [...recipe.negativeConstraints],
    recipe.buyerQuestion,
    [...recipe.requiredFactKinds],
    recipe.textAllowed,
    recipe.backgroundPolicy,
  ]);
  return createHash("sha256").update(`${recipe.id}|${canonical}`, "utf8").digest("hex").slice(0, 8);
}

describe("Slot Prompt Recipe 新增机器可读字段", () => {
  it("7 个 recipe 的新字段齐备且类型正确（既有 7 个字段名与语义不变）", () => {
    for (const id of ALL_RECIPE_IDS) {
      const recipe = SLOT_PROMPT_RECIPES[id];
      expect(recipe.recipeVersion).toMatch(/^[0-9a-f]{8}$/);
      expect(typeof recipe.buyerQuestion).toBe("string");
      expect(recipe.buyerQuestion.length).toBeGreaterThan(0);
      expect(Array.isArray(recipe.requiredFactKinds)).toBe(true);
      expect(recipe.requiredFactKinds.every((kind) => typeof kind === "string" && kind.length > 0)).toBe(true);
      expect(typeof recipe.textAllowed).toBe("boolean");
      expect(BACKGROUND_POLICIES).toContain(recipe.backgroundPolicy);

      expect(recipe.id).toBe(id);
      expect(recipe.name).toBeTruthy();
      expect(recipe.businessGoal).toBeTruthy();
      expect(recipe.composition).toBeTruthy();
      expect(recipe.cameraLanguage).toBeTruthy();
      expect(recipe.lighting).toBeTruthy();
      expect(recipe.environment).toBeTruthy();
      expect(recipe.textPolicy).toBeTruthy();
      expect(recipe.negativeConstraints.length).toBeGreaterThan(0);
    }
  });

  it("buyerQuestion 一律是「帮助用户了解…」的疑问句式，不写未经证实的结论", () => {
    const unverifiedClaims = ["证明", "更耐用", "最耐用", "最好", "保证", "guaranteed", "proven", "certified"];
    for (const id of ALL_RECIPE_IDS) {
      const question = SLOT_PROMPT_RECIPES[id].buyerQuestion;
      expect(question.startsWith("帮助用户了解"), `${id} 必须写成“帮助用户了解…”`).toBe(true);
      expect(question.endsWith("。")).toBe(true);
      for (const claim of unverifiedClaims) {
        expect(question, `${id} 不得写入未经证实的结论：${claim}`).not.toContain(claim);
      }
    }
  });

  it("textAllowed 与既有 textPolicy 文案一致（7 个槽位的 textPolicy 均明确禁止文字 → 全部 false）", () => {
    for (const id of ALL_RECIPE_IDS) {
      const recipe = SLOT_PROMPT_RECIPES[id];
      const forbidsText = /zero text|zero fabricated|zero simulated|do not (?:generate|render)/iu.test(recipe.textPolicy);
      expect(forbidsText, `${id} 的 textPolicy 文案应当禁止文字`).toBe(true);
      expect(recipe.textAllowed, `${id} 的 textAllowed 必须与 textPolicy 一致`).toBe(!forbidsText);
      expect(recipe.textAllowed).toBe(false);
    }
  });

  it("backgroundPolicy 与既有 environment 文案一致", () => {
    expect(SLOT_PROMPT_RECIPES.main_white_studio.backgroundPolicy).toBe("pure_white");
    expect(SLOT_PROMPT_RECIPES.main_white_studio.environment).toContain("RGB 255, 255, 255");

    expect(SLOT_PROMPT_RECIPES.lifestyle_in_use.backgroundPolicy).toBe("scene");
    expect(SLOT_PROMPT_RECIPES.lifestyle_in_use.environment).toContain("lifestyle environment");

    const neutralSlots: SlotPromptRecipeId[] = [
      "selling_points",
      "dimension_specs",
      "detail_closeup",
      "packaging_bundle",
      "usage_steps",
    ];
    for (const id of neutralSlots) {
      expect(SLOT_PROMPT_RECIPES[id].backgroundPolicy).toBe("neutral");
      expect(SLOT_PROMPT_RECIPES[id].environment.toLowerCase()).toContain("neutral");
    }
  });

  it("requiredFactKinds 引用 purposeRequirements 的既有判定结果（同源函数身份一致，不是本地白名单）", () => {
    expect(REQUIRED_FACT_KIND_SOURCES.selling_point_fact.evidence).toBe(hasSellingPointEvidence);
    expect(REQUIRED_FACT_KIND_SOURCES.dimension_fact.evidence).toBe(hasDimensionEvidence);
    expect(REQUIRED_FACT_KIND_SOURCES.packaging_fact.evidence).toBe(hasPackagingEvidence);
    expect(REQUIRED_FACT_KIND_SOURCES.usage_fact.evidence).toBe(hasUsageEvidence);

    expect([...SLOT_PROMPT_RECIPES.selling_points.requiredFactKinds]).toEqual([...requiredFactKindsForPurpose("selling_point_infographic")]);
    expect([...SLOT_PROMPT_RECIPES.dimension_specs.requiredFactKinds]).toEqual([...requiredFactKindsForPurpose("dimension_specification")]);
    expect([...SLOT_PROMPT_RECIPES.packaging_bundle.requiredFactKinds]).toEqual([...requiredFactKindsForPurpose("packaging_bundle")]);
    expect([...SLOT_PROMPT_RECIPES.usage_steps.requiredFactKinds]).toEqual([...requiredFactKindsForPurpose("usage_steps")]);

    // 无事实门禁的槽位不得凭空宣布依赖（也不得宣布满足）
    expect([...SLOT_PROMPT_RECIPES.main_white_studio.requiredFactKinds]).toEqual([]);
    expect([...SLOT_PROMPT_RECIPES.detail_closeup.requiredFactKinds]).toEqual([]);
    expect([...SLOT_PROMPT_RECIPES.lifestyle_in_use.requiredFactKinds]).toEqual([]);
  });
});

describe("recipeVersion 内容确定性派生", () => {
  it("等于 sha256(recipeId + \"|\" + 规范化序列化) 前 8 位（与 node:crypto 逐条对照）", () => {
    for (const id of ALL_RECIPE_IDS) {
      const recipe = SLOT_PROMPT_RECIPES[id];
      expect(recipe.recipeVersion).toBe(expectedRecipeVersion(recipe));
      expect(recipe.recipeVersion).toBe(deriveSlotRecipeVersion(withoutRecipeVersion(recipe)));
    }
  });

  it("同一内容稳定：重复派生一致，且与对象键顺序无关", () => {
    const content = withoutRecipeVersion(SLOT_PROMPT_RECIPES.dimension_specs);
    expect(deriveSlotRecipeVersion(content)).toBe(SLOT_PROMPT_RECIPES.dimension_specs.recipeVersion);
    expect(deriveSlotRecipeVersion(content)).toBe(deriveSlotRecipeVersion(content));

    const reordered: SlotPromptRecipeContent = {
      backgroundPolicy: content.backgroundPolicy,
      textAllowed: content.textAllowed,
      requiredFactKinds: content.requiredFactKinds,
      buyerQuestion: content.buyerQuestion,
      negativeConstraints: content.negativeConstraints,
      textPolicy: content.textPolicy,
      environment: content.environment,
      lighting: content.lighting,
      cameraLanguage: content.cameraLanguage,
      composition: content.composition,
      businessGoal: content.businessGoal,
      name: content.name,
      id: content.id,
    };
    expect(deriveSlotRecipeVersion(reordered)).toBe(deriveSlotRecipeVersion(content));
  });

  it("改变任一字段内容都会改变 recipeVersion（全部 13 个字段）", () => {
    const base = withoutRecipeVersion(SLOT_PROMPT_RECIPES.main_white_studio);
    const baseline = deriveSlotRecipeVersion(base);

    const mutations: Array<[string, SlotPromptRecipeContent]> = [
      ["id", { ...base, id: "packaging_bundle" }],
      ["name", { ...base, name: `${base.name}（变更）` }],
      ["businessGoal", { ...base, businessGoal: `${base.businessGoal} changed` }],
      ["composition", { ...base, composition: `${base.composition} changed` }],
      ["cameraLanguage", { ...base, cameraLanguage: `${base.cameraLanguage} changed` }],
      ["lighting", { ...base, lighting: `${base.lighting} changed` }],
      ["environment", { ...base, environment: `${base.environment} changed` }],
      ["textPolicy", { ...base, textPolicy: `${base.textPolicy} changed` }],
      ["negativeConstraints", { ...base, negativeConstraints: [...base.negativeConstraints, "no extra rule"] }],
      ["buyerQuestion", { ...base, buyerQuestion: "帮助用户了解商品在纯白背景下的真实外观。" }],
      ["requiredFactKinds", { ...base, requiredFactKinds: ["dimension_fact"] }],
      ["textAllowed", { ...base, textAllowed: true }],
      ["backgroundPolicy", { ...base, backgroundPolicy: "neutral" }],
    ];

    expect(mutations.map(([field]) => field)).toEqual([
      "id",
      "name",
      "businessGoal",
      "composition",
      "cameraLanguage",
      "lighting",
      "environment",
      "textPolicy",
      "negativeConstraints",
      "buyerQuestion",
      "requiredFactKinds",
      "textAllowed",
      "backgroundPolicy",
    ]);

    for (const [field, mutated] of mutations) {
      expect(deriveSlotRecipeVersion(mutated), `字段 ${field} 变更后 recipeVersion 必须变化`).not.toBe(baseline);
    }
  });

  it("不把 recipeVersion 本身算进哈希输入（自指防护）", () => {
    const content = withoutRecipeVersion(SLOT_PROMPT_RECIPES.selling_points);
    const withSelfReference = { ...content, recipeVersion: "deadbeef" } as SlotPromptRecipeContent;
    expect(deriveSlotRecipeVersion(withSelfReference)).toBe(deriveSlotRecipeVersion(content));
    expect(deriveSlotRecipeVersion(withSelfReference)).toBe(SLOT_PROMPT_RECIPES.selling_points.recipeVersion);
  });
});

describe("既有槽位解析行为回归锁定（本轮新增字段不得改变 resolveSlotRecipe）", () => {
  it("全部既有输入返回的 id 与配方引用保持一模一样", () => {
    const cases: Array<[ResolveSlotRecipeInput, SlotPromptRecipeId]> = [
      [{ slotType: "main_white_studio" }, "main_white_studio"],
      [{ slotType: "slot-main" }, "main_white_studio"],
      [{ slotType: "selling_points" }, "selling_points"],
      [{ slotType: "slot-selling-points" }, "selling_points"],
      [{ slotType: "dimension_specs" }, "dimension_specs"],
      [{ slotType: "slot-dimension-specs" }, "dimension_specs"],
      [{ slotType: "detail_closeup" }, "detail_closeup"],
      [{ slotType: "slot-detail-closeup" }, "detail_closeup"],
      [{ slotType: "lifestyle_in_use" }, "lifestyle_in_use"],
      [{ slotType: "slot-lifestyle-scene" }, "lifestyle_in_use"],
      [{ slotType: "packaging_bundle" }, "packaging_bundle"],
      [{ slotType: "slot-packaging-bundle" }, "packaging_bundle"],
      [{ slotType: "usage_steps" }, "usage_steps"],
      [{ slotType: "slot-usage-steps" }, "usage_steps"],
      [{ slotType: "unknown-slot" }, "main_white_studio"],
      [{ slotType: null, primaryPurpose: "white_studio" }, "main_white_studio"],
      [{ primaryPurpose: "dimension_specification" }, "dimension_specs"],
      [{ primaryPurpose: "detail_closeup" }, "detail_closeup"],
      [{ primaryPurpose: "packaging_bundle" }, "packaging_bundle"],
      [{ primaryPurpose: "usage_steps" }, "usage_steps"],
      [{ primaryPurpose: "selling_point_infographic" }, "selling_points"],
      [{ primaryPurpose: "selling_point_infographic", lifestyleScene: "none" }, "selling_points"],
      [{ primaryPurpose: "selling_point_infographic", lifestyleScene: "home_lifestyle" }, "lifestyle_in_use"],
      [{ primaryPurpose: "white_studio", lifestyleScene: "home_lifestyle" }, "main_white_studio"],
      [{ primaryPurpose: "comparison" }, "main_white_studio"],
      [{ primaryPurpose: "custom" }, "main_white_studio"],
      [{ primaryPurpose: "usage_steps", stylePresetId: "macro_detail" }, "usage_steps"],
      [{ slotType: "slot-usage-steps", primaryPurpose: "white_studio" }, "usage_steps"],
      [{ stylePresetId: "macro_detail" }, "detail_closeup"],
      [{ stylePresetId: "packaging_set" }, "packaging_bundle"],
      [{ stylePresetId: "lifestyle_home" }, "lifestyle_in_use"],
      [{ stylePresetId: "outdoor_story" }, "lifestyle_in_use"],
      [{ stylePresetId: "feature_board" }, "selling_points"],
      [{ stylePresetId: "amazon_clean_hero" }, "main_white_studio"],
      [{}, "main_white_studio"],
    ];

    for (const [input, expectedId] of cases) {
      const resolved = resolveSlotRecipe(input);
      expect(resolved.id, `输入 ${JSON.stringify(input)} 解析结果必须保持 ${expectedId}`).toBe(expectedId);
      // 必须返回字典中的同一对象引用（无复制、无重建、无 fallback 漂移）
      expect(resolved).toBe(SLOT_PROMPT_RECIPES[expectedId]);
    }
  });

  it("既有 7 个字段在全部 7 个槽位上仍为非空文本（新增字段未覆盖既有语义）", () => {
    for (const id of ALL_RECIPE_IDS) {
      const recipe = SLOT_PROMPT_RECIPES[id];
      const legacyFields = [
        recipe.name,
        recipe.businessGoal,
        recipe.composition,
        recipe.cameraLanguage,
        recipe.lighting,
        recipe.environment,
        recipe.textPolicy,
      ];
      for (const value of legacyFields) {
        expect(typeof value).toBe("string");
        expect(value.trim().length).toBeGreaterThan(0);
      }
      expect(recipe.negativeConstraints.length).toBeGreaterThan(0);
      expect(recipe.negativeConstraints.every((rule) => typeof rule === "string" && rule.length > 0)).toBe(true);
    }
  });
});
