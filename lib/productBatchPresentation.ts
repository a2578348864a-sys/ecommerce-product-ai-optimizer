import type { ProductBatchReportType } from "@/lib/productBatchContract";
import type { ProductBatchItemView } from "@/lib/productBatchStore";
import type { SellerSpriteDetectedReportType } from "@/lib/upstream/sellersprite/reportType";

export const AMAZON_US_TOP_LEVEL_CATEGORIES = [
  { value: "Amazon Devices & Accessories", label: "Amazon 设备与配件" },
  { value: "Amazon Renewed", label: "Amazon 翻新商品" },
  { value: "Appliances", label: "家用电器" },
  { value: "Apps & Games", label: "应用与游戏" },
  { value: "Arts, Crafts & Sewing", label: "艺术、手工与缝纫" },
  { value: "Audible Books & Originals", label: "Audible 有声书与原创内容" },
  { value: "Automotive", label: "汽车用品" },
  { value: "Baby", label: "母婴用品" },
  { value: "Beauty & Personal Care", label: "美妆与个人护理" },
  { value: "Books", label: "图书" },
  { value: "Camera & Photo Products", label: "相机与摄影" },
  { value: "CDs & Vinyl", label: "CD 与黑胶唱片" },
  { value: "Cell Phones & Accessories", label: "手机与配件" },
  { value: "Clothing & Accessories", label: "服装与配饰" },
  { value: "Clothing, Shoes & Jewelry", label: "服装、鞋靴与珠宝" },
  { value: "Collectible Coins", label: "收藏硬币" },
  { value: "Collectibles & Fine Art", label: "收藏品与艺术品" },
  { value: "Computers & Accessories", label: "电脑与配件" },
  { value: "Digital Educational Resources", label: "数字教育资源" },
  { value: "Digital Music", label: "数字音乐" },
  { value: "Electronics", label: "电子产品" },
  { value: "Entertainment Collectibles", label: "娱乐收藏品" },
  { value: "Garden & Outdoor", label: "花园与户外" },
  { value: "Gift Cards", label: "礼品卡" },
  { value: "Grocery & Gourmet Food", label: "食品与美食" },
  { value: "Handmade Products", label: "手工商品" },
  { value: "Health & Household", label: "健康与家居日用" },
  { value: "Home & Business Services", label: "家庭与商业服务" },
  { value: "Home & Kitchen", label: "家居与厨房" },
  { value: "Industrial & Scientific", label: "工业与科学用品" },
  { value: "Jewelry", label: "珠宝" },
  { value: "Kindle Store", label: "Kindle 商店" },
  { value: "Kitchen & Dining", label: "厨房与餐厨" },
  { value: "Luggage & Travel Gear", label: "箱包与旅行用品" },
  { value: "Luxury Beauty", label: "高端美妆" },
  { value: "Magazine Subscriptions", label: "杂志订阅" },
  { value: "Movies & TV", label: "电影与电视" },
  { value: "Musical Instruments", label: "乐器" },
  { value: "Office Products", label: "办公用品" },
  { value: "Patio, Lawn & Garden", label: "庭院、草坪与园艺" },
  { value: "Pet Supplies", label: "宠物用品" },
  { value: "Prime Video", label: "Prime Video" },
  { value: "Shoes", label: "鞋靴" },
  { value: "Software", label: "软件" },
  { value: "Sports & Outdoors", label: "运动与户外" },
  { value: "Sports Collectibles", label: "体育收藏品" },
  { value: "Tools & Home Improvement", label: "工具与家装" },
  { value: "Toys & Games", label: "玩具与游戏" },
  { value: "Unique Finds", label: "特色商品" },
  { value: "Video Games", label: "电子游戏" },
  { value: "Watches", label: "腕表" },
] as const;

export type AmazonUsTopLevelCategory =
  typeof AMAZON_US_TOP_LEVEL_CATEGORIES[number]["value"];

const AMAZON_US_TOP_LEVEL_CATEGORY_SET = new Set<string>(
  AMAZON_US_TOP_LEVEL_CATEGORIES.map((category) => category.value),
);
const AMAZON_CATEGORY_ALIASES = new Map<string, AmazonUsTopLevelCategory>([
  ["Automotive Parts & Accessories", "Automotive"],
  ["Camera & Photo", "Camera & Photo Products"],
  ["Computers", "Computers & Accessories"],
  ["Handmade", "Handmade Products"],
  ["Health, Household & Baby Care", "Health & Household"],
]);

export type ProductBatchCategoryDetection = {
  status: "detected" | "mixed_requires_confirmation" | "unknown";
  category: AmazonUsTopLevelCategory | null;
  distribution: ReadonlyArray<{
    category: AmazonUsTopLevelCategory;
    count: number;
  }>;
  validCategoryCount: number;
};

/**
 * 报表类型「辅助诊断建议」（Core-Smoke-Fix.1 复核）：
 * 仅用于无法自动识别时的人工选择提示，**不参与 reportType 自动判定**。
 * 所有信号均为 supporting 级（真实样本规律，未经官方合同证明）：
 * - bandLikeBsr：大类 BSR 全部 ∈[1..10]（12/12 CC 样本；Top100/加载更多导出可 >10）
 * - singleRootCategory：大类目唯一（12/12 CC 样本；PS 搜索词可能命中单类目）
 * - hotSales：月销量中位数 ≥ 10,000（CC 榜单热销特征；PS 热销搜索词可能命中）
 * - bestSellerMajority：Best Seller 标识行占比 ≥ 50%（同上）
 * 综合：≥3 信号成立 → 建议 category_current；≤1 → 建议 search_results；否则无建议。
 * 用户可基于报表内容推翻建议（fail-closed 不变）。
 */
export type SellerSpriteReportTypeHints = {
  suggestion: "category_current" | "search_results" | null;
  signals: {
    bandLikeBsr: boolean;
    singleRootCategory: boolean;
    hotSales: boolean;
    bestSellerMajority: boolean;
  };
  reasons: ReadonlyArray<string>;
};

export type ProductBatchImportInspection = {
  reportType: SellerSpriteDetectedReportType;
  reportTypeDetected: boolean;
  categoryDetection: ProductBatchCategoryDetection;
  /** 仅 reportTypeDetected=false 时有值（辅助建议，非判定） */
  reportTypeHints: SellerSpriteReportTypeHints | null;
  query: null;
  queryDetection: "not_available";
};

/** 建议阈值（supporting 信号，非合同） */
const HOT_SALES_MEDIAN_MIN = 10_000;
const BEST_SELLER_RATIO_MIN = 0.5;

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildSellerSpriteReportTypeHints(input: {
  rootCategoryBsrValues: ReadonlyArray<number>;
  rootCategories: ReadonlyArray<string>;
  monthlySalesValues: ReadonlyArray<number>;
  bestSellerFlagRows: number;
  totalRows: number;
}): SellerSpriteReportTypeHints {
  const bandLikeBsr = input.rootCategoryBsrValues.length > 0
    && input.rootCategoryBsrValues.every((value) => value >= 1 && value <= 10);
  const singleRootCategory = new Set(input.rootCategories.filter(Boolean)).size === 1;
  const salesMedian = median(input.monthlySalesValues);
  const hotSales = salesMedian !== null && salesMedian >= HOT_SALES_MEDIAN_MIN;
  const bestSellerMajority = input.totalRows > 0
    && input.bestSellerFlagRows / input.totalRows >= BEST_SELLER_RATIO_MIN;
  const signals = { bandLikeBsr, singleRootCategory, hotSales, bestSellerMajority };
  const reasons: string[] = [];
  if (bandLikeBsr) reasons.push("大类 BSR 值域呈榜单形态（1..10）");
  if (singleRootCategory) reasons.push("大类目唯一");
  if (hotSales) reasons.push(`月销量中位数高（≥${HOT_SALES_MEDIAN_MIN.toLocaleString("en-US")}）`);
  if (bestSellerMajority) reasons.push("多数行带 Best Seller 标识");
  const signalCount = Object.values(signals).filter(Boolean).length;
  const suggestion: SellerSpriteReportTypeHints["suggestion"] = signalCount >= 3
    ? "category_current"
    : signalCount <= 1
      ? "search_results"
      : null;
  return { suggestion, signals, reasons };
}

export function isAmazonUsTopLevelCategory(
  value: string,
): value is AmazonUsTopLevelCategory {
  return AMAZON_US_TOP_LEVEL_CATEGORY_SET.has(value);
}

function canonicalAmazonCategory(value: string): AmazonUsTopLevelCategory | null {
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  const alias = AMAZON_CATEGORY_ALIASES.get(normalized);
  if (alias) return alias;
  return isAmazonUsTopLevelCategory(normalized) ? normalized : null;
}

export function detectProductBatchCategory(input: {
  reportType: SellerSpriteDetectedReportType;
  rootCategories: ReadonlyArray<string>;
}): ProductBatchCategoryDetection {
  const counts = new Map<AmazonUsTopLevelCategory, number>();
  for (const raw of input.rootCategories) {
    const category = canonicalAmazonCategory(raw);
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const distribution = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => (
      right.count - left.count || left.category.localeCompare(right.category, "en")
    ));
  const validCategoryCount = distribution.reduce((sum, item) => sum + item.count, 0);
  if (distribution.length === 0 || input.reportType === "unknown") {
    return {
      status: "unknown",
      category: null,
      distribution,
      validCategoryCount,
    };
  }
  const first = distribution[0];
  const secondCount = distribution[1]?.count ?? 0;
  const categoryCurrentDetected = input.reportType === "category_current"
    && first.count > secondCount;
  const searchDetected = input.reportType === "search_results"
    && first.count > secondCount
    && first.count / validCategoryCount >= 0.6;
  if (categoryCurrentDetected || searchDetected) {
    return {
      status: "detected",
      category: first.category,
      distribution,
      validCategoryCount,
    };
  }
  return {
    status: "mixed_requires_confirmation",
    category: null,
    distribution,
    validCategoryCount,
  };
}

export function productBatchReportTypeLabel(reportType: ProductBatchReportType): string {
  return reportType === "search_results"
    ? "搜索结果报表"
    : "类目商品报表";
}

export type ProductBatchItemPresentation = {
  title: string;
  asin: string | null;
  price: string;
  rating: string;
  reviews: string;
  estimatedMonthlySales: string;
  researchPriority: string;
  evidenceStatus: string;
  positiveReasons: string[];
  counterSignals: string[];
  missingSignals: string[];
};

const RESEARCH_PRIORITY_LABELS: Readonly<Record<string, string>> = {
  priority_1: "优先研究",
  priority_2: "次优先研究",
  priority_3: "后续研究",
  unranked_insufficient_evidence: "暂不排序（证据不足）",
};

const EVIDENCE_STATUS_LABELS: Readonly<Record<string, string>> = {
  sufficient_for_comparison: "证据较完整，可用于批次内比较",
  limited_evidence: "证据有限，需要补充核验",
  insufficient_evidence: "证据不足，暂不参与排序",
};

const MARKET_SIGNAL_LABELS: Readonly<Record<string, string>> = {
  price_within_brief_range: "价格在本次研究范围内",
  price_outside_brief_range: "价格不在本次研究范围内",
  estimated_monthly_sales_at_or_above_report_midpoint:
    "SellerSprite 估算月销量不低于本报告中位数",
  estimated_monthly_sales_below_report_midpoint:
    "SellerSprite 估算月销量低于本报告中位数",
  rating_quality_supported: "评分与评论证据相对充分",
  rating_quality_limited: "评分与评论证据相对有限",
  sales_review_efficiency_at_or_above_neutral: "估算销量与评论数的相对关系不低于中性水平",
  sales_review_efficiency_below_neutral: "估算销量与评论数的相对关系低于中性水平",
  organic_visibility_observed: "观察到自然搜索曝光",
  sponsored_only_visibility: "只观察到广告曝光",
  organic_and_sponsored_coverage: "同时观察到自然与广告曝光",
  organic_visibility_zero_with_sponsored_evidence: "有广告曝光证据，但未观察到自然曝光",
  multiple_variations_context_only_no_score: "变体较多，仅作背景信息，未计分",
  core_estimated_monthly_sales_conflicting: "核心估算月销量数据存在冲突",
  core_estimated_monthly_sales_missing: "缺少核心估算月销量数据",
  core_search_placement_missing: "缺少核心搜索位置数据",
  root_category_bsr_comparable: "根类目 BSR 可在本报告内比较",
  subcategory_bsr_not_comparable: "子类目 BSR 暂不可比较",
  subcategory_bsr_comparable_within_exact_group: "子类目 BSR 可在相同分组内比较",
  core_root_category_bsr_conflicting: "核心根类目 BSR 数据存在冲突",
  core_root_category_bsr_missing: "缺少核心根类目 BSR 数据",
};

const MISSING_SIGNAL_LABELS: Readonly<Record<string, string>> = {
  productTitle: "商品标题",
  brand: "品牌",
  price: "价格",
  priceFit: "价格范围匹配信息",
  rating: "评分",
  reviews: "评论数",
  estimatedMonthlySales: "SellerSprite 估算月销量",
  searchPlacement: "搜索位置",
  rootCategoryBsr: "根类目 BSR",
  subCategory: "子类目",
  subCategoryBsr: "子类目 BSR",
};

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function boundedText(value: unknown, limit = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= limit ? text : null;
}

function resolvedMetric(
  product: Record<string, unknown> | null,
  field: string,
): string | number | null {
  const metrics = product?.providerMetrics;
  if (typeof metrics !== "object" || metrics === null || Array.isArray(metrics)) return null;
  const metric = (metrics as Record<string, unknown>)[field];
  if (typeof metric !== "object" || metric === null || Array.isArray(metric)) return null;
  const record = metric as Record<string, unknown>;
  if (record.status !== "resolved") return null;
  const normalized = record.normalized;
  if (typeof normalized === "number") return Number.isFinite(normalized) ? normalized : null;
  return boundedText(normalized);
}

function metricText(
  product: Record<string, unknown> | null,
  field: string,
  missing: string,
  grouped = false,
): string {
  const value = resolvedMetric(product, field);
  if (value === null) return missing;
  return typeof value === "number" && grouped
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : String(value);
}

function signalList(
  ranking: Record<string, unknown> | null,
  field: "positiveReasons" | "counterSignals" | "missingSignals",
): string[] {
  const value = ranking?.[field];
  if (!Array.isArray(value)) return [];
  const labels = field === "missingSignals" ? MISSING_SIGNAL_LABELS : MARKET_SIGNAL_LABELS;
  return value
    .slice(0, 24)
    .flatMap((entry) => {
      const code = boundedText(entry, 120);
      return code ? [labels[code] ?? code] : [];
    });
}

export function readProductBatchItemPresentation(
  item: ProductBatchItemView,
): ProductBatchItemPresentation {
  const product = parseObject(item.normalizedProductJson);
  const ranking = parseObject(item.rankingJson);
  return {
    title: boundedText(resolvedMetric(product, "productTitle")) ?? "商品标题缺失",
    asin: boundedText(item.asin, 32),
    price: metricText(product, "price", "待确认"),
    rating: metricText(product, "rating", "缺失"),
    reviews: metricText(product, "reviews", "缺失", true),
    estimatedMonthlySales: metricText(product, "estimatedMonthlySales", "缺失", true),
    researchPriority: RESEARCH_PRIORITY_LABELS[item.researchPriority] ?? "研究顺序待确认",
    evidenceStatus: EVIDENCE_STATUS_LABELS[item.evidenceStatus] ?? "证据状态待确认",
    positiveReasons: signalList(ranking, "positiveReasons"),
    counterSignals: signalList(ranking, "counterSignals"),
    missingSignals: signalList(ranking, "missingSignals"),
  };
}
