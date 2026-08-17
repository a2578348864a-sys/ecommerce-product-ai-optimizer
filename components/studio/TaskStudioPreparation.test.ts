import { describe, expect, it } from "vitest";
import {
  buildPreparationFactOptions,
  buildPreparationPreferences,
  defaultPreparationSelection,
  visualReferenceSourceLabel,
} from "@/components/studio/TaskStudioPreparation";
import type { CreativeHandoffPreview } from "@/components/creative-handoff/types";

describe("visualReferenceSourceLabel", () => {
  it("candidate_fallback 产品化为「当前商品数据」，不暴露内部 tier", () => {
    expect(visualReferenceSourceLabel("candidate_fallback")).toBe("当前商品数据");
  });

  it("xlsx_embedded 产品化为「SellerSprite 商品数据」", () => {
    expect(visualReferenceSourceLabel("xlsx_embedded")).toBe("SellerSprite 商品数据");
  });

  it("未知或缺失 tier 回退到「当前商品数据」", () => {
    expect(visualReferenceSourceLabel(undefined)).toBe("当前商品数据");
    expect(visualReferenceSourceLabel("something_internal")).toBe("当前商品数据");
  });
});


describe("buildPreparationFactOptions", () => {
  it("将服务端 confirmableFactCandidates 映射为用户可确认的中文事实选项", () => {
    const preview = {
      eligibility: "eligible",
      candidateFactOptions: [],
      confirmableFactCandidates: [{
        selectionId: "confirm:brand",
        canonicalField: "brand",
        displayValue: "Phase2Brand",
        sourceKindSummary: "candidate_snapshot",
        capturedAt: "2026-08-08T00:00:00.000Z",
        allowedUsageScopes: ["internal", "listing"],
        humanConfirmationRequired: true,
        provenanceSummary: "来源快照，需人工确认。",
      }],
    } satisfies CreativeHandoffPreview;

    expect(buildPreparationFactOptions(preview)).toEqual([{
      selectionId: "confirm:brand",
      field: "brand",
      label: "品牌",
      valueSummary: "Phase2Brand",
      listingEligible: true,
    }]);
  });

  it("已有服务端事实选项时保持原始安全投影", () => {
    const projected = [{ selectionId: "confirm:material", field: "material", label: "材质", valueSummary: "steel" }];
    const preview = {
      eligibility: "eligible",
      candidateFactOptions: projected,
      confirmableFactCandidates: [],
    } satisfies CreativeHandoffPreview;

    expect(buildPreparationFactOptions(preview)).toEqual([{
      selectionId: "confirm:material",
      field: "material",
      label: "材质",
      valueSummary: "steel",
      listingEligible: true,
    }]);
  });

  it("默认选择：同 field 只取首个、market_signal 排除、product_fact 全选", () => {
    const options = buildPreparationFactOptions({
      eligibility: "eligible",
      candidateFactOptions: [],
      confirmableFactCandidates: [
        { selectionId: "brand-title", canonicalField: "brand", displayValue: "YETI", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "brand-proj", canonicalField: "brand", displayValue: "YETI", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "type-title", canonicalField: "product_type", displayValue: "Bottle", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "type-proj", canonicalField: "product_type", displayValue: "Insulated Bottle", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "material", canonicalField: "material", displayValue: "Stainless Steel", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "price", canonicalField: "price_usd", displayValue: "29.99", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "rating", canonicalField: "rating", displayValue: "4.8", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
      ] as never,
    } satisfies CreativeHandoffPreview);

    const selected = defaultPreparationSelection(options);
    expect(selected).toContain("brand-title");
    expect(selected).not.toContain("brand-proj");
    expect(selected).toContain("type-title");
    expect(selected).not.toContain("type-proj");
    expect(selected).toContain("material");
    expect(selected).not.toContain("price");
    expect(selected).not.toContain("rating");
    // 提交集合内同 field 唯一
    const fields = selected.map((id) => options.find((o) => o.selectionId === id)!.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("同 field 互斥切换：选择另一候选时取消同 field 首个", () => {
    const options = buildPreparationFactOptions({
      eligibility: "eligible",
      candidateFactOptions: [],
      confirmableFactCandidates: [
        { selectionId: "type-title", canonicalField: "product_type", displayValue: "Bottle", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "type-proj", canonicalField: "product_type", displayValue: "Insulated Bottle", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
        { selectionId: "material", canonicalField: "material", displayValue: "Stainless Steel", sourceKindSummary: "candidate_snapshot", capturedAt: "2026-08-11T00:00:00.000Z", allowedUsageScopes: ["internal", "listing", "image"], humanConfirmationRequired: true, provenanceSummary: "来源快照" },
      ] as never,
    } satisfies CreativeHandoffPreview);

    const initial = defaultPreparationSelection(options);
    expect(initial).toEqual(["type-title", "material"]);

    // 模拟组件 onChange 互斥：选 type-proj → type-title 取消
    const fieldExclusive = (current: string[], target: string, field: string) => {
      const sameFieldIds = options.filter((o) => o.field === field && o.selectionId !== target).map((o) => o.selectionId);
      const without = current.filter((id) => !sameFieldIds.includes(id));
      return [...new Set([...without, target])];
    };
    const afterSwitch = fieldExclusive(initial, "type-proj", "product_type");
    expect([...afterSwitch].sort()).toEqual(["material", "type-proj"]);
  });

  it("空创作偏好不回传，非空偏好仅保留有效字符串", () => {
    expect(buildPreparationPreferences({})).toBeUndefined();
    expect(buildPreparationPreferences({ targetMarket: " US ", tone: "" })).toEqual({ targetMarket: "US" });
  });

  it("把 Task 场景选择映射到既有的安全创作偏好字段", () => {
    expect(buildPreparationPreferences(
      { targetMarket: "US", tone: "professional" },
      {
        imageStyle: "outdoor",
        backgroundPreference: "Believable outdoor or travel context.",
        compositionPreference: "Natural in-use composition.",
        additionalRequirements: "Keep room for a headline.",
      },
    )).toEqual({
      targetMarket: "US",
      tone: "professional",
      imageStyle: "outdoor",
      backgroundPreference: "Believable outdoor or travel context.",
      compositionPreference: "Natural in-use composition.",
      additionalRequirements: "Keep room for a headline.",
    });
  });
});
