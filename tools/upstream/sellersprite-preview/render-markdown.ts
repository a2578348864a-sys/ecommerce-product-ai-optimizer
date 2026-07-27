import {
  sellerSpritePreviewSignalLabel,
  type SellerSpriteLocalPreviewRankingReason,
} from "./ranking-report";
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

function labeledCodes(values: readonly string[]): string {
  return list(values.map(sellerSpritePreviewSignalLabel));
}

function reasonLabels(values: readonly SellerSpriteLocalPreviewRankingReason[]): string {
  return list(values.map((value) => value.label));
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
  if (value.status === "missing") return "缺失";
  if (value.status === "conflict") return "存在冲突";
  if (value.normalized === null) return "缺失";
  return String(value.normalized);
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

function score(value: number | null): string {
  return value === null ? "未计算正式比较分" : value.toFixed(2);
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function spread(
  value: SellerSpriteLocalPreviewReport["ranking"]["diagnostics"]["scoreSpread"],
): string {
  if (value.minimum === null || value.maximum === null) return "无可比较分数";
  return `${value.minimum.toFixed(2)}–${value.maximum.toFixed(2)}`;
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
    "- 数据性质：SellerSprite 第三方指标",
    "- 月销量与销售额：SellerSprite 第三方估算，不代表亚马逊后台订单或实际店铺成交记录",
    "- 本报告只用于市场预筛",
    "",
    "## 筛选条件",
    "",
    ...(report.reportType === "search_results"
      ? [`- 查询关键词：${inline(report.query)}`]
      : ["- 搜索位置：不适用"]),
    `- 类目：${inline(report.category)}`,
    `- 市场：${report.marketplace} / ${report.market}`,
    `- 币种：${report.currency}`,
    `- 目标价格区间：${report.priceMin}–${report.priceMax} ${report.currency}`,
    "",
    "## 数据质量",
    "",
    `- 报告状态：${report.reportStatus === "complete" ? "完整" : "部分数据已隔离"}`,
    `- 原始行数：${report.precheckSummary.totalRows}`,
    `- 接受行数：${report.precheckSummary.acceptedRows}`,
    `- 隔离行数：${report.precheckSummary.rejectedRows}`,
    report.reportType === "search_results"
      ? `- Search Appearance 数：${report.occurrenceSummary.occurrenceCount}`
      : `- Category Current 记录数：${report.occurrenceSummary.occurrenceCount}`,
    `- Product 数：${report.productSummary.productCount}`,
    `- Family 数：${report.familySummary.familyCount}`,
    `- 数据质量提示：${labeledCodes(report.warnings)}`,
    `- 缺失信号：${labeledCodes(report.missingSignals)}`,
    `- 冲突信号：${labeledCodes(report.conflictingSignals)}`,
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
      ? [
          "appearance-weighted 表示搜索结果中的出现记录；product-weighted 表示每个 ASIN 只计算一次的市场画像，两者不能混用。",
        ]
      : [
          `- 大类 BSR：${summary(report.categoryBsrSummary.rootCategoryBsr)}`,
          `- 小类 BSR：${summary(report.categoryBsrSummary.subCategoryBsr)}`,
          "Category Current 记录与 product-weighted 商品画像不能混用。",
          "BSR 是类目排名信号，不代表平台后台订单数据。",
        ]),
    "",
    "# 市场信号排序（非正式）",
    "",
    "本排序只用于决定在当前报表内先研究哪个商品，不是正式选品、采购或上架结论。",
    "",
    "- 市场信号分不是成功率，也不是盈利概率。",
    "- 预估销量和销售额来自 SellerSprite 第三方估算。",
    ...(report.reportType === "search_results"
      ? ["- 广告位仅代表付费曝光，不等于自然需求。"]
      : [
          "- 搜索位置：不适用。",
          "- BSR 是类目排名信号，不代表平台后台订单数据。",
        ]),
    "- 所有商品均不可自动晋级。",
    "- 价格适配采用区间内/区间外二元规则。即使只超过边界 0.01 美元，也会失去该项分数，请结合原始价格人工判断。",
    "",
    "## 排序概况",
    "",
    `- Ranking 模型版本：${report.ranking.modelVersion}`,
    `- 报表类型：${report.ranking.reportType === "search_results" ? "关键词搜索报表" : "类目当前商品报表"}`,
    `- 市场信号 Top3：${list(report.ranking.diagnostics.marketSignalTop3)}`,
    `- 可排名商品数量：${report.ranking.rankableProductCount}`,
    `- 未排名商品数量：${report.ranking.unrankedProductCount}`,
    `- 研究分组数量：${report.ranking.familyResearchListCount}`,
    `- 销量 Top3 与市场信号 Top3 重合数量：${report.ranking.diagnostics.top3SalesOverlap}`,
    `- 单组件主导警告数量：${report.ranking.diagnostics.dominanceWarningCount}`,
    `- 得分区间：${spread(report.ranking.diagnostics.scoreSpread)}`,
    `- Ranking Hash：${report.ranking.rankingHash.slice(0, 16)}…（用于结果完整性校验）`,
    "",
    "## 优先研究商品",
    "",
  ];

  const productByAsin = new Map(report.products.map((product) => [product.asin, product]));
  const rankableProducts = report.ranking.products.filter(
    (product) => product.evidenceStatus === "sufficient_for_comparison",
  );
  if (rankableProducts.length === 0) {
    lines.push("本次没有证据足够、可进行报表内比较的商品。", "");
  }
  for (const ranked of rankableProducts) {
    const product = productByAsin.get(ranked.asin);
    lines.push(
      `### 第 ${ranked.scoreRank} 名 · ${ranked.asin}`,
      "",
      `- 标题：${inline(ranked.title)}`,
      `- 品牌：${inline(ranked.brand)}`,
      `- 市场信号分：${score(ranked.signalScore)}`,
      `- 证据覆盖度：${percentage(ranked.evidenceCoverage)}（表示本模型预期信号中实际可计算的比例）`,
      `- 研究优先级：${ranked.researchPriorityLabel}`,
      `- 家族代表：${ranked.familyRepresentative ? "是" : "否"}`,
      `- 正向理由：${reasonLabels(ranked.positiveReasons)}`,
      `- 主要反向信号：${reasonLabels(ranked.counterSignals)}`,
      `- 价格：${product ? metric(product, "price") : "缺失"} USD`,
      `- 预估月销量：${product ? metric(product, "estimatedMonthlySales") : "缺失"}（SellerSprite 第三方估算）`,
      `- 评分：${product ? metric(product, "rating") : "缺失"}`,
      `- 评论数：${product ? metric(product, "reviews") : "缺失"}`,
      "",
      "<details>",
      "<summary>高级诊断</summary>",
      "",
      `- 已知证据条件分（不用于排名）：${ranked.conditionalSignalScore === null ? "无法计算" : ranked.conditionalSignalScore.toFixed(2)}`,
      `- 证据不完整差额：${ranked.coveragePenalty === null ? "无法计算" : ranked.coveragePenalty.toFixed(2)}`,
      `- 可用权重：${ranked.availableWeight}`,
      "- 已知证据条件分只描述现有证据范围内的表现，不参与商品名次。",
      "- 证据不完整差额是条件分与固定分母市场信号分之间的差值，仅用于解释证据完整度。",
      "- 组件分解：",
      ...ranked.components.map((component) => (
        `  - ${component.label}（权重 ${component.weight}）：${component.available ? `${component.weightedPoints?.toFixed(2)} 分；${component.explanation}` : `不可计算；${component.explanation}`}`
      )),
      "",
      "</details>",
      "",
    );
  }

  lines.push("## 暂不排名商品", "");
  const unrankedProducts = report.ranking.products.filter(
    (product) => product.evidenceStatus !== "sufficient_for_comparison",
  );
  if (unrankedProducts.length === 0) {
    lines.push("无。", "");
  }
  for (const ranked of unrankedProducts) {
    lines.push(
      `### 未排名 · ${ranked.asin}`,
      "",
      `- 标题：${inline(ranked.title)}`,
      `- 证据覆盖度：${percentage(ranked.evidenceCoverage)}`,
      `- 证据状态：${ranked.evidenceStatusLabel}`,
      `- 缺失信号：${list(ranked.missingSignalLabels)}`,
      `- 冲突信号：${list(ranked.conflictingSignalLabels)}`,
      `- 暂不排名原因：${reasonLabels(ranked.counterSignals)}`,
      "- 市场信号分：未计算正式比较分。",
      "",
    );
  }

  lines.push(
    "## 家族研究列表",
    "",
    "- 同一明确 Parent ASIN 默认只保留一个代表商品。",
    "- 无 Parent ASIN 的商品作为独立研究项。",
    "- 其他子体仍保留在家族成员中，不相加父子体销量。",
    "",
  );
  for (const family of report.ranking.familyResearchList) {
    const otherMembers = family.members.filter((asin) => asin !== family.representativeAsin);
    lines.push(
      `### ${inline(family.familyIdentity)}`,
      "",
      `- 代表 ASIN：${family.representativeAsin}`,
      `- 代表原因：${family.representativeReasonLabel}`,
      `- 成员数量：${family.members.length}`,
      `- 可排名成员数量：${family.rankableMemberCount}`,
      `- 其他成员 ASIN：${list(otherMembers)}`,
      `- 家族提示：${list(family.familyWarningLabels)}`,
      "",
    );
  }

  lines.push(
    "## 模型诊断",
    "",
    "<details>",
    "<summary>展开模型诊断</summary>",
    "",
    `- 销量 Top3：${list(report.ranking.diagnostics.salesOnlyTop3)}`,
    `- 市场信号 Top3：${list(report.ranking.diagnostics.marketSignalTop3)}`,
    `- Top3 重合数量：${report.ranking.diagnostics.top3SalesOverlap}`,
    `- 得分区间：${spread(report.ranking.diagnostics.scoreSpread)}`,
    `- 单组件主导警告数量：${report.ranking.diagnostics.dominanceWarningCount}`,
    "- 这些指标只用于检查模型是否过度依赖某一个信号，不是预测准确率或盈利概率。",
    "",
    "</details>",
    "",
    "## 商品预览",
    "",
  );

  for (const product of report.products) {
    lines.push(
      `### ${product.asin}`,
      "",
      `- 标题：${inline(metric(product, "productTitle"))}`,
      `- 品牌：${inline(metric(product, "brand"))}`,
      `- Parent ASIN：${inline(product.parentAsin)}`,
      `- 价格：${metric(product, "price")}`,
      `- 评分：${metric(product, "rating")}`,
      `- 评论数：${metric(product, "reviews")}`,
      `- 预估月销量：${metric(product, "estimatedMonthlySales")}`,
      ...(report.reportType === "search_results"
        ? [
            `- 广告位数量：${product.sponsoredAppearanceCount ?? 0}`,
            `- 自然位数量：${product.organicAppearanceCount ?? 0}`,
          ]
        : [
            `- 大类目：${metric(product, "rootCategory")}`,
            `- 大类 BSR：${metric(product, "rootCategoryBsr")}`,
            `- 小类目：${metric(product, "subCategory")}`,
            `- 小类 BSR：${metric(product, "subCategoryBsr")}`,
          ]),
      `- 缺失字段：${labeledCodes(product.missingProviderMetrics)}`,
      `- 冲突字段：${labeledCodes(product.conflictingProviderMetrics)}`,
      "- 自动晋级：否",
      "",
    );
  }

  lines.push(
    "## 当前不能判断的内容",
    "",
    "- 是否侵权或存在知识产权风险",
    "- 是否满足平台和当地合规要求",
    "- 是否属于危险品或受限商品",
    "- 供应商是否真实可靠",
    "- 实际采购成本",
    "- 实际物流成本",
    "- 广告真实转化情况",
    "- 实际利润",
    "- 店铺后台成交数据",
    "",
    "## 使用结论",
    "",
    "该结果是非权威市场预筛，不构成正式选品、采购或上架建议，需要人工复核；未运行正式 Stage 1，未写数据库，也未注册生产 Manifest。",
    "",
  );
  return lines.join("\n");
}
