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
