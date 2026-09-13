import { describe, expect, it } from "vitest";
import {
  SLOT_PROMPT_RECIPES,
  formatSlotRecipeBlock,
  resolveSlotRecipe,
  type SlotPromptRecipeId,
} from "@/lib/imageHandoff/slotPromptRecipes";
import { findImageStyleFactLeak } from "@/lib/imageStyleLibrary";

describe("Slot Prompt Recipes Specification", () => {
  const allRecipeIds: SlotPromptRecipeId[] = [
    "main_white_studio",
    "selling_points",
    "dimension_specs",
    "detail_closeup",
    "lifestyle_in_use",
    "packaging_bundle",
  ];

  it("覆盖全部 6 个核心视觉槽位，且字段完备", () => {
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
    }
  });

  it("Slot 2 (核心卖点图) 与 Slot 3 (尺寸规格图) 明确要求排版留白，严禁直接绘制文字与假标尺", () => {
    const slot2 = SLOT_PROMPT_RECIPES.selling_points;
    expect(slot2.textPolicy).toContain("RESERVED LAYOUT SPACE");
    expect(slot2.textPolicy).toContain("Do NOT generate simulated text");
    expect(slot2.composition).toContain("negative space reserved");

    const slot3 = SLOT_PROMPT_RECIPES.dimension_specs;
    expect(slot3.textPolicy).toContain("CLEAN SCALE TEMPLATE");
    expect(slot3.textPolicy).toContain("Do NOT render dimension numbers");
    expect(slot3.textPolicy).toContain("ready for vector overlays");
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

    // 2. 意图组合推断
    expect(resolveSlotRecipe({ primaryPurpose: "white_studio" }).id).toBe("main_white_studio");
    expect(resolveSlotRecipe({ primaryPurpose: "dimension_specification" }).id).toBe("dimension_specs");
    expect(resolveSlotRecipe({ primaryPurpose: "detail_closeup" }).id).toBe("detail_closeup");
    expect(resolveSlotRecipe({ primaryPurpose: "packaging_bundle" }).id).toBe("packaging_bundle");
    expect(resolveSlotRecipe({ primaryPurpose: "selling_point_infographic", lifestyleScene: "none" }).id).toBe("selling_points");
    expect(resolveSlotRecipe({ primaryPurpose: "selling_point_infographic", lifestyleScene: "home_lifestyle" }).id).toBe("lifestyle_in_use");
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
      expect(prompt).toContain("Style preset: 卖点视觉 (feature_board)");
    });

    it("Slot 5 (真实生活使用场景图) 真实 Provider Prompt 包含场景上下文并维持主用途领先", async () => {
      const { buildProductVisualPrompt } = await import("@/lib/imageHandoff/realImageProvider");
      const { writeFileSync } = await import("node:fs");
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

      writeFileSync(
        "C:/Users/a2578/.gemini/antigravity/brain/589da4b9-8b64-498e-b19d-0c933b58482c/scratch/prompt_samples.json",
        JSON.stringify({ slot1: prompt1, slot2: prompt2, slot3: prompt3, slot5: prompt5 }, null, 2),
        "utf-8",
      );

      expect(prompt5).toContain("CURRENT VISUAL SLOT: 真实生活使用场景图 (lifestyle_in_use)");
      expect(prompt5).toContain("Authentic, clean and tidy lifestyle environment");
      expect(prompt5).toContain("Style preset: 户外故事 (outdoor_story)");
      expect(prompt5).toContain("SECONDARY SCENE: Outdoor/travel environment as supporting context only");
    });
  });
});
