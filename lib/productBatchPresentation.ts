import type { ProductBatchReportType } from "@/lib/productBatchContract";
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

export type ProductBatchImportInspection = {
  reportType: SellerSpriteDetectedReportType;
  reportTypeDetected: boolean;
  categoryDetection: ProductBatchCategoryDetection;
  query: null;
  queryDetection: "not_available";
};

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
