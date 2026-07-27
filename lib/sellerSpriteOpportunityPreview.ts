import type {
  SellerSpriteBriefBoundShadowReport,
  SellerSpriteProvisionalDisposition,
} from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import type {
  SellerSpriteConcentrationSummary,
  SellerSpriteMarketNumericSummaries,
  SellerSpriteMarketSnapshot,
} from "@/lib/upstream/sellersprite/marketSnapshot";
import type {
  SellerSpriteMarketSignalComponent,
  SellerSpriteMarketSignalRankingReport,
  SellerSpriteRankingEvidenceStatus,
  SellerSpriteResearchPriority,
} from "@/lib/upstream/sellersprite/marketSignalRanking";
import type {
  SellerSpriteProductMetricField,
  SellerSpriteProductObservation,
} from "@/lib/upstream/sellersprite/projections";
import type { SellerSpriteReportType } from "@/lib/upstream/sellersprite/reportType";
import type { SellerSpriteBsrNormalizedValue } from "@/lib/upstream/sellersprite/fields";
import type { SellerSpriteShadowSelectionBrief } from "@/lib/upstream/sellersprite/shadowBrief";

export const SELLERSPRITE_OPPORTUNITY_PREVIEW_SCHEMA_VERSION =
  "sellersprite-opportunity-preview.v2" as const;
export const SELLERSPRITE_PREVIEW_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SELLERSPRITE_PREVIEW_MAX_REQUEST_BYTES =
  SELLERSPRITE_PREVIEW_MAX_FILE_BYTES + 64 * 1024;

export interface SellerSpritePreviewConcentration {
  status: SellerSpriteConcentrationSummary["status"];
  entityCount: number;
  validShareCount: number;
  missingShareCount: number;
  topEntity: string | null;
  topShare: number | null;
  top3Share: number | null;
}

export interface SellerSpritePreviewProduct {
  reportType: SellerSpriteReportType;
  asin: string;
  title: string | null;
  brand: string | null;
  parentAsin: string | null;
  price: number | null;
  estimatedMonthlySales: number | null;
  rating: number | null;
  reviews: number | null;
  variationCount: number | null;
  occurrenceCount: number;
  appearanceCount: number | null;
  sponsoredAppearanceCount: number | null;
  organicAppearanceCount: number | null;
  unknownAppearanceCount: number | null;
  bestSponsoredPage: number | null;
  bestSponsoredPosition: number | null;
  bestOrganicPage: number | null;
  bestOrganicPosition: number | null;
  rootCategory: string | null;
  rootCategoryBsr: SellerSpriteBsrNormalizedValue;
  subCategory: string | null;
  subCategoryBsr: SellerSpriteBsrNormalizedValue;
  missingSignals: ReadonlyArray<string>;
  conflictingSignals: ReadonlyArray<string>;
  priceBandStatus: "within" | "outside" | "missing" | "conflict";
  provisionalDisposition: SellerSpriteProvisionalDisposition;
  authoritative: false;
  promotionEligible: false;
  productionEffect: false;
  productionDatabaseWritten: false;
  manifestRegistered: false;
}

export interface SellerSpritePreviewRankingComponent {
  component: SellerSpriteMarketSignalComponent;
  label: string;
  weight: number;
  available: boolean;
  normalizedSignal: number | null;
  weightedPoints: number | null;
  metricNature: "snapshot" | "estimate" | "derived";
  explanation: string;
}

export interface SellerSpritePreviewRankingProduct {
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
  researchPriority: SellerSpriteResearchPriority;
  familyIdentity: string;
  familyRepresentative: boolean;
  missingSignals: ReadonlyArray<string>;
  conflictingSignals: ReadonlyArray<string>;
  positiveReasons: ReadonlyArray<string>;
  counterSignals: ReadonlyArray<string>;
  componentScores: ReadonlyArray<SellerSpritePreviewRankingComponent>;
  componentDominance: number | null;
  dominantComponent: SellerSpriteMarketSignalComponent | null;
  dominanceWarning: boolean;
  promotionEligible: false;
}

export interface SellerSpritePreviewFamilyResearchItem {
  familyIdentity: string;
  representativeAsin: string;
  members: ReadonlyArray<string>;
  rankableMemberCount: number;
  representativeReason: string;
  familyWarnings: ReadonlyArray<string>;
}

export interface SellerSpritePreviewRanking {
  schemaVersion: "sellersprite-market-signal-ranking.v2";
  modelVersion:
    | "sellersprite-market-signal-ranking.search.v2"
    | "sellersprite-market-signal-ranking.category.v2";
  rankingHash: string;
  reportType: SellerSpriteReportType;
  productCount: number;
  rankableProductCount: number;
  unrankedProductCount: number;
  familyResearchListCount: number;
  conditionalSignalScoreUsage: "diagnostic_only_not_used_for_ranking";
  searchPlacementStatus: "available" | "not_applicable";
  weights: ReadonlyArray<{
    component: SellerSpriteMarketSignalComponent;
    label: string;
    weight: number;
  }>;
  diagnostics: {
    salesOnlyTop3: ReadonlyArray<string>;
    marketSignalTop3: ReadonlyArray<string>;
    top3SalesOverlap: number;
    scoreSpread: {
      minimum: number | null;
      median: number | null;
      maximum: number | null;
      standardDeviation: number | null;
    };
    dominanceWarningCount: number;
    dominantComponentDistribution: Readonly<Record<string, number>>;
  };
  products: ReadonlyArray<SellerSpritePreviewRankingProduct>;
  familyResearchList: ReadonlyArray<SellerSpritePreviewFamilyResearchItem>;
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

export interface SellerSpriteOpportunityPreviewViewModel {
  schemaVersion: typeof SELLERSPRITE_OPPORTUNITY_PREVIEW_SCHEMA_VERSION;
  reportType: SellerSpriteReportType;
  requestId: string;
  reportStatus: "complete" | "partial";
  sourceFileName: string;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  briefHash: string;
  reportHash: string;
  source: "SellerSprite";
  sourceType: "provider_metric";
  authoritative: false;
  promotionAllowed: false;
  hardGateEvaluable: false;
  currentStage1Invoked: false;
  productionEffect: false;
  productionDatabaseWritten: false;
  manifestRegistered: false;
  marketplace: "amazon.com";
  market: "US";
  currency: "USD";
  query: string | null;
  category: string;
  priceMin: number;
  priceMax: number;
  sheetName: string;
  headerColumnCount: number;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  occurrenceCount: number;
  occurrenceLabel: "Search Appearance" | "Category Current 记录";
  appearanceCount: number | null;
  productCount: number;
  familyCount: number;
  uniqueAsinCount: number;
  duplicateOccurrenceGroupCount: number;
  duplicateAppearanceGroupCount: number | null;
  sponsoredAppearanceCount: number | null;
  organicAppearanceCount: number | null;
  unknownAppearanceCount: number | null;
  placementSummary: SellerSpriteMarketSnapshot["placementSummary"];
  categoryBsrSummary: SellerSpriteMarketSnapshot["categoryBsrSummary"];
  warningCounts: Readonly<Record<string, number>>;
  conflictCount: number;
  missingSignals: ReadonlyArray<string>;
  fieldMapping: SellerSpriteMarketSnapshot["fieldMapping"];
  fieldCoverage: SellerSpriteMarketSnapshot["fieldCoverage"];
  metricNatureCoverage: SellerSpriteMarketSnapshot["metricNatureCoverage"];
  productWeightedStatistics: SellerSpriteMarketNumericSummaries;
  occurrenceWeightedStatistics: SellerSpriteMarketNumericSummaries;
  appearanceWeightedStatistics: SellerSpriteMarketNumericSummaries | null;
  brandConcentration: SellerSpritePreviewConcentration;
  sellerConcentration: SellerSpritePreviewConcentration;
  products: ReadonlyArray<SellerSpritePreviewProduct>;
  ranking: SellerSpritePreviewRanking;
}

const RANKING_COMPONENT_LABELS: Readonly<Record<
  SellerSpriteMarketSignalComponent,
  string
>> = {
  priceFit: "价格带适配",
  estimatedMonthlySales: "估算月销量",
  ratingQuality: "评分质量",
  salesReviewEfficiency: "销量—评论相对效率",
  organicVisibility: "自然位可见性",
  placementCoverage: "搜索位置覆盖",
  sponsoredExposure: "广告曝光位置",
  categoryBsrSignal: "Category BSR",
};

function rankingComponentExplanation(input: {
  component: SellerSpriteMarketSignalComponent;
  available: boolean;
  normalizedSignal: number | null;
}): string {
  if (!input.available) {
    return `${RANKING_COMPONENT_LABELS[input.component]}缺失或冲突，未参与市场信号分。`;
  }
  if (input.component === "priceFit") {
    return input.normalizedSignal === 1
      ? "价格位于 Brief 含边界的目标区间内。"
      : "价格位于 Brief 目标区间外；证据资格不因此改变。";
  }
  return {
    estimatedMonthlySales: "SellerSprite 估算月销量在本报表商品集合内的相对位置，不代表真实订单。",
    ratingQuality: "评分质量结合评分与少量评论支持度计算，评论数不会单独主导该项。",
    salesReviewEfficiency: "估算销量与评论数的相对位置差，仅作派生研究信号。",
    organicVisibility: "按有效自然搜索位置计算；没有自然位但有广告位时该项为 0，不视为缺失。",
    placementCoverage: "同时具备自然位与广告位时覆盖更完整，两者不会互相替代。",
    sponsoredExposure: "按广告位置计算，仅表示付费曝光位置，不代表自然需求。",
    categoryBsrSignal: "大类 BSR 低值优先；仅在同一小类证据足够时合并小类 BSR。",
    priceFit: "价格适配按 Brief 区间内或区间外二元计算。",
  }[input.component];
}

function resolvedNumber(
  product: SellerSpriteProductObservation,
  field: Extract<
    SellerSpriteProductMetricField,
    | "price"
    | "estimatedMonthlySales"
    | "rating"
    | "reviews"
    | "variationCount"
    | "rootCategoryBsr"
    | "subCategoryBsr"
  >,
): number | null {
  const metric = product.providerMetrics[field];
  return metric.status === "resolved" && typeof metric.normalized === "number"
    ? metric.normalized
    : null;
}

function resolvedString(
  product: SellerSpriteProductObservation,
  field: Extract<
    SellerSpriteProductMetricField,
    "brand" | "productTitle" | "rootCategory" | "subCategory"
  >,
): string | null {
  const metric = product.providerMetrics[field];
  return metric.status === "resolved" && typeof metric.normalized === "string"
    ? metric.normalized
    : null;
}

function resolvedBsr(
  product: SellerSpriteProductObservation,
  field: "rootCategoryBsr" | "subCategoryBsr",
): SellerSpriteBsrNormalizedValue {
  const metric = product.providerMetrics[field];
  if (metric.status !== "resolved") return null;
  if (typeof metric.normalized === "number" || Array.isArray(metric.normalized)) {
    return metric.normalized as SellerSpriteBsrNormalizedValue;
  }
  return null;
}

function projectConcentration(
  input: SellerSpriteConcentrationSummary,
): SellerSpritePreviewConcentration {
  return {
    status: input.status,
    entityCount: input.entityCount,
    validShareCount: input.validShareCount,
    missingShareCount: input.missingShareCount,
    topEntity: input.topEntity,
    topShare: input.topShare,
    top3Share: input.top3Share,
  };
}

function assertReadOnlyShadowContract(report: SellerSpriteBriefBoundShadowReport): void {
  if (
    report.authoritative !== false
    || report.promotionAllowed !== false
    || report.hardGateEvaluable !== false
    || report.currentStage1Invoked !== false
    || report.productionEffect !== false
    || report.productionDatabaseWritten !== false
    || report.manifestRegistered !== false
  ) {
    throw new Error("SELLERSPRITE_PREVIEW_READ_ONLY_CONTRACT_VIOLATION");
  }
}

function failRankingIntegrity(): never {
  throw new Error("SELLERSPRITE_RANKING_INTEGRITY_FAILED");
}

function assertSellerSpriteRankingIntegrity(input: {
  snapshot: SellerSpriteMarketSnapshot;
  brief: SellerSpriteShadowSelectionBrief;
  ranking: SellerSpriteMarketSignalRankingReport;
}): void {
  const { snapshot, brief, ranking } = input;
  const expectedModelVersion = snapshot.reportType === "search_results"
    ? "sellersprite-market-signal-ranking.search.v2"
    : "sellersprite-market-signal-ranking.category.v2";
  if (
    ranking.schemaVersion !== "sellersprite-market-signal-ranking.v2"
    || ranking.modelVersion !== expectedModelVersion
    || ranking.reportType !== snapshot.reportType
    || ranking.normalizedBusinessHash !== snapshot.normalizedBusinessHash
    || ranking.sourceBoundSnapshotHash !== snapshot.sourceBoundSnapshotHash
    || ranking.briefHash !== brief.briefHash
    || ranking.sourceFileSha256 !== snapshot.sourceFileSha256
    || ranking.productCount !== snapshot.products.length
    || ranking.products.length !== snapshot.products.length
    || !/^[a-f0-9]{64}$/.test(ranking.rankingHash)
    || ranking.authoritative !== false
    || ranking.currentStage1Invoked !== false
    || ranking.hardGateEvaluable !== false
    || ranking.promotionEligible !== false
    || ranking.manifestRegistered !== false
    || ranking.productionEffect !== false
    || ranking.productionDatabaseWritten !== false
    || ranking.products.some((product) => (
      product.reportType !== ranking.reportType
      || product.promotionEligible !== false
    ))
  ) {
    failRankingIntegrity();
  }

  const snapshotAsins = snapshot.products.map((product) => product.asin).sort();
  const rankingAsins = ranking.products.map((product) => product.asin).sort();
  if (
    new Set(snapshotAsins).size !== snapshotAsins.length
    || new Set(rankingAsins).size !== rankingAsins.length
    || snapshotAsins.some((asin, index) => asin !== rankingAsins[index])
  ) {
    failRankingIntegrity();
  }
}

function buildRankingPreview(
  snapshot: SellerSpriteMarketSnapshot,
  brief: SellerSpriteShadowSelectionBrief,
  ranking: SellerSpriteMarketSignalRankingReport,
  previewProducts: ReadonlyArray<SellerSpritePreviewProduct>,
): SellerSpritePreviewRanking {
  assertSellerSpriteRankingIntegrity({ snapshot, brief, ranking });
  const previewByAsin = new Map(previewProducts.map((product) => [product.asin, product]));
  const dominanceByAsin = new Map(
    ranking.diagnostics.productDominance.map((diagnostic) => [diagnostic.asin, diagnostic]),
  );
  const products = ranking.products.map((product): SellerSpritePreviewRankingProduct => {
    const preview = previewByAsin.get(product.asin);
    const dominance = dominanceByAsin.get(product.asin);
    if (!preview || !dominance) failRankingIntegrity();
    return {
      asin: product.asin,
      parentAsin: product.parentAsin,
      title: preview.title,
      brand: preview.brand,
      scoreRank: product.scoreRank,
      scoreTie: product.scoreTie,
      signalScore: product.signalScore,
      conditionalSignalScore: product.conditionalSignalScore,
      availableWeight: product.availableWeight,
      earnedWeightedPoints: product.earnedWeightedPoints,
      evidenceCoverage: product.evidenceCoverage,
      coveragePenalty: product.coveragePenalty,
      evidenceStatus: product.evidenceStatus,
      researchPriority: product.researchPriority,
      familyIdentity: product.familyIdentity,
      familyRepresentative: product.familyRepresentative,
      missingSignals: [...product.missingSignals],
      conflictingSignals: [...product.conflictingSignals],
      positiveReasons: [...product.positiveReasons],
      counterSignals: [...product.counterSignals],
      componentScores: product.componentEvidence.map((component) => ({
        component: component.component,
        label: RANKING_COMPONENT_LABELS[component.component],
        weight: component.weight,
        available: component.available,
        normalizedSignal: component.normalizedSignal,
        weightedPoints: component.weightedPoints,
        metricNature: component.metricNature,
        explanation: rankingComponentExplanation(component),
      })),
      componentDominance: dominance.componentDominance,
      dominantComponent: dominance.dominantComponent,
      dominanceWarning: dominance.dominanceWarning,
      promotionEligible: false,
    };
  });
  const dominantComponentDistribution: Record<string, number> = {};
  for (const diagnostic of ranking.diagnostics.productDominance) {
    if (diagnostic.dominantComponent !== null) {
      dominantComponentDistribution[diagnostic.dominantComponent] =
        (dominantComponentDistribution[diagnostic.dominantComponent] ?? 0) + 1;
    }
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
    conditionalSignalScoreUsage: "diagnostic_only_not_used_for_ranking",
    searchPlacementStatus: ranking.reportType === "search_results"
      ? "available"
      : "not_applicable",
    weights: Object.entries(ranking.weights).map(([component, weight]) => ({
      component: component as SellerSpriteMarketSignalComponent,
      label: RANKING_COMPONENT_LABELS[component as SellerSpriteMarketSignalComponent],
      weight,
    })),
    diagnostics: {
      salesOnlyTop3: ranking.diagnostics.salesOnlyOrder.slice(0, 3),
      marketSignalTop3: products
        .filter((product) => product.scoreRank !== null)
        .slice(0, 3)
        .map((product) => product.asin),
      top3SalesOverlap: ranking.diagnostics.top3SalesOverlap,
      scoreSpread: { ...ranking.diagnostics.scoreSpread },
      dominanceWarningCount: ranking.diagnostics.productDominance.filter(
        (diagnostic) => diagnostic.dominanceWarning,
      ).length,
      dominantComponentDistribution,
    },
    products,
    familyResearchList: ranking.familyResearchList.map((family) => ({
      familyIdentity: family.familyIdentity,
      representativeAsin: family.representativeAsin,
      members: [...family.members],
      rankableMemberCount: family.rankableMemberCount,
      representativeReason: family.representativeReason,
      familyWarnings: [...family.familyWarnings],
    })),
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

export function buildSellerSpriteOpportunityPreviewViewModel(input: {
  requestId: string;
  sourceFileName: string;
  headerColumnCount: number;
  snapshot: SellerSpriteMarketSnapshot;
  brief: SellerSpriteShadowSelectionBrief;
  report: SellerSpriteBriefBoundShadowReport;
  ranking: SellerSpriteMarketSignalRankingReport;
}): SellerSpriteOpportunityPreviewViewModel {
  const { snapshot, report } = input;
  assertReadOnlyShadowContract(report);
  if (
    snapshot.sourceFileSha256 !== report.sourceFileSha256
    || snapshot.sourceBoundSnapshotHash !== report.sourceBoundSnapshotHash
    || snapshot.normalizedBusinessHash !== report.normalizedBusinessHash
    || snapshot.reportType !== report.reportType
  ) {
    throw new Error("SELLERSPRITE_PREVIEW_SNAPSHOT_REPORT_MISMATCH");
  }
  if (report.brief.category.trim() === "") {
    throw new Error("SELLERSPRITE_PREVIEW_CATEGORY_REQUIRED");
  }

  const reportByAsin = new Map(report.products.map((product) => [product.asin, product]));
  const products = snapshot.products.map((product): SellerSpritePreviewProduct => {
    const shadow = reportByAsin.get(product.asin);
    if (!shadow) throw new Error("SELLERSPRITE_PREVIEW_PRODUCT_REPORT_MISMATCH");
    return {
      reportType: snapshot.reportType,
      asin: product.asin,
      title: resolvedString(product, "productTitle"),
      brand: resolvedString(product, "brand"),
      parentAsin: product.parentAsin,
      price: resolvedNumber(product, "price"),
      estimatedMonthlySales: resolvedNumber(product, "estimatedMonthlySales"),
      rating: resolvedNumber(product, "rating"),
      reviews: resolvedNumber(product, "reviews"),
      variationCount: resolvedNumber(product, "variationCount"),
      occurrenceCount: product.occurrenceCount,
      appearanceCount: snapshot.reportType === "search_results"
        ? product.appearances.length
        : null,
      sponsoredAppearanceCount: product.sponsoredAppearanceCount,
      organicAppearanceCount: product.organicAppearanceCount,
      unknownAppearanceCount: product.unknownAppearanceCount,
      bestSponsoredPage: product.bestSponsoredPage,
      bestSponsoredPosition: product.bestSponsoredPosition,
      bestOrganicPage: product.bestOrganicPage,
      bestOrganicPosition: product.bestOrganicPosition,
      rootCategory: resolvedString(product, "rootCategory"),
      rootCategoryBsr: resolvedBsr(product, "rootCategoryBsr"),
      subCategory: resolvedString(product, "subCategory"),
      subCategoryBsr: resolvedBsr(product, "subCategoryBsr"),
      missingSignals: shadow.missingSignals,
      conflictingSignals: shadow.conflictingSignals,
      priceBandStatus: shadow.briefPriceBandResult.status,
      provisionalDisposition: shadow.provisionalDisposition,
      authoritative: false,
      promotionEligible: false,
      productionEffect: false,
      productionDatabaseWritten: false,
      manifestRegistered: false,
    };
  });

  return {
    schemaVersion: SELLERSPRITE_OPPORTUNITY_PREVIEW_SCHEMA_VERSION,
    reportType: snapshot.reportType,
    requestId: input.requestId,
    reportStatus: snapshot.rejectedRows === 0 ? "complete" : "partial",
    sourceFileName: input.sourceFileName,
    sourceFileSha256: snapshot.sourceFileSha256,
    sourceBoundSnapshotHash: snapshot.sourceBoundSnapshotHash,
    normalizedBusinessHash: snapshot.normalizedBusinessHash,
    briefHash: report.briefHash,
    reportHash: report.reportHash,
    source: "SellerSprite",
    sourceType: "provider_metric",
    authoritative: false,
    promotionAllowed: false,
    hardGateEvaluable: false,
    currentStage1Invoked: false,
    productionEffect: false,
    productionDatabaseWritten: false,
    manifestRegistered: false,
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    query: report.brief.query,
    category: report.brief.category,
    priceMin: report.brief.priceMin,
    priceMax: report.brief.priceMax,
    sheetName: snapshot.sheetName,
    headerColumnCount: input.headerColumnCount,
    totalRows: snapshot.totalRows,
    acceptedRows: snapshot.acceptedRows,
    rejectedRows: snapshot.rejectedRows,
    occurrenceCount: snapshot.occurrences.length,
    occurrenceLabel: snapshot.reportType === "search_results"
      ? "Search Appearance"
      : "Category Current 记录",
    appearanceCount: snapshot.reportType === "search_results"
      ? snapshot.appearances.length
      : null,
    productCount: snapshot.products.length,
    familyCount: snapshot.families.length,
    uniqueAsinCount: snapshot.uniqueAsinCount,
    duplicateOccurrenceGroupCount: snapshot.products.filter(
      (product) => product.occurrences.length > 1,
    ).length,
    duplicateAppearanceGroupCount: snapshot.reportType === "search_results"
      ? snapshot.products.filter((product) => product.appearances.length > 1).length
      : null,
    sponsoredAppearanceCount: snapshot.sponsoredPlacementCount,
    organicAppearanceCount: snapshot.organicPlacementCount,
    unknownAppearanceCount: snapshot.unknownPlacementCount,
    placementSummary: snapshot.placementSummary,
    categoryBsrSummary: snapshot.categoryBsrSummary,
    warningCounts: snapshot.warningCounts,
    conflictCount: Object.values(report.conflictCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    missingSignals: report.missingSignals,
    fieldMapping: snapshot.fieldMapping,
    fieldCoverage: snapshot.fieldCoverage,
    metricNatureCoverage: snapshot.metricNatureCoverage,
    productWeightedStatistics: snapshot.productWeightedSummary,
    occurrenceWeightedStatistics: snapshot.occurrenceWeightedSummary,
    appearanceWeightedStatistics: snapshot.appearanceWeightedSummary,
    brandConcentration: projectConcentration(snapshot.brandConcentrationSummary),
    sellerConcentration: projectConcentration(snapshot.sellerConcentrationSummary),
    products,
    ranking: buildRankingPreview(snapshot, input.brief, input.ranking, products),
  };
}
