import { describe, it, expect } from "vitest";
import { calculateProfit } from "@/lib/profit";

describe("calculateProfit", () => {
  it("calculates basic profit correctly", () => {
    const result = calculateProfit({
      purchasePrice: 50,
      domesticShippingFee: 5,
      internationalShippingFee: 20,
      commissionRate: 0.15,
      expectedProfitRate: 0.3,
      otherCost: 0,
      manualSellingPrice: undefined,
      currency: "USD",
    });

    expect(result.baseCost).toBe(75); // 50 + 5 + 20
    expect(result.totalFixedCost).toBe(75); // same as baseCost without otherCost
    expect(result.commissionRate).toBe(0.15);
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
      commissionRate: 0.15,
      expectedProfitRate: 0.3,
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
      commissionRate: 0.1,
      expectedProfitRate: 0.2,
      otherCost: 0,
      currency: "USD",
    });

    expect(result.totalFixedCost).toBeGreaterThan(0);
  });

  it("uses selling-price margin for 15 purchase / 25 sale / 15 percent commission", () => {
    const result = calculateProfit({
      purchasePrice: 15,
      domesticShippingFee: 0,
      internationalShippingFee: 0,
      commissionRate: 0.15,
      expectedProfitRate: 0,
      otherCost: 0,
      manualSellingPrice: 25,
      currency: "CNY",
    });

    expect(result.commissionAmount).toBe(3.75);
    expect(result.grossProfit).toBe(6.25);
    expect(result.grossMargin).toBe(0.25);
  });

  it("shows negative profit for 20 purchase / 18 sale / 15 percent commission", () => {
    const result = calculateProfit({
      purchasePrice: 20,
      domesticShippingFee: 0,
      internationalShippingFee: 0,
      commissionRate: 0.15,
      expectedProfitRate: 0,
      otherCost: 0,
      manualSellingPrice: 18,
      currency: "CNY",
    });

    expect(result.commissionAmount).toBe(2.7);
    expect(result.grossProfit).toBe(-4.7);
    expect(result.grossMargin).toBeCloseTo(-0.2611, 4);
  });
});
