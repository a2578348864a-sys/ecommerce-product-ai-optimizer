import { describe, expect, it } from "vitest";
import {
  evaluatePurposeRequirements,
  hasPackagingEvidence,
  PURPOSE_SCENE_COMPATIBILITY,
  PURPOSE_REQUIREMENTS,
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
    const purposes = ["white_studio", "selling_point_infographic", "dimension_specification", "detail_closeup", "packaging_bundle", "usage_steps", "comparison", "custom"] as const;
    for (const purpose of purposes) {
      expect(PURPOSE_REQUIREMENTS[purpose]).toBeDefined();
    }
  });

  it("white_studio × 生活场景 = CONFLICT（场景必须忽略/禁用）", () => {
    expect(PURPOSE_SCENE_COMPATIBILITY.white_studio.outdoor_travel).toBe("CONFLICT");
    expect(PURPOSE_SCENE_COMPATIBILITY.white_studio.none).toBe("ALLOWED");
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
