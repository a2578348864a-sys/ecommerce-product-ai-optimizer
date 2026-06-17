import "server-only";

import type {
  AiAnalysisResult,
  CrossBorderProductInput,
  KeywordGenerationResult,
  ProfitCalculationResult,
  StructuredListingData,
} from "@/lib/types";

export type CrossBorderAnalysisPromptInput = {
  product: CrossBorderProductInput;
  profit?: ProfitCalculationResult;
  listingPreview?: StructuredListingData;
};

export type KeywordGenerationPromptInput = CrossBorderAnalysisPromptInput & {
  aiAnalysis?: AiAnalysisResult;
};

export type ListingCopyPromptInput = KeywordGenerationPromptInput & {
  keywords?: KeywordGenerationResult;
};

function textOrMissing(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "用户未填写";
}

function numberOrMissing(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : "用户未填写";
}

function buildProductSummary(product: CrossBorderProductInput) {
  return {
    name: textOrMissing(product.name),
    description: textOrMissing(product.description),
    targetPlatform: textOrMissing(product.targetPlatform),
    targetCountry: textOrMissing(product.targetCountry),
    currency: textOrMissing(product.currency),
    purchasePrice: numberOrMissing(product.purchasePrice),
    domesticShippingFee: numberOrMissing(product.domesticShippingFee),
    internationalShippingFee: numberOrMissing(product.internationalShippingFee),
    otherCost: numberOrMissing(product.otherCost),
    commissionRate: numberOrMissing(product.commissionRate),
    expectedProfitRate: numberOrMissing(product.expectedProfitRate),
    weight: numberOrMissing(product.weight),
    packageLength: numberOrMissing(product.packageLength),
    packageWidth: numberOrMissing(product.packageWidth),
    packageHeight: numberOrMissing(product.packageHeight),
    stock: numberOrMissing(product.stock),
  };
}

function buildProfitSummary(profit?: ProfitCalculationResult) {
  if (!profit) {
    return "用户未提供利润测算结果。不要自行重新计算利润，只能基于已知信息做保守分析。";
  }

  return {
    baseCost: profit.baseCost,
    totalFixedCost: profit.totalFixedCost,
    commissionRate: profit.commissionRate,
    suggestedPrice: profit.suggestedPrice,
    breakEvenPrice: profit.breakEvenPrice,
    commissionAmount: profit.commissionAmount,
    grossProfit: profit.grossProfit,
    grossMargin: profit.grossMargin,
    roi: profit.roi,
    currency: profit.currency,
    warnings: profit.warnings,
  };
}

function buildListingSummary(listingPreview?: StructuredListingData) {
  if (!listingPreview) {
    return "用户未提供上架资料预览。";
  }

  return {
    sku: listingPreview.sku,
    title: listingPreview.title,
    price: listingPreview.price,
    stock: listingPreview.stock,
    targetPlatform: listingPreview.targetPlatform,
    targetCountry: listingPreview.targetCountry,
    categorySuggestion: listingPreview.categorySuggestion,
    attributes: listingPreview.attributes,
    weight: listingPreview.weight ?? "用户未填写",
    dimensions: listingPreview.dimensions ?? "用户未填写",
    riskNotes: listingPreview.riskNotes,
    confirmStatus: listingPreview.confirmStatus,
  };
}

function buildAiAnalysisSummary(aiAnalysis?: AiAnalysisResult) {
  if (!aiAnalysis) {
    return "用户未提供 AI 选品分析结果。请仅基于商品输入、利润测算和上架资料预览生成关键词。";
  }

  return {
    recommendation: aiAnalysis.recommendation,
    score: aiAnalysis.score,
    reasons: aiAnalysis.reasons,
    risks: aiAnalysis.risks,
    targetAudience: aiAnalysis.targetAudience,
    scenarios: aiAnalysis.scenarios,
    platformFit: aiAnalysis.platformFit,
    logisticsRisk: aiAnalysis.logisticsRisk,
    afterSalesRisk: aiAnalysis.afterSalesRisk,
    infringementRisk: aiAnalysis.infringementRisk,
    sensitiveCategoryRisk: aiAnalysis.sensitiveCategoryRisk,
    newbieFriendly: aiAnalysis.newbieFriendly,
  };
}

function buildKeywordSummary(keywords?: KeywordGenerationResult) {
  if (!keywords) {
    return "用户未提供关键词生成结果。请仅基于商品输入、利润测算、上架资料预览和可选 AI 选品分析生成英文上架文案。";
  }

  return {
    coreKeywords: keywords.coreKeywords,
    longTailKeywords: keywords.longTailKeywords,
    searchTerms: keywords.searchTerms,
    titleKeywords: keywords.titleKeywords,
    sellingPointKeywords: keywords.sellingPointKeywords,
    riskWords: keywords.riskWords,
    negativeKeywords: keywords.negativeKeywords ?? [],
    platformNotes: keywords.platformNotes,
  };
}

export function buildCrossBorderAnalysisPrompt(input: CrossBorderAnalysisPromptInput) {
  return [
    "你是一个保守、合规的跨境电商运营顾问，帮助国内用户判断一个商品是否适合做第一版半自动上架辅助。",
    "你只基于用户提供的商品信息、利润测算结果和上架资料预览做分析，不要编造平台真实数据、销量、竞品价格或政策细节。",
    "",
    "重要边界：",
    "- AI 结果只做辅助，不等于平台最终规则。",
    "- 侵权、禁售、物流限制、认证要求必须人工复核。",
    "- 不允许建议刷评、虚假评论、规避平台风控、违规上架。",
    "- 不允许建议爬虫采集 Amazon、Shopee、TikTok、Temu 等平台数据。",
    "- 不允许建议自动发布商品或绕过平台审核。",
    "",
    "分析重点：",
    "- 商品是否适合新手。",
    "- 利润是否有空间，注意利润测算里的 warnings。",
    "- 物流是否麻烦，重点关注重量、尺寸、易碎、液体、粉末、电池、磁性、带电、刀具、仿牌等风险。",
    "- 售后是否容易爆，关注退货率、破损、尺寸不符、功能复杂、安装难度、客诉风险。",
    "- 是否可能有品牌词、外观专利、版权图案、IP 角色、仿牌等侵权风险。不能断言绝对不侵权，只能提醒人工复核。",
    "- 是否适合目标平台和目标国家。",
    "- 是否需要谨慎上架。",
    "",
    "你必须只返回合法 JSON，不要 Markdown，不要代码块，不要解释文字。",
    "JSON 字段必须完全匹配下面结构：",
    JSON.stringify({
      recommendation: "recommend | caution | reject",
      score: 50,
      reasons: ["为什么值得做"],
      risks: ["核心风险"],
      targetAudience: ["目标人群"],
      scenarios: ["使用场景"],
      platformFit: "目标平台适配性的中文说明",
      logisticsRisk: "跨境物流风险中文说明",
      afterSalesRisk: "售后风险中文说明",
      infringementRisk: "侵权风险中文说明，必须提醒人工复核",
      sensitiveCategoryRisk: "敏感货、危险品、平台禁限售风险中文说明",
      newbieFriendly: false,
    }, null, 2),
    "",
    "字段规则：",
    "- recommendation 只能是 recommend、caution、reject。若你想表达 not_recommend，请返回 reject。",
    "- score 必须是 0 到 100 的数字。",
    "- reasons、risks、targetAudience、scenarios 必须是字符串数组。",
    "- newbieFriendly 必须是 boolean。",
    "- 所有说明用中文，适合小白理解。",
    "",
    "商品输入：",
    JSON.stringify(buildProductSummary(input.product), null, 2),
    "",
    "利润测算结果：",
    JSON.stringify(buildProfitSummary(input.profit), null, 2),
    "",
    "上架资料预览：",
    JSON.stringify(buildListingSummary(input.listingPreview), null, 2),
  ].join("\n");
}

export function buildKeywordGenerationPrompt(input: KeywordGenerationPromptInput) {
  return [
    "你是一个保守、合规的跨境电商关键词运营顾问，帮助国内用户为商品准备英文上架关键词。",
    "你只能基于用户提供的商品输入、利润测算、上架资料预览和可选 AI 选品分析生成关键词，不要编造品牌名、平台销量、竞品数据或政策细节。",
    "",
    "重要边界：",
    "- 只返回合法 JSON，不要 Markdown，不要代码块，不要解释文字。",
    "- 所有关键词优先输出英文；platformNotes 用中文。",
    "- 不要使用知名品牌词、IP 角色名、商标词、名人词或仿牌暗示。",
    "- 不要建议刷评、虚假评论、规避平台风控、违规上架或爬虫采集平台数据。",
    "- 对可能侵权、夸大、敏感、禁售或高风险的词，放到 riskWords，不要放进推荐关键词数组。",
    "- 关键词要适合跨境电商上架，围绕商品属性、用途、人群、场景和卖点，不要泛泛而谈。",
    "- 不要返回空泛词，例如 good product、best item、cheap stuff。",
    "",
    "请结合这些维度：",
    "- 商品名称和描述。",
    "- 目标平台、目标国家和币种；未填写时按“用户未填写”处理。",
    "- 利润测算结果和 warnings；利润风险会影响关键词定位的谨慎程度。",
    "- 上架资料预览里的标题、属性、价格、风险备注。",
    "- AI 选品分析里的目标人群、使用场景、风险点；如果未提供，也要能生成基础关键词。",
    "",
    "你必须只返回下面 JSON 结构：",
    JSON.stringify({
      coreKeywords: ["english keyword"],
      longTailKeywords: ["english long-tail keyword"],
      searchTerms: ["english search term"],
      titleKeywords: ["english title keyword"],
      sellingPointKeywords: ["english selling point keyword"],
      riskWords: ["risky word"],
      negativeKeywords: ["optional negative keyword"],
      platformNotes: "中文关键词使用建议，提醒人工复核平台规则和侵权风险。",
    }, null, 2),
    "",
    "字段规则：",
    "- coreKeywords、longTailKeywords、searchTerms、titleKeywords、sellingPointKeywords、riskWords、negativeKeywords 都必须是字符串数组。",
    "- 每个数组最多 10 个关键词。",
    "- 不要返回重复关键词，大小写不同但含义相同也算重复。",
    "- 推荐关键词尽量用自然英文短语，贴近真实买家搜索。",
    "- platformNotes 简洁中文说明关键词使用建议和人工复核提醒。",
    "",
    "商品输入：",
    JSON.stringify(buildProductSummary(input.product), null, 2),
    "",
    "利润测算结果：",
    JSON.stringify(buildProfitSummary(input.profit), null, 2),
    "",
    "上架资料预览：",
    JSON.stringify(buildListingSummary(input.listingPreview), null, 2),
    "",
    "AI 选品分析结果：",
    JSON.stringify(buildAiAnalysisSummary(input.aiAnalysis), null, 2),
  ].join("\n");
}

export function buildListingCopyPrompt(input: ListingCopyPromptInput) {
  return [
    "你是一个保守、合规的跨境电商英文上架文案助手，帮助国内用户整理可人工复核的英文商品资料。",
    "你只能基于用户提供的商品输入、利润测算、上架资料预览、可选 AI 选品分析和关键词结果生成文案。",
    "不要编造品牌、销量、评价、认证、专利、材质、功能、平台政策或任何用户没有提供的事实。",
    "",
    "重要边界：",
    "- 只返回合法 JSON，不要 Markdown，不要代码块，不要解释文字。",
    "- 文案以英文为主，适合跨境商品上架，表达自然清楚，不要堆关键词。",
    "- 不使用知名品牌词、IP 角色名、商标词、名人词或仿牌暗示。",
    "- 不夸大效果，不承诺无法确认的质量、认证、疗效、材料、适配范围或售后政策。",
    "- 不建议刷评、虚假评论、规避平台风控、违规上架、爬虫采集数据或自动发布商品。",
    "- 不生成侵权、仿牌、危险品规避话术。",
    "- 侵权、物流、禁售、平台规则必须在 notes 里提醒人工复核。",
    "- 如果信息不足，宁可保守表达，也不要补充不存在的配件、功能或认证。",
    "",
    "你必须只返回下面 JSON 结构：",
    JSON.stringify({
      title: "English product title within 180 characters",
      bulletPoints: ["English selling point"],
      description: "English product description",
      shortDescription: "1-2 sentence English short description",
      keywords: ["english keyword"],
      longTailKeywords: ["english long-tail keyword"],
      faq: [
        {
          question: "English question",
          answer: "English answer",
        },
      ],
      packingList: ["conservative packing item"],
      afterSales: "Conservative English after-sales note",
      notes: ["Manual review reminder"],
    }, null, 2),
    "",
    "字段规则：",
    "- title 必须是英文，不超过 180 字符，不要堆关键词。",
    "- bulletPoints 必须是 3-5 条英文卖点，每条关注一个清楚卖点。",
    "- description 必须是英文详情描述，避免夸大和未证实承诺。",
    "- shortDescription 必须是 1-2 句英文短描述。",
    "- keywords 最多 10 个英文核心关键词。",
    "- longTailKeywords 最多 10 个英文长尾关键词。",
    "- faq 必须是 question/answer 对象数组，问题和回答都用英文。",
    "- packingList 保守生成；不确定的配件不要编造。",
    "- afterSales 必须是保守英文售后说明，不承诺平台政策外服务。",
    "- notes 必须包含人工复核提醒，覆盖侵权、物流、平台禁限售或目标平台规则。",
    "",
    "商品输入：",
    JSON.stringify(buildProductSummary(input.product), null, 2),
    "",
    "利润测算结果：",
    JSON.stringify(buildProfitSummary(input.profit), null, 2),
    "",
    "上架资料预览：",
    JSON.stringify(buildListingSummary(input.listingPreview), null, 2),
    "",
    "AI 选品分析结果：",
    JSON.stringify(buildAiAnalysisSummary(input.aiAnalysis), null, 2),
    "",
    "关键词结果：",
    JSON.stringify(buildKeywordSummary(input.keywords), null, 2),
  ].join("\n");
}

// ── 风险排查 prompt ──

export type RiskCheckPromptInput = {
  productName: string;
  category: string;
  claims: string;
  targetPlatform: string;
  description: string;
};

export function buildRiskCheckPrompt(input: RiskCheckPromptInput) {
  return [
    "你是资深跨境电商合规和风控专家，正在做“新品风险排查报告”。",
    "你的任务是根据用户提供的商品信息，检查侵权、功效宣称、品类、物流、售后和平台规则风险。",
    "必须基于用户输入判断，不要编造品牌、销量、认证或法律结论。证据不足时要写“需人工复核”，并告诉小白运营该查什么。",
    "",
    "重点检查维度：",
    "- 侵权风险：是否涉及品牌名、IP形象、卡通角色、影视/动漫/游戏周边、明星同款、专利结构。",
    "- 功效宣称风险：是否声称减肥、美白、祛痘、抗皱、治病、增高、壮阳等。",
    "- 品类风险：是否属于食品、美妆、儿童用品、医疗健康、带电产品、液体、大件、易碎等高风险类目。",
    "- 平台规则风险：目标平台对该品类是否有特殊资质要求或禁售限制。",
    "- 物流风险：是否带电、带磁、液体、大件、易碎，是否影响头程和尾程。",
    "- 售后风险：退货率预期、售后复杂度、是否容易引发纠纷。",
    "- 新手友好度：小白运营能不能独立上架和售后。",
    "",
    `目标平台：${input.targetPlatform || "未提供"}`,
    "",
    "必须只返回合法 JSON object，不要 Markdown，不要代码块，不要解释文字。",
    "JSON 字段固定为：",
    JSON.stringify({
      overallLevel: "yellow",
      summary: "",
      risks: [
        {
          category: "侵权风险",
          level: "green",
          title: "",
          description: "",
          suggestion: "",
        },
      ],
      blacklistMatches: [],
      beginnerFriendly: true,
    }, null, 2),
    "",
    "字段要求：",
    "- overallLevel 必须是 green / yellow / red：全是 green 则 green，有 yellow 无 red 则 yellow，有任一 red 则 red。",
    "- summary 用一段话总结整体风险判断和下一步建议。",
    "- risks 数组至少包含：侵权风险、功效宣称风险、品类风险、平台规则风险、物流风险、售后风险，共 6 项。",
    "- 每一项 risk.level 必须是 green / yellow / red。",
    "- 每一项 risk.title 是简短的风险标题（不超过 15 字）。",
    "- 每一项 risk.description 是 1-3 句话说明风险原因。",
    "- 每一项 risk.suggestion 是给运营的可执行建议。",
    "- blacklistMatches 列出匹配到的风险类目名称；没有则输出空数组。",
    "- beginnerFriendly 为 true 表示小白运营可独立操作；false 表示建议有经验者操作。",
    "",
    "商品名称：",
    input.productName || "未提供",
    "",
    "商品类目：",
    input.category || "未提供",
    "",
    "卖点声明 / 功效宣称：",
    input.claims || "未提供",
    "",
    "商品描述：",
    input.description || "未提供",
  ].join("\n");
}
