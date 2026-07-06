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

// ── Decision-Consistency.1: AI text must not self-trigger rules ──

describe("Decision-Consistency.1 — AI text self-trigger prevention", () => {
  it("AI caution about 儿童 does NOT trigger children_product", () => {
    const result = generateRiskPrecheck({
      productName: "桌面手机支架",
      finalReport: { finalVerdict: "小单测试", nextSteps: ["建议确认是否属于儿童用品"] },
    });
    const children = result.allItems.find((i) => i.key === "children_product")!;
    expect(children.precheckLevel).toBe("not_triggered");
  });

  it("AI caution about 锂电池 does NOT trigger logistics_hazmat or electronics_battery", () => {
    const result = generateRiskPrecheck({
      productName: "桌面手机支架",
      finalReport: { finalVerdict: "小单测试", nextSteps: ["需要检查是否含有锂电池"] },
    });
    const hazmat = result.allItems.find((i) => i.key === "logistics_hazmat")!;
    const battery = result.allItems.find((i) => i.key === "electronics_battery")!;
    expect(hazmat.precheckLevel).toBe("not_triggered");
    expect(battery.precheckLevel).toBe("not_triggered");
  });

  it("AI caution about 危险品物流 does NOT trigger logistics_hazmat", () => {
    const result = generateRiskPrecheck({
      productName: "桌面手机支架",
      riskResult: { summary: "需要确认危险品物流限制" },
    });
    const hazmat = result.allItems.find((i) => i.key === "logistics_hazmat")!;
    expect(hazmat.precheckLevel).toBe("not_triggered");
  });

  it("AI caution about 平台禁售 does NOT trigger platform_restricted", () => {
    const result = generateRiskPrecheck({
      productName: "桌面手机支架",
      sourcingResult: { summary: "需要检查平台是否禁售该类产品" },
    });
    const restricted = result.allItems.find((i) => i.key === "platform_restricted")!;
    expect(restricted.precheckLevel).toBe("not_triggered");
  });

  it("AI text '本产品不含锂电池' does NOT trigger electronics_battery", () => {
    const result = generateRiskPrecheck({
      productName: "桌面手机支架",
      listingResult: { title: "桌面可调节手机支架", complianceNotes: ["本产品不含锂电池"] },
    });
    const battery = result.allItems.find((i) => i.key === "electronics_battery")!;
    expect(battery.precheckLevel).toBe("not_triggered");
  });

  it("AI text '本产品不是儿童用品' does NOT trigger children_product", () => {
    const result = generateRiskPrecheck({
      productName: "桌面手机支架",
      summaryResult: { decisionReason: "本产品不是儿童用品，无需CPC认证" },
    });
    const children = result.allItems.find((i) => i.key === "children_product")!;
    expect(children.precheckLevel).toBe("not_triggered");
  });

  // ── Scenario B: Product fact fields still trigger correctly ──

  it("productName '儿童手机支架' correctly triggers children_product", () => {
    const result = generateRiskPrecheck({ productName: "儿童手机支架" });
    const children = result.allItems.find((i) => i.key === "children_product")!;
    expect(children.precheckLevel).toBe("high");
  });

  it("productName '带锂电池的手机支架' correctly triggers battery/logistics rules", () => {
    const result = generateRiskPrecheck({ productName: "带锂电池的手机支架" });
    const battery = result.allItems.find((i) => i.key === "electronics_battery")!;
    const hazmat = result.allItems.find((i) => i.key === "logistics_hazmat")!;
    expect(battery.precheckLevel).toBe("medium");
    expect(hazmat.precheckLevel).toBe("high");
  });

  it("productName '桌面手机支架' does NOT trigger children/battery/hazmat/restricted", () => {
    const result = generateRiskPrecheck({ productName: "桌面手机支架" });
    expect(item(result, "children_product").precheckLevel).toBe("not_triggered");
    expect(item(result, "logistics_hazmat").precheckLevel).toBe("not_triggered");
    expect(item(result, "electronics_battery").precheckLevel).toBe("not_triggered");
    expect(item(result, "platform_restricted").precheckLevel).toBe("not_triggered");
  });

  it("patent_design still triggers from productName (not in AI text scope fix)", () => {
    const result = generateRiskPrecheck({ productName: "桌面手机支架" });
    const patent = result.allItems.find((i) => i.key === "patent_design")!;
    // patent_design matches '支架' in productName — this is correct behavior
    expect(patent.precheckLevel).toBe("medium");
  });
});
