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
    "【合规声明严格禁止】以下表达绝对不能出现在 title、bulletPoints、description、shortDescription、faq、packingList 中，除非用户输入中明确提供了对应认证：",
    "- ASTM certified / ASTM F963 certified / meets ASTM",
    "- CPSIA compliant / CPSIA certified",
    "- CPC certified / Children's Product Certificate",
    "- FDA approved / FDA certified / FDA registered",
    "- CE certified / CE marked / CE compliant",
    "- RoHS compliant / RoHS certified",
    "- EN71 certified / EN71 compliant",
    "- 100% safe / absolutely safe / completely safe",
    "- no risk / zero risk / risk-free",
    "- guaranteed safe / child-safe certified",
    "- any other specific certification or compliance standard",
    "",
    "【高合规品类保守表述】如果商品属于儿童玩具、磁铁产品、带电产品、美妆、食品接触材料、医疗健康相关品类，只能使用以下保守提醒语：",
    "- \"Verify applicable safety and compliance requirements before listing.\"",
    "- \"Certification details should be confirmed with the supplier before sale.\"",
    "- \"Follow platform and local market requirements for labeling and documentation.\"",
    "- \"Please confirm age grading, warning labels, and required documents before selling.\"",
    "这些提醒语只能放在 notes 数组或 FAQ 末尾，不要在标题或 bullet points 中出现。",
    "文案正文（title/bulletPoints/description/shortDescription）仍要围绕商品卖点、使用场景和材质体验自然书写，不能变成一堆警告。",
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
    "- title 必须是英文，不超过 180 字符，不要堆关键词，不要包含认证标准。",
    "- bulletPoints 必须是 3-5 条英文卖点，每条关注一个清楚卖点，不要包含认证承诺。",
    "- description 必须是英文详情描述，避免夸大和未证实承诺，不要引述具体认证标准名。",
    "- shortDescription 必须是 1-2 句英文短描述。",
    "- keywords 最多 10 个英文核心关键词。",
    "- longTailKeywords 最多 10 个英文长尾关键词。",
    "- faq 必须是 question/answer 对象数组，问题和回答都用英文。对于高合规品类，FAQ 末尾加入一条温和提醒，例如 \"What certifications are required for this product? — Certification requirements vary by marketplace. As a seller, you should confirm applicable safety standards and labeling requirements with your supplier before listing.\"",
    "- packingList 保守生成；不确定的配件不要编造。",
    "- afterSales 必须是保守英文售后说明，不承诺平台政策外服务。",
    "- notes 必须包含人工复核提醒，覆盖侵权、物流、平台禁限售或目标平台规则。对高合规品类，notes 中必须加入认证/合规复核提醒。",
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

// ── 小白结论 prompt ──

export type SummaryPromptInput = {
  productName: string;
  sourcingFindings: string;
  riskFindings: string;
  productFindings: string;
  viralFindings: string;
  extraNotes: string;
};

export function buildSummaryPrompt(input: SummaryPromptInput) {
  return [
    "你是资深跨境电商选品顾问，正在给小白运营做最终总结。",
    "你的任务：把前面几步的分散分析结果，用大白话总结为一句结论，并给出明确的风险分层。",
    "不要推荐具体供应商名、不要给法律/医疗建议、不要断言绝对不侵权或绝对安全。",
    "",
    "输出要求：",
    "- 用中文，像跟朋友聊天一样说清楚。",
    "- 结论先行：第一句就要给出明确的产品适合度判断。",
    "- 解释为什么：2-4 条理由，每条简短。",
    "- 下一步：2-4 条可执行的动作。",
    "- 风险提醒：需要人工复核的关键点。",
    "",
    "verdict 必须从以下 5 个中选择最合适的一个：",
    "1. 新手可小单测试 —— 普通低风险品类，轻小件，无明显合规门槛，货源好找。",
    "2. 可做但需控制成本 —— 货源和风险均可控，但物流、售后或退货成本偏高，需要精算再定。",
    "3. 有经验再做 —— 存在中等合规门槛（如儿童用品、带电产品），或采购/售后复杂度较高，新手容易踩坑。",
    "4. 新手不建议做 —— 明显合规门槛（如磁铁玩具、美妆功效、食品接触），或 blacklist 命中高风险类目，小白运营不建议独自操作。",
    "5. 暂不建议做 —— 存在 red 风险、认证缺失、侵权明显、或平台禁限售概率高，当前条件下不建议启动。",
    "",
    "verdict 选择规则：",
    "- 如果 risk 的 overallLevel 是 red，或 sourcing feasibility 是 low，verdict 必须偏「暂不建议做」。",
    "- 如果 risk 命中儿童玩具/磁铁/带电/美妆/食品接触/医疗健康等高风险类目，且 beginnerFriendly 是 false，verdict 不能给「新手可小单测试」，至少是「有经验再做」。",
    "- 如果只是普通品类、轻小件、低风险（overallLevel green），verdict 可以给「新手可小单测试」或「可做但需控制成本」。",
    "- 如果大件、易碎、物流售后成本显著偏高，verdict 应偏「可做但需控制成本」或「有经验再做」。",
    "",
    "confidence 规则：",
    "- 只能用 高 / 中 / 低 之一。",
    "- 如果 sourcing + risk 都有结果且信息丰富且结论一致：confidence 给「高」。",
    "- 如果只有部分分析（如只有 sourcing 没有 risk），或信息存在明显矛盾：confidence 给「低」。",
    "- 其他情况给「中」。",
    "- 不要所有商品都给「中」，要根据输入质量和一致性真实区分。",
    "",
    "必须只返回合法 JSON object，不要 Markdown，不要代码块，不要解释文字。",
    "JSON 结构固定为：",
    JSON.stringify({
      verdict: "新手可小单测试",
      confidence: "中",
      summary: "一句白话总结",
      reasons: ["理由 1", "理由 2"],
      risks: ["需要人工复核的风险点"],
      nextSteps: ["可执行的下一步动作"],
      beginnerTip: "给小白运营的一句贴心提示",
    }, null, 2),
    "",
    "字段规则：",
    "- verdict 必须是 新手可小单测试、可做但需控制成本、有经验再做、新手不建议做、暂不建议做 之一。",
    "- confidence 必须是 高、中、低 之一。",
    "- summary 一句话，不超过 80 字。",
    "- reasons 2-4 条。",
    "- risks 2-4 条。",
    "- nextSteps 2-4 条，每条可执行。",
    "- beginnerTip 一句贴心话，不超过 60 字。",
    "",
    "商品名称：",
    input.productName || "未提供",
    "",
    "货源判断结果：",
    input.sourcingFindings || "未提供（用户还没做货源判断）",
    "",
    "风险排查结果：",
    input.riskFindings || "未提供（用户还没做风险排查）",
    "",
    "选品体检结果（利润 + AI 分析 + 关键词）：",
    input.productFindings || "未提供（用户还没做选品体检）",
    "",
    "爆款拆解结果：",
    input.viralFindings || "未提供（用户还没做爆款拆解）",
    "",
    "补充说明：",
    input.extraNotes || "未提供",
  ].join("\n");
}

// ── 货源判断 prompt ──

export type SourcingPromptInput = {
  productName: string;
  category: string;
  targetPrice: string;
  targetPlatform: string;
  description: string;
};

export function buildSourcingPrompt(input: SourcingPromptInput) {
  return [
    '你是资深跨境电商采购和货源开发专家，正在做"新品货源判断报告"。',
    '你的任务是根据用户提供的商品信息，判断货源可行性、采购难度、新手适合度、合规门槛和物流售后难度。',
    '必须基于用户输入判断，不要编造供应商名称、具体采购价或库存数据。不确定的信息要标注"需人工核实"。',
    "",
    "重点分析维度：",
    "- 1688 搜索关键词：根据商品名和品类，给出可在 1688 上找到同类或相近货源的搜索词。",
    "- 替代品/近似品方向：如果该商品不好找，建议哪些近似品类或替代材质/工艺方向。",
    "- 价格带分析：根据目标售价和品类，评估采购成本大概区间，判断是否有利润空间。",
    "- 起订量判断：该品类通常的 MOQ 范围，是否适合小卖家试单。",
    "- 新手适合度：不能只看货源多不多，还要看品类合规门槛、物流难度、售后风险。",
    "  * 儿童玩具、磁铁产品、带电产品、美妆功效、医疗健康、食品接触材料 — 即使货源很多，新手适合度也不能给 high。",
    "  * 大件、易碎、退货率高的品类 — 新手适合度应考虑物流和售后负担。",
    "  * 普通低风险轻小件、无合规门槛 — 可以给 high。",
    "- 合规门槛判断：该品类在目标平台是否需要特殊认证、检测报告、年龄标识、警示标签等。",
    "- 风险提示：该品类采购中常见的坑（品质不稳、色差、货不对版、断货、季节波动等）。",
    "",
    `目标平台：${input.targetPlatform || "未提供"}`,
    "",
    "必须只返回合法 JSON object，不要 Markdown，不要代码块，不要解释文字。",
    "JSON 字段固定为：",
    JSON.stringify({
      feasibility: "medium",
      summary: "",
      searchKeywords: [],
      alternativeDirections: [],
      priceBand: { min: "", max: "", unit: "CNY", note: "" },
      moqEstimate: "",
      beginnerFriendly: true,
      beginnerFit: "medium",
      complianceBarrier: "low",
      logisticsDifficulty: "low",
      afterSalesRisk: "low",
      suggestedEntryLevel: "beginner",
      risks: [],
      nextSteps: [],
    }, null, 2),
    "",
    "字段要求：",
    "- feasibility 必须是 high / medium / low：综合考虑货源可得性+利润空间+合规难度的整体判断。即使货源很多，如果合规门槛很高，feasibility 也应下调。",
    "- summary 用一段话总结货源判断和下一步行动建议。如果品类合规门槛高，summary 必须明确提醒新手注意。",
    "- searchKeywords 给出 3-6 个 1688 搜索词，每个词必须具体（含材质/规格/风格关键词），不要只写品类名。",
    "- alternativeDirections 给出 2-4 个替代品方向，解释为什么可以替代以及优劣。",
    "- priceBand.min 和 .max 是估算的采购成本区间（数字字符串），.unit 固定 CNY，.note 说明价格带判断依据和不确定性。",
    "- moqEstimate 说明该品类通常起订量范围和小卖家试单建议。",
    "- beginnerFriendly 为 true 表示小白可独立完成采购物流；false 表示建议有经验者操作。与 beginnerFit 和 suggestedEntryLevel 保持一致。",
    "- beginnerFit 必须是 high / medium / low：高=小白轻松上手，中=需要一些学习但可以尝试，低=新手容易踩坑。",
    "- complianceBarrier 必须是 low / medium / high：低=无特殊认证要求，中=需要一般资质文件，高=必须提供第三方认证或检测报告。",
    "- logisticsDifficulty 必须是 low / medium / high：低=轻小件普货，中=稍大或有特殊包装要求，高=大件/易碎/带磁/液体/危险品。",
    "- afterSalesRisk 必须是 low / medium / high：低=退货率低售后简单，中=有常见售后问题，高=退货率高或纠纷多发品类。",
    "- suggestedEntryLevel 必须是 beginner / intermediate / experienced：",
    "  * beginner = 小白可以独立操作",
    "  * intermediate = 建议有一定经验的运营操作",
    "  * experienced = 必须有经验且确认合规文件后才能操作",
    "  * 儿童玩具/磁铁/带电/美妆/医疗/食品接触 默认至少 intermediate，如果合规门槛高则为 experienced",
    "- risks 列出 2-4 个采购环节常见风险及应对建议。",
    "- nextSteps 列出 3-5 条具体的下一步行动，每条必须可执行。",
    "",
    "商品名称：",
    input.productName || "未提供",
    "",
    "商品品类：",
    input.category || "未提供",
    "",
    "目标售价：",
    input.targetPrice || "未提供",
    "",
    "商品描述：",
    input.description || "未提供",
  ].join("\n");
}
