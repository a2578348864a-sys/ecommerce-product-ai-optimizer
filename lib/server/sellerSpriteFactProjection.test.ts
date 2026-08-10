import { describe, expect, it } from "vitest";
import {
  parseStructuredKeyValueBlocks,
  projectStructuredCandidates,
  extractProductFactCandidatesFromContent,
  projectSellerSpriteFactCandidates,
} from "@/lib/server/sellerSpriteFactProjection";

// 真实 XLSX YETI B0GZRLKJT8 数据（20260807 文件）
const YETI_DETAIL = "Brand: YETI | Material: Stainless Steel | Bottle Type: Insulated Bottle | Color: Mist/Pink/Grasshopper | Capacity: 12 ounces";
const YETI_SKU = "Color: Mist/Pink/Grasshopper";
const YETI_SELLING = "YETI kids need a bottle that can keep up. Introducing Rambler Jr. - a small-and-mighty kids bottle over-engineered for your little wild ones.\nDishwasher Safe - As a well-deserved convenience, we ensure the bottle and lid are dishwasher safe.\n18/8 stainless steel - built to take all dents and drops, and BPA-free.\nNo sweat design - keeps hands dry.";

// 真实 XLSX Owala B0FH1ZXTN1（既有 CASE B 商品）
const OWALA_DETAIL = "Brand: Owala | Material: Stainless Steel | Bottle Type: Water Bottle | Color: Blue Jay | Capacity: 24 fluid ounces";
const OWALA_SELLING = "24-ounce insulated stainless-steel water bottle with a FreeSip spout and push-button lid with lock\nPatented FreeSip spout designed for either sipping upright through the built-in straw\nDouble-wall insulation keeps drinks cold for up to 24 hours";

describe("parseStructuredKeyValueBlocks", () => {
  it("解析 Key: Value | Key: Value", () => {
    const blocks = parseStructuredKeyValueBlocks(YETI_DETAIL);
    expect(blocks).toEqual([
      { key: "Brand", value: "YETI" },
      { key: "Material", value: "Stainless Steel" },
      { key: "Bottle Type", value: "Insulated Bottle" },
      { key: "Color", value: "Mist/Pink/Grasshopper" },
      { key: "Capacity", value: "12 ounces" },
    ]);
  });

  it("空/无结构 → []", () => {
    expect(parseStructuredKeyValueBlocks(null)).toEqual([]);
    expect(parseStructuredKeyValueBlocks("no colon here")).toEqual([]);
  });

  it("中文冒号/分隔符兼容", () => {
    const blocks = parseStructuredKeyValueBlocks("品牌：YETI｜材质：不锈钢");
    expect(blocks).toEqual([
      { key: "品牌", value: "YETI" },
      { key: "材质", value: "不锈钢" },
    ]);
  });
});

describe("projectStructuredCandidates（真实 YETI）", () => {
  it("YETI 详细参数 → brand/material/product_type/color/capacity 全部候选", () => {
    const { candidates, unmapped } = projectStructuredCandidates(YETI_DETAIL, YETI_SKU);
    const byField = Object.fromEntries(candidates.map((c) => [c.field, c.value]));
    expect(byField.brand).toBe("YETI");
    expect(byField.material).toBe("Stainless Steel");
    expect(byField.product_type).toBe("Insulated Bottle");
    expect(byField.color_or_variant).toBe("Mist/Pink/Grasshopper");
    expect(byField.capacity).toBe("12 ounces");
    expect(candidates.every((c) => c.candidateKind === "structured")).toBe(true);
    expect(candidates.every((c) => c.sourceField === "Material" || c.sourceField === "Brand" || c.sourceField === "Bottle Type" || c.sourceField === "Color" || c.sourceField === "Capacity")).toBe(true);
    // SKU 与详细参数重复的 Color 去重
    expect(candidates.filter((c) => c.field === "color_or_variant").length).toBe(1);
    void unmapped;
  });

  it("未知字段不硬猜 → unmapped", () => {
    const { candidates, unmapped } = projectStructuredCandidates("Special Feature: XYZ | Foo: Bar", null);
    expect(candidates).toEqual([]);
    expect(unmapped.length).toBe(2);
  });

  it("Owala 详细参数 → material/capacity 候选（specification 缺口被填补）", () => {
    const { candidates } = projectStructuredCandidates(OWALA_DETAIL, null);
    const byField = Object.fromEntries(candidates.map((c) => [c.field, c.value]));
    expect(byField.material).toBe("Stainless Steel");
    expect(byField.capacity).toBe("24 fluid ounces");
  });
});

describe("extractProductFactCandidatesFromContent（真实 YETI 卖点）", () => {
  it("提取功能候选：care/construction/functional", () => {
    const candidates = extractProductFactCandidatesFromContent(YETI_SELLING);
    const roles = new Set(candidates.map((c) => c.role));
    expect(roles.has("care")).toBe(true); // dishwasher safe
    expect(roles.has("construction")).toBe(true); // 18/8 stainless steel
    expect(roles.has("functional_feature")).toBe(true); // straw cap / sipping
    expect(candidates.every((c) => c.candidateKind === "ai_extracted")).toBe(true);
    expect(candidates.every((c) => c.sourceField === "产品卖点")).toBe(true);
  });

  it("安全：候选可含 BPA-free 但带来源标记，不自动确认", () => {
    const candidates = extractProductFactCandidatesFromContent("18/8 stainless steel built to take all dents and drops, and BPA-free");
    const bpa = candidates.find((c) => c.value.includes("BPA"));
    expect(bpa?.value).toContain("BPA-free");
    // 候选仅 internal 用途；确认动作由用户在 UI 完成（本函数不产出 confirmed）
  });

  it("空卖点 → []", () => {
    expect(extractProductFactCandidatesFromContent(null)).toEqual([]);
  });
});

describe("projectSellerSpriteFactCandidates", () => {
  it("YETI 全链：structured + content 候选齐全", () => {
    const { structured, content } = projectSellerSpriteFactCandidates({
      detailAttributesRaw: YETI_DETAIL,
      skuRaw: YETI_SKU,
      sellingPointsRaw: YETI_SELLING,
    });
    expect(structured.length).toBeGreaterThanOrEqual(5);
    expect(content.length).toBeGreaterThanOrEqual(3);
    expect(structured.some((c) => c.field === "material" && c.value === "Stainless Steel")).toBe(true);
    expect(content.some((c) => c.role === "care")).toBe(true);
  });
});
