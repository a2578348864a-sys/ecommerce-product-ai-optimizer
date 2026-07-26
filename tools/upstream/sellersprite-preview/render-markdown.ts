import type { SellerSpriteLocalPreviewReport } from "./runner";

function inline(value: string | null): string {
  if (value === null || value.trim() === "") return "缺失";
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&");
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "无" : values.map(inline).join("、");
}

function metric(
  product: SellerSpriteLocalPreviewReport["products"][number],
  field:
    | "brand"
    | "productTitle"
    | "price"
    | "rating"
    | "reviews"
    | "estimatedMonthlySales"
    | "rootCategory"
    | "rootCategoryBsr"
    | "subCategory"
    | "subCategoryBsr",
): string {
  const value = product.providerMetrics[field];
  if (value.status !== "resolved" || value.normalized === null) return value.status;
  return String(value.normalized);
}

function position(value: { page: number; position: number } | null): string {
  return value === null ? "无" : `第 ${value.page} 页第 ${value.position} 位`;
}

function summary(
  value: SellerSpriteLocalPreviewReport["productWeightedStatistics"]["price"],
): string {
  return [
    `有效 ${value.validCount}`,
    `缺失 ${value.missingCount}`,
    `冲突 ${value.conflictCount}`,
    `最小 ${value.minimum ?? "缺失"}`,
    `中位数 ${value.median ?? "缺失"}`,
    `最大 ${value.maximum ?? "缺失"}`,
  ].join("；");
}

export function renderSellerSpritePreviewMarkdown(
  report: SellerSpriteLocalPreviewReport,
): string {
  const lines = [
    report.reportType === "search_results"
      ? "# SellerSprite 关键词搜索市场预筛报告"
      : "# SellerSprite 类目当前商品市场预筛报告",
    "",
    "## 数据来源与边界",
    "",
    `- 文件名：${inline(report.inputFileName)}`,
    `- 文件 SHA-256：${report.sourceFileSha256}`,
    "- 来源：SellerSprite 官方导出文件",
    "- 数据性质：第三方 provider_metric",
    "- 月销量与销售额：第三方估算（estimate），不代表 Amazon 后台订单事实",
    "- 本报告只用于市场预筛",
    "",
    "## 筛选条件",
    "",
    ...(report.reportType === "search_results"
      ? [`- 查询关键词：${inline(report.query)}`]
      : []),
    `- 类目：${inline(report.category)}`,
    `- 市场：${report.marketplace} / ${report.market}`,
    `- 币种：${report.currency}`,
    `- 目标价格区间：${report.priceMin}–${report.priceMax} ${report.currency}`,
    "",
    "## 数据质量",
    "",
    `- 报告状态：${report.reportStatus}`,
    `- 原始行数：${report.precheckSummary.totalRows}`,
    `- 接受行数：${report.precheckSummary.acceptedRows}`,
    `- 隔离行数：${report.precheckSummary.rejectedRows}`,
    report.reportType === "search_results"
      ? `- Search Appearance 数：${report.occurrenceSummary.occurrenceCount}`
      : `- Category Current 记录数：${report.occurrenceSummary.occurrenceCount}`,
    `- Product 数：${report.productSummary.productCount}`,
    `- Family 数：${report.familySummary.familyCount}`,
    `- Warning：${list(report.warnings)}`,
    `- 缺失信号：${list(report.missingSignals)}`,
    `- 冲突信号：${list(report.conflictingSignals)}`,
    "",
    "## 市场概况",
    "",
    "以下默认使用 product-weighted 统计，即每个 ASIN 只计算一次：",
    "",
    `- 价格：${summary(report.productWeightedStatistics.price)}`,
    `- 估算月销量：${summary(report.productWeightedStatistics.estimatedMonthlySales)}`,
    `- 估算月销售额：${summary(report.productWeightedStatistics.estimatedMonthlyRevenue)}`,
    `- 评分：${summary(report.productWeightedStatistics.rating)}`,
    `- 评论数：${summary(report.productWeightedStatistics.reviews)}`,
    `- 品牌集中度：${report.brandConcentrationSummary.status}，Top 3=${report.brandConcentrationSummary.top3Share ?? "缺失"}`,
    `- 卖家集中度：${report.sellerConcentrationSummary.status}，Top 3=${report.sellerConcentrationSummary.top3Share ?? "缺失"}`,
    "",
    ...(report.reportType === "search_results"
      ? ["appearance-weighted 表示搜索结果中的出现记录；product-weighted 表示每个 ASIN 只计算一次的市场画像，两者不能混用。"]
      : [
          `- 大类 BSR：${summary(report.categoryBsrSummary.rootCategoryBsr)}`,
          `- 小类 BSR：${summary(report.categoryBsrSummary.subCategoryBsr)}`,
          "Category Current 记录与 product-weighted 商品画像不能混用；BSR 是 SellerSprite 快照信号，不是销量事实。",
        ]),
    "",
    "## 商品预览",
    "",
  ];

  for (const product of report.products) {
    const commonProductLines = [
      `### ${product.asin}`,
      "",
      `- 标题：${inline(metric(product, "productTitle"))}`,
      `- 品牌：${inline(metric(product, "brand"))}`,
      `- Parent ASIN：${inline(product.parentAsin)}`,
      `- 价格：${metric(product, "price")}`,
      `- 评分：${metric(product, "rating")}`,
      `- 评论数：${metric(product, "reviews")}`,
      `- 估算月销量：${metric(product, "estimatedMonthlySales")}`,
    ];
    const reportSpecificLines = report.reportType === "search_results" ? [
      `- 广告位数量：${product.sponsoredAppearanceCount ?? 0}`,
      `- 自然位数量：${product.organicAppearanceCount ?? 0}`,
      `- 最佳广告位置：${position(product.placementSummary.bestSponsoredPosition)}`,
      `- 最佳自然位置：${position(product.placementSummary.bestOrganicPosition)}`,
    ] : [
      `- 大类目：${metric(product, "rootCategory")}`,
      `- 大类 BSR：${metric(product, "rootCategoryBsr")}`,
      `- 小类目：${metric(product, "subCategory")}`,
      `- 小类 BSR：${metric(product, "subCategoryBsr")}`,
    ];
    lines.push(
      ...commonProductLines,
      ...reportSpecificLines,
      `- 缺失字段：${list(product.missingProviderMetrics)}`,
      `- 冲突字段：${list(product.conflictingProviderMetrics)}`,
      `- Brief 价格带：${product.briefPriceBandResult.status}`,
      `- provisionalDisposition：${product.provisionalDisposition}`,
      "- promotionEligible=false",
      "",
    );
  }

  lines.push(
    "## 当前不能判断的内容",
    "",
    "- 合规",
    "- 侵权",
    "- 危险品",
    "- 供应链真实性",
    "- 采购成本",
    "- 物流成本",
    "- 广告实际转化",
    "- 真实利润",
    "- Amazon 真实订单",
    "",
    "## 使用结论",
    "",
    "该结果是非权威市场预筛，不构成正式选品、采购或上架建议，需要人工复核。",
    "",
  );
  return lines.join("\n");
}
