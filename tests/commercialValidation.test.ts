import { describe, it, expect } from "vitest";
import {
  buildProductDevelopmentBrief,
  type ProductDevelopmentBrief,
  type ProductDevelopmentBriefInput,
} from "../lib/productDevelopmentBrief";

export type TestCaseDefinition = {
  id: string;
  category: "high_potential" | "red_ocean" | "high_risk" | "low_margin" | "sourcing_advantage" | "missing_evidence";
  name: string;
  input: ProductDevelopmentBriefInput;
  expectedRecommendation: "promote" | "validate_first" | "abandon";
  expectedRiskStatus: "positive" | "caution" | "negative" | "unknown";
  expectedSourcingStatus: "positive" | "caution" | "negative" | "unknown";
  expectedMarketStatus: "positive" | "caution" | "negative" | "unknown";
  expectedHeadlineKeywords: string[];
  expectedNextActionKeywords: string[];
  explanationCheck: {
    whyQuestion: string;
    evidenceQuestion: string;
    failureRiskQuestion: string;
    missingInfoQuestion: string;
  };
};

export const COMMERCIAL_BENCHMARK_CASES: TestCaseDefinition[] = [
  // ── 1. 高潜力商品 ──
  {
    id: "CASE-01",
    category: "high_potential",
    name: "不锈钢儿童保温辅食罐（带折叠勺）",
    input: {
      productName: "Stainless Steel Kids Food Jar with Folding Spoon",
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
                bsr: { value: 320, status: "correct" },
                title: { value: "THERMOS FUNTAINER 10 Ounce Stainless Steel Food Jar", status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "lid-latch",
                label: "按扣卡槽易老化断裂",
                summary: "买家反映塑料按扣使用 2 个月后脱落",
                reviewCount: 42,
                strength: "high",
                evidenceRefs: ["rev-101", "rev-102"],
              },
              {
                themeId: "spoon-slot",
                label: "折叠勺容易丢失",
                summary: "收纳槽过松",
                reviewCount: 19,
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
              displayedPrice: "¥17.80",
              displayedMoq: "30件起批",
            },
          ],
        },
        riskReviewSnapshot: {
          overallLevel: "green",
          summary: "常规儿童保温容器，未见外观专利冲突，具备 FDA 报告",
          items: [
            {
              key: "cpc_cert",
              level: "low",
              label: "儿童产品证书(CPC)",
              reason: "供应商可提供第三方检测报告，合规清晰",
            },
          ],
        },
        profitSnapshot: {
          purchaseCost: 17.8,
          salePrice: 119.0,
          estimatedProfit: 46.5,
          estimatedMarginRate: 0.39,
        },
      },
    },
    expectedRecommendation: "promote",
    expectedRiskStatus: "positive",
    expectedSourcingStatus: "positive",
    expectedMarketStatus: "caution", // 痛点集中
    expectedHeadlineKeywords: ["需求明确", "合规风险可控", "供应链具备成本优势"],
    expectedNextActionKeywords: ["打样", "微改良", "小批量试单"],
    explanationCheck: {
      whyQuestion: "市场需求明确，合规清晰，供应链毛利高达 39%，且买家痛点集中提供了极佳的微创新突破口。",
      evidenceQuestion: "Amazon BSR #320/评分4.6星、1688货源报价¥17.80、VOC 42条差评提及按扣老化。",
      failureRiskQuestion: "若按扣改版不达标或折叠勺仍然易丢，会重蹈竞品差评覆辙；另外长途运输需防刮擦。",
      missingInfoQuestion: "已具备全量四维证据，仅需核验工厂大货样品的材质厚度与打样时效。",
    },
  },

  // ── 2. 红海商品（超薄瑜伽垫，低毛利与恶性价格战） ──
  {
    id: "CASE-02",
    category: "red_ocean",
    name: "常规超薄便携瑜伽垫",
    input: {
      productName: "Ultra Thin Travel Yoga Mat",
      resultJson: {
        browserEvidence: {
          targetAsin: "B07YOGA001",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B07YOGA001" },
              currency: "USD",
              fields: {
                price: { value: 9.99, status: "correct" },
                rating: { value: 4.0, status: "correct" },
                reviewCount: { value: 52000, status: "correct" },
                bsr: { value: 120, status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "smell",
                label: "刺鼻橡胶异味",
                summary: "开箱异味极其严重，久久不散",
                reviewCount: 156,
              },
              {
                themeId: "slippery",
                label: "出汗容易打滑",
                summary: "防滑涂层遇水失效",
                reviewCount: 98,
              },
            ],
          },
        },
        sourcingEvidence: {
          candidates: [
            {
              offerId: "offer-yoga-12",
              title: "TPE超薄便携瑜伽垫 1mm 环保折叠",
              displayedPrice: "¥16.50",
              displayedMoq: "200件起订",
            },
          ],
        },
        profitSnapshot: {
          purchaseCost: 16.5,
          salePrice: 38.0,
          estimatedProfit: 3.8,
          estimatedMarginRate: 0.10, // 仅 10% 毛利率
        },
      },
    },
    expectedRecommendation: "abandon",
    expectedRiskStatus: "caution",
    expectedSourcingStatus: "negative", // 利润过薄
    expectedMarketStatus: "caution",
    expectedHeadlineKeywords: ["采购成本过高", "利润模型", "微利/亏损"],
    expectedNextActionKeywords: ["停止", "放弃", "替代款式"],
    explanationCheck: {
      whyQuestion: "红海价格战严重，单件毛利不足 ¥4（毛利率 10%），无法覆盖海外仓与广告获客开销。",
      evidenceQuestion: "1688 采购 ¥16.50、Amazon 售价折合人民币不足 ¥40、评论超 5.2 万条垄断严重。",
      failureRiskQuestion: "广告 CPC 飙升侵蚀微薄利润，且异味差评退货率高。",
      missingInfoQuestion: "缺少高客单价差异化包装或更低成本源头工厂支持。",
    },
  },

  // ── 3. 高风险商品 A（大功率激光玩具） ──
  {
    id: "CASE-03",
    category: "high_risk",
    name: "大功率绿光激光笔猫玩具",
    input: {
      productName: "High Power Green Laser Pointer Cat Toy",
      resultJson: {
        risk: {
          overallLevel: "red",
          summary: "大功率激光设备存在人眼灼伤危险，属于 Amazon 强制下架与平台黑名单禁限售品类",
          blacklistMatches: ["大功率激光", "眼部辐射禁售品"],
        },
        summary: {
          verdict: "暂不建议做",
          summary: "严重合规红线，禁止销售",
        },
      },
    },
    expectedRecommendation: "abandon",
    expectedRiskStatus: "negative",
    expectedSourcingStatus: "unknown",
    expectedMarketStatus: "caution",
    expectedHeadlineKeywords: ["显著合规或侵权隐患", "大功率激光", "下架或封店"],
    expectedNextActionKeywords: ["停止", "放弃"],
    explanationCheck: {
      whyQuestion: "命中安全红线与禁售黑名单，继续上架会导致 Listing 强制删除甚至店铺受限。",
      evidenceQuestion: "风险黑名单命中：大功率激光、眼部辐射禁售品。",
      failureRiskQuestion: "买家投诉致盲或海关直接查扣退运。",
      missingInfoQuestion: "无（属于不可逆合规阻断项，无需补充信息）。",
    },
  },

  // ── 4. 高风险商品 B（外观设计侵权保温杯） ──
  {
    id: "CASE-04",
    category: "high_risk",
    name: "网红款渐变色不锈钢吸管保冷杯",
    input: {
      productName: "Quencher Style Tumbler with Handle",
      resultJson: {
        risk: {
          overallLevel: "red",
          summary: "外观与某头部品牌（Stanley）外观设计专利高度重合，已被多家海外律所发起 TRO 诉讼",
          blacklistMatches: ["外观设计专利侵权", "律所TRO高危类目"],
        },
        summary: {
          verdict: "暂不建议做",
          summary: "专利侵权风险极大",
        },
      },
    },
    expectedRecommendation: "abandon",
    expectedRiskStatus: "negative",
    expectedSourcingStatus: "unknown",
    expectedMarketStatus: "caution",
    expectedHeadlineKeywords: ["合规或侵权隐患", "外观设计专利侵权"],
    expectedNextActionKeywords: ["停止", "放弃"],
    explanationCheck: {
      whyQuestion: "涉及海外知名品牌外观专利侵权，面临律所冻结资金与平台封店处罚。",
      evidenceQuestion: "命中侵权标签：外观设计专利侵权、律所TRO高危类目。",
      failureRiskQuestion: "Paypal/亚马逊账号资金被法院冻结，面临高额和解金。",
      missingInfoQuestion: "如需继续，需重新开模研发具有独立外观专利授权的器型。",
    },
  },

  // ── 5. 低利润商品（超薄透明手机壳） ──
  {
    id: "CASE-05",
    category: "low_margin",
    name: "超薄防发黄透明硅胶手机壳",
    input: {
      productName: "Ultra Slim Clear TPU Phone Case",
      resultJson: {
        profitSnapshot: {
          purchaseCost: 3.5,
          salePrice: 18.0,
          estimatedProfit: 1.2,
          estimatedMarginRate: 0.067, // 毛利率 6.7%
        },
        sourcingEvidence: {
          candidates: [
            {
              offerId: "offer-case-001",
              title: "TPU透明手机壳",
              displayedPrice: "¥3.50",
              displayedMoq: "100件",
            },
          ],
        },
      },
    },
    expectedRecommendation: "abandon",
    expectedRiskStatus: "caution",
    expectedSourcingStatus: "negative",
    expectedMarketStatus: "unknown",
    expectedHeadlineKeywords: ["采购成本过高或利润模型", "微利/亏损"],
    expectedNextActionKeywords: ["停止", "替代款式"],
    explanationCheck: {
      whyQuestion: "毛利率仅 6.7%（单件利润仅 ¥1.2），只要发生 1 次退货或开启广告投放即陷入严重亏损。",
      evidenceQuestion: "采购 ¥3.50，售价 ¥18.00，预估毛利率 6.7%（< 15% 临界线）。",
      failureRiskQuestion: "抗运费涨价能力为零，发黄差评导致退货直接击穿成本池。",
      missingInfoQuestion: "缺少高溢价图案定制能力或与数码周边绑定的组合销售策略。",
    },
  },

  // ── 6. 供应链优势商品 A（陶瓷厨房台面收纳筒） ──
  {
    id: "CASE-06",
    category: "sourcing_advantage",
    name: "陶瓷厨房台面收纳筒二件套",
    input: {
      productName: "LE TAUCI Ceramic Utensil Holder 2-Piece Set",
      resultJson: {
        browserEvidence: {
          targetAsin: "B0CKQNP26P",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B0CKQNP26P" },
              currency: "USD",
              fields: {
                price: { value: 26.99, status: "correct" },
                rating: { value: 4.7, status: "correct" },
                reviewCount: { value: 3200, status: "correct" },
                bsr: { value: 850, status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "broken-shipping",
                label: "长途运输边缘易磕碰开裂",
                summary: "包装只有一层薄纸盒，收货时底座破损",
                reviewCount: 35,
              },
            ],
          },
        },
        sourcingEvidence: {
          humanConfirmed: [
            {
              offerId: "offer-ceramic-99",
              title: "潮州源头陶瓷收纳桶 浮雕双件套",
              displayedPrice: "¥26.00",
              displayedMoq: "30件",
            },
          ],
        },
        riskReviewSnapshot: {
          overallLevel: "green",
          summary: "日用陶瓷品类，工厂具备重金属溶出检测合格证明",
        },
        profitSnapshot: {
          purchaseCost: 26.0,
          salePrice: 189.0,
          estimatedProfit: 78.5,
          estimatedMarginRate: 0.415, // 毛利率 41.5%
        },
      },
    },
    expectedRecommendation: "promote",
    expectedRiskStatus: "positive",
    expectedSourcingStatus: "positive",
    expectedMarketStatus: "positive",
    expectedHeadlineKeywords: ["需求明确", "合规风险可控", "供应链具备成本优势"],
    expectedNextActionKeywords: ["打样", "微改良", "小批量试单"],
    explanationCheck: {
      whyQuestion: "潮州源头工厂成本优势显著，毛利率高达 41.5%，且买家痛点极其明确单一（运输包装防损）。",
      evidenceQuestion: "Amazon 售价 $26.99 (折合约¥189)、1688 源头出厂 ¥26.00、VOC 35条抱怨运输破损。",
      failureRiskQuestion: "长途海运防震跌落不达标导致入仓爆仓或客户开箱即破损退款。",
      missingInfoQuestion: "需核对工厂定制珍珠棉/保丽龙包材方案及每套加收的包材成本。",
    },
  },

  // ── 7. 供应链优势商品 B（加厚防潮便携野餐垫） ──
  {
    id: "CASE-07",
    category: "sourcing_advantage",
    name: "加厚防水牛津布户外野餐垫",
    input: {
      productName: "Waterproof Outdoor Picnic Blanket",
      resultJson: {
        browserEvidence: {
          targetAsin: "B08PICNIC01",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B08PICNIC01" },
              currency: "USD",
              fields: {
                price: { value: 21.99, status: "correct" },
                rating: { value: 4.4, status: "correct" },
                reviewCount: { value: 1800, status: "correct" },
                bsr: { value: 2100, status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "water-seep",
                label: "湿草地容易渗水",
                summary: "底部 PE 膜太薄容易被树枝扎破渗水",
                reviewCount: 28,
              },
            ],
          },
        },
        sourcingEvidence: {
          humanConfirmed: [
            {
              offerId: "offer-picnic-66",
              title: "600D加厚牛津布野餐垫 铝箔防潮底膜",
              displayedPrice: "¥21.50",
              displayedMoq: "20件起订",
            },
          ],
        },
        riskReviewSnapshot: {
          overallLevel: "green",
          summary: "户外纺织常规普货，无特殊认证限制",
        },
        profitSnapshot: {
          purchaseCost: 21.5,
          salePrice: 154.0,
          estimatedProfit: 55.0,
          estimatedMarginRate: 0.357,
        },
      },
    },
    expectedRecommendation: "promote",
    expectedRiskStatus: "positive",
    expectedSourcingStatus: "positive",
    expectedMarketStatus: "positive",
    expectedHeadlineKeywords: ["需求明确", "供应链具备成本优势"],
    expectedNextActionKeywords: ["打样", "微改良", "小批量试单"],
    explanationCheck: {
      whyQuestion: "户外热度持续，1688 铝箔加厚底膜可完美解决竞品渗水痛点，MOQ 仅 20 件极低门槛启动。",
      evidenceQuestion: "采购 ¥21.50，售价 ¥154.00，毛利率 35.7%，MOQ 20 件。",
      failureRiskQuestion: "季节性波动（秋冬季销量回落）；若折叠体积过大引起 FBA 尺寸分段跳档增加配送费。",
      missingInfoQuestion: "需确认折叠压缩后包装尺寸（是否满足标准小件或大件门槛）。",
    },
  },

  // ── 8. 缺少关键证据 A（缺少 1688 供应链货源数据） ──
  {
    id: "CASE-08",
    category: "missing_evidence",
    name: "超声波七彩香薰加湿器",
    input: {
      productName: "Ultrasonic Essential Oil Diffuser with LED Light",
      resultJson: {
        browserEvidence: {
          targetAsin: "B09DIFFUSER",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B09DIFFUSER" },
              currency: "USD",
              fields: {
                price: { value: 29.99, status: "correct" },
                rating: { value: 4.5, status: "correct" },
                reviewCount: { value: 8900, status: "correct" },
                bsr: { value: 650, status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "noisy",
                label: "夜间运行电机有蜂鸣噪音",
                summary: "睡眠时听到明显的马达嗡嗡声",
                reviewCount: 45,
              },
            ],
          },
        },
        // 故意不传 sourcingEvidence 和 profitSnapshot
      },
    },
    expectedRecommendation: "validate_first",
    expectedRiskStatus: "caution",
    expectedSourcingStatus: "unknown", // 缺少 1688
    expectedMarketStatus: "positive",
    expectedHeadlineKeywords: ["建议先小单验证", "测款", "切勿直接重资金备货"],
    expectedNextActionKeywords: ["补充核对缺失证据", "重点核实供应商真实起订量"],
    explanationCheck: {
      whyQuestion: "市场需求虽然存在，但目前缺少真实 1688 供货价与 MOQ，无法算利，贸然备货风险不可控。",
      evidenceQuestion: "已具备 Amazon 采集与 VOC 差评，但缺少 1688 供应商信号与利润数据。",
      failureRiskQuestion: "由于属于带电弱电类目，若未核验工厂电源适配器 UL/ETL 认证，在入仓阶段可能被截扣。",
      missingInfoQuestion: "缺少 1688 供货报价、起订量（MOQ）以及出厂适配器安规认证证明。",
    },
  },

  // ── 9. 缺少关键证据 B（缺少 Amazon 详情页与 VOC 证据） ──
  {
    id: "CASE-09",
    category: "missing_evidence",
    name: "金属机械解压指尖陀螺",
    input: {
      productName: "Mechanical Metal Fidget Spinner",
      resultJson: {
        // 故意不传 browserEvidence 和 vocAnalysis
        sourcingEvidence: {
          humanConfirmed: [
            {
              offerId: "offer-fidget-001",
              title: "精密全铜指尖陀螺 轴承可拆卸",
              displayedPrice: "¥8.80",
              displayedMoq: "50件",
            },
          ],
        },
        profitSnapshot: {
          purchaseCost: 8.8,
          salePrice: 79.0,
          estimatedProfit: 28.5,
          estimatedMarginRate: 0.36,
        },
      },
    },
    expectedRecommendation: "validate_first",
    expectedRiskStatus: "caution",
    expectedSourcingStatus: "positive",
    expectedMarketStatus: "unknown", // 缺少 Amazon
    expectedHeadlineKeywords: ["建议先小单验证", "测款", "切勿直接重资金备货"],
    expectedNextActionKeywords: ["补充核对缺失证据", "小批量采购"],
    explanationCheck: {
      whyQuestion: "国内货源虽好，但缺少海外真实买家反馈与竞品售价数据，未验证海外消费者是否真正买单。",
      evidenceQuestion: "具备 1688 报价（¥8.80）与利润测算，但 Amazon 市场信号与 VOC 痛点为 0 条。",
      failureRiskQuestion: "解压玩具可能属于短期快闪爆款（Fad），入仓后热度消退面临高额长期仓储费与滞销清仓。",
      missingInfoQuestion: "缺少 Amazon 竞品详情页采集、买家差评分布及近 90 天销量走势。",
    },
  },

  // ── 10. 缺少关键证据 C（儿童接触品类，待核验 CPC 认证） ──
  {
    id: "CASE-10",
    category: "missing_evidence",
    name: "婴幼儿食品级硅胶磨牙棒咬咬胶",
    input: {
      productName: "Baby Silicone Teething Toy",
      resultJson: {
        browserEvidence: {
          targetAsin: "B08TEETH01",
          snapshots: [
            {
              entityBinding: { bound: true, pageAsin: "B08TEETH01" },
              currency: "USD",
              fields: {
                price: { value: 11.99, status: "correct" },
                rating: { value: 4.8, status: "correct" },
                reviewCount: { value: 4300, status: "correct" },
                bsr: { value: 450, status: "correct" },
              },
            },
          ],
        },
        vocAnalysis: {
          themes: {
            painPointThemes: [
              {
                themeId: "small-parts",
                label: "担心凸起部分被幼儿咬下误吞",
                summary: "买家非常介意小零件窒息风险",
                reviewCount: 22,
              },
            ],
          },
        },
        sourcingEvidence: {
          humanConfirmed: [
            {
              offerId: "offer-teether-88",
              title: "食品级硅胶小鹿曼哈顿球咬胶",
              displayedPrice: "¥6.20",
              displayedMoq: "100件",
            },
          ],
        },
        riskReviewSnapshot: {
          overallLevel: "yellow",
          summary: "婴幼儿直接接触品类，Amazon 强制要求出具 CPSC 认可实验室的 CPC 证书与拉力测试报告",
        },
        profitSnapshot: {
          purchaseCost: 6.2,
          salePrice: 84.0,
          estimatedProfit: 31.0,
          estimatedMarginRate: 0.369,
        },
      },
    },
    expectedRecommendation: "validate_first",
    expectedRiskStatus: "caution", // 中度合规需复核
    expectedSourcingStatus: "positive",
    expectedMarketStatus: "positive",
    expectedHeadlineKeywords: ["建议先小单验证", "确认类目认证资质", "切勿直接重资金备货"],
    expectedNextActionKeywords: ["补充核对缺失证据", "目标平台准入证书"],
    explanationCheck: {
      whyQuestion: "虽然毛利与需求优秀，但属于美国极高监管强度的儿童玩具品类，未确认检测报告前绝不可打款。",
      evidenceQuestion: "Amazon BSR #450、毛利率 36.9%、风险等级标记为 yellow（需 CPC 认证）。",
      failureRiskQuestion: "若供应商提供的 CPC 检测报告不被 Amazon 审核机构认可，货物到港后将被海关扣押销毁。",
      missingInfoQuestion: "工厂真实 CPC 证书编号、CPSC 认可实验室英文报告原件及小零件拉力测试记录。",
    },
  },
];

describe("Commercial Benchmark Validation (10大商业案例实战验证)", () => {
  COMMERCIAL_BENCHMARK_CASES.forEach((tc) => {
    it(`[${tc.id}] ${tc.name} (${tc.category}) - 验证商业判断与决策契约`, () => {
      const brief: ProductDevelopmentBrief = buildProductDevelopmentBrief(tc.input);

      // 1. 验证最终建议
      expect(brief.recommendation).toBe(tc.expectedRecommendation);

      // 2. 验证三大维度状态
      expect(brief.basis.risk.status).toBe(tc.expectedRiskStatus);
      expect(brief.basis.sourcing.status).toBe(tc.expectedSourcingStatus);
      expect(brief.basis.market.status).toBe(tc.expectedMarketStatus);

      // 3. 验证 30 秒 Headline 关键词
      for (const kw of tc.expectedHeadlineKeywords) {
        const inHeadlineOrLabel = brief.headline.includes(kw) || brief.recommendationLabel.includes(kw);
        expect(inHeadlineOrLabel).toBe(true);
      }

      // 4. 验证下一步动作关键词
      const combinedNextSteps = brief.advice.nextSteps.join(" ");
      for (const kw of tc.expectedNextActionKeywords) {
        expect(combinedNextSteps).toContain(kw);
      }

      // 5. 验证解释能力（四问检查）
      expect(brief.headline.length).toBeGreaterThan(15);
      expect(brief.advice.supplierCheckpoints.length).toBeGreaterThanOrEqual(3);
      expect(brief.evidenceReadiness).toBeDefined();

      if (tc.expectedRecommendation === "promote") {
        expect(brief.advice.keyDifferentiator.length).toBeGreaterThan(10);
      }
    });
  });
});
