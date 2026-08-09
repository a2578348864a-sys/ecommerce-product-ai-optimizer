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
  standaloneListingLimit: 3,
  standaloneListingUsed: 0,
  standaloneListingReserved: 0,
  standaloneListingRemaining: 3,
  standaloneImageUnitLimit: 3,
  standaloneImageUnitsUsed: 0,
  standaloneImageUnitsReserved: 0,
  standaloneImageUnitsRemaining: 3,
};

describe("DemoAccessBanner product-journey copy", () => {
  it("shows concise research and standalone Studio quotas without AI-call or 24h wording", () => {
    const content = formatDemoAccessBannerContent(snapshot);

    expect(content).toContain("访客体验");
    expect(content).toContain("商品研究 2/5");
    expect(content).toContain("独立 Listing 剩余 3 次");
    expect(content).toContain("独立生图 剩余 3 张");
    expect(content).not.toMatch(/AI调用|真实 AI 操作次数|24 小时|有效期/);
  });

  it("keeps existing history available in the exhausted message", () => {
    expect(formatDemoAccessBannerContent({
      ...snapshot,
      usedProducts: 5,
      remainingProducts: 0,
    })).toContain("商品研究 5/5");
  });
});
