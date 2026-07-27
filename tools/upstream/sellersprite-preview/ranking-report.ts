import type { SellerSpriteMarketSnapshot } from "../../../lib/upstream/sellersprite/marketSnapshot";
import type {
  SellerSpriteMarketSignalComponent,
  SellerSpriteMarketSignalRankingReport,
  SellerSpriteRankingEvidenceStatus,
  SellerSpriteResearchPriority,
} from "../../../lib/upstream/sellersprite/marketSignalRanking";
import type { SellerSpriteShadowSelectionBrief } from "../../../lib/upstream/sellersprite/shadowBrief";

const COMPONENT_LABELS: Readonly<Record<SellerSpriteMarketSignalComponent, string>> = {
  priceFit: "价格带适配",
  estimatedMonthlySales: "预估月销量",
  ratingQuality: "评分质量",
  salesReviewEfficiency: "销量—评论相对效率",
  organicVisibility: "自然位可见性",
  placementCoverage: "搜索位置覆盖",
  sponsoredExposure: "广告曝光",
  categoryBsrSignal: "Category BSR",
};

const EVIDENCE_STATUS_LABELS: Readonly<Record<SellerSpriteRankingEvidenceStatus, string>> = {
  sufficient_for_comparison: "证据足够，可进行本报表内比较",
  limited_evidence: "证据有限，暂不参与排名",
  insufficient_evidence: "证据不足，无法比较",
};

const RESEARCH_PRIORITY_LABELS: Readonly<Record<SellerSpriteResearchPriority, string>> = {
  priority_1: "优先研究组 1",
  priority_2: "优先研究组 2",
  priority_3: "优先研究组 3",
  unranked_insufficient_evidence: "暂不排名：证据不足或存在冲突",
};

const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  "Hard-gate evidence is unavailable; no promotion or formal disposition is allowed.": "缺少正式硬门禁证据，不能自动晋级或形成正式结论",
  "SellerSprite provider_metric is screening evidence only.": "SellerSprite 第三方指标仅用于市场预筛",
  "The provisional score is not the current production Stage 1 score.": "当前分数不是正式 Stage 1 分数",
  duplicate_asin: "同一 ASIN 在报表中出现多次；原始记录均保留，未合并销量",
  "product_field_partial:sku": "部分商品缺少 SKU",
  "product_field_partial:estimatedMonthlySales": "部分商品缺少预估月销量",
  "product_field_partial:estimatedMonthlyRevenue": "部分商品缺少预估月销售额",
  sku: "缺少 SKU",
  estimatedMonthlySales: "缺少预估月销量",
  estimatedMonthlyRevenue: "缺少预估月销售额",
  rating: "缺少评分",
  reviews: "缺少评论数",
  price: "缺少价格",
  priceFit: "缺少价格，无法判断价格带适配",
  rootCategoryBsr: "缺少大类 BSR",
  largeCategoryBsr: "缺少大类 BSR",
  subCategoryBsr: "缺少小类 BSR",
  smallCategoryBsr: "缺少小类 BSR",
  searchRank: "缺少搜索排名",
  searchPlacement: "缺少有效搜索位置",
  organicPosition: "缺少自然位位置",
  sponsoredPosition: "缺少广告位位置",
  conflicting_provider_metric: "第三方指标存在冲突，未用于排名",
  multiple_variations_context_only_no_score: "存在多个变体；仅作为研究背景，不参与加分",
  price_within_brief_range: "价格位于本次目标区间内",
  price_outside_brief_range: "价格不在本次目标区间内",
  estimated_monthly_sales_at_or_above_report_midpoint: "预估月销量达到或高于本报表中位水平",
  estimated_monthly_sales_below_report_midpoint: "预估月销量低于本报表中位水平",
  rating_quality_supported: "评分及评论支撑较好",
  rating_quality_limited: "评分或评论支撑有限",
  sales_review_efficiency_at_or_above_neutral: "销量—评论相对效率达到或高于中性水平",
  sales_review_efficiency_below_neutral: "销量—评论相对效率低于中性水平",
  organic_visibility_observed: "观察到自然位可见性",
  sponsored_only_visibility: "仅观察到广告曝光，未观察到自然位",
  organic_and_sponsored_coverage: "同时观察到自然位和广告曝光",
  organic_visibility_zero_with_sponsored_evidence: "只有广告曝光时，自然位得分为 0",
  core_estimated_monthly_sales_conflicting: "核心预估月销量存在冲突，暂不排名",
  core_estimated_monthly_sales_missing: "缺少核心预估月销量，暂不排名",
  core_search_placement_missing: "缺少有效搜索位置，暂不排名",
  root_category_bsr_comparable: "大类 BSR 可用于本报表内比较",
  subcategory_bsr_not_comparable: "同一小类有效样本不足，小类 BSR 未参与比较",
  subcategory_bsr_comparable_within_exact_group: "小类 BSR 仅在同一小类内参与比较",
  core_root_category_bsr_conflicting: "核心大类 BSR 存在冲突，暂不排名",
  core_root_category_bsr_missing: "缺少核心大类 BSR，暂不排名",
  highest_rankable_signal_score_then_coverage: "优先选择可比较且市场信号分最高的成员；同分再看证据覆盖度",
  best_available_non_authoritative_evidence: "该分组暂无可比较成员，仅保留现有非权威证据较完整的代表",
};

const UNKNOWN_QUALITY_LABEL = "存在未识别的数据质量问题（代码已保留在 JSON）";

export class SellerSpriteRankingIntegrityError extends Error {
  constructor() {
    super("ranking_integrity_failed");
    this.name = "SellerSpriteRankingIntegrityError";
  }
}

export interface SellerSpriteLocalPreviewRankingReason {
  code: string;
  label: string;
}

export interface SellerSpriteLocalPreviewRanking {
  schemaVersion: "sellersprite-market-signal-ranking.v2";
  modelVersion:
    | "sellersprite-market-signal-ranking.search.v2"
    | "sellersprite-market-signal-ranking.category.v2";
  rankingHash: string;
  reportType: "search_results" | "category_current";
  productCount: number;
  rankableProductCount: number;
  unrankedProductCount: number;
  familyResearchListCount: number;
  weights: ReadonlyArray<{
    component: SellerSpriteMarketSignalComponent;
    label: string;
    weight: number;
  }>;
  normalizationPolicy: SellerSpriteMarketSignalRankingReport["normalizationPolicy"];
  products: ReadonlyArray<{
    asin: string;
    parentAsin: string | null;
    title: string | null;
    brand: string | null;
    scoreRank: number | null;
    scoreTie: boolean;
    signalScore: number | null;
    conditionalSignalScore: number | null;
    availableWeight: number;
    earnedWeightedPoints: number;
    evidenceCoverage: number;
    coveragePenalty: number | null;
    evidenceStatus: SellerSpriteRankingEvidenceStatus;
    evidenceStatusLabel: string;
    researchPriority: SellerSpriteResearchPriority;
    researchPriorityLabel: string;
    familyIdentity: string;
    familyRepresentative: boolean;
    missingSignals: ReadonlyArray<string>;
    missingSignalLabels: ReadonlyArray<string>;
    conflictingSignals: ReadonlyArray<string>;
    conflictingSignalLabels: ReadonlyArray<string>;
    positiveReasons: ReadonlyArray<SellerSpriteLocalPreviewRankingReason>;
    counterSignals: ReadonlyArray<SellerSpriteLocalPreviewRankingReason>;
    components: ReadonlyArray<{
      component: SellerSpriteMarketSignalComponent;
      label: string;
      weight: number;
      available: boolean;
      normalizedSignal: number | null;
      weightedPoints: number | null;
      sourceType: "provider_metric";
      metricNature: "snapshot" | "estimate" | "derived";
      explanation: string;
    }>;
    promotionEligible: false;
  }>;
  familyResearchList: ReadonlyArray<{
    familyIdentity: string;
    representativeAsin: string;
    representativeReason: string;
    representativeReasonLabel: string;
    members: ReadonlyArray<string>;
    rankableMemberCount: number;
    familyWarnings: ReadonlyArray<string>;
    familyWarningLabels: ReadonlyArray<string>;
  }>;
  diagnostics: {
    salesOnlyTop3: ReadonlyArray<string>;
    marketSignalTop3: ReadonlyArray<string>;
    top3SalesOverlap: number;
    scoreSpread: SellerSpriteMarketSignalRankingReport["diagnostics"]["scoreSpread"];
    dominanceWarningCount: number;
    dominantComponentDistribution: Readonly<Record<string, number>>;
  };
  safety: {
    authoritative: false;
    currentStage1Invoked: false;
    hardGateEvaluable: false;
    promotionEligible: false;
    manifestRegistered: false;
    productionEffect: false;
    productionDatabaseWritten: false;
  };
}

export function sellerSpritePreviewSignalLabel(code: string): string {
  if (code.startsWith("conflicting_provider_metric:")) {
    const field = code.slice("conflicting_provider_metric:".length);
    return `第三方指标存在冲突：${SIGNAL_LABELS[field]?.replace(/^缺少/u, "") ?? "字段名称已保留在 JSON"}；未用于排名`;
  }
  if (code.startsWith("member_not_rankable:")) {
    return "该研究分组包含暂不排名的成员";
  }
  return SIGNAL_LABELS[code] ?? UNKNOWN_QUALITY_LABEL;
}

function normalizedString(
  snapshot: SellerSpriteMarketSnapshot,
  asin: string,
  field: "productTitle" | "brand",
): string | null {
  const value = snapshot.products.find((product) => product.asin === asin)
    ?.providerMetrics[field].normalized;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function assertRankingIntegrity(
  ranking: SellerSpriteMarketSignalRankingReport,
  snapshot: SellerSpriteMarketSnapshot,
  brief: SellerSpriteShadowSelectionBrief,
): void {
  const expectedModel = snapshot.reportType === "search_results"
    ? "sellersprite-market-signal-ranking.search.v2"
    : "sellersprite-market-signal-ranking.category.v2";
  const snapshotAsins = snapshot.products.map((product) => product.asin);
  const rankingAsins = ranking.products.map((product) => product.asin);
  const uniqueRankingAsins = new Set(rankingAsins);
  const flagsAreFrozen = ranking.authoritative === false
    && ranking.currentStage1Invoked === false
    && ranking.hardGateEvaluable === false
    && ranking.promotionEligible === false
    && ranking.manifestRegistered === false
    && ranking.productionEffect === false
    && ranking.productionDatabaseWritten === false
    && ranking.products.every((product) => product.promotionEligible === false);
  if (
    ranking.schemaVersion !== "sellersprite-market-signal-ranking.v2"
    || ranking.modelVersion !== expectedModel
    || ranking.reportType !== snapshot.reportType
    || ranking.normalizedBusinessHash !== snapshot.normalizedBusinessHash
    || ranking.sourceBoundSnapshotHash !== snapshot.sourceBoundSnapshotHash
    || ranking.briefHash !== brief.briefHash
    || ranking.sourceFileSha256 !== snapshot.sourceFileSha256
    || ranking.productCount !== snapshot.products.length
    || rankingAsins.length !== snapshotAsins.length
    || uniqueRankingAsins.size !== rankingAsins.length
    || JSON.stringify(sorted(rankingAsins)) !== JSON.stringify(sorted(snapshotAsins))
    || !/^[a-f0-9]{64}$/u.test(ranking.rankingHash)
    || !flagsAreFrozen
  ) {
    throw new SellerSpriteRankingIntegrityError();
  }
}

export function buildSellerSpriteLocalPreviewRanking(
  ranking: SellerSpriteMarketSignalRankingReport,
  snapshot: SellerSpriteMarketSnapshot,
  brief: SellerSpriteShadowSelectionBrief,
): SellerSpriteLocalPreviewRanking {
  assertRankingIntegrity(ranking, snapshot, brief);
  const dominantComponentDistribution: Record<string, number> = {};
  for (const item of ranking.diagnostics.productDominance) {
    if (item.dominantComponent === null) continue;
    dominantComponentDistribution[item.dominantComponent] = (
      dominantComponentDistribution[item.dominantComponent] ?? 0
    ) + 1;
  }
  return {
    schemaVersion: ranking.schemaVersion,
    modelVersion: ranking.modelVersion,
    rankingHash: ranking.rankingHash,
    reportType: ranking.reportType,
    productCount: ranking.productCount,
    rankableProductCount: ranking.rankableProductCount,
    unrankedProductCount: ranking.unrankedProductCount,
    familyResearchListCount: ranking.familyResearchListCount,
    weights: Object.entries(ranking.weights).map(([componentName, weight]) => {
      const component = componentName as SellerSpriteMarketSignalComponent;
      return { component, label: COMPONENT_LABELS[component], weight };
    }),
    normalizationPolicy: ranking.normalizationPolicy,
    products: ranking.products.map((product) => ({
      asin: product.asin,
      parentAsin: product.parentAsin,
      title: normalizedString(snapshot, product.asin, "productTitle"),
      brand: normalizedString(snapshot, product.asin, "brand"),
      scoreRank: product.scoreRank,
      scoreTie: product.scoreTie,
      signalScore: product.signalScore,
      conditionalSignalScore: product.conditionalSignalScore,
      availableWeight: product.availableWeight,
      earnedWeightedPoints: product.earnedWeightedPoints,
      evidenceCoverage: product.evidenceCoverage,
      coveragePenalty: product.coveragePenalty,
      evidenceStatus: product.evidenceStatus,
      evidenceStatusLabel: EVIDENCE_STATUS_LABELS[product.evidenceStatus],
      researchPriority: product.researchPriority,
      researchPriorityLabel: RESEARCH_PRIORITY_LABELS[product.researchPriority],
      familyIdentity: product.familyIdentity,
      familyRepresentative: product.familyRepresentative,
      missingSignals: [...product.missingSignals],
      missingSignalLabels: product.missingSignals.map(sellerSpritePreviewSignalLabel),
      conflictingSignals: [...product.conflictingSignals],
      conflictingSignalLabels: product.conflictingSignals.map((code) => (
        sellerSpritePreviewSignalLabel(`conflicting_provider_metric:${code}`)
      )),
      positiveReasons: product.positiveReasons.map((code) => ({
        code,
        label: sellerSpritePreviewSignalLabel(code),
      })),
      counterSignals: product.counterSignals.map((code) => ({
        code,
        label: sellerSpritePreviewSignalLabel(code),
      })),
      components: product.componentEvidence.map((item) => ({
        component: item.component,
        label: COMPONENT_LABELS[item.component],
        weight: item.weight,
        available: item.available,
        normalizedSignal: item.normalizedSignal,
        weightedPoints: item.weightedPoints,
        sourceType: item.sourceType,
        metricNature: item.metricNature,
        explanation: sellerSpritePreviewSignalLabel(item.explanation),
      })),
      promotionEligible: false,
    })),
    familyResearchList: ranking.familyResearchList.map((family) => ({
      familyIdentity: family.familyIdentity,
      representativeAsin: family.representativeAsin,
      representativeReason: family.representativeReason,
      representativeReasonLabel: sellerSpritePreviewSignalLabel(family.representativeReason),
      members: [...family.members],
      rankableMemberCount: family.rankableMemberCount,
      familyWarnings: [...family.familyWarnings],
      familyWarningLabels: family.familyWarnings.map(sellerSpritePreviewSignalLabel),
    })),
    diagnostics: {
      salesOnlyTop3: ranking.diagnostics.salesOnlyOrder.slice(0, 3),
      marketSignalTop3: ranking.products
        .filter((product) => product.scoreRank !== null)
        .slice(0, 3)
        .map((product) => product.asin),
      top3SalesOverlap: ranking.diagnostics.top3SalesOverlap,
      scoreSpread: ranking.diagnostics.scoreSpread,
      dominanceWarningCount: ranking.diagnostics.productDominance.filter(
        (item) => item.dominanceWarning,
      ).length,
      dominantComponentDistribution,
    },
    safety: {
      authoritative: false,
      currentStage1Invoked: false,
      hardGateEvaluable: false,
      promotionEligible: false,
      manifestRegistered: false,
      productionEffect: false,
      productionDatabaseWritten: false,
    },
  };
}
