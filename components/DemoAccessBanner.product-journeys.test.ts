import { describe, expect, it } from "vitest";
import { formatDemoAccessBannerContent } from "@/components/DemoAccessBanner";

const snapshot = {
  id: "visitor-a",
  label: "Visitor A",
  expiresAt: null,
  isActive: true,
  quotaMetric: "product_journeys_v1" as const,
  maxProducts: 5,
  usedProducts: 2,
  reservedProducts: 0,
  remainingProducts: 3,
  migrationStatus: "migrated" as const,
};

describe("DemoAccessBanner product-journey copy", () => {
  it("shows used and remaining products without AI-call or 24h wording", () => {
    const content = formatDemoAccessBannerContent(snapshot);

    expect(content).toContain("访客体验");
    expect(content).toContain("已使用商品 2 / 5");
    expect(content).toContain("剩余 3 个商品");
    expect(content).toContain("每个商品可体验商品研究、人工决策、Listing和产品图片完整流程。");
    expect(content).not.toMatch(/AI调用|真实 AI 操作次数|24 小时|有效期/);
  });

  it("keeps existing history available in the exhausted message", () => {
    expect(formatDemoAccessBannerContent({
      ...snapshot,
      usedProducts: 5,
      remainingProducts: 0,
    })).toContain("5个商品体验名额已全部使用，已有研究记录仍可查看。");
  });
});
