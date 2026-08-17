import { describe, expect, it } from "vitest";
import { LOGIN_PRODUCT_JOURNEY } from "@/components/LoginPage";

describe("LoginPage product journey", () => {
  it("presents research as the main chain and creation as optional studios", () => {
    expect(LOGIN_PRODUCT_JOURNEY.map(({ number, label, description }) => ({
      number,
      label,
      description,
    }))).toEqual([
      { number: "01", label: "导入真实数据", description: "SellerSprite 数据进入候选池" },
      { number: "02", label: "商品研究", description: "收集 Amazon、VOC 与供应证据" },
      { number: "03", label: "AI 整理证据", description: "归纳重点、风险与信息缺口" },
      { number: "04", label: "人工决定", description: "决定继续、补资料或结束研究" },
      { number: "05", label: "内容创作", description: "已确认资料进入 Listing / Image Studio" },
    ]);

    expect(JSON.stringify(LOGIN_PRODUCT_JOURNEY)).not.toContain("创作交接");
  });
});
