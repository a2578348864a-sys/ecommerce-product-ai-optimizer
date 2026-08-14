/**
 * Golden Dataset — SellerSprite 报告类型识别（真实形态脱敏 fixture）。
 *
 * 表头为真实 SellerSprite 导出 72 列（2026-08-14 双样本核实）：
 * - Product Search 与 Category Current 新格式表头完全相同（均无「搜索排名」列）；
 * - 行级差异：Category Current（BSR 类目榜）大类 BSR 值域 [1..10]（12/12 样本），
 *   Product Search（无搜索排名列）大类 BSR 无此约束（样本 max=750682、非升序）。
 * 行数据全部合成脱敏（ASIN/品牌/链接/标题使用 GOLDEN/SANITIZED 前缀），不含真实业务数据。
 */
import { SELLERSPRITE_SEARCH_EXPORT_HEADERS } from "../fixtures/search-export.sanitized.v1";

/** 真实新格式表头（72 列；PS 与 CC 相同，无「搜索排名」列） */
export const GOLDEN_CURRENT_FORMAT_HEADERS = [
  "#",
  "图片",
  "ASIN",
  "SKU",
  "详细参数",
  "品牌",
  "品牌链接",
  "商品标题",
  "标题(翻译)",
  "产品卖点",
  "产品卖点(翻译)",
  "商品详情页链接",
  "商品主图",
  "父ASIN",
  "类目路径",
  "大类目",
  "大类BSR",
  "大类BSR增长数",
  "大类BSR增长率",
  "小类目",
  "小类BSR",
  "月销量",
  "月销量增长率",
  "月销售额($)",
  "子体销量",
  "子体销售额($)",
  "变体数",
  "价格($)",
  "Prime价格($)",
  "Coupon",
  "Q&A数",
  "评分数",
  "月新增评分数",
  "评分",
  "留评率",
  "FBA($)",
  "毛利率",
  "评级",
  "上架时间",
  "上架天数",
  "配送方式",
  "配送时长",
  "Prime配送时长",
  "买家运费($)",
  "LQS",
  "卖家数",
  "Buybox卖家",
  "BuyBox类型",
  "卖家所属地",
  "卖家信息",
  "卖家首页",
  "Best Seller标识",
  "Amazon's Choice",
  "CPF绿标",
  "CPF绿标信息",
  "New Release标识",
  "A+页面",
  "视频介绍",
  "SP广告",
  "品牌故事",
  "品牌广告",
  "秒杀",
  "AC关键词",
  "商品重量",
  "商品重量（单位换算）",
  "商品尺寸",
  "商品尺寸（单位换算）",
  "包装重量",
  "包装重量（单位换算）",
  "包装尺寸",
  "包装尺寸（单位换算）",
  "包装尺寸分段",
] as const;

export type GoldenRow = Readonly<Record<string, string>>;

export function goldenRowToValues(
  row: GoldenRow,
  headers: ReadonlyArray<string>,
): ReadonlyArray<string | null> {
  return headers.map((header) => row[header] ?? null);
}

function goldenRow(
  ordinal: string,
  asin: string,
  rootCategory: string,
  rootCategoryBsr: string,
  subCategory: string,
  subCategoryBsr: string,
  sales: string,
  title = "Golden Sanitized Product",
): GoldenRow {
  return {
    "#": ordinal,
    ASIN: asin,
    SKU: `GOLDEN-SKU-${ordinal}`,
    品牌: "Golden Sanitized Brand",
    商品标题: title,
    商品详情页链接: `https://www.amazon.com/dp/${asin}`,
    大类目: rootCategory,
    大类BSR: rootCategoryBsr,
    小类目: subCategory,
    小类BSR: subCategoryBsr,
    月销量: sales,
    "月销售额($)": `$1,234.56`,
    变体数: "1",
    "价格($)": "$24.99",
    评分数: "100",
    评分: "4.5",
  };
}

/**
 * 新格式 Product Search（无搜索排名列）脱敏行：大类 BSR 大值域、非升序、多类目
 * （真实 Products(10) 样本模式：rootBsr max=750682、allAscending=false、rootCategoryUnique=3）。
 */
export const GOLDEN_PS_NO_SEARCH_RANK_ROWS: ReadonlyArray<GoldenRow> = [
  goldenRow("1", "B0GOLD0001", "Golden Home & Kitchen", "12,700", "Golden Tumblers", "1,266", "228"),
  goldenRow("2", "B0GOLD0002", "Golden Sports & Outdoors", "750,682", "Golden Water Bottles", "98", "198,618"),
  goldenRow("3", "B0GOLD0003", "Golden Home & Kitchen", "5,240", "Golden Mugs", "1,266", "1,250"),
  goldenRow("4", "B0GOLD0004", "Golden Electronics", "98,301", "Golden Phone Stands", "4", "640"),
];

/**
 * 新格式 Category Current（BSR 类目榜）脱敏行：大类 BSR 值域 [1..10]、含并列名次
 * （真实 BSR(...Current) 样本模式：rootBsrMax=10，并列名次导致非严格升序，如 健康与家居 1..5,3,5,8,9,10）。
 */
export const GOLDEN_CC_CURRENT_ROWS: ReadonlyArray<GoldenRow> = [
  goldenRow("1", "B0GOLD0101", "Golden Sports & Outdoors", "1", "Golden Water Bottles", "1", "198,618"),
  goldenRow("2", "B0GOLD0102", "Golden Sports & Outdoors", "2", "Golden Water Bottles", "1", "120,300"),
  goldenRow("3", "B0GOLD0103", "Golden Sports & Outdoors", "3", "Golden Water Bottles", "2", "95,400"),
  goldenRow("4", "B0GOLD0104", "Golden Sports & Outdoors", "3", "Golden Water Bottles", "2", "88,100"),
  goldenRow("5", "B0GOLD0105", "Golden Sports & Outdoors", "5", "Golden Water Bottles", "2", "77,700"),
  goldenRow("6", "B0GOLD0106", "Golden Sports & Outdoors", "5", "Golden Water Bottles", "3", "60,200"),
  goldenRow("7", "B0GOLD0107", "Golden Sports & Outdoors", "7", "Golden Water Bottles", "3", "41,800"),
  goldenRow("8", "B0GOLD0108", "Golden Sports & Outdoors", "8", "Golden Water Bottles", "4", "30,500"),
  goldenRow("9", "B0GOLD0109", "Golden Sports & Outdoors", "9", "Golden Water Bottles", "4", "22,300"),
  goldenRow("10", "B0GOLD0110", "Golden Sports & Outdoors", "10", "Golden Water Bottles", "5", "15,900"),
];

/** 旧格式 Product Search（含搜索排名列）——直接复用现有脱敏 fixture */
export const GOLDEN_PS_LEGACY_HEADERS = SELLERSPRITE_SEARCH_EXPORT_HEADERS;

/**
 * 歧义例：四件套不全（有搜索排名列 + 部分类目列，无小类 BSR）。
 * 有搜索排名列 → 判定 search_results（旧格式强签名）；用于验证「四件套不全但搜索排名存在」路径。
 */
export const GOLDEN_PS_PARTIAL_CATEGORY_HEADERS = [
  ...SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter((header) => (
    header !== "小类BSR"
    && header !== "大类BSR"
  )),
] as const;

/**
 * 未知表：仅含必需身份列，无任何报告签名（无搜索排名、无四件套）。
 */
export const GOLDEN_UNSIGNED_HEADERS = [
  "#",
  "ASIN",
  "商品标题",
  "商品详情页链接",
  "品牌",
] as const;
