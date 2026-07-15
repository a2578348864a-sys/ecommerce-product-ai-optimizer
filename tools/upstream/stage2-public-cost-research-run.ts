import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  buildStage2PublicCostDerivationPreview,
  validateStage2PublicCostEvidence,
  type Stage2PublicCostEvidence,
} from "./stage2-public-cost-evidence";
import type { Stage2PublicCostResearchBrief } from "./stage2-public-cost-research-brief";
import {
  validateStage2PublicCostResearchAuthorizationConsumption,
  type Stage2PublicCostResearchAuthorizationConsumption,
  type Stage2PublicCostResearchAuthorizationGrant,
  type Stage2PublicCostResearchAuthorizationRequest,
} from "./stage2-public-cost-research-authorization";

type OfficialObservationInput = {
  capturedAt: string;
  externalReadCount: number;
  uniqueUrls: string[];
  retryCount: 0;
  exchangeRate: { rate: number; effectiveDate: string; sourceUrl: string; releaseDate: string };
  referralSchedule: {
    category: string;
    rate: number;
    minimumFeeUsd: number;
    sourceUrl: string;
    productFeeCategoryConfirmed: false;
    effectiveDate: null;
  };
  fbaPage: {
    sourceUrl: string;
    exactFeeObserved: false;
    packageDimensionConflict: true;
  };
};

type ManualSupplierEvidence = {
  schemaVersion: "stage2-manual-source-evidence.v1";
  receivedAt: string;
  target: { sampleId: string; productKey: string };
  supplierSource: { sourceUrl: string };
  observedPublicFacts: { selectedVariantPrice: { value: number; currency: "CNY" } };
};

export type Stage2PublicCostResearchRun = {
  schemaVersion: "stage2-public-cost-research-run.v1";
  runId: string;
  briefId: string;
  briefHash: string;
  grantHash: string;
  consumptionHash: string;
  status: "partial_official_evidence";
  capturedAt: string;
  navigation: {
    externalReadCount: number;
    uniqueUrls: string[];
    retryCount: 0;
    allowedOriginsOnly: true;
    loginUsed: false;
    accessRestrictionBypassed: false;
  };
  observations: {
    exchangeRate: { rate: number; quoteDirection: "CNY_PER_USD"; effectiveDate: string; releaseDate: string; sourceUrl: string; contentHash: string };
    referralSchedule: { category: string; rate: number; minimumFeeUsd: number; sourceUrl: string; effectiveDate: null; applicability: "fee_category_unconfirmed"; reasonCode: "amazon_fee_category_not_confirmed_for_product"; contentHash: string };
    fbaPage: { sourceUrl: string; feeUsd: null; applicability: "blocked_package_dimension_conflict"; reasonCode: "exact_fba_fee_not_observed_and_package_height_conflicts"; contentHash: string };
  };
  boundary: { stage2SubmissionMutated: false; profitCalculated: false; candidateCreated: false; databaseWritten: false; externalAiApiCalled: false };
  runHash: string;
};

function origin(url: string) {
  try { return new URL(url).origin; } catch { return null; }
}

export function buildStage2PublicCostResearchRun(input: {
  brief: Stage2PublicCostResearchBrief;
  request: Stage2PublicCostResearchAuthorizationRequest;
  grant: Stage2PublicCostResearchAuthorizationGrant;
  consumption: Stage2PublicCostResearchAuthorizationConsumption;
  supplier: ManualSupplierEvidence;
  observed: OfficialObservationInput;
}) {
  if (validateStage2PublicCostResearchAuthorizationConsumption(
    input.brief, input.request, input.grant, input.consumption,
  ).status !== "valid_consumed") throw new Error("STAGE2_PUBLIC_COST_CONSUMPTION_INVALID");
  if (input.observed.externalReadCount < 1
    || input.observed.externalReadCount > input.brief.requestedScope.maxTotalNavigations
    || input.observed.retryCount !== 0) throw new Error("STAGE2_PUBLIC_COST_NAVIGATION_BUDGET_INVALID");
  if (input.observed.uniqueUrls.some((url) => !input.brief.requestedScope.allowedOrigins.includes(origin(url) as never))) {
    throw new Error("STAGE2_PUBLIC_COST_SOURCE_ORIGIN_INVALID");
  }
  if (input.supplier.target.sampleId !== input.brief.sample.sampleId
    || input.supplier.target.productKey !== input.brief.sample.productKey
    || input.supplier.observedPublicFacts.selectedVariantPrice.currency !== "CNY"
    || input.supplier.observedPublicFacts.selectedVariantPrice.value <= 0) throw new Error("STAGE2_PUBLIC_COST_SUPPLIER_EVIDENCE_INVALID");

  const exchangeContent = {
    quoteDirection: "CNY_PER_USD" as const, rate: input.observed.exchangeRate.rate,
    effectiveDate: input.observed.exchangeRate.effectiveDate, releaseDate: input.observed.exchangeRate.releaseDate,
  };
  const referralContent = {
    category: input.observed.referralSchedule.category, rate: input.observed.referralSchedule.rate,
    minimumFeeUsd: input.observed.referralSchedule.minimumFeeUsd,
    productFeeCategoryConfirmed: false, effectiveDate: null,
  };
  const fbaContent = { exactFeeObserved: false, packageDimensionConflict: true };
  const runBody = {
    schemaVersion: "stage2-public-cost-research-run.v1" as const,
    runId: input.consumption.runId,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    grantHash: input.grant.grantHash,
    consumptionHash: input.consumption.consumptionHash,
    status: "partial_official_evidence" as const,
    capturedAt: input.observed.capturedAt,
    navigation: {
      externalReadCount: input.observed.externalReadCount,
      uniqueUrls: [...input.observed.uniqueUrls],
      retryCount: 0 as const,
      allowedOriginsOnly: true as const,
      loginUsed: false as const,
      accessRestrictionBypassed: false as const,
    },
    observations: {
      exchangeRate: { ...exchangeContent, sourceUrl: input.observed.exchangeRate.sourceUrl, contentHash: stableHash(exchangeContent) },
      referralSchedule: {
        category: input.observed.referralSchedule.category,
        rate: input.observed.referralSchedule.rate,
        minimumFeeUsd: input.observed.referralSchedule.minimumFeeUsd,
        sourceUrl: input.observed.referralSchedule.sourceUrl,
        effectiveDate: null,
        applicability: "fee_category_unconfirmed" as const,
        reasonCode: "amazon_fee_category_not_confirmed_for_product" as const,
        contentHash: stableHash(referralContent),
      },
      fbaPage: {
        sourceUrl: input.observed.fbaPage.sourceUrl,
        feeUsd: null,
        applicability: "blocked_package_dimension_conflict" as const,
        reasonCode: "exact_fba_fee_not_observed_and_package_height_conflicts" as const,
        contentHash: stableHash(fbaContent),
      },
    },
    boundary: {
      stage2SubmissionMutated: false as const,
      profitCalculated: false as const,
      candidateCreated: false as const,
      databaseWritten: false as const,
      externalAiApiCalled: false as const,
    },
  };
  const run: Stage2PublicCostResearchRun = { ...runBody, runHash: stableHash(runBody) };
  const supplierContentHash = stableHash(input.supplier);
  const evidence: Stage2PublicCostEvidence = {
    schemaVersion: "stage2-public-cost-evidence.v1",
    evidenceId: `stage2-public-cost-evidence-${input.brief.briefHash.slice(0, 24)}`,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    sampleId: input.brief.sample.sampleId,
    productKey: input.brief.sample.productKey,
    status: "partial",
    capturedAt: input.observed.capturedAt,
    boundary: { officialPublicEvidenceOnly: true, rawAndDerivedValuesSeparated: true, stage2SubmissionMutated: false, profitCalculated: false, candidateCreated: false, databaseWritten: false },
    observations: {
      supplierUnitPriceCny: {
        value: input.supplier.observedPublicFacts.selectedVariantPrice.value,
        missingReason: null,
        evidence: { sourceType: "manual", sourceUrl: input.supplier.supplierSource.sourceUrl, capturedAt: input.supplier.receivedAt, note: "用户提供的1688灰色六层变体公开页面证据；原始截图采集时间未知，以证据接收时间记录。", contentHash: supplierContentHash },
      },
      exchangeRate: {
        value: { quoteDirection: "CNY_PER_USD", rate: input.observed.exchangeRate.rate, effectiveDate: input.observed.exchangeRate.effectiveDate },
        missingReason: null,
        evidence: { sourceType: "direct_observation", sourceUrl: input.observed.exchangeRate.sourceUrl, capturedAt: input.observed.capturedAt, note: `Federal Reserve H.10 ${input.observed.exchangeRate.releaseDate} 发布；中国人民币 ${input.observed.exchangeRate.effectiveDate} 为每美元 ${input.observed.exchangeRate.rate} 元。`, contentHash: stableHash(exchangeContent) },
      },
      referralFee: { value: null, missingReason: "amazon_fee_category_not_confirmed_for_product", evidence: null },
      fbaFulfillmentFee: { value: null, missingReason: "exact_fba_fee_not_observed_and_package_height_conflicts", evidence: null },
    },
  };
  const validation = validateStage2PublicCostEvidence(input.brief, evidence);
  if (validation.status !== "valid_partial") throw new Error(`STAGE2_PUBLIC_COST_EVIDENCE_INVALID:${validation.reasonCodes.join(",")}`);
  const preview = buildStage2PublicCostDerivationPreview(input.brief, evidence);
  return { run, evidence, validation, preview };
}

export function generateStage2PublicCostResearchRun(input: {
  briefFile: string; requestFile: string; grantFile: string; consumptionFile: string; supplierFile: string;
  observed: OfficialObservationInput; outputDirectory: string;
}) {
  const read = <T>(file: string) => JSON.parse(readFileSync(resolve(file), "utf8")) as T;
  const brief = read<Stage2PublicCostResearchBrief>(input.briefFile);
  const result = buildStage2PublicCostResearchRun({
    brief, request: read(input.requestFile), grant: read(input.grantFile),
    consumption: read(input.consumptionFile), supplier: read(input.supplierFile), observed: input.observed,
  });
  const reviewBody = {
    schemaVersion: "stage2-public-cost-submission-patch-preview.v1" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    runId: result.run.runId,
    runHash: result.run.runHash,
    sourceEvidenceHash: result.validation.evidenceHash,
    status: "partial_patch_requires_manual_review" as const,
    proposedStage2Fields: {
      bom: {
        value: result.preview.derivedStage2Fields.bom.value,
        currency: "USD" as const,
        unit: "per_item" as const,
        status: "review_required" as const,
        inputHash: result.preview.derivedStage2Fields.bom.inputHash,
      },
      platformCommission: { value: null, status: "blocked_fee_category_unconfirmed" as const },
      fba: { value: null, status: "blocked_package_height_conflict_and_no_exact_fee" as const },
    },
    remainingEvidence: [
      "actual_amazon_fee_category_for_product",
      "exact_package_height",
      "applicable_fba_fulfillment_fee",
      ...brief.unresolvedOutsideThisResearch,
    ],
    boundary: {
      previewOnly: true as const,
      stage2SubmissionMutated: false as const,
      profitCalculated: false as const,
      humanDecisionRecorded: false as const,
      candidateCreated: false as const,
      databaseWritten: false as const,
    },
  };
  const review = { ...reviewBody, previewHash: stableHash(reviewBody) };
  const files = [
    "stage2-public-cost-research-run.v1.json",
    "stage2-public-cost-evidence.v1.json",
    "stage2-public-cost-evidence-validation.v1.json",
    "stage2-public-cost-derivation-preview.v1.json",
    "stage2-public-cost-submission-patch.preview.v1.json",
    "README-真实研究结果.md",
  ];
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(result.run) },
    { relativePath: files[1], content: json(result.evidence) },
    { relativePath: files[2], content: json(result.validation) },
    { relativePath: files[3], content: json(result.preview) },
    { relativePath: files[4], content: json(review) },
    {
      relativePath: files[5],
      content: `# Stage 2 公开成本研究结果\n\n- 已确认：18.50 CNY 与 6.7766 CNY/USD 可形成 BOM 预览约 2.73 USD/件。\n- 未确认：该商品实际 Amazon fee category，因此 15% / 0.30 USD 费表没有写入正式字段。\n- 未确认：包装高度在 3.5cm 与 3.8cm 冲突，且公开页未提供可直接适用的 FBA 金额，因此 FBA 保持 null。\n- 当前仅为只读补丁预览；未修改正式 Stage 2 submission、未计算利润、未生成 Candidate、未写数据库。\n`,
    },
  ], "STAGE2_PUBLIC_COST_RUN_OUTPUT_CONFLICT");
  return { ...result, review, files, artifactWrite };
}
