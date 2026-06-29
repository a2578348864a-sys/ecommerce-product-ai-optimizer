import { describe, expect, it } from "vitest";
import { normalizeProfitSnapshot, validateProfitSnapshot } from "@/lib/profitSnapshot";

describe("normalizeProfitSnapshot", () => {
  it("returns null for missing or non-object payloads", () => {
    expect(normalizeProfitSnapshot(null)).toBeNull();
    expect(normalizeProfitSnapshot(undefined)).toBeNull();
    expect(normalizeProfitSnapshot("invalid")).toBeNull();
    expect(normalizeProfitSnapshot([])).toBeNull();
  });

  it("keeps valid profit snapshot fields", () => {
    const snapshot = normalizeProfitSnapshot({
      purchaseCost: 15,
      salePrice: 25,
      platformFeeRate: 0.15,
      platformFeeAmount: 3.75,
      estimatedProfit: 6.25,
      estimatedMarginRate: 0.25,
      decision: "testable",
      note: "manual estimate",
      createdAt: "2026-06-29T10:00:00.000Z",
      currency: "USD",
    });

    expect(snapshot).toEqual({
      purchaseCost: 15,
      salePrice: 25,
      platformFeeRate: 0.15,
      platformFeeAmount: 3.75,
      estimatedProfit: 6.25,
      estimatedMarginRate: 0.25,
      decision: "testable",
      note: "manual estimate",
      source: "manual_profit_mvp",
      createdAt: "2026-06-29T10:00:00.000Z",
      currency: "USD",
    });
  });

  it("keeps compatible legacy aliases and percentage fee rates", () => {
    const snapshot = normalizeProfitSnapshot({
      estimatedPurchasePrice: "20",
      estimatedSellingPrice: "50",
      commissionRate: 15,
      decision: "cautious",
      note: "alias payload",
      createdAt: "2026-06-29T10:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      purchaseCost: 20,
      salePrice: 50,
      platformFeeRate: 0.15,
      platformFeeAmount: 7.5,
      estimatedProfit: 22.5,
      estimatedMarginRate: 0.45,
      decision: "caution",
      note: "alias payload",
      source: "manual_profit_mvp",
    });
  });

  it("uses safe defaults for invalid numeric fields without throwing", () => {
    const snapshot = normalizeProfitSnapshot({
      purchaseCost: "bad",
      salePrice: "30",
      platformFeeRate: "bad",
      estimatedProfit: "bad",
      estimatedMarginRate: "bad",
      createdAt: "2026-06-29T10:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      purchaseCost: 0,
      salePrice: 30,
      platformFeeRate: 0.15,
      platformFeeAmount: 4.5,
      estimatedProfit: 25.5,
      estimatedMarginRate: 0.85,
      decision: "testable",
      source: "manual_profit_mvp",
    });
  });

  it("infers not_recommended when profit is not positive", () => {
    const snapshot = normalizeProfitSnapshot({
      purchaseCost: 20,
      salePrice: 20,
      platformFeeRate: 0.15,
      createdAt: "2026-06-29T10:00:00.000Z",
    });

    expect(snapshot?.estimatedProfit).toBe(-3);
    expect(snapshot?.decision).toBe("not_recommended");
  });
});

describe("validateProfitSnapshot", () => {
  it("returns valid result for already normalized payloads", () => {
    const result = validateProfitSnapshot({
      purchaseCost: 15,
      salePrice: 25,
      platformFeeRate: 0.15,
      platformFeeAmount: 3.75,
      estimatedProfit: 6.25,
      estimatedMarginRate: 0.25,
      decision: "testable",
      note: "manual estimate",
      createdAt: "2026-06-29T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("valid");
    if (result.ok) {
      expect(result.data.estimatedProfit).toBe(6.25);
    }
  });

  it("returns repaired result when aliases or defaults are used", () => {
    const result = validateProfitSnapshot({
      estimatedPurchasePrice: "10",
      estimatedSellingPrice: "40",
      commissionRate: 15,
      decision: "cautious",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("repaired");
    if (result.ok) {
      expect(result.data.platformFeeRate).toBe(0.15);
      expect(result.data.decision).toBe("caution");
      expect(result.repairedFields).toEqual(expect.arrayContaining(["purchaseCost", "salePrice", "platformFeeRate", "decision"]));
    }
  });

  it("returns invalid_schema result for invalid payloads", () => {
    const result = validateProfitSnapshot("invalid");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("invalid_schema");
    if (!result.ok) {
      expect(result.userMessage).toBe("利润快照结构异常，已跳过保存。");
      expect(result.fieldErrors?.[0]?.field).toBe("profitSnapshot");
    }
  });
});
