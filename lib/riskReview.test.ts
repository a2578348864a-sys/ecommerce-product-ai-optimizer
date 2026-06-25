import { describe, expect, it } from "vitest";
import {
  createDefaultRiskReviewItems,
  generateRiskPrecheck,
  normalizeRiskReviewSnapshot,
  RISK_REVIEW_DISCLAIMER,
  summarizeRiskReview,
} from "@/lib/riskReview";

function item(result: ReturnType<typeof generateRiskPrecheck>, key: string) {
  const found = result.allItems.find((entry) => entry.key === key);
  expect(found).toBeTruthy();
  return found!;
}

function expectNoForbiddenCopy(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain("安全可卖");
  expect(text).not.toContain("无侵权风险");
  expect(text).not.toContain("已通过合规");
  expect(text).not.toContain("平台允许销售");
  expect(text).not.toContain("自动合规审核完成");
  expect(text).not.toContain("无需人工确认");
  expect(text).not.toContain("100% 安全");
}

describe("risk review helpers", () => {
  it("summarizes high risk first", () => {
    expect(summarizeRiskReview([
      { status: "cleared" },
      { status: "high_risk" },
      { status: "needs_check" },
    ])).toBe("high_risk");
  });

  it("summarizes needs_check when items are unchecked or need review", () => {
    expect(summarizeRiskReview([{ status: "cleared" }, { status: "needs_check" }])).toBe("needs_check");
    expect(summarizeRiskReview([{ status: "cleared" }, { status: "unchecked" }])).toBe("needs_check");
  });

  it("summarizes cleared only when every item is cleared", () => {
    expect(summarizeRiskReview([{ status: "cleared" }, { status: "cleared" }])).toBe("cleared");
  });

  it("summarizes empty items as unknown", () => {
    expect(summarizeRiskReview([])).toBe("unknown");
  });

  it("prechecks cat litter box as design risk without high electronics or logistics", () => {
    const result = generateRiskPrecheck({ productName: "猫砂盆" });

    expect(item(result, "patent_design").precheckLevel).toBe("medium");
    expect(item(result, "patent_design").status).toBe("needs_check");
    expect(item(result, "electronics_battery").precheckLevel).not.toBe("high");
    expect(item(result, "logistics_hazmat").precheckLevel).not.toBe("high");
    expect(result.summary).toContain("外观");
    expectNoForbiddenCopy(result);
  });

  it("prechecks automatic cat litter box as structure and electronics risk with supplier documents", () => {
    const result = generateRiskPrecheck({ productName: "自动猫砂盆" });

    expect(item(result, "patent_design").precheckLevel).toBe("medium");
    expect(["medium", "high"]).toContain(item(result, "electronics_battery").precheckLevel);
    expect(item(result, "supplier_documents").status).toBe("needs_check");
    expectNoForbiddenCopy(result);
  });

  it("prechecks anti-wolf spray as platform and logistics high risk", () => {
    const result = generateRiskPrecheck({ productName: "防狼喷雾" });

    expect(item(result, "platform_restricted").precheckLevel).toBe("high");
    expect(item(result, "platform_restricted").status).toBe("high_risk");
    expect(item(result, "logistics_hazmat").precheckLevel).toBe("high");
    expect(result.overallPrecheckLevel).toBe("high");
    expectNoForbiddenCopy(result);
  });

  it("prechecks children cup as children and food-contact risk with supplier documents", () => {
    const result = generateRiskPrecheck({ productName: "儿童水杯" });

    expect(["medium", "high"]).toContain(item(result, "children_product").precheckLevel);
    expect(["medium", "high"]).toContain(item(result, "food_cosmetic_skin").precheckLevel);
    expect(item(result, "supplier_documents").status).toBe("needs_check");
    expectNoForbiddenCopy(result);
  });

  it("prechecks LED makeup mirror as electronics and cosmetic-skin related risk", () => {
    const result = generateRiskPrecheck({ productName: "LED 化妆镜" });

    expect(item(result, "electronics_battery").precheckLevel).toBe("medium");
    expect(["low", "medium"]).toContain(item(result, "food_cosmetic_skin").precheckLevel);
    expect(item(result, "supplier_documents").status).toBe("needs_check");
    expectNoForbiddenCopy(result);
  });

  it("prechecks Disney children toy as brand, trademark, and children risk", () => {
    const result = generateRiskPrecheck({ productName: "Disney 儿童玩具" });

    expect(item(result, "brand_ip").precheckLevel).toBe("high");
    expect(item(result, "trademark").precheckLevel).toBe("high");
    expect(item(result, "children_product").precheckLevel).toBe("high");
    expect(result.overallPrecheckLevel).toBe("high");
    expectNoForbiddenCopy(result);
  });

  it("normalizes new snapshot and keeps old manual snapshot compatible", () => {
    const snapshot = normalizeRiskReviewSnapshot({
      version: "risk_auto_mvp_v1",
      source: "rule_based_risk_precheck_mvp",
      overallPrecheckLevel: "high",
      summary: "系统自动圈出重点风险，需人工最终确认。",
      recommendedActions: ["查商标", "问供应商要报告"],
      items: [
        { key: "brand_ip", status: "needs_check", precheckLevel: "high", note: "出现品牌词" },
        { key: "trademark", status: "needs_check", precheckLevel: "high" },
      ],
      note: "需要人工复核供应商文件",
      disclaimer: "ignored",
    });

    expect(snapshot?.version).toBe("risk_auto_mvp_v1");
    expect(snapshot?.source).toBe("rule_based_risk_precheck_mvp");
    expect(snapshot?.mode).toBe("ai_rule_precheck_with_manual_review");
    expect(snapshot?.overallStatus).toBe("needs_check");
    expect(snapshot?.overallPrecheckLevel).toBe("high");
    expect(snapshot?.items).toHaveLength(createDefaultRiskReviewItems().length);
    expect(snapshot?.disclaimer).toBe(RISK_REVIEW_DISCLAIMER);
    expectNoForbiddenCopy(snapshot);

    const legacy = normalizeRiskReviewSnapshot({
      version: "risk_review_mvp_v1",
      items: [
        { key: "brand_ip", status: "cleared", note: "未看到品牌词" },
        { key: "trademark", status: "high_risk" },
      ],
    });

    expect(legacy?.version).toBe("risk_review_mvp_v1");
    expect(legacy?.source).toBe("manual_risk_review_mvp");
    expect(legacy?.overallStatus).toBe("high_risk");
    expect(legacy?.summary).toContain("旧版人工复核清单");
  });

  it("keeps untouched snapshots as unknown", () => {
    const snapshot = normalizeRiskReviewSnapshot({ items: createDefaultRiskReviewItems(), note: "" });
    expect(snapshot?.overallStatus).toBe("unknown");
  });
});
