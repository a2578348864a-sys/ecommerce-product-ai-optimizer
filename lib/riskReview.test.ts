import { describe, expect, it } from "vitest";
import {
  createDefaultRiskReviewItems,
  normalizeRiskReviewSnapshot,
  RISK_REVIEW_DISCLAIMER,
  summarizeRiskReview,
} from "@/lib/riskReview";

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

  it("normalizes snapshot and never claims final compliance clearance", () => {
    const snapshot = normalizeRiskReviewSnapshot({
      items: [
        { key: "brand_ip", status: "cleared", note: "未看到品牌词" },
        { key: "trademark", status: "high_risk" },
      ],
      note: "需要人工复核供应商文件",
      disclaimer: "ignored",
    });

    expect(snapshot?.version).toBe("risk_review_mvp_v1");
    expect(snapshot?.source).toBe("manual_risk_review_mvp");
    expect(snapshot?.overallStatus).toBe("high_risk");
    expect(snapshot?.items).toHaveLength(createDefaultRiskReviewItems().length);
    expect(snapshot?.items.find((item) => item.key === "brand_ip")?.note).toBe("未看到品牌词");
    expect(snapshot?.disclaimer).toBe(RISK_REVIEW_DISCLAIMER);
    expect(JSON.stringify(snapshot)).not.toContain("安全可卖");
    expect(JSON.stringify(snapshot)).not.toContain("已通过合规检查");
  });

  it("keeps untouched snapshots as unknown", () => {
    const snapshot = normalizeRiskReviewSnapshot({ items: createDefaultRiskReviewItems(), note: "" });
    expect(snapshot?.overallStatus).toBe("unknown");
  });
});
