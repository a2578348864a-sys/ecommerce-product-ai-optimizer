export const categories = [
  "服装",
  "美妆",
  "数码",
  "家居",
  "食品",
  "宠物用品",
  "母婴",
  "运动",
  "其他",
] as const;

export const platforms = [
  "淘宝/天猫",
  "拼多多",
  "抖音小店",
  "小红书",
  "TikTok Shop",
  "亚马逊",
  "独立站",
] as const;

export const tones = [
  "专业可信",
  "年轻活泼",
  "高端质感",
  "强促销转化",
  "小红书种草风",
] as const;

export const languages = ["中文", "英文", "中英双语"] as const;

export type ProductInput = {
  productName: string;
  category: string;
  platform: string;
  sellingPointsInput: string;
  targetAudience: string;
  priceRange?: string;
  competitorInfo?: string;
  painPoints?: string;
  tone: string;
  language: string;
};

export type GenerateRequest = ProductInput & {
  accessPassword: string;
};

export type GeneratedContent = {
  titles: string[];
  coverCopies: string[];
  sellingPoints: string[];
  detailPageCopy: string;
  xiaohongshuPosts: string[];
  videoScripts: string[];
  customerServiceReplies: string[];
  negativeReviewReplies: string[];
  differentiationAdvice: string[];
  conversionAdvice: string[];
  audienceTags: string[];
  marketingHooks: string[];
  seoKeywords: string[];
  searchTerms: string[];
  imageOptimizationIdeas: string[];
  complianceChecklist: string[];
  priorityActionPlan: string[];
};

export type GenerateErrorResponse = {
  error: string;
  fieldErrors?: Partial<Record<keyof GenerateRequest, string>>;
};

export const inputLimits: Record<keyof ProductInput, number> = {
  productName: 80,
  category: 40,
  platform: 40,
  sellingPointsInput: 800,
  targetAudience: 80,
  priceRange: 80,
  competitorInfo: 600,
  painPoints: 500,
  tone: 40,
  language: 40,
};

export const requiredFields: Array<keyof ProductInput> = [
  "productName",
  "category",
  "platform",
  "sellingPointsInput",
  "targetAudience",
  "tone",
  "language",
];

export const resultLabels: Array<{
  key: keyof GeneratedContent;
  title: string;
  description: string;
}> = [
  { key: "titles", title: "商品标题", description: "10 个适合测试的标题方向" },
  { key: "coverCopies", title: "商品主图文案", description: "5 条可放在主图上的短文案" },
  { key: "sellingPoints", title: "商品核心卖点", description: "6 条面向转化的卖点表达" },
  { key: "detailPageCopy", title: "详情页完整文案", description: "可直接改写成详情页结构" },
  { key: "xiaohongshuPosts", title: "小红书种草文案", description: "3 条更适合内容平台的文案" },
  { key: "videoScripts", title: "抖音/短视频脚本", description: "3 条短视频口播与镜头脚本" },
  { key: "customerServiceReplies", title: "客服常见问题回复", description: "8 条售前售后高频回复" },
  { key: "negativeReviewReplies", title: "差评回复模板", description: "5 条克制、可执行的回复模板" },
  { key: "differentiationAdvice", title: "竞品差异化建议", description: "帮助商品避开同质化竞争" },
  { key: "conversionAdvice", title: "提高转化率的优化建议", description: "页面、价格、信任和促销优化" },
  { key: "audienceTags", title: "适合投放的人群标签", description: "广告和内容测试可用标签" },
  { key: "marketingHooks", title: "适合测试的营销钩子", description: "可用于标题、视频和广告开头" },
  { key: "seoKeywords", title: "SEO 关键词", description: "适合平台搜索、长尾词和人群意图的关键词" },
  { key: "searchTerms", title: "搜索词和后台词", description: "适合上架、标签和广告测试的词组" },
  { key: "imageOptimizationIdeas", title: "主图/详情图优化建议", description: "图片信息层级、场景和卖点表达建议" },
  { key: "complianceChecklist", title: "平台合规检查", description: "发布前需要人工核对的风险点" },
  { key: "priorityActionPlan", title: "优先行动计划", description: "上新、测试和优化的可执行步骤" },
];
