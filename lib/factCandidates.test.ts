/**
 * V3 UX Closure — Fact Candidate 提取与批量确认测试（行为优先）
 *
 * 覆盖：
 * - extractFactCandidates：THERMOS 样本 → brand/capacity/category/price/rating/reviews/bsr/material 候选；
 * - 禁止升权：AI summary / VOC / competitor / sourcing sellerClaims 不进入候选；
 * - 来源确定性：candidateId 稳定（同字段同来源去重）；
 * - buildFactCandidateView：确认后从候选移入 confirmed；
 * - getFactCandidates：schema 校验 fail-closed。
 */
import { describe, expect, it } from "vitest";
import {
  buildFactCandidateView,
  extractFactCandidates,
  FACT_CANDIDATES_SCHEMA,
  getFactCandidates,
  type ConfirmedFactCandidate,
} from "@/lib/factCandidates";

function thermosResultJson(): Record<string, unknown> {
  return {
    productName: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
    candidateAnalysisContext: {
      schema: "candidate-analysis-context-v1",
      facts: {
        productFacts: {
          productTitle: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
          brand: "THERMOS",
          price: 19.99,
          rating: 4.7,
          reviews: 48110,
          rootCategory: "Kitchen & Dining",
          rootCategoryBsr: 9,
        },
      },
    },
    browserEvidence: {
      schema: "browser-evidence.v1",
      version: 1,
      snapshots: [
        {
          fields: {
            asin: { value: "B0F2BF31PW", status: "correct" },
            title: { value: "THERMOS FUNTAINER ... Stainless Steel ...", status: "correct" },
            price: { value: 19.99, status: "correct" },
            bsr: { value: 9, status: "correct" },
            rating: { value: 4.7, status: "correct" },
            reviewCount: { value: 48116, status: "correct" },
          },
        },
      ],
    },
    vocAnalysis: { schema: "voc-analysis.v1", themes: { positiveThemes: ["good"] } },
    aiEvidenceSummary: { schema: "ai-evidence-summary.v1", summary: { facts: ["fake fact"] } },
    sourcingEvidence: {
      schema: "sourcing-evidence.v1",
      candidates: [{ sellerClaims: [{ name: "内胆材质", value: "304不锈钢" }] }],
    },
    competitorEvidence: { schema: "competitor-evidence.v1", asins: [] },
  };
}

describe("extractFactCandidates", () => {
  it("THERMOS 样本提取确定性候选：brand/capacity/category/price/rating/reviews/bsr", () => {
    const candidates = extractFactCandidates(thermosResultJson());
    const byField = new Map(candidates.map((c) => [c.field, c]));
    expect(byField.get("brand")?.value).toBe("THERMOS");
    expect(byField.get("brand")?.sourceKind).toBe("seller_sprite_product_facts");
    expect(byField.get("capacity")?.value).toBe("12oz");
    expect(byField.get("category")?.value).toBe("Kitchen & Dining");
    expect(byField.get("price")?.value).toBe(19.99);
    expect(byField.get("rating")?.value).toBe(4.7);
    expect(byField.get("reviews")?.value).toBe(48110);
    expect(byField.get("bsr")?.value).toBe(9);
  });

  it("标题派生候选：material（Stainless Steel）来自 product_title", () => {
    const candidates = extractFactCandidates(thermosResultJson());
    const material = candidates.find((c) => c.field === "material");
    expect(material).toBeDefined();
    expect(material?.sourceKind).toBe("product_title");
    expect(String(material?.value).toLowerCase()).toContain("stainless");
  });

  it("禁止升权：VOC/AI summary/competitor/sourcing sellerClaims 不进入候选", () => {
    const candidates = extractFactCandidates(thermosResultJson());
    const fields = candidates.map((c) => c.field).join(",");
    expect(fields).not.toContain("voc_theme");
    const sourceKinds = candidates.map((c) => String(c.sourceKind)).join(",");
    expect(sourceKinds).not.toContain("ai_summary");
    expect(sourceKinds).not.toContain("competitor");
    expect(sourceKinds).not.toContain("seller_claim");
    // 供应商声称（304不锈钢）不得自动成为 material 候选（material 只能来自标题派生/确定性来源）
    const material = candidates.find((c) => c.field === "material");
    expect(material?.sourceRef).not.toContain("sellerClaims");
  });

  it("确定性去重：同字段同来源只出一个候选（browserEvidence 与 productFacts 同字段合并）", () => {
    const candidates = extractFactCandidates(thermosResultJson());
    const priceCount = candidates.filter((c) => c.field === "price").length;
    expect(priceCount).toBe(1);
  });

  it("空输入/无证据 → 空候选（不强制填满）", () => {
    expect(extractFactCandidates({})).toEqual([]);
    expect(extractFactCandidates(null)).toEqual([]);
  });
});

describe("fact-candidates 持久化视图", () => {
  it("getFactCandidates：无 namespace → null；非法 schema → null", () => {
    expect(getFactCandidates({})).toBeNull();
    expect(getFactCandidates({ factCandidates: { schema: "wrong" } })).toBeNull();
    expect(getFactCandidates({ factCandidates: { schema: FACT_CANDIDATES_SCHEMA, confirmed: "bad" } })).toBeNull();
  });

  it("buildFactCandidateView：确认后从候选移入 confirmed（来源保留）", () => {
    const result = thermosResultJson();
    const confirmed: ConfirmedFactCandidate = {
      candidateId: "seller_sprite_product_facts:brand",
      field: "brand",
      label: "品牌",
      value: "THERMOS",
      sourceKind: "seller_sprite_product_facts",
      sourceRef: "seller_sprite.productFacts.brand",
      humanConfirmationRequired: true,
      confirmedAt: "2026-08-19T00:00:00.000Z",
      confirmedBy: "visitor:test",
    };
    result.factCandidates = {
      schema: FACT_CANDIDATES_SCHEMA,
      version: 1,
      confirmed: [confirmed],
      updatedAt: "2026-08-19T00:00:00.000Z",
    };
    const view = buildFactCandidateView(result);
    expect(view.confirmed.map((c) => c.field)).toContain("brand");
    expect(view.candidates.some((c) => c.field === "brand")).toBe(false);
    // 其余候选仍在
    expect(view.candidates.map((c) => c.field)).toContain("capacity");
    // 已确认项保留原始来源
    expect(view.confirmed[0].sourceKind).toBe("seller_sprite_product_facts");
  });
});

describe("V3 Final PHASE 1 — Product Information 规格候选（amazon_product_info）", () => {
  function resultWithProductInfo(): Record<string, unknown> {
    const result = thermosResultJson();
    const snapshots = (result.browserEvidence as { snapshots: Array<Record<string, unknown>> }).snapshots;
    snapshots[0].productInfo = {
      schemaVersion: "amazon-product-info-extraction.v1",
      rows: [
        { label: "Material Type", value: "Stainless Steel", sourceSection: "productDetails_depthRightSections" },
        { label: "Item Dimensions W x H", value: "2.7\"W x 6.9\"H", sourceSection: "productDetails_depthRightSections" },
        { label: "Item Weight", value: "0.22 kg", sourceSection: "productDetails_depthRightSections" },
        { label: "Product Care Instructions", value: "Top Rack Dishwasher Safe", sourceSection: "productDetails_depthRightSections" },
      ],
      canonicalFacts: {
        material: "Stainless Steel",
        dimensions: "2.7\"W x 6.9\"H",
        weight: "0.22 kg",
        care: "Top Rack Dishwasher Safe",
        some_unknown_field: "x",
      },
      capturedAt: "2026-08-19T00:00:00.000Z",
      collectorVersion: "amazon-detail-page-extractor.v1",
    };
    return result;
  }

  it("提取 amazon_product_info 规格候选（dimensions/weight/care；material 与标题派生同字段去重）", () => {
    const candidates = extractFactCandidates(resultWithProductInfo());
    // 标题派生未覆盖的字段 → 来自 amazon_product_info
    expect(candidates.find((c) => c.field === "dimensions")?.value).toBe("2.7\"W x 6.9\"H");
    expect(candidates.find((c) => c.field === "dimensions")?.sourceKind).toBe("amazon_product_info");
    expect(candidates.find((c) => c.field === "weight")?.value).toBe("0.22 kg");
    expect(candidates.find((c) => c.field === "care")?.value).toBe("Top Rack Dishwasher Safe");
    // material：同字段去重（标题派生优先，productInfo 同值不重复）
    const materialCandidates = candidates.filter((c) => c.field === "material");
    expect(materialCandidates.length).toBe(1);
  });

  it("未知 canonical 字段 fail-closed（不进入候选）；同字段与既有来源去重", () => {
    const candidates = extractFactCandidates(resultWithProductInfo());
    expect(candidates.some((c) => c.field === "some_unknown_field")).toBe(false);
    // material 已由标题派生产生候选 → 与 amazon_product_info 去重（只保留一个）
    const materialCandidates = candidates.filter((c) => c.field === "material");
    expect(materialCandidates.length).toBe(1);
  });

  it("无 productInfo 快照 → 不产生 amazon_product_info 候选", () => {
    const candidates = extractFactCandidates(thermosResultJson());
    expect(candidates.some((c) => c.sourceKind === "amazon_product_info")).toBe(false);
  });
});
