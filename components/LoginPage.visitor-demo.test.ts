import { describe, expect, it } from "vitest";
import { LOGIN_PRODUCT_JOURNEY } from "@/components/LoginPage";

describe("LoginPage product journey", () => {
  it("presents research as the main chain and creation as optional studios", () => {
    expect(LOGIN_PRODUCT_JOURNEY.map(({ number, label, description }) => ({
      number,
      label,
      description,
    }))).toEqual([
      { number: "01", label: "发现商品", description: "上传 SellerSprite，筛选候选商品" },
      { number: "02", label: "研究优先级", description: "结合市场信号安排研究顺序" },
      { number: "03", label: "AI 商品研究", description: "整理信息、风险与证据缺口" },
      { number: "04", label: "人工决策", description: "决定继续、待补或放弃" },
      { number: "05", label: "按需创作", description: "进入 Listing Studio / Image Studio" },
    ]);

    expect(JSON.stringify(LOGIN_PRODUCT_JOURNEY)).not.toContain("创作交接");
  });
});
