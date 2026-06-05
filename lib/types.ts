// 产品类别
export const categories = [
  "电子",
  "机械",
  "家居",
  "纺织",
  "包装",
  "五金",
  "化工",
  "医疗",
  "玩具",
  "食品",
  "美容",
  "运动",
  "宠物",
  "其他",
] as const;

// 三态选择（是/否/不确定）
export const yesNoUnsure = ["是", "否", "不确定"] as const;

export const yesNo = ["是", "否"] as const;

// ========== 表单输入类型 ==========

export type ProductFormInput = {
  // 基础模式（必填）
  productName: string;
  category: string;
  material: string;
  sellingPoints: string;
  productCost: string;
  estimatedPrice: string;
  moq: string;
  targetCountries: string;

  // 专业模式 - 第一组：产品基础信息补充
  englishName: string;
  specifications: string;
  productUsage: string;
  applicableScenarios: string;

  // 专业模式 - 第二组：选品判断信息补充
  productWeight: string;
  productVolume: string;
  supportsOemOdm: string;
  hasStock: string;
  leadTime: string;
  packagingMethod: string;

  // 专业模式 - 第三组：市场与买家信息
  targetBuyerTypes: string;
  customerPainPoints: string;
  competitorInfo: string;
  keywordTrendData: string;
  rfqData: string;
  amazonCompetitorInfo: string;

  // 专业模式 - 第四组：风险信息
  isFragile: string;
  isLiquid: string;
  isBatteryPowered: string;
  isMagnetic: string;
  isFoodContact: string;
  isChildrenProduct: string;
  needsCertification: string;
  existingCertificates: string;

  // 专业模式 - 第五组：补充信息
  supplyChainAdvantages: string;
  factoryAdvantages: string;
  additionalNotes: string;
};

export type GenerateRequest = ProductFormInput & {
  accessPassword: string;
};

// ========== 输出类型 ==========

export type ConfidenceLevel = "low" | "medium" | "high";

// 五要素结论格式
export type BaseAssessment = {
  conclusion: string;
  basis: string;
  risk: string;
  confidence: ConfidenceLevel;
  verificationStep: string;
};

// 评分维度明细
export type ScoreDimension = {
  score: number;
  basis: string;
  mainRisk: string;
  missingData: string;
};

// 评分拆分
export type ScoreBreakdown = {
  marketDemand: ScoreDimension;
  competitionRisk: ScoreDimension;
  profitMargin: ScoreDimension;
  logisticsDifficulty: ScoreDimension;
  complianceRisk: ScoreDimension;
  b2bFit: ScoreDimension;
  differentiation: ScoreDimension;
  beginnerDifficulty: ScoreDimension;
};

// 询盘回复模板
export type InquiryTemplates = {
  firstInquiry: string;
  moqReply: string;
  sampleFeeReply: string;
  oemOdmReply: string;
  priceTooHighReply: string;
  leadTimeReply: string;
  shippingReply: string;
  followUpReply: string;
};

// AI 输出结果
export type AlibabaResult = {
  productOpportunityScore: number;
  confidenceLevel: ConfidenceLevel;
  recommendation: {
    suggestion: string;
    dataWarning: string;
  };
  scoreBreakdown: ScoreBreakdown;
  demandAnalysis: BaseAssessment;
  competitionRiskAssessment: BaseAssessment;
  profitRiskAssessment: BaseAssessment;
  logisticsRiskAssessment: BaseAssessment;
  complianceRiskAssessment: BaseAssessment;
  b2bFitAssessment: BaseAssessment;
  differentiationAssessment: BaseAssessment;
  beginnerDifficultyAssessment: BaseAssessment;
  missingData: string[];
  validationChecklist: string[];
  targetMarkets: string[];
  buyerTypes: string[];
  alibabaTitle: string;
  coreKeywords: string[];
  longTailKeywords: string[];
  productDescription: string;
  inquiryReplyTemplates: InquiryTemplates;
  imageSuggestions: string[];
  amazonListing: string;
  actionPlan: string[];
};

export type GenerateErrorResponse = {
  error: string;
  fieldErrors?: Partial<Record<keyof ProductFormInput, string>>;
};

// ========== 限制与验证 ==========

// 基础模式必填字段
export const basicRequiredFields: Array<keyof ProductFormInput> = [
  "productName",
  "category",
  "material",
  "sellingPoints",
  "productCost",
  "estimatedPrice",
  "moq",
  "targetCountries",
];

// 输入字符限制
export const inputLimits: Partial<Record<keyof ProductFormInput, number>> = {
  productName: 80,
  category: 40,
  material: 100,
  sellingPoints: 800,
  productCost: 40,
  estimatedPrice: 40,
  moq: 40,
  targetCountries: 100,
  englishName: 200,
  specifications: 200,
  productUsage: 200,
  applicableScenarios: 200,
  productWeight: 40,
  productVolume: 40,
  leadTime: 100,
  packagingMethod: 200,
  targetBuyerTypes: 200,
  customerPainPoints: 500,
  competitorInfo: 600,
  keywordTrendData: 600,
  rfqData: 600,
  amazonCompetitorInfo: 600,

  supportsOemOdm: 40,
  hasStock: 40,
  isFragile: 40,
  isLiquid: 40,
  isBatteryPowered: 40,
  isMagnetic: 40,
  isFoodContact: 40,
  isChildrenProduct: 40,
  needsCertification: 40,
  existingCertificates: 400,
  supplyChainAdvantages: 400,
  factoryAdvantages: 400,
  additionalNotes: 800,
};

// 风险字段列表（用于判断是否需要红色高亮）
export const riskFields: Array<keyof ProductFormInput> = [
  "isFragile",
  "isLiquid",
  "isBatteryPowered",
  "isMagnetic",
  "isFoodContact",
  "isChildrenProduct",
  "needsCertification",
];

// 用于展示的评分维度标签
export const scoreDimensionLabels: Record<keyof ScoreBreakdown, { label: string; maxScore: number }> = {
  marketDemand: { label: "市场需求", maxScore: 20 },
  competitionRisk: { label: "竞争强度", maxScore: 15 },
  profitMargin: { label: "利润空间", maxScore: 20 },
  logisticsDifficulty: { label: "物流难度", maxScore: 10 },
  complianceRisk: { label: "认证/合规风险", maxScore: 10 },
  b2bFit: { label: "B2B 适配度", maxScore: 10 },
  differentiation: { label: "差异化空间", maxScore: 10 },
  beginnerDifficulty: { label: "新手操作难度", maxScore: 5 },
};
