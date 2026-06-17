import { describe, it, expect } from "vitest";
import { calculateProfit } from "@/lib/profit";

describe("calculateProfit", () => {
  it("calculates basic profit correctly", () => {
    const result = calculateProfit({
      purchasePrice: 50,
      domesticShippingFee: 5,
      internationalShippingFee: 20,
      commissionRate: 15,
      expectedProfitRate: 30,
      otherCost: 0,
      manualSellingPrice: undefined,
      currency: "USD",
    });

    expect(result.baseCost).toBe(75); // 50 + 5 + 20
    expect(result.totalFixedCost).toBe(75); // same as baseCost without otherCost
    expect(result.commissionRate).toBe(15);
    expect(result.currency).toBe("USD");
    expect(result.suggestedPrice).toBeGreaterThan(0);
    expect(result.breakEvenPrice).toBeGreaterThan(0);
    expect(result.grossProfit).toBeGreaterThan(0);
    expect(result.grossMargin).toBeGreaterThan(0);
  });

  it("returns warnings when cost exceeds manual price", () => {
    const result = calculateProfit({
      purchasePrice: 100,
      domesticShippingFee: 10,
      internationalShippingFee: 50,
      commissionRate: 15,
      expectedProfitRate: 30,
      otherCost: 0,
      manualSellingPrice: 50,
      currency: "USD",
    });

    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("handles zero values gracefully", () => {
    const result = calculateProfit({
      purchasePrice: 0,
      domesticShippingFee: 0,
      internationalShippingFee: 0,
      commissionRate: 0,
      expectedProfitRate: 0,
      otherCost: 0,
      currency: "CNY",
    });

    expect(result.currency).toBe("CNY");
    expect(result.baseCost).toBe(0);
  });

  it("handles string number inputs", () => {
    const result = calculateProfit({
      purchasePrice: "30" as unknown as number,
      domesticShippingFee: "5" as unknown as number,
      internationalShippingFee: 15,
      commissionRate: 10,
      expectedProfitRate: 20,
      otherCost: 0,
      currency: "USD",
    });

    expect(result.totalFixedCost).toBeGreaterThan(0);
  });
});
