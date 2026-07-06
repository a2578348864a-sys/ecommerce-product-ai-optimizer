import { describe, expect, it } from "vitest";
import {
  buildDecisionEvidenceSnapshot,
  extractDecisionEvidenceSnapshot,
  normalizeHumanDecision,
} from "@/lib/decisionEvidence";

function baseWorkflow() {
  return {
    productName: "Heated Gloves",
    finalReport: {
      finalVerdict: "Recommended for small batch test",
      riskLevel: "yellow",
      nextSteps: ["Confirm supplier certifications"],
    },
    risk: {
      summary: "Battery and certification risk need manual review.",
      overallLevel: "yellow",
    },
    summary: {
      decisionReason: "Outdoor winter use case may have demand.",
    },
    listing: {
      title: "Rechargeable Heated Gloves",
      keywords: ["heated gloves"],
    },
  };
}

describe("decision evidence snapshot", () => {
  it("separates user input, calculations, rules, AI inference, and human decision", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: baseWorkflow(),
      sourceMeta: {
        sourceTitle: "Candidate page",
        sourceUrl: "https://example.com/item?token=secret-token",
        evidenceSnapshot: {
          sourceName: "manual import",
          confidence: "high",
          generatedAt: "2026-07-04T08:00:00.000Z",
        },
      },
      profitSnapshot: {
        purchaseCost: 20,
        salePrice: 49,
        platformFeeRate: 0.15,
        platformFeeAmount: 7.35,
        estimatedProfit: 21.65,
        estimatedMarginRate: 0.44,
      },
      riskReviewSnapshot: {
        source: "rule_based_risk_precheck_mvp",
        items: [
          { key: "battery", status: "needs_check", precheckLevel: "medium", precheckReason: "Battery certification missing" },
          { key: "patent_design", status: "high_risk", precheckLevel: "high", precheckReason: "Design patent similarity needs checking" },
        ],
      },
      reviewState: {
        sourcingReviewed: true,
        riskReviewed: false,
        summaryReviewed: true,
        listingReviewed: false,
      },
      humanDecision: {
        status: "need_info",
        reason: "Need supplier certificate and shipping cost before continuing.",
        nextAction: "Ask supplier for UN38.3 and logistics quote.",
        decidedAt: "2026-07-04T09:00:00.000Z",
        confirmedItems: ["source reviewed"],
        unconfirmedItems: ["risk reviewed"],
      },
    });

    expect(snapshot.version).toBe("decision-evidence-v1");
    expect(snapshot.items.some((item) => item.kind === "user_input" && item.field === "productName")).toBe(true);
    expect(snapshot.items.some((item) => item.kind === "fact" && item.field === "sourceMeta")).toBe(true);
    expect(snapshot.items.some((item) => item.kind === "calculation" && item.field === "profitSnapshot.estimatedProfit")).toBe(true);
    expect(snapshot.items.some((item) => item.kind === "rule" && item.field.includes("riskReviewSnapshot"))).toBe(true);
    expect(snapshot.items.some((item) => item.kind === "ai_inference" && item.field === "finalReport.finalVerdict")).toBe(true);
    expect(snapshot.items.some((item) => item.kind === "human_decision" && item.field === "humanDecision")).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("secret-token");
    expect(snapshot.humanDecision?.reason).toContain("supplier certificate");
  });

  it("marks unavailable market inputs as missing instead of inventing facts", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: baseWorkflow(),
    });

    expect(snapshot.missingData.map((item) => item.field)).toContain("sourceMeta");
    expect(snapshot.missingData.map((item) => item.field)).toContain("profitSnapshot.purchaseCost");
    expect(snapshot.missingData.map((item) => item.field)).toContain("profitSnapshot.logisticsCost");
    expect(snapshot.missingData.map((item) => item.field)).toContain("reviewState");
    expect(snapshot.items.find((item) => item.field === "finalReport.finalVerdict")?.kind).toBe("ai_inference");
  });

  it("detects a conflict when human decision rejects a positive AI suggestion", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: baseWorkflow(),
      humanDecision: {
        status: "rejected",
        reason: "Manual compliance review failed.",
        nextAction: "Stop this candidate.",
      },
    });

    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0].kind).toBe("conflict");
  });

  it("extracts persisted snapshots and ignores legacy records", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: baseWorkflow(),
      humanDecision: { status: "continue", reason: "Ready for quote check.", nextAction: "Request quote." },
    });

    expect(extractDecisionEvidenceSnapshot({ decisionEvidence: snapshot })?.version).toBe("decision-evidence-v1");
    expect(extractDecisionEvidenceSnapshot({ finalReport: baseWorkflow().finalReport })).toBeNull();
  });

  it("normalizes human decisions with safe defaults", () => {
    const decision = normalizeHumanDecision({ status: "unknown", reason: "", nextAction: "" });

    expect(decision?.status).toBe("pending");
    expect(decision?.reason.length).toBeGreaterThan(0);
    expect(decision?.reason).toBe("未填写原因");
    expect(decision?.nextAction.length).toBeGreaterThan(0);
  });

  it("assigns missing priority levels so not all missing items look the same", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: baseWorkflow(),
      sourceMeta: {
        sourceTitle: "Test product",
        sourceUrl: "https://example.com/test",
      },
      profitSnapshot: {
        purchaseCost: 10,
        salePrice: 30,
        platformFeeRate: 0.15,
        estimatedProfit: 15,
        estimatedMarginRate: 0.5,
      },
    });

    const criticalItems = snapshot.missingData.filter((item) => item.missingPriority === "critical");
    const suggestedItems = snapshot.missingData.filter((item) => item.missingPriority === "suggested");

    // Product name, source, purchase cost, sale price are provided → not missing
    // Logistics cost, ad cost, return rate → suggested
    // Risk review, manual review, human decision → critical
    expect(suggestedItems.length).toBeGreaterThan(0);
    expect(criticalItems.length).toBeGreaterThan(0);
    // Verify no two missing items have the exact same label+summary combo
    const combos = new Set(snapshot.missingData.map((item) => `${item.label}:${item.summary}`));
    expect(combos.size).toBe(snapshot.missingData.length);
  });
});

// ── Decision-Consistency.1: AI text must not produce rule evidence ──

describe("Decision-Consistency.1 — Evidence consistency", () => {
  function baseWorkflow() {
    return {
      productName: "桌面手机支架",
      finalReport: { finalVerdict: "小单测试", riskLevel: "yellow", nextSteps: ["联系供应商"] },
      summary: { decisionReason: "需求稳定" },
      listing: { title: "桌面可调节手机支架" },
    };
  }

  it("AI text with risk warnings does NOT produce rule evidence items", () => {
    // AI outputs contain risk-related warnings
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: {
        ...baseWorkflow(),
        finalReport: {
          finalVerdict: "小单测试",
          riskLevel: "yellow",
          nextSteps: ["建议确认是否属于儿童用品", "需要检查是否含有锂电池"],
        },
        risk: { summary: "需要确认危险品物流限制和平台是否禁售" },
      },
      riskReviewSnapshot: {
        source: "rule_based_risk_precheck_mvp",
        items: [
          // Simulate risk precheck with only patent_design triggered
          { key: "patent_design", status: "needs_check", precheckLevel: "medium", precheckReason: "外观结构风险", evidenceHint: "对比外观" },
          { key: "children_product", status: "unchecked", precheckLevel: "not_triggered", precheckReason: "未触发", evidenceHint: "" },
          { key: "logistics_hazmat", status: "unchecked", precheckLevel: "not_triggered", precheckReason: "未触发", evidenceHint: "" },
          { key: "electronics_battery", status: "unchecked", precheckLevel: "not_triggered", precheckReason: "未触发", evidenceHint: "" },
          { key: "platform_restricted", status: "unchecked", precheckLevel: "not_triggered", precheckReason: "未触发", evidenceHint: "" },
        ],
      },
    });

    // Evidence rule items should only include patent_design (medium), not the false positives
    const ruleItems = snapshot.items.filter((item) => item.kind === "rule");
    const ruleKeys = ruleItems.map((item) => item.field);
    expect(ruleKeys).toContain("riskReviewSnapshot.items.patent_design");
    expect(ruleKeys).not.toContain("riskReviewSnapshot.items.children_product");
    expect(ruleKeys).not.toContain("riskReviewSnapshot.items.logistics_hazmat");
    expect(ruleKeys).not.toContain("riskReviewSnapshot.items.electronics_battery");
    expect(ruleKeys).not.toContain("riskReviewSnapshot.items.platform_restricted");
  });

  it("real risk product name still produces rule evidence", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: { ...baseWorkflow(), productName: "带锂电池的儿童手机支架" },
      riskReviewSnapshot: {
        source: "rule_based_risk_precheck_mvp",
        items: [
          { key: "patent_design", status: "needs_check", precheckLevel: "medium", precheckReason: "外观风险", evidenceHint: "" },
          { key: "children_product", status: "needs_check", precheckLevel: "high", precheckReason: "命中儿童", evidenceHint: "需CPC" },
          { key: "electronics_battery", status: "needs_check", precheckLevel: "medium", precheckReason: "命中电池", evidenceHint: "需认证" },
          { key: "logistics_hazmat", status: "needs_check", precheckLevel: "high", precheckReason: "危险品", evidenceHint: "需MSDS" },
        ],
      },
    });

    const ruleItems = snapshot.items.filter((item) => item.kind === "rule");
    const ruleKeys = ruleItems.map((item) => item.field);
    expect(ruleKeys.length).toBeGreaterThanOrEqual(3);
    expect(ruleKeys).toContain("riskReviewSnapshot.items.children_product");
    expect(ruleKeys).toContain("riskReviewSnapshot.items.electronics_battery");
  });

  it("plain product only produces patent_design rule evidence", () => {
    const snapshot = buildDecisionEvidenceSnapshot({
      workflowResult: baseWorkflow(),
      riskReviewSnapshot: {
        source: "rule_based_risk_precheck_mvp",
        items: [
          { key: "patent_design", status: "needs_check", precheckLevel: "medium", precheckReason: "外观风险", evidenceHint: "" },
          { key: "children_product", status: "unchecked", precheckLevel: "not_triggered", precheckReason: "", evidenceHint: "" },
          { key: "logistics_hazmat", status: "unchecked", precheckLevel: "not_triggered", precheckReason: "", evidenceHint: "" },
        ],
      },
    });

    const ruleItems = snapshot.items.filter((item) => item.kind === "rule");
    // Only patent_design should appear as a rule
    expect(ruleItems.length).toBeGreaterThanOrEqual(1);
    expect(ruleItems.every((item) => item.field.includes("children_product") || item.field.includes("logistics_hazmat") ? false : true)).toBe(true);
  });
});
