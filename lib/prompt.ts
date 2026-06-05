import type { ProductFormInput } from "./types";

// ========== JSON Schema（用于 OpenAI json_schema 模式） ==========

export const alibabaJsonSchema = {
  name: "alibaba_product_sourcing_optimization",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      productOpportunityScore: { type: "number" },
      confidenceLevel: { type: "string", enum: ["low", "medium", "high"] },
      recommendation: {
        type: "object",
        additionalProperties: false,
        properties: {
          suggestion: { type: "string" },
          dataWarning: { type: "string" },
        },
        required: ["suggestion", "dataWarning"],
      },
      scoreBreakdown: {
        type: "object",
        additionalProperties: false,
        properties: {
          marketDemand: { "$ref": "#/$defs/scoreDimension" },
          competitionRisk: { "$ref": "#/$defs/scoreDimension" },
          profitMargin: { "$ref": "#/$defs/scoreDimension" },
          logisticsDifficulty: { "$ref": "#/$defs/scoreDimension" },
          complianceRisk: { "$ref": "#/$defs/scoreDimension" },
          b2bFit: { "$ref": "#/$defs/scoreDimension" },
          differentiation: { "$ref": "#/$defs/scoreDimension" },
          beginnerDifficulty: { "$ref": "#/$defs/scoreDimension" },
        },
        required: [
          "marketDemand", "competitionRisk", "profitMargin",
          "logisticsDifficulty", "complianceRisk", "b2bFit",
          "differentiation", "beginnerDifficulty",
        ],
      },
      demandAnalysis: { "$ref": "#/$defs/baseAssessment" },
      competitionRiskAssessment: { "$ref": "#/$defs/baseAssessment" },
      profitRiskAssessment: { "$ref": "#/$defs/baseAssessment" },
      logisticsRiskAssessment: { "$ref": "#/$defs/baseAssessment" },
      complianceRiskAssessment: { "$ref": "#/$defs/baseAssessment" },
      b2bFitAssessment: { "$ref": "#/$defs/baseAssessment" },
      differentiationAssessment: { "$ref": "#/$defs/baseAssessment" },
      beginnerDifficultyAssessment: { "$ref": "#/$defs/baseAssessment" },
      missingData: { type: "array", items: { type: "string" } },
      validationChecklist: { type: "array", items: { type: "string" } },
      targetMarkets: { type: "array", items: { type: "string" } },
      buyerTypes: { type: "array", items: { type: "string" } },
      alibabaTitle: { type: "string" },
      coreKeywords: { type: "array", items: { type: "string" } },
      longTailKeywords: { type: "array", items: { type: "string" } },
      productDescription: { type: "string" },
      inquiryReplyTemplates: {
        type: "object",
        additionalProperties: false,
        properties: {
          firstInquiry: { type: "string" },
          moqReply: { type: "string" },
          sampleFeeReply: { type: "string" },
          oemOdmReply: { type: "string" },
          priceTooHighReply: { type: "string" },
          leadTimeReply: { type: "string" },
          shippingReply: { type: "string" },
          followUpReply: { type: "string" },
        },
        required: [
          "firstInquiry", "moqReply", "sampleFeeReply", "oemOdmReply",
          "priceTooHighReply", "leadTimeReply", "shippingReply", "followUpReply",
        ],
      },
      imageSuggestions: { type: "array", items: { type: "string" } },
      amazonListing: { type: "string" },
      actionPlan: { type: "array", items: { type: "string" } },
    },
    required: [
      "productOpportunityScore", "confidenceLevel", "recommendation",
      "scoreBreakdown",
      "demandAnalysis", "competitionRiskAssessment", "profitRiskAssessment",
      "logisticsRiskAssessment", "complianceRiskAssessment", "b2bFitAssessment",
      "differentiationAssessment", "beginnerDifficultyAssessment",
      "missingData", "validationChecklist",
      "targetMarkets", "buyerTypes", "alibabaTitle",
      "coreKeywords", "longTailKeywords", "productDescription",
      "inquiryReplyTemplates", "imageSuggestions", "amazonListing", "actionPlan",
    ],
    "$defs": {
      scoreDimension: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "number" },
          basis: { type: "string" },
          mainRisk: { type: "string" },
          missingData: { type: "string" },
        },
        required: ["score", "basis", "mainRisk", "missingData"],
      },
      baseAssessment: {
        type: "object",
        additionalProperties: false,
        properties: {
          conclusion: { type: "string" },
          basis: { type: "string" },
          risk: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          verificationStep: { type: "string" },
        },
        required: ["conclusion", "basis", "risk", "confidence", "verificationStep"],
      },
    },
  },
} as const;

// ========== DeepSeek JSON 格式指令 ==========

const deepSeekJsonExample = {
  productOpportunityScore: 75,
  confidenceLevel: "medium",
  recommendation: {
    suggestion: "建议先做小批量测试，再根据询盘反馈决定是否主推。",
    dataWarning: "当前数据不足，只能做初步判断。",
  },
  scoreBreakdown: {
    marketDemand: { score: 15, basis: "目标市场和用途较明确。", mainRisk: "缺少真实需求数据。", missingData: "关键词趋势数据。" },
    competitionRisk: { score: 10, basis: "已提供部分竞品信息。", mainRisk: "竞品价格竞争明显。", missingData: "更多竞品询盘数据。" },
    profitMargin: { score: 16, basis: "成本和预估售价存在利润空间。", mainRisk: "未计入完整物流费用。", missingData: "目标市场运费。" },
    logisticsDifficulty: { score: 7, basis: "已提供重量和风险属性。", mainRisk: "运输方案仍需核实。", missingData: "包装后体积。" },
    complianceRisk: { score: 8, basis: "已提供部分认证信息。", mainRisk: "目标市场要求可能不同。", missingData: "最新认证要求。" },
    b2bFit: { score: 8, basis: "支持批量采购和定制。", mainRisk: "MOQ 需要买家验证。", missingData: "历史询盘反馈。" },
    differentiation: { score: 7, basis: "产品具备可表达的差异化卖点。", mainRisk: "卖点容易被竞品复制。", missingData: "买家偏好数据。" },
    beginnerDifficulty: { score: 4, basis: "供应链信息较完整。", mainRisk: "合规和物流仍需专业确认。", missingData: "首单执行成本。" },
  },
  demandAnalysis: { conclusion: "有初步需求潜力。", basis: "目标市场和用途明确。", risk: "缺少真实搜索和询盘数据。", confidence: "medium", verificationStep: "补充关键词趋势和 RFQ 数据。" },
  competitionRiskAssessment: { conclusion: "竞争强度中等。", basis: "已有部分竞品信息。", risk: "价格竞争可能压缩利润。", confidence: "medium", verificationStep: "补充主要竞品价格和 MOQ。" },
  profitRiskAssessment: { conclusion: "存在理论利润空间。", basis: "已提供成本与售价。", risk: "未计入完整物流和平台费用。", confidence: "medium", verificationStep: "核算到岸成本。" },
  logisticsRiskAssessment: { conclusion: "物流难度可控。", basis: "已提供产品风险属性。", risk: "包装后体积尚未确认。", confidence: "medium", verificationStep: "向货代确认运输方案。" },
  complianceRiskAssessment: { conclusion: "需要继续核实合规要求。", basis: "目标市场和认证信息已提供。", risk: "⚠️ 高风险: 不同市场认证要求不同。", confidence: "medium", verificationStep: "向认证机构确认要求。" },
  b2bFitAssessment: { conclusion: "适合 B2B 批量采购。", basis: "支持 MOQ 和定制。", risk: "MOQ 是否被市场接受尚未验证。", confidence: "medium", verificationStep: "用 RFQ 验证买家采购量。" },
  differentiationAssessment: { conclusion: "具备一定差异化空间。", basis: "已提供核心卖点。", risk: "差异化卖点可能不够持久。", confidence: "medium", verificationStep: "对比前三名竞品卖点。" },
  beginnerDifficultyAssessment: { conclusion: "新手操作难度中等。", basis: "基础供应链信息较完整。", risk: "仍需处理物流和认证。", confidence: "medium", verificationStep: "先完成小批量试单。" },
  missingData: ["目标市场运费", "更多竞品询盘数据"],
  validationChecklist: ["核算完整到岸成本", "确认目标市场认证要求"],
  targetMarkets: ["美国", "欧洲"],
  buyerTypes: ["批发商", "品牌商"],
  alibabaTitle: "Custom Portable Bluetooth Speaker for Wholesale Buyers",
  coreKeywords: ["portable bluetooth speaker", "wholesale speaker"],
  longTailKeywords: ["custom portable bluetooth speaker supplier"],
  productDescription: "Professional B2B product description based on the supplied product information.",
  inquiryReplyTemplates: {
    firstInquiry: "Thank you for your inquiry. This is [Your Company Name].",
    moqReply: "Our standard MOQ is based on the requested configuration.",
    sampleFeeReply: "Sample cost will be confirmed according to your requirements.",
    oemOdmReply: "We support OEM and ODM services for qualified orders.",
    priceTooHighReply: "We can review the specification and order quantity to optimize the quotation.",
    leadTimeReply: "Lead time will be confirmed after specifications and quantity are finalized.",
    shippingReply: "Please share the destination port so we can check the shipping option.",
    followUpReply: "May I know whether you need any additional product or quotation details?",
  },
  imageSuggestions: ["展示产品尺寸与核心卖点", "展示包装和定制能力"],
  amazonListing: "Supplementary Amazon listing copy. Alibaba.com remains the primary platform.",
  actionPlan: ["补充缺失数据", "验证目标市场需求", "完成小批量测试"],
};

export const DEEPSEEK_JSON_FORMAT_INSTRUCTION = `
你必须返回且只返回一个合法 JSON object，不要使用 Markdown 代码块或添加解释。
必须完整输出以下新版阿里国际站字段，并保持字段类型与示例一致：

${JSON.stringify(deepSeekJsonExample, null, 2)}

Amazon Listing is only a supplementary reference section. The main platform and primary publishing output must remain Alibaba.com / Alibaba International Station.

不要添加其他顶级字段。不要省略任何字段。示例内容仅用于展示结构，必须根据用户输入生成真实内容。
`;

// ========== 主提示词 ==========

export function buildAlibabaPrompt(input: ProductFormInput) {
  // 判断数据完整性
  const hasCostPrice = input.productCost.trim().length > 0 && input.estimatedPrice.trim().length > 0;
  const hasMoq = input.moq.trim().length > 0;
  const hasWeight = input.productWeight.trim().length > 0;
  const hasTargetCountries = input.targetCountries.trim().length > 0;
  const hasCertInfo = input.needsCertification.trim().length > 0 || input.existingCertificates.trim().length > 0;
  const hasCompetitor = input.competitorInfo.trim().length > 0;
  const hasKeywordData = input.keywordTrendData.trim().length > 0;
  const hasRfq = input.rfqData.trim().length > 0;
  const hasVolume = input.productVolume.trim().length > 0;
  const hasSupplierData = input.supplyChainAdvantages.trim().length > 0 || input.factoryAdvantages.trim().length > 0;

  const mediumCount = [hasCostPrice, hasMoq, hasWeight, hasTargetCountries, hasCertInfo].filter(Boolean).length;
  const highCount = [hasCompetitor, hasKeywordData, hasRfq, hasVolume, hasSupplierData].filter(Boolean).length;

  let confidenceLevel = "low";
  if (mediumCount >= 3) { confidenceLevel = "medium"; }
  if (mediumCount >= 4 && highCount >= 3) { confidenceLevel = "high"; }

  const hasCriticalData = input.productName.trim().length > 0
    && input.productCost.trim().length > 0
    && input.estimatedPrice.trim().length > 0
    && input.targetCountries.trim().length > 0;
  const hasRiskInfo = input.isFragile.trim().length > 0
    || input.isLiquid.trim().length > 0
    || input.isBatteryPowered.trim().length > 0
    || input.isMagnetic.trim().length > 0
    || input.isFoodContact.trim().length > 0
    || input.isChildrenProduct.trim().length > 0;
  const dataInsufficient = !hasCriticalData || !hasRiskInfo;

  const riskFlags = [];
  if (input.isChildrenProduct === "是") riskFlags.push("儿童用品");
  if (input.isFoodContact === "是") riskFlags.push("食品接触");
  if (input.isBatteryPowered === "是") riskFlags.push("带电产品");
  if (input.isMagnetic === "是") riskFlags.push("带磁产品");
  if (input.isLiquid === "是") riskFlags.push("液体产品");
  if (input.isFragile === "是") riskFlags.push("易碎品");
  const hasHighRiskAndNoCert = [
    input.isChildrenProduct,
    input.isFoodContact,
    input.isBatteryPowered,
    input.isMagnetic,
    input.isLiquid,
  ].some((value) => value === "是") && input.existingCertificates.trim().length === 0;
  if (hasHighRiskAndNoCert) riskFlags.push("高风险品类但未提供认证证书");
  const highRiskCats = ["化工", "医疗", "美容", "食品"];
  if (highRiskCats.includes(input.category) && input.existingCertificates.trim().length === 0) {
    riskFlags.push(input.category + "品类但未提供相关认证证书");
  }

  return [
    "你是一位资深的阿里巴巴国际站（Alibaba.com）B2B 选品与运营专家。",
    "请根据用户输入的产品信息，进行阿里巴巴国际站选品初筛与发布优化。",
    "",
    "=== 核心约束 ===",
    "1. 主平台是 Alibaba.com 阿里巴巴国际站，Amazon 只作为补充参考。",
    "2. 不要编造任何真实的搜索量、销量、平台排名数据。",
    "3. 不要承诺爆品、销量、转化率。",
    "4. 不要使用淘宝、小红书、抖音等国内电商风格。",
    "5. 英文内容必须适合 B2B 外贸场景。",
    "6. 所有结论必须包含依据、风险、置信度。",
    "7. 如果不确定，请标注不确定性，不要强行给出结论。",
    "8. 如果缺少关键数据，必须明确提示用户补充。",
    "9. 风险检查只做初步提醒，不保证 100% 合规。",
    "10. 输出必须是严格的结构化 JSON。",
    "",
    "=== 评分规则（总分100分） ===",
    "- 市场需求（20分）：分析产品在目标国家/地区的需求潜力。直接引用用户输入的目标国家数据和用途信息。",
    "- 竞争强度（15分）：分析竞争激烈程度。优先参考用户提供的竞品信息；如无竞品信息则标记为\"缺乏竞品数据\"。",
    "- 利润空间（20分）：基于成本和售价计算理论利润空间。提示缺少的关键数据。",
    "- 物流难度（10分）：根据重量、体积、易碎/液体/带电/带磁属性判断。",
    "- 认证/合规风险（10分）：根据风险信息和目标国家判断认证要求。",
    "- B2B适配度（10分）：判断产品是否适合 Alibaba.com B2B 批量采购模式。",
    "- 差异化空间（10分）：分析产品差异化潜力。",
    "- 新手操作难度（5分）：评估新手卖家的操作难度。",
    "",
    "=== 置信度 ===",
    "当前数据完整性评估为：` + confidenceLevel + `",
    "请确保最终输出的 confidenceLevel 与此评估一致，除非你判断更严格。",
    "",
    dataInsufficient ? "⚠️ 关键数据不足。请在 recommendation.dataWarning 中明确提示\"当前数据不足，只能做初步判断\"，不得输出 high 置信度，不得强行建议主推。" : "",
    "",
    riskFlags.length > 0 ? "⚠️ 高风险因素：" + riskFlags.join("、") + "。请在 complianceRiskAssessment 中重点分析，并使用\"⚠️ 高风险\"前缀标注。" : "",
    "",
    "=== 所有 8 个 assessment 字段的格式要求 ===",
    "每个 assessment 必须包含：conclusion（结论）、basis（依据，引用用户输入）、risk（风险）、confidence（置信度）、verificationStep（下一步验证）。",
    "如果检测到高风险因素，请在 risk 字段中使用\"⚠️ 高风险:\"前缀。",
    "",
    "=== 询盘回复要求 ===",
    "8 个询盘回复模板必须：",
    "- 适合 B2B 外贸场景",
    "- 语气专业礼貌，有销售意识",
    "- 可直接复制使用",
    "- 包含公司名称占位符 [Your Company Name]",
    "",
    "=== 用户输入的产品信息 ===",
    `产品中文名称：${input.productName || "未提供"}`,
    `产品英文名称：${input.englishName || "未提供"}`,
    `产品类别：${input.category || "未提供"}`,
    `材质：${input.material || "未提供"}`,
    `规格尺寸：${input.specifications || "未提供"}`,
    `核心卖点：${input.sellingPoints || "未提供"}`,
    `产品用途：${input.productUsage || "未提供"}`,
    `适用场景：${input.applicableScenarios || "未提供"}`,
    `产品成本：${input.productCost || "未提供"}`,
    `预估售价：${input.estimatedPrice || "未提供"}`,
    `MOQ：${input.moq || "未提供"}`,
    `产品重量：${input.productWeight || "未提供"}`,
    `产品体积：${input.productVolume || "未提供"}`,
    `是否支持 OEM/ODM：${input.supportsOemOdm || "未提供"}`,
    `是否现货：${input.hasStock || "未提供"}`,
    `交货周期：${input.leadTime || "未提供"}`,
    `包装方式：${input.packagingMethod || "未提供"}`,
    `目标国家/地区：${input.targetCountries || "未提供"}`,
    `目标买家类型：${input.targetBuyerTypes || "未提供"}`,
    `目标客户痛点：${input.customerPainPoints || "未提供"}`,
    `竞品信息：${input.competitorInfo || "未提供"}`,
    `阿里关键词趋势数据：${input.keywordTrendData || "未提供"}`,
    `RFQ 买家需求信息：${input.rfqData || "未提供"}`,
    `Amazon 竞品信息：${input.amazonCompetitorInfo || "未提供"}`,
    `是否易碎：${input.isFragile || "未提供"}`,
    `是否液体：${input.isLiquid || "未提供"}`,
    `是否带电：${input.isBatteryPowered || "未提供"}`,
    `是否带磁：${input.isMagnetic || "未提供"}`,
    `是否食品接触：${input.isFoodContact || "未提供"}`,
    `是否儿童用品：${input.isChildrenProduct || "未提供"}`,
    `是否需要认证：${input.needsCertification || "未提供"}`,
    `已有认证证书：${input.existingCertificates || "未提供"}`,
    `供应链优势：${input.supplyChainAdvantages || "未提供"}`,
    `工厂优势：${input.factoryAdvantages || "未提供"}`,
    `其他补充说明：${input.additionalNotes || "未提供"}`,
  ].filter(Boolean).join("\n");
}
