import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";

export type Stage2NextEvidenceHandoff = {
  schemaVersion: string;
  status: string;
  createdAt: string;
  sourceSubmissionHash: string;
  sourceValidationHash: string;
  sourceRequestHash: string;
  target: { sampleId: string; productKey: string; asin: string };
  knownInputs: {
    salePriceUsd: number;
    provisionalBomUsdPerItem: number;
    packageMetric: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number };
    packageImperialDiagnostic: Record<string, number>;
    packageHeightBasis: string;
  };
  tracks: Array<{ trackId: string; requestedFields: readonly string[] }>;
  remainingLaterFields: string[];
  boundary: Record<string, unknown>;
  handoffHash: string;
  [key: string]: unknown;
};

type AmazonFeeEvidence = {
  status: "pending" | "provided";
  capturedAt: string | null;
  sourceUrl: string | null;
  sourceImageSha256: string | null;
  feeCategory: string | null;
  currency: "USD" | null;
  referralFeeUsdPerItem: number | null;
  fbaFeeUsdPerItem: number | null;
  catalogDimensionsAndWeightText: string | null;
  note: string | null;
  missingReason: string | null;
};

type FreightQuoteEvidence = {
  status: "pending" | "provided";
  capturedAt: string | null;
  sourceUrl: string | null;
  sourceImageSha256: string | null;
  quotedQuantityUnits: number | null;
  totalQuote: number | null;
  currency: "USD" | "CNY" | null;
  routeAndTransportMode: string | null;
  includedCharges: string[];
  excludedCharges: string[];
  quoteValidUntil: string | null;
  note: string | null;
  missingReason: string | null;
};

export type Stage2NextEvidenceReceipt = {
  schemaVersion: "stage2-next-evidence-receipt.v1";
  receiptId: string;
  handoffHash: string;
  target: { sampleId: string; productKey: string; asin: string };
  createdAt: string;
  submittedBy: "project_owner" | null;
  amazonFeeEvidence: AmazonFeeEvidence;
  freightQuoteEvidence: FreightQuoteEvidence;
  boundary: {
    rawEvidenceMustBePreserved: true;
    valuesRequireManualReviewBeforeApplication: true;
    submissionMutationAllowed: false;
    profitCalculationAllowed: false;
    databaseWriteAllowed: false;
  };
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validText(value: unknown, max = 500): value is string {
  return typeof value === "string" && value.trim().length >= 3 && value.length <= max;
}

function validPublicHttpsUrl(value: unknown, amazonOnly = false): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    if (amazonOnly && host !== "amazon.com" && !host.endsWith(".amazon.com")) return false;
    return host.includes(".");
  } catch {
    return false;
  }
}

function validateHandoff(handoff: Stage2NextEvidenceHandoff) {
  const { handoffHash, ...body } = handoff;
  return handoff.schemaVersion === "stage2-next-evidence-handoff.v1"
    && handoff.status === "pending_manual_evidence_capture"
    && stableHash(body) === handoffHash
    && handoff.boundary.externalWebsiteAccessed === false
    && handoff.boundary.doesNotCalculateProfit === true
    && handoff.tracks.length === 2
    && handoff.tracks[0]?.trackId === "amazon_fee_evidence"
    && handoff.tracks[1]?.trackId === "first_mile_quote";
}

export function buildStage2NextEvidenceReceiptTemplate(input: {
  handoff: Stage2NextEvidenceHandoff;
  createdAt: string;
}): Stage2NextEvidenceReceipt {
  if (!validateHandoff(input.handoff) || !validIso(input.createdAt)) {
    throw new Error("STAGE2_NEXT_EVIDENCE_RECEIPT_SOURCE_INVALID");
  }
  return {
    schemaVersion: "stage2-next-evidence-receipt.v1",
    receiptId: `stage2-next-evidence-receipt-${stableHash({
      handoffHash: input.handoff.handoffHash,
      createdAt: input.createdAt,
    }).slice(0, 24)}`,
    handoffHash: input.handoff.handoffHash,
    target: { ...input.handoff.target },
    createdAt: input.createdAt,
    submittedBy: null,
    amazonFeeEvidence: {
      status: "pending",
      capturedAt: null,
      sourceUrl: null,
      sourceImageSha256: null,
      feeCategory: null,
      currency: null,
      referralFeeUsdPerItem: null,
      fbaFeeUsdPerItem: null,
      catalogDimensionsAndWeightText: null,
      note: null,
      missingReason: "not_provided",
    },
    freightQuoteEvidence: {
      status: "pending",
      capturedAt: null,
      sourceUrl: null,
      sourceImageSha256: null,
      quotedQuantityUnits: null,
      totalQuote: null,
      currency: null,
      routeAndTransportMode: null,
      includedCharges: [],
      excludedCharges: [],
      quoteValidUntil: null,
      note: null,
      missingReason: "not_provided",
    },
    boundary: {
      rawEvidenceMustBePreserved: true,
      valuesRequireManualReviewBeforeApplication: true,
      submissionMutationAllowed: false,
      profitCalculationAllowed: false,
      databaseWriteAllowed: false,
    },
  };
}

function pendingAmazonValid(value: AmazonFeeEvidence) {
  return value.status === "pending"
    && value.missingReason === "not_provided"
    && value.capturedAt === null
    && value.sourceUrl === null
    && value.sourceImageSha256 === null
    && value.feeCategory === null
    && value.currency === null
    && value.referralFeeUsdPerItem === null
    && value.fbaFeeUsdPerItem === null
    && value.catalogDimensionsAndWeightText === null
    && value.note === null;
}

function pendingFreightValid(value: FreightQuoteEvidence) {
  return value.status === "pending"
    && value.missingReason === "not_provided"
    && value.capturedAt === null
    && value.sourceUrl === null
    && value.sourceImageSha256 === null
    && value.quotedQuantityUnits === null
    && value.totalQuote === null
    && value.currency === null
    && value.routeAndTransportMode === null
    && value.includedCharges.length === 0
    && value.excludedCharges.length === 0
    && value.quoteValidUntil === null
    && value.note === null;
}

export function validateStage2NextEvidenceReceipt(
  handoff: Stage2NextEvidenceHandoff,
  receipt: Stage2NextEvidenceReceipt,
) {
  const reasons: string[] = [];
  if (!validateHandoff(handoff)
    || receipt.schemaVersion !== "stage2-next-evidence-receipt.v1"
    || receipt.handoffHash !== handoff.handoffHash
    || receipt.target.sampleId !== handoff.target.sampleId
    || receipt.target.productKey !== handoff.target.productKey
    || receipt.target.asin !== handoff.target.asin
    || !validIso(receipt.createdAt)
    || receipt.boundary.rawEvidenceMustBePreserved !== true
    || receipt.boundary.valuesRequireManualReviewBeforeApplication !== true
    || receipt.boundary.submissionMutationAllowed !== false
    || receipt.boundary.profitCalculationAllowed !== false
    || receipt.boundary.databaseWriteAllowed !== false) {
    reasons.push("receipt_binding_invalid");
  }

  const amazon = receipt.amazonFeeEvidence;
  if (amazon.status === "pending") {
    if (!pendingAmazonValid(amazon)) reasons.push("amazon_fee_pending_shape_invalid");
    else reasons.push("amazon_fee_evidence_missing");
  } else {
    if (receipt.submittedBy !== "project_owner") reasons.push("submitted_by_required");
    if (!validIso(amazon.capturedAt)) reasons.push("amazon_fee_captured_at_invalid");
    if (!validSha256(amazon.sourceImageSha256)) reasons.push("amazon_fee_image_hash_invalid");
    if (amazon.sourceUrl !== null && !validPublicHttpsUrl(amazon.sourceUrl, true)) reasons.push("amazon_fee_source_url_invalid");
    if (!validText(amazon.feeCategory, 200)) reasons.push("amazon_fee_category_invalid");
    if (amazon.currency !== "USD") reasons.push("amazon_fee_currency_invalid");
    if (typeof amazon.referralFeeUsdPerItem !== "number"
      || !Number.isFinite(amazon.referralFeeUsdPerItem)
      || amazon.referralFeeUsdPerItem < 0) reasons.push("amazon_referral_fee_invalid");
    if (typeof amazon.fbaFeeUsdPerItem !== "number"
      || !Number.isFinite(amazon.fbaFeeUsdPerItem)
      || amazon.fbaFeeUsdPerItem < 0) reasons.push("amazon_fba_fee_invalid");
    if (amazon.catalogDimensionsAndWeightText !== null
      && !validText(amazon.catalogDimensionsAndWeightText, 300)) reasons.push("amazon_catalog_dimensions_invalid");
    if (!validText(amazon.note)) reasons.push("amazon_fee_note_invalid");
    if (amazon.missingReason !== null) reasons.push("amazon_fee_missing_reason_unexpected");
  }

  const freight = receipt.freightQuoteEvidence;
  if (freight.status === "pending") {
    if (!pendingFreightValid(freight)) reasons.push("freight_quote_pending_shape_invalid");
    else reasons.push("freight_quote_evidence_missing");
  } else {
    if (receipt.submittedBy !== "project_owner") reasons.push("submitted_by_required");
    if (!validIso(freight.capturedAt)) reasons.push("freight_quote_captured_at_invalid");
    if (!validSha256(freight.sourceImageSha256)) reasons.push("freight_quote_image_hash_invalid");
    if (freight.sourceUrl !== null && !validPublicHttpsUrl(freight.sourceUrl)) reasons.push("freight_quote_source_url_invalid");
    if (!Number.isInteger(freight.quotedQuantityUnits) || (freight.quotedQuantityUnits ?? 0) <= 0) {
      reasons.push("freight_quote_quantity_invalid");
    }
    if (typeof freight.totalQuote !== "number" || !Number.isFinite(freight.totalQuote) || freight.totalQuote <= 0) {
      reasons.push("freight_quote_total_invalid");
    }
    if (!freight.currency || !["USD", "CNY"].includes(freight.currency)) reasons.push("freight_quote_currency_invalid");
    if (!validText(freight.routeAndTransportMode)) reasons.push("freight_quote_route_invalid");
    if (!Array.isArray(freight.includedCharges) || freight.includedCharges.length === 0
      || freight.includedCharges.some((item) => !validText(item, 100))) reasons.push("freight_quote_included_charges_invalid");
    if (!Array.isArray(freight.excludedCharges)
      || freight.excludedCharges.some((item) => !validText(item, 100))) reasons.push("freight_quote_excluded_charges_invalid");
    if (typeof freight.quoteValidUntil !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(freight.quoteValidUntil)
      || !Number.isFinite(Date.parse(`${freight.quoteValidUntil}T00:00:00Z`))) reasons.push("freight_quote_valid_until_invalid");
    if (!validText(freight.note)) reasons.push("freight_quote_note_invalid");
    if (freight.missingReason !== null) reasons.push("freight_quote_missing_reason_unexpected");
  }

  const blockingReasons = reasons.filter((reason) => ![
    "amazon_fee_evidence_missing",
    "freight_quote_evidence_missing",
  ].includes(reason));
  if (blockingReasons.length === 0
    && amazon.status === "provided"
    && freight.status === "provided"
    && freight.currency === "CNY") {
    reasons.push("freight_quote_exchange_rate_required");
  }
  const status = blockingReasons.length > 0
    ? "rejected"
    : amazon.status === "pending" || freight.status === "pending"
      ? "pending_evidence"
      : freight.currency === "CNY"
        ? "valid_partial_requires_exchange_rate"
        : "valid_for_manual_review";
  const body = {
    schemaVersion: "stage2-next-evidence-receipt-validation.v1" as const,
    status,
    reasonCodes: reasons,
    inputHash: stableHash(receipt),
    handoffHash: handoff.handoffHash,
    boundary: {
      submissionMutated: false as const,
      valuesApplied: false as const,
      profitCalculated: false as const,
      databaseWritten: false as const,
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function buildStage2NextEvidencePatchPreview(
  handoff: Stage2NextEvidenceHandoff,
  receipt: Stage2NextEvidenceReceipt,
) {
  const validation = validateStage2NextEvidenceReceipt(handoff, receipt);
  if (!(["valid_for_manual_review", "valid_partial_requires_exchange_rate"] as string[]).includes(validation.status)) {
    throw new Error("STAGE2_NEXT_EVIDENCE_PATCH_SOURCE_INVALID");
  }
  const amazon = receipt.amazonFeeEvidence;
  const freight = receipt.freightQuoteEvidence;
  if (amazon.status !== "provided" || freight.status !== "provided") {
    throw new Error("STAGE2_NEXT_EVIDENCE_PATCH_SOURCE_INVALID");
  }
  const firstMile = freight.currency === "USD"
    ? Math.round(((freight.totalQuote! / freight.quotedQuantityUnits!) + Number.EPSILON) * 100) / 100
    : null;
  const body = {
    schemaVersion: "stage2-next-evidence-patch-preview.v1" as const,
    status: validation.status === "valid_for_manual_review"
      ? "manual_review_required" as const
      : "partial_exchange_rate_required" as const,
    handoffHash: handoff.handoffHash,
    receiptValidationHash: validation.evidenceHash,
    target: { ...receipt.target },
    proposedFields: {
      platformCommission: {
        value: amazon.referralFeeUsdPerItem,
        currency: "USD" as const,
        status: "manual_review_required" as const,
      },
      fba: {
        value: amazon.fbaFeeUsdPerItem,
        currency: "USD" as const,
        status: "manual_review_required" as const,
      },
      firstMile: {
        value: firstMile,
        currency: firstMile === null ? null : "USD" as const,
        status: firstMile === null
          ? "exchange_rate_evidence_required" as const
          : "derived_from_quote_manual_review_required" as const,
      },
      logisticsEvidenceUrl: {
        value: freight.sourceUrl,
        status: freight.sourceUrl === null
          ? "missing_public_url_screenshot_hash_only" as const
          : "manual_review_required" as const,
      },
    },
    sourceEvidence: {
      amazonFeeImageSha256: amazon.sourceImageSha256,
      freightQuoteImageSha256: freight.sourceImageSha256,
      rawFreightQuote: {
        quantityUnits: freight.quotedQuantityUnits,
        totalQuote: freight.totalQuote,
        currency: freight.currency,
      },
    },
    boundary: {
      previewOnly: true as const,
      submissionMutated: false as const,
      profitCalculated: false as const,
      candidateCreated: false as const,
      databaseWritten: false as const,
    },
  };
  return { ...body, previewHash: stableHash(body) };
}

export function generateStage2NextEvidenceReceiptMaterials(input: {
  handoff: Stage2NextEvidenceHandoff;
  createdAt: string;
  outputDirectory: string;
}) {
  const receipt = buildStage2NextEvidenceReceiptTemplate(input);
  const validation = validateStage2NextEvidenceReceipt(input.handoff, receipt);
  const files = [
    "stage2-next-evidence-receipt.template.v1.json",
    "stage2-next-evidence-receipt-validation.pending.v1.json",
    "README-收到截图后不用自己填写.md",
  ];
  const readme = `# 收到截图后不用自己填写

这份目录只是待收件模板。你不要自己改 JSON，也不用计算任何费用。

等你发来以下任一材料后，由系统生成新的receipt successor并校验：

1. Amazon官方费用结果截图；
2. 货代完整报价截图。

规则：

- 截图原始金额、数量、币种和费用组成先保存，再生成单件派生预览。
- CNY报价没有同期汇率证据时不换算USD。
- 截图只有Hash进入JSON，图片本体、Cookie、Token和账号信息不得写入。
- 校验通过也只生成patch preview，必须再次人工复核后才能应用到Stage 2 submission。
- 当前模板状态固定为pending_evidence，不代表证据已经提供。
`;
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(receipt) },
    { relativePath: files[1], content: json(validation) },
    { relativePath: files[2], content: readme },
  ], "STAGE2_NEXT_EVIDENCE_RECEIPT_OUTPUT_CONFLICT");
  return { receipt, validation, files, artifactWrite };
}
