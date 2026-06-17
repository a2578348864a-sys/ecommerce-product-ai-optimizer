export const platformOptions = ["manual", "tiktok", "amazon", "etsy", "shopify", "instagram", "pinterest", "youtube_shorts", "other"] as const;

export type Platform = (typeof platformOptions)[number];

export const platformLabels: Record<Platform, string> = {
  manual: "手动输入",
  tiktok: "TikTok",
  amazon: "Amazon",
  etsy: "Etsy",
  shopify: "Shopify / 独立站",
  instagram: "Instagram",
  pinterest: "Pinterest",
  youtube_shorts: "YouTube Shorts",
  other: "其他海外平台",
};

// ========== 跨境电商平台 ==========

/** 跨境电商售卖平台（TargetPlatform 的常量数组，用于迭代和校验） */
export const CROSS_BORDER_PLATFORMS = [
  "amazon",
  "ebay",
  "etsy",
  "shopify",
  "tiktok_shop",
  "shopee",
  "lazada",
  "temu",
  "other",
] as const;

/** 所有已知平台（海外 + 跨境 + 杂项），用于 API 校验 */
export const ALL_KNOWN_PLATFORMS = [
  ...platformOptions,
  ...CROSS_BORDER_PLATFORMS,
  "1688",
  "alibaba",
] as const;

/** 跨境 + 杂项平台的中文标签 */
export const crossBorderPlatformLabels: Record<string, string> = {
  amazon: "Amazon",
  ebay: "eBay",
  etsy: "Etsy",
  shopify: "Shopify",
  tiktok_shop: "TikTok Shop",
  tiktok: "TikTok",
  shopee: "Shopee",
  lazada: "Lazada",
  temu: "Temu",
  instagram: "Instagram",
  pinterest: "Pinterest",
  youtube_shorts: "YouTube Shorts",
  "1688": "1688",
  alibaba: "阿里国际站",
  other: "其他平台",
};

/** 合并所有平台标签（中国 + 跨境） */
export const allPlatformLabels: Record<string, string> = {
  ...platformLabels,
  ...crossBorderPlatformLabels,
};

export const analysisGoals = [
  "能不能跟品",
  "风险有多高",
  "去哪里找货",
  "怎么差异化",
  "全部分析",
] as const;

export const personalLimitOptions = [
  "不做食品",
  "不做美妆",
  "不做儿童用品",
  "不做带电产品",
  "不做大件",
  "不做易碎",
  "不做高售后",
  "不做品牌/IP相关",
] as const;

export const preferredCategories = [
  "家居收纳",
  "厨房小工具",
  "清洁用品",
  "桌面办公",
  "宿舍用品",
  "宠物用品，但不包括宠物食品和宠物药品",
  "车载小件，但不包括汽车安全件",
  "低价、低售后、低资质风险的百货类小件",
] as const;

export const riskBlacklist = [
  "食品",
  "美妆",
  "儿童用品",
  "母婴用品",
  "医疗健康",
  "减肥产品",
  "保健品",
  "宠物食品",
  "宠物药品",
  "贴身用品",
  "带电产品",
  "电池",
  "充电器",
  "加热类产品",
  "汽车安全件",
  "大件商品",
  "易碎商品",
  "液体商品",
  "品牌强相关",
  "卡通/IP形象",
  "明星同款",
  "影视/动漫/游戏周边",
  "疑似专利结构商品",
] as const;

export type ConfidenceLevel = "low" | "medium" | "high";
export type FinalDecision = "recommend" | "caution" | "reject";
export type MaterialType = "url" | "image" | "text";
export type MaterialStatus = "success" | "partial" | "failed" | "need_more_info";
export type DetectedMaterialType =
  | "product_page"
  | "ranking_page"
  | "search_result"
  | "note"
  | "comment_screenshot"
  | "product_image"
  | "manual_text"
  | "unknown";

export type LinkType = "product" | "ranking" | "search" | "note" | "unknown";

export type PlatformSearchStatusValue =
  | "success"
  | "partial"
  | "need_login"
  | "no_permission"
  | "captcha"
  | "failed"
  | "manual_required"
  | "not_supported_yet";

export type ConfidenceField = {
  fieldName: string;
  value: string;
  confidence: ConfidenceLevel;
  reason: string;
};

export type MaterialInput = {
  id: string;
  type: MaterialType;
  sourceName?: string;
  originalUrl?: string;
  cleanedUrl?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  rawText?: string;
  previewUrl?: string;
  createdAt: string;
};

export type ProductEvidence = {
  productName?: string;
  normalizedProductName?: string;
  priceText?: string;
  salesText?: string;
  ratingText?: string;
  rankText?: string;
  shopName?: string;
  brandName?: string;
  pageTitle?: string;
  visibleDescription?: string;
  sourceUrl?: string;
  platform: Platform | "unknown";
  rawEvidenceText: string;
  capturedAt: string;
  confidenceFields: ConfidenceField[];
};

export type EvidenceCard = ProductEvidence & {
  id: string;
  materialId: string;
  materialType: MaterialType;
  detectedMaterialType: DetectedMaterialType;
  status: MaterialStatus;
  missingFields: string[];
  message: string;
  riskNotes: string;
  userNotes: string;
};

export type MaterialAnalysisResult = {
  materialId: string;
  materialType: MaterialType;
  detectedPlatform: Platform | "unknown";
  detectedMaterialType: DetectedMaterialType;
  status: MaterialStatus;
  extractedEvidence: ProductEvidence[];
  missingFields: string[];
  message: string;
};

export type MaterialAgentCompleteness = "完整" | "一般" | "不完整";

export type MaterialAgentResult = {
  productType: string;
  sellingPoints: string[];
  targetUsers: string[];
  usageScenarios: string[];
  priceRange: string;
  painPoints: string[];
  commentDemands: string[];
  riskWords: string[];
  materialCompleteness: MaterialAgentCompleteness;
  missingInfo: string[];
  summary: string;
};

export type ViralLevel = "高" | "中" | "低";

export type ViralLevelReason = {
  level: ViralLevel;
  reason: string;
};

export type ViralAgentResult = {
  titleAttraction: ViralLevelReason;
  sellingPointClarity: ViralLevelReason;
  sceneSense: ViralLevelReason;
  commentDemand: ViralLevelReason;
  painPointStrength: ViralLevelReason;
  contentShootability: ViralLevelReason;
  viralPotential: ViralLevel;
  bonusPoints: string[];
  weakPoints: string[];
  optimizationSuggestions: string[];
  suggestedAngles: string[];
  summary: string;
};

export type LinkAnalysisInput = {
  originalUrl: string;
  cleanedUrl: string;
  platform: Platform | "unknown";
  linkType: LinkType;
  rawText?: string;
};

export type RadarFormInput = {
  keyword: string;
  analysisGoal: string;
  targetPriceRange: string;
  targetAudience: string;
  excludedCategories: string;
  selectedPlatforms: Platform[];
  personalLimits: string[];
  notes: string;
  linksText: string;
  manualText: string;
  lowTokenMode: boolean;
  materials: MaterialInput[];
  evidenceCards: EvidenceCard[];
};

export type GenerateRequest = RadarFormInput & {
  accessPassword: string;
};

export type PlatformSearchStatus = {
  platform: Platform | string;
  status: PlatformSearchStatusValue;
  message: string;
  itemCount: number;
};

export type CandidateProduct = {
  productName: string;
  normalizedProductName: string;
  platform: Platform | string;
  priceText: string;
  salesText: string;
  ratingText: string;
  rankText: string;
  shopName: string;
  brandName: string;
  productUrl: string;
  sourceUrl: string;
  capturedAt: string;
  sourcePlatform: Platform | string;
  rawEvidenceText: string;
  evidenceText: string;
  riskTags: string[];
  hotScore: number;
  beginnerFitScore: number;
  competitionScore: number;
  afterSalesRiskScore: number;
  ipRiskScore: number;
  logisticsRiskScore: number;
  grossMarginPotentialScore: number;
  finalScore: number;
  hotReason: string;
  beginnerFitReason: string;
  competitionRisk: string;
  afterSalesRisk: string;
  ipRisk: string;
  logisticsRisk: string;
  estimatedCostRange: string;
  suggestedSellingPrice: string;
  grossMarginHint: string;
  shippingDifficulty: string;
  afterSalesDifficulty: string;
  ipRiskLevel: string;
  sourcingKeywords: {
    source1688: string[];
    pdd: string[];
    taobao: string[];
    specsAndMaterials: string[];
    differentiation: string[];
  };
  differentiationAngle: string;
  similarDirections: string[];
  finalDecision: FinalDecision;
  reason: string;
};

export type PlatformEvidence = {
  platform: Platform | string;
  evidenceSummary: string;
  credibility: string;
  gaps: string;
};

export type RiskWarning = {
  riskType: string;
  level: "green" | "yellow" | "red";
  relatedProducts: string[];
  reason: string;
  suggestion: string;
};

export type TrafficLightRisk = {
  name: string;
  level: "green" | "yellow" | "red";
  explanation: string;
};

export type DifferentiationIdea = {
  productDirection: string;
  angle: string;
  whyItMayWork: string;
  contentSuggestion: string;
};

export type NextAction = {
  productDirection: string;
  action: string;
  checklist: string[];
  testSuggestion: "先观察" | "小批量测试" | "暂不做" | "直接排除";
};

export type HotProductRadarResult = {
  summary: string;
  finalDecision: FinalDecision;
  confidenceLevel: ConfidenceLevel;
  sampleQuality: string;
  agentConclusion: string;
  platformSearchStatus: PlatformSearchStatus[];
  evidenceCards: EvidenceCard[];
  candidateProducts: CandidateProduct[];
  recommendedProducts: CandidateProduct[];
  cautiousProducts: CandidateProduct[];
  rejectedProducts: CandidateProduct[];
  platformEvidence: PlatformEvidence[];
  riskWarnings: RiskWarning[];
  sourcingKeywords: string[];
  differentiationIdeas: DifferentiationIdea[];
  similarProductDirections: string[];
  nextActions: NextAction[];
  trafficLightRisks: TrafficLightRisk[];
  disclaimer: string;
};

export type GenerateErrorResponse = {
  error: string;
  fieldErrors?: Partial<Record<keyof RadarFormInput | "accessPassword", string>>;
};

export const inputLimits: Partial<Record<keyof RadarFormInput, number>> = {
  keyword: 80,
  analysisGoal: 40,
  targetPriceRange: 80,
  targetAudience: 200,
  excludedCategories: 300,
  notes: 800,
  linksText: 3000,
  manualText: 12000,
};

export const imageLimits = {
  maxCount: 10,
  maxSizeBytes: 8 * 1024 * 1024,
  acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
};

export const linkLimits = {
  maxCount: 10,
};

export const defaultPlatformStatus: PlatformSearchStatus[] = [
  {
    platform: "manual",
    status: "success",
    message: "已使用你手动提供的商品、素材或截图信息作为主要分析来源。",
    itemCount: 0,
  },
  {
    platform: "tiktok",
    status: "not_supported_yet",
    message: "V1 不读取 TikTok 页面，请上传截图或手动粘贴可见信息。",
    itemCount: 0,
  },
  {
    platform: "amazon",
    status: "manual_required",
    message: "V1 不自动抓取 Amazon 页面，请手动粘贴商品信息或上传截图。",
    itemCount: 0,
  },
  {
    platform: "etsy",
    status: "manual_required",
    message: "V1 不自动抓取 Etsy 页面，请手动粘贴商品信息或上传截图。",
    itemCount: 0,
  },
  {
    platform: "shopify",
    status: "manual_required",
    message: "V1 不自动抓取 Shopify 独立站页面，请手动粘贴商品信息。",
    itemCount: 0,
  },
  {
    platform: "instagram",
    status: "not_supported_yet",
    message: "V1 不支持自动读取 Instagram 内容，请上传截图或手动粘贴素材。",
    itemCount: 0,
  },
  {
    platform: "pinterest",
    status: "manual_required",
    message: "V1 不读取 Pinterest 页面，请手动粘贴商品或素材信息。",
    itemCount: 0,
  },
  {
    platform: "youtube_shorts",
    status: "not_supported_yet",
    message: "V1 不支持自动读取 YouTube Shorts，请上传截图或手动粘贴素材。",
    itemCount: 0,
  },
  {
    platform: "other",
    status: "manual_required",
    message: "V1 对其他海外平台不自动读取，请手动粘贴信息或上传截图。",
    itemCount: 0,
  },
  {
    platform: "ebay",
    status: "manual_required",
    message: "V1 不自动抓取 eBay 页面，请手动粘贴商品信息或上传截图。",
    itemCount: 0,
  },
  {
    platform: "shopee",
    status: "manual_required",
    message: "V1 不自动抓取 Shopee 页面，请手动粘贴商品信息或上传截图。",
    itemCount: 0,
  },
  {
    platform: "lazada",
    status: "manual_required",
    message: "V1 不自动抓取 Lazada 页面，请手动粘贴商品信息或上传截图。",
    itemCount: 0,
  },
  {
    platform: "temu",
    status: "not_supported_yet",
    message: "V1 不读取 Temu 页面，请上传截图或手动粘贴可见信息。",
    itemCount: 0,
  },
];

export const reportDisclaimer =
  "免责声明：本报告仅基于用户提供信息和本地浏览器可见页面内容生成，不构成经营、投资或法律建议。平台数据可能变化，最终选品需人工复核资质、侵权、价格、供货、售后、物流和平台规则风险。";

// ========== 跨境电商选品上架助手 MVP 类型 ==========

export type TargetPlatform =
  | "amazon"
  | "ebay"
  | "etsy"
  | "shopify"
  | "tiktok_shop"
  | "shopee"
  | "lazada"
  | "temu"
  | "other";

export type TargetCountry = string;

export type CurrencyCode =
  | "USD"
  | "EUR"
  | "GBP"
  | "JPY"
  | "CNY"
  | (string & { readonly __currencyCode?: never });

export type ProductStatus =
  | "draft"
  | "analyzed"
  | "copy_generated"
  | "pending_confirm"
  | "exported"
  | "discarded";

export type ListingConfirmStatus = "pending" | "confirmed" | "needs_edit";

export type NumericFormValue = string;

export type CrossBorderProductFormInput = {
  name: string;
  description: string;
  purchasePrice: NumericFormValue;
  domesticShippingFee: NumericFormValue;
  weight: NumericFormValue;
  packageLength: NumericFormValue;
  packageWidth: NumericFormValue;
  packageHeight: NumericFormValue;
  targetCountry: TargetCountry;
  targetPlatform: TargetPlatform;
  currency: CurrencyCode;
  internationalShippingFee: NumericFormValue;
  commissionRate: NumericFormValue;
  expectedProfitRate: NumericFormValue;
  otherCost: NumericFormValue;
  stock: NumericFormValue;
  imagePaths: string[];
};

export type CrossBorderProductInput = {
  id?: string;
  sku?: string;
  name?: string;
  description?: string;
  purchasePrice?: number;
  domesticShippingFee?: number;
  weight?: number;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  targetCountry?: TargetCountry;
  targetPlatform?: TargetPlatform;
  currency?: CurrencyCode;
  internationalShippingFee?: number;
  commissionRate?: number;
  expectedProfitRate?: number;
  otherCost?: number;
  stock?: number;
  imagePaths?: string[];
  status?: ProductStatus;
  createdAt?: string;
  updatedAt?: string;
};

export type ProfitNumberInput = number | string | null | undefined;

export type ProfitCalculationInput = {
  purchasePrice?: ProfitNumberInput;
  domesticShippingFee?: ProfitNumberInput;
  internationalShippingFee?: ProfitNumberInput;
  commissionRate?: ProfitNumberInput;
  expectedProfitRate?: ProfitNumberInput;
  otherCost?: ProfitNumberInput;
  manualSellingPrice?: ProfitNumberInput;
  currency?: CurrencyCode;
};

export type ProfitCalculationResult = {
  baseCost: number;
  totalFixedCost: number;
  commissionRate: number;
  suggestedPrice: number;
  breakEvenPrice: number;
  commissionAmount: number;
  grossProfit: number;
  grossMargin: number;
  roi: number;
  currency: CurrencyCode;
  warnings: string[];
};

export type ProfitLevel = "loss" | "low" | "medium" | "high";

export type ListingCopyResult = {
  title: string;
  bulletPoints: string[];
  description: string;
  shortDescription: string;
  keywords: string[];
  longTailKeywords: string[];
  faq: Array<{
    question: string;
    answer: string;
  }>;
  packingList: string[];
  afterSales: string;
  notes: string[];
};

export type AiAnalysisResult = {
  recommendation: "recommend" | "caution" | "reject";
  score: number;
  reasons: string[];
  risks: string[];
  targetAudience: string[];
  scenarios: string[];
  platformFit: string;
  logisticsRisk: string;
  afterSalesRisk: string;
  infringementRisk: string;
  sensitiveCategoryRisk: string;
  newbieFriendly: boolean;
};

export type KeywordGenerationResult = {
  coreKeywords: string[];
  longTailKeywords: string[];
  searchTerms: string[];
  titleKeywords: string[];
  sellingPointKeywords: string[];
  riskWords: string[];
  negativeKeywords?: string[];
  platformNotes: string;
};

export type StructuredListingData = {
  sku: string;
  title: string;
  price: number;
  stock: number;
  targetPlatform: TargetPlatform;
  targetCountry: TargetCountry;
  categorySuggestion: string;
  attributes: Record<string, string>;
  keywords: string[];
  bulletPoints: string[];
  description: string;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  imagePaths: string[];
  riskNotes: string[];
  confirmStatus: ListingConfirmStatus;
};
