import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Opportunities SellerSprite 运营入口", () => {
  it("以 ProductBatchManager 为主内容，无旧版候选兼容占位", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain("ProductBatchManager");
    expect(source).toContain("发现商品");
    // 不再渲染旧版批次与历史的占位壳 / 旧版候选兼容视图
    expect(source).not.toContain("OpportunitiesConvergenceView");
    expect(source).not.toContain("legacyContent");
    expect(source).not.toContain("MarketScreeningWorkbench");
    expect(source).not.toContain("旧版候选兼容视图");
    // 不引入后端耦合
    expect(source).not.toContain("opportunityCandidateService");
    expect(source).not.toContain("marketSignalRanking");
  });
});
