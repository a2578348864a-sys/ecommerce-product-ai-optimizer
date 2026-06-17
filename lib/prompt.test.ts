import { describe, it, expect } from "vitest";
import { buildRiskCheckPrompt, buildSourcingPrompt } from "@/lib/cross-border/prompts";

describe("buildRiskCheckPrompt", () => {
  it("returns a string containing the product name", () => {
    const result = buildRiskCheckPrompt({
      productName: "测试商品",
      category: "家居日用",
      claims: "防水",
      targetPlatform: "shopify",
      description: "一个测试描述",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("测试商品");
    expect(result).toContain("shopify");
  });

  it("handles empty optional fields", () => {
    const result = buildRiskCheckPrompt({
      productName: "测试",
      category: "",
      claims: "",
      targetPlatform: "amazon",
      description: "",
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildSourcingPrompt", () => {
  it("returns a string containing the product name", () => {
    const result = buildSourcingPrompt({
      productName: "折叠水杯",
      category: "户外用品",
      targetPrice: "19.99 USD",
      targetPlatform: "shopify",
      description: "硅胶材质",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("折叠水杯");
    expect(result).toContain("1688");
  });

  it("handles empty fields gracefully", () => {
    const result = buildSourcingPrompt({
      productName: "测试",
      category: "",
      targetPrice: "",
      targetPlatform: "etsy",
      description: "",
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
