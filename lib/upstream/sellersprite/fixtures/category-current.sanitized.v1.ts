import { SELLERSPRITE_SEARCH_EXPORT_HEADERS } from "./search-export.sanitized.v1";

export const SELLERSPRITE_CATEGORY_CURRENT_HEADERS =
  SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter((header) => header !== "搜索排名");

export const SELLERSPRITE_CATEGORY_CURRENT_ROWS:
ReadonlyArray<Readonly<Record<string, string>>> = [
  {
    "#": "1",
    ASIN: "B0CAT00001",
    SKU: "CAT-SKU-001",
    品牌: "Synthetic Outdoor Brand",
    商品标题: "Synthetic Category Product Parent",
    商品详情页链接: "https://www.amazon.com/dp/B0CAT00001",
    父ASIN: "",
    大类目: "Synthetic Root Category",
    大类BSR: "1",
    小类目: "Synthetic Subcategory",
    小类BSR: "1",
    月销量: "1,250",
    "月销售额($)": "$31,237.50",
    变体数: "2",
    "价格($)": "$24.99",
    评分数: "456",
    评分: "4.5",
    Buybox卖家: "Synthetic Category Seller",
  },
  {
    "#": "2",
    ASIN: "B0CAT00002",
    SKU: "CAT-SKU-002",
    品牌: "Synthetic Outdoor Brand",
    商品标题: "Synthetic Category Product Child",
    商品详情页链接: "https://www.amazon.com/dp/B0CAT00002",
    父ASIN: "B0CAT00001",
    大类目: "Synthetic Root Category",
    大类BSR: "2",
    小类目: "Synthetic Subcategory",
    小类BSR: "2",
    月销量: "640",
    "月销售额($)": "$15,993.60",
    变体数: "2",
    "价格($)": "$24.99",
    评分数: "210",
    评分: "4.3",
    Buybox卖家: "Synthetic Category Seller",
  },
];
