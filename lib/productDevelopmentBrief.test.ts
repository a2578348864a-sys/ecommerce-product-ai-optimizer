import { describe, it, expect } from "vitest";
import {
  buildProductDevelopmentBrief,
  type ProductDevelopmentBriefInput,
} from "./productDevelopmentBrief";

describe("ProductDevelopmentBrief (商品开发决策卡计算引擎)", () => {
  it("有完整 Evidence（Amazon + VOC + 1688 + Risk）时，能正确抽取证据引用并给出推进决策", () => {
    const input: ProductDevelopmentBriefInput = {
      productName: "Stainless Steel Kids Food Jar",
      resultJson: {
        browserEvidence: {
          targetAsin: "B0017IFSIS",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B0017IFSIS" },
              capturedAt: "2026-09-17T12:00:00Z",
              currency: "USD",
              fields: {
                price: { value: 16.99, status: "correct" },
                rating: { value: 4.6, status: "correct" },
                reviewCount: { value: 12450, status: "correct" },
                bsr: { value: 320, status: "correct" },
                title: { value: "THERMOS FUNTAINER 10 Ounce Stainless Steel Food Jar", status: "correct" },
              },
              productInfo: {
                canonicalFacts: {
                  material: "Stainless Steel",
                  capacity: "10 Ounce",
                },
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
                summary: "许多买家反映使用 2 个月后塑料按扣脱落",
                reviewCount: 42,
                strength: "high",
                evidenceRefs: ["rev-101", "rev-102"],
              },
              {
                themeId: "spoon-holder",
                label: "折叠勺容易丢失",
                summary: "底部固定槽较松，勺子容易掉出",
                reviewCount: 18,
                strength: "medium",
                evidenceRefs: ["rev-201"],
              },
            ],
          },
        },
        sourcingEvidence: {
          humanConfirmed: [
            {
              offerId: "offer-889922",
              title: "304不锈钢儿童保温罐 300ml 带折叠勺",
              displayedPrice: "¥18.50",
              displayedMoq: "50件起批",
            },
          ],
        },
        riskReviewSnapshot: {
          overallLevel: "green",
          summary: "常规儿童保温容器，未见外观专利冲突",
          items: [
            {
              key: "cpc_cert",
              level: "low",
              label: "儿童产品证书(CPC)",
              reason: "供应商可提供第三方 FDA/CPC 检测报告，风险可控",
            },
          ],
        },
        profitSnapshot: {
          purchaseCost: 18.5,
          salePrice: 118.0,
          estimatedProfit: 45.2,
          estimatedMarginRate: 0.383,
        },
      },
    };

    const brief = buildProductDevelopmentBrief(input);

    expect(brief.version).toBe("product-development-brief-v1");
    expect(brief.recommendation).toBe("promote");
    expect(brief.recommendationLabel).toContain("建议推进");
    expect(brief.isFallback).toBe(false);

    // 验证证据准备度
    expect(brief.evidenceReadiness.amazon).toBe(true);
    expect(brief.evidenceReadiness.voc).toBe(true);
    expect(brief.evidenceReadiness.sourcing).toBe(true);
    expect(brief.evidenceReadiness.risk).toBe(true);
    expect(brief.evidenceReadiness.overallScore).toBe(100);

    // 验证三大依据
    expect(brief.basis.market.signals.length).toBeGreaterThan(0);
    expect(brief.basis.market.signals.some((s) => s.sourceType === "amazon")).toBe(true);
    expect(brief.basis.sourcing.signals.some((s) => s.sourceType === "sourcing")).toBe(true);
    expect(brief.basis.risk.signals.some((s) => s.sourceType === "risk")).toBe(true);

    // 验证 VOC 痛点被转化入差异化建议
    expect(brief.advice.keyDifferentiator).toContain("盖子卡扣易断裂");
    expect(brief.advice.targetAudience).toContain("儿童");
    expect(brief.advice.supplierCheckpoints.length).toBeGreaterThanOrEqual(3);
    expect(brief.advice.nextSteps[0]).toContain("打样");
  });

  it("高风险品类（红灯 / 命中黑名单 / 侵权）坚决裁决为 abandon", () => {
    const input: ProductDevelopmentBriefInput = {
      productName: "Laser Toy for Cats",
      resultJson: {
        risk: {
          overallLevel: "red",
          summary: "大功率激光存在严重安全隐患与平台禁限售管制",
          blacklistMatches: ["大功率激光", "眼部辐射风险"],
        },
        summary: {
          verdict: "暂不建议做",
          summary: "平台严厉打击此类违规带辐射玩具",
        },
      },
    };

    const brief = buildProductDevelopmentBrief(input);

    expect(brief.recommendation).toBe("abandon");
    expect(brief.recommendationLabel).toContain("暂不建议");
    expect(brief.badgeText).toContain("暂不建议");
    expect(brief.recommendationTone).toContain("rose");
    expect(brief.headline).toContain("大功率激光");
    expect(brief.basis.risk.status).toBe("negative");
    expect(brief.advice.nextSteps.some((s) => s.includes("停止") || s.includes("放弃"))).toBe(true);
  });

  it("当缺乏一手数据或只有中度风险时，给出建议先小单验证（validate_first）", () => {
    const input: ProductDevelopmentBriefInput = {
      productName: "Ceramic Mug Set",
      resultJson: {
        sourcing: {
          feasibility: "medium",
          summary: "货源常规，但陶瓷易碎，需确认包装防破损",
        },
        risk: {
          overallLevel: "yellow",
          summary: "食品接触陶瓷需确认铅镉溶出检测",
        },
        finalReport: {
          finalVerdict: "可做但需控制损耗与合规",
          riskLevel: "yellow",
        },
      },
    };

    const brief = buildProductDevelopmentBrief(input);

    expect(brief.recommendation).toBe("validate_first");
    expect(brief.recommendationLabel).toContain("验证");
    expect(brief.badgeText).toContain("验证");
    expect(brief.recommendationTone).toContain("amber");
    expect(brief.headline).toContain("测款");
  });

  it("历史旧任务无任何 Evidence 时，平滑降级（Fail-soft），不报错且声明缺失缺口", () => {
    const input: ProductDevelopmentBriefInput = {
      resultJson: null,
      workflowResult: null,
    };

    const brief = buildProductDevelopmentBrief(input);

    expect(brief).toBeDefined();
    expect(brief.isFallback).toBe(true);
    expect(brief.evidenceReadiness.overallScore).toBe(0);
    expect(brief.gaps.length).toBeGreaterThan(0);
    expect(brief.headline).toBeDefined();
    expect(brief.advice.supplierCheckpoints.length).toBeGreaterThan(0);
  });
});
