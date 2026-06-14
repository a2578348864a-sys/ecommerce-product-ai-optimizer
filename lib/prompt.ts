import {
  defaultPlatformStatus,
  personalLimitOptions,
  preferredCategories,
  reportDisclaimer,
  riskBlacklist,
} from "./types";
import type { EvidenceCard, RadarFormInput } from "./types";

const confidenceFieldSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fieldName: { type: "string" },
    value: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string" },
  },
  required: ["fieldName", "value", "confidence", "reason"],
} as const;

const evidenceCardSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    materialId: { type: "string" },
    materialType: { type: "string", enum: ["url", "image", "text"] },
    detectedMaterialType: {
      type: "string",
      enum: ["product_page", "ranking_page", "search_result", "note", "comment_screenshot", "product_image", "manual_text", "unknown"],
    },
    status: { type: "string", enum: ["success", "partial", "failed", "need_more_info"] },
    missingFields: { type: "array", items: { type: "string" } },
    message: { type: "string" },
    riskNotes: { type: "string" },
    userNotes: { type: "string" },
    productName: { type: "string" },
    normalizedProductName: { type: "string" },
    priceText: { type: "string" },
    salesText: { type: "string" },
    ratingText: { type: "string" },
    rankText: { type: "string" },
    shopName: { type: "string" },
    brandName: { type: "string" },
    pageTitle: { type: "string" },
    visibleDescription: { type: "string" },
    sourceUrl: { type: "string" },
    platform: { type: "string" },
    rawEvidenceText: { type: "string" },
    capturedAt: { type: "string" },
    confidenceFields: { type: "array", items: confidenceFieldSchema },
  },
  required: [
    "id",
    "materialId",
    "materialType",
    "detectedMaterialType",
    "status",
    "missingFields",
    "message",
    "riskNotes",
    "userNotes",
    "productName",
    "normalizedProductName",
    "priceText",
    "salesText",
    "ratingText",
    "rankText",
    "shopName",
    "brandName",
    "pageTitle",
    "visibleDescription",
    "sourceUrl",
    "platform",
    "rawEvidenceText",
    "capturedAt",
    "confidenceFields",
  ],
} as const;

const scoreFields = {
  hotScore: { type: "number" },
  beginnerFitScore: { type: "number" },
  competitionScore: { type: "number" },
  afterSalesRiskScore: { type: "number" },
  ipRiskScore: { type: "number" },
  logisticsRiskScore: { type: "number" },
  grossMarginPotentialScore: { type: "number" },
  finalScore: { type: "number" },
} as const;

const sourcingKeywordsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    source1688: { type: "array", items: { type: "string" } },
    pdd: { type: "array", items: { type: "string" } },
    taobao: { type: "array", items: { type: "string" } },
    specsAndMaterials: { type: "array", items: { type: "string" } },
    differentiation: { type: "array", items: { type: "string" } },
  },
  required: ["source1688", "pdd", "taobao", "specsAndMaterials", "differentiation"],
} as const;

const candidateProductSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    productName: { type: "string" },
    normalizedProductName: { type: "string" },
    platform: { type: "string" },
    priceText: { type: "string" },
    salesText: { type: "string" },
    ratingText: { type: "string" },
    rankText: { type: "string" },
    shopName: { type: "string" },
    brandName: { type: "string" },
    productUrl: { type: "string" },
    sourceUrl: { type: "string" },
    capturedAt: { type: "string" },
    sourcePlatform: { type: "string" },
    rawEvidenceText: { type: "string" },
    evidenceText: { type: "string" },
    riskTags: { type: "array", items: { type: "string" } },
    ...scoreFields,
    hotReason: { type: "string" },
    beginnerFitReason: { type: "string" },
    competitionRisk: { type: "string" },
    afterSalesRisk: { type: "string" },
    ipRisk: { type: "string" },
    logisticsRisk: { type: "string" },
    estimatedCostRange: { type: "string" },
    suggestedSellingPrice: { type: "string" },
    grossMarginHint: { type: "string" },
    shippingDifficulty: { type: "string" },
    afterSalesDifficulty: { type: "string" },
    ipRiskLevel: { type: "string" },
    sourcingKeywords: sourcingKeywordsSchema,
    differentiationAngle: { type: "string" },
    similarDirections: { type: "array", items: { type: "string" } },
    finalDecision: { type: "string", enum: ["recommend", "caution", "reject"] },
    reason: { type: "string" },
  },
  required: [
    "productName",
    "normalizedProductName",
    "platform",
    "priceText",
    "salesText",
    "ratingText",
    "rankText",
    "shopName",
    "brandName",
    "productUrl",
    "sourceUrl",
    "capturedAt",
    "sourcePlatform",
    "rawEvidenceText",
    "evidenceText",
    "riskTags",
    "hotScore",
    "beginnerFitScore",
    "competitionScore",
    "afterSalesRiskScore",
    "ipRiskScore",
    "logisticsRiskScore",
    "grossMarginPotentialScore",
    "finalScore",
    "hotReason",
    "beginnerFitReason",
    "competitionRisk",
    "afterSalesRisk",
    "ipRisk",
    "logisticsRisk",
    "estimatedCostRange",
    "suggestedSellingPrice",
    "grossMarginHint",
    "shippingDifficulty",
    "afterSalesDifficulty",
    "ipRiskLevel",
    "sourcingKeywords",
    "differentiationAngle",
    "similarDirections",
    "finalDecision",
    "reason",
  ],
} as const;

export const radarJsonSchema = {
  name: "hot_product_radar_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      finalDecision: { type: "string", enum: ["recommend", "caution", "reject"] },
      confidenceLevel: { type: "string", enum: ["low", "medium", "high"] },
      sampleQuality: { type: "string" },
      agentConclusion: { type: "string" },
      platformSearchStatus: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            platform: { type: "string", enum: ["manual", "jd", "taobao", "tmall", "pdd", "douyin", "xhs"] },
            status: {
              type: "string",
              enum: ["success", "partial", "need_login", "no_permission", "captcha", "failed", "manual_required", "not_supported_yet"],
            },
            message: { type: "string" },
            itemCount: { type: "number" },
          },
          required: ["platform", "status", "message", "itemCount"],
        },
      },
      evidenceCards: { type: "array", items: evidenceCardSchema },
      candidateProducts: { type: "array", items: candidateProductSchema },
      recommendedProducts: { type: "array", items: candidateProductSchema },
      cautiousProducts: { type: "array", items: candidateProductSchema },
      rejectedProducts: { type: "array", items: candidateProductSchema },
      platformEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            platform: { type: "string" },
            evidenceSummary: { type: "string" },
            credibility: { type: "string" },
            gaps: { type: "string" },
          },
          required: ["platform", "evidenceSummary", "credibility", "gaps"],
        },
      },
      riskWarnings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            riskType: { type: "string" },
            level: { type: "string", enum: ["green", "yellow", "red"] },
            relatedProducts: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["riskType", "level", "relatedProducts", "reason", "suggestion"],
        },
      },
      sourcingKeywords: { type: "array", items: { type: "string" } },
      differentiationIdeas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            productDirection: { type: "string" },
            angle: { type: "string" },
            whyItMayWork: { type: "string" },
            contentSuggestion: { type: "string" },
          },
          required: ["productDirection", "angle", "whyItMayWork", "contentSuggestion"],
        },
      },
      similarProductDirections: { type: "array", items: { type: "string" } },
      nextActions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            productDirection: { type: "string" },
            action: { type: "string" },
            checklist: { type: "array", items: { type: "string" } },
            testSuggestion: { type: "string", enum: ["先观察", "小批量测试", "暂不做", "直接排除"] },
          },
          required: ["productDirection", "action", "checklist", "testSuggestion"],
        },
      },
      trafficLightRisks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            level: { type: "string", enum: ["green", "yellow", "red"] },
            explanation: { type: "string" },
          },
          required: ["name", "level", "explanation"],
        },
      },
      disclaimer: { type: "string" },
    },
    required: [
      "summary",
      "finalDecision",
      "confidenceLevel",
      "sampleQuality",
      "agentConclusion",
      "platformSearchStatus",
      "evidenceCards",
      "candidateProducts",
      "recommendedProducts",
      "cautiousProducts",
      "rejectedProducts",
      "platformEvidence",
      "riskWarnings",
      "sourcingKeywords",
      "differentiationIdeas",
      "similarProductDirections",
      "nextActions",
      "trafficLightRisks",
      "disclaimer",
    ],
  },
} as const;

export const DEEPSEEK_JSON_FORMAT_INSTRUCTION = `
你必须只输出一个合法 JSON object，不要输出 Markdown、解释、代码块或额外文本。
字段必须完整符合 HotProductRadarResult 结构。
finalDecision 只能是 recommend、caution、reject。
风险灯 level 只能是 green、yellow、red。
nextActions.testSuggestion 只能是：先观察、小批量测试、暂不做、直接排除。
`;

function formatArray(values: readonly string[] | string[]) {
  return values.length ? values.join("、") : "未提供";
}

function formatEvidenceCards(cards: EvidenceCard[]) {
  if (!cards.length) {
    return "未生成证据卡片。";
  }

  return cards.map((card, index) => {
    const confidence = card.confidenceFields
      .map((item) => `${item.fieldName}=${item.value}（${item.confidence}，${item.reason}）`)
      .join("；");
    return [
      `证据卡片 ${index + 1}`,
      `素材类型：${card.materialType}`,
      `平台：${card.platform}`,
      `素材类别：${card.detectedMaterialType}`,
      `读取状态：${card.status}`,
      `商品名：${card.productName || "未识别"}`,
      `价格：${card.priceText || "未识别"}`,
      `销量/热度：${card.salesText || card.ratingText || card.rankText || "未识别"}`,
      `店铺/品牌：${card.shopName || card.brandName || "未识别"}`,
      `链接：${card.sourceUrl || "未提供"}`,
      `可见描述：${card.visibleDescription || "未提供"}`,
      `原始证据：${card.rawEvidenceText || "未提供"}`,
      `缺失字段：${formatArray(card.missingFields)}`,
      `风险备注：${card.riskNotes || "未提供"}`,
      `用户备注：${card.userNotes || "未提供"}`,
      `字段置信度：${confidence || "未提供"}`,
      `提示：${card.message}`,
    ].join("\n");
  }).join("\n\n");
}

function buildPlatformStatusHint(input: RadarFormInput) {
  const selected = new Set(input.selectedPlatforms.length ? input.selectedPlatforms : ["manual"]);
  return defaultPlatformStatus
    .filter((item) => selected.has(item.platform) || item.platform === "manual")
    .map((item) => `${item.platform}: ${item.status}，${item.message}`)
    .join("\n");
}

export function buildRadarPrompt(input: RadarFormInput) {
  const selectedPlatforms = input.selectedPlatforms.length ? input.selectedPlatforms : ["manual"];

  return [
    "你是一个本地使用的“爆款素材识别 Agent”。",
    "你的任务不是爬取、搬运、铺货、发布或下单，而是基于用户提供的图片说明、截图信息、链接、手动文字和已确认的证据卡片，判断低风险百货类商品是否值得继续跟品。",
    "",
    "=== 工作流程 ===",
    "1. 只基于证据卡片和用户输入分析。",
    "2. 低置信度信息不能作为强推荐依据。",
    "3. 没有证据的销量、评价、排名、价格、品牌信息不能编造。",
    "4. 样本不足时必须写明“样本不足，仅供参考”。",
    "5. 结论必须是：推荐做、谨慎做或不建议做。",
    "6. 自动化读取失败不影响手动分析，报告里要说明可手动继续。",
    "",
    "=== 安全边界 ===",
    "禁止建议用户自动发布、自动下单、自动评论、私信、点赞、收藏、搬运图片或绕过登录/验证码/平台限制。",
    "图片建议只能写：自己拍摄、供应商授权、重新设计、合规素材。",
    "不要建议复制品牌、IP、明星、影视、动漫、游戏周边内容。",
    "不要给经营、投资或法律保证。",
    "",
    "=== 第一版优先类目 ===",
    formatArray(preferredCategories),
    "",
    "=== 高风险黑名单/灰名单 ===",
    formatArray(riskBlacklist),
    "遇到这些风险要进入风险灯和风险提醒。明显不适合新手的商品要 reject。",
    "",
    "=== 评分逻辑 ===",
    "hotScore：榜单、销量、评价、互动、排名、多平台出现等热度证据。",
    "beginnerFitScore：低客单、低资质、低售后、容易找货、容易自己拍图做内容。",
    "competitionScore：同质化、价格内卷、大牌占据、竞争强度。高分表示竞争风险更可控。",
    "afterSalesRiskScore：易坏、易碎、尺寸复杂、使用纠纷、退货率。高分表示售后风险更低。",
    "ipRiskScore：品牌、IP、明星、影视游戏元素、仿牌、专利结构。高分表示侵权风险更低。",
    "logisticsRiskScore：大件、重、易碎、液体、异形包装。高分表示物流风险更低。",
    "grossMarginPotentialScore：拿货价差、包邮后利润、组合装、差异化空间。",
    "finalScore：综合分。推荐做必须有明确证据、风险较低、适合新手、有找货关键词和差异化角度。",
    "",
    "=== 用户输入 ===",
    `关键词/品类：${input.keyword || "未提供"}`,
    `分析目标：${input.analysisGoal || "全部分析"}`,
    `目标价格带：${input.targetPriceRange || "未提供"}`,
    `目标人群：${input.targetAudience || "未提供"}`,
    `排除类目：${input.excludedCategories || "未提供"}`,
    `平台选择：${formatArray(selectedPlatforms)}`,
    `个人限制：${formatArray(input.personalLimits.length ? input.personalLimits : personalLimitOptions)}`,
    `省钱模式：${input.lowTokenMode ? "开启，优先复用证据卡片，少推理不扩写" : "关闭"}`,
    `备注：${input.notes || "未提供"}`,
    "",
    "=== 平台读取状态提示 ===",
    buildPlatformStatusHint(input),
    "",
    "=== 用户粘贴链接 ===",
    input.linksText || "未提供",
    "",
    "=== 用户粘贴文字 ===",
    input.manualText || "未提供",
    "",
    "=== 已确认或待确认的证据卡片 ===",
    formatEvidenceCards(input.evidenceCards),
    "",
    "=== 输出要求 ===",
    "1. 报告第一屏必须直接给出 finalDecision、summary 和 agentConclusion。",
    "2. evidenceCards 必须返回并尽量保留用户修改后的内容。",
    "3. candidateProducts 每个商品都要保留 rawEvidenceText 和 evidenceText。",
    "4. 推荐做 / 谨慎做 / 不建议做 三类都要按 finalDecision 分类。",
    "5. trafficLightRisks 至少包含：热度、新手适配、同质化、侵权/IP、售后、物流、利润空间、最终判断。",
    "6. sourcingKeywords 要给找货关键词，不要只给泛泛词。",
    "7. similarProductDirections 要给同类扩展方向。",
    "8. nextActions 要具体，包括找货、核价、运费、资质/侵权/售后/物流复核、供应商对比、小批量测试建议。",
    `9. disclaimer 必须使用这段文字：${reportDisclaimer}`,
  ].join("\n");
}
