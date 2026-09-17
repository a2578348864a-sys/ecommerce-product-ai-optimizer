import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ProductDevelopmentBriefCard } from "./ProductDevelopmentBriefCard";
import { buildProductDevelopmentBrief } from "@/lib/productDevelopmentBrief";

describe("ProductDevelopmentBriefCard (商品开发决策卡组件)", () => {
  it("渲染建议推进的决策卡，包含核心结论与三大依据", () => {
    const brief = buildProductDevelopmentBrief({
      productName: "Stainless Steel Kids Food Jar",
      resultJson: {
        browserEvidence: {
          targetAsin: "B0017IFSIS",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B0017IFSIS" },
              currency: "USD",
              fields: {
                price: { value: 16.99, status: "correct" },
                rating: { value: 4.6, status: "correct" },
                reviewCount: { value: 12450, status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "lid-latch",
                label: "盖子卡扣易断裂",
                summary: "使用两个月后卡扣断裂",
                reviewCount: 38,
              },
            ],
          },
        },
        sourcingEvidence: {
          humanConfirmed: [
            {
              offerId: "offer-12345",
              title: "儿童不锈钢保温罐",
              displayedPrice: "¥18.00",
              displayedMoq: "30件",
            },
          ],
        },
        riskReviewSnapshot: {
          overallLevel: "green",
          summary: "常规普货，未发现专利风险",
        },
        profitSnapshot: {
          purchaseCost: 18.0,
          salePrice: 110.0,
          estimatedProfit: 42.0,
          estimatedMarginRate: 0.38,
        },
      },
    });

    const html = renderToStaticMarkup(createElement(ProductDevelopmentBriefCard, { brief }));

    expect(html).toContain("商品开发决策卡");
    expect(html).toContain("建议推进");
    expect(html).toContain("核心开发结论");
    expect(html).toContain("市场需求与买家声音 (VOC)");
    expect(html).toContain("供应链与利润测算");
    expect(html).toContain("合规门槛与侵权防线");
    expect(html).toContain("Amazon 售价");
    expect(html).toContain("盖子卡扣易断裂");
    expect(html).toContain("1688 #2345");
  });

  it("渲染暂不建议决策卡，包含警告与拦截信息", () => {
    const brief = buildProductDevelopmentBrief({
      productName: "High Power Laser",
      resultJson: {
        risk: {
          overallLevel: "red",
          summary: "高风险激光武器，平台禁售",
          blacklistMatches: ["大功率激光"],
        },
      },
    });

    const html = renderToStaticMarkup(createElement(ProductDevelopmentBriefCard, { brief }));

    expect(html).toContain("暂不建议");
    expect(html).toContain("存在高风险拦截项");
    expect(html).toContain("大功率激光");
  });

  it("当处于降级状态时，提示补充证据", () => {
    const brief = buildProductDevelopmentBrief({});
    const html = renderToStaticMarkup(createElement(ProductDevelopmentBriefCard, { brief }));

    expect(html).toContain("当前商品暂无已保存的采集证据");
  });
});
