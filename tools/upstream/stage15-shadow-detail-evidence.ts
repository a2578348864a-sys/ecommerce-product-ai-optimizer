import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage15ShadowObservation,
  type ShadowEvidenceValue,
  type Stage15ShadowObservation,
} from "./stage15-shadow-calibration";
import {
  evaluateStage15ShadowDetailAccessPreflight,
  type Stage15ShadowDetailAccessAuthorization,
  type Stage15ShadowDetailAccessLogEntry,
  type Stage15ShadowDetailAccessRequest,
} from "./stage15-shadow-detail-access";

type DetailEvidenceItem = {
  productKey: string;
  evidenceSnapshotId: string;
  sourceUrl: string;
  sourceCapture: {
    relativePath: string;
    fileSha256: string;
    capturedAt: string;
    accessOutcome: Stage15ShadowDetailAccessLogEntry["outcome"];
  };
  dimensions: ShadowEvidenceValue<string>;
  material: ShadowEvidenceValue<string[]>;
  monthlyBought: ShadowEvidenceValue<number>;
  firstAvailableAt: ShadowEvidenceValue<string>;
  exactVariantRating: ShadowEvidenceValue<number>;
  exactVariantReviewCount: ShadowEvidenceValue<number>;
  exactVariantPositiveReviews: ShadowEvidenceValue<string[]>;
  exactVariantNegativeReviews: ShadowEvidenceValue<string[]>;
  exactVariantReviewSampleCount: ShadowEvidenceValue<number>;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function iso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function withoutObservationHash(observation: Stage15ShadowObservation) {
  const { observationHash: _observationHash, ...body } = observation;
  void _observationHash;
  return body;
}

function validateDetailField<T>(field: ShadowEvidenceValue<T>, label: string, capturedAt: string): void {
  if (field.status === "observed") {
    if (field.value === null || field.exactVariant !== true || field.missingReason !== null
      || field.capturedAt !== capturedAt || field.evidenceRefs.length === 0
      || field.evidenceRefs.some((ref) => !/^detail-capture:/u.test(ref))) {
      throw new Error(`SHADOW_DETAIL_EVIDENCE_EXACT_VARIANT_REQUIRED:${label}`);
    }
    return;
  }
  if (field.status !== "missing" || field.value !== null || field.exactVariant !== null
    || field.capturedAt !== null || field.evidenceRefs.length !== 0 || !nonEmpty(field.missingReason)) {
    throw new Error(`SHADOW_DETAIL_EVIDENCE_FIELD_INVALID:${label}`);
  }
}

function allFields(item: DetailEvidenceItem): Array<[string, ShadowEvidenceValue<unknown>]> {
  return [
    ["dimensions", item.dimensions],
    ["material", item.material],
    ["monthlyBought", item.monthlyBought],
    ["firstAvailableAt", item.firstAvailableAt],
    ["exactVariantRating", item.exactVariantRating],
    ["exactVariantReviewCount", item.exactVariantReviewCount],
    ["exactVariantPositiveReviews", item.exactVariantPositiveReviews],
    ["exactVariantNegativeReviews", item.exactVariantNegativeReviews],
    ["exactVariantReviewSampleCount", item.exactVariantReviewSampleCount],
  ];
}

function missing<T>(reason: string): ShadowEvidenceValue<T> {
  return { value: null, status: "missing", evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: reason };
}

function ageDays(firstAvailableAt: ShadowEvidenceValue<string>, capturedAt: string): ShadowEvidenceValue<number> {
  if (firstAvailableAt.status !== "observed" || !iso(firstAvailableAt.value)) {
    return missing("first_available_date_not_collected");
  }
  const value = Math.floor((Date.parse(capturedAt) - Date.parse(firstAvailableAt.value)) / 86_400_000);
  return {
    value,
    status: "observed",
    evidenceRefs: [...firstAvailableAt.evidenceRefs],
    capturedAt,
    exactVariant: true,
    missingReason: null,
  };
}

export function buildStage15ShadowDetailEvidencePackage(input: {
  schemaVersion: "stage15-shadow-detail-evidence-package-input.v1";
  request: Stage15ShadowDetailAccessRequest;
  authorization: Stage15ShadowDetailAccessAuthorization;
  accessLog: Stage15ShadowDetailAccessLogEntry[];
  sourceObservations: Stage15ShadowObservation[];
  detailItems: DetailEvidenceItem[];
  createdAt: string;
}) {
  if (input.schemaVersion !== "stage15-shadow-detail-evidence-package-input.v1" || !iso(input.createdAt)
    || input.sourceObservations.length !== 20 || input.detailItems.length !== 20 || input.accessLog.length !== 20) {
    throw new Error("SHADOW_DETAIL_EVIDENCE_PACKAGE_INPUT_INVALID");
  }
  evaluateStage15ShadowDetailAccessPreflight({
    request: input.request,
    authorization: input.authorization,
    accessLog: input.accessLog,
  });
  const sourceByProduct = new Map(input.sourceObservations.map((observation) => [observation.productKey, observation]));
  const itemByProduct = new Map(input.detailItems.map((item) => [item.productKey, item]));
  const logByProduct = new Map(input.accessLog.map((entry) => [entry.productKey, entry]));
  if (sourceByProduct.size !== 20 || itemByProduct.size !== 20 || logByProduct.size !== 20) {
    throw new Error("SHADOW_DETAIL_EVIDENCE_IDENTITY_DRIFT");
  }

  const orderedItems: DetailEvidenceItem[] = [];
  const observations = input.request.targets.map((target) => {
    const source = sourceByProduct.get(target.productKey);
    const item = itemByProduct.get(target.productKey);
    const log = logByProduct.get(target.productKey);
    if (!source || !item || !log || source.batchId !== input.request.batchId
      || stableHash(withoutObservationHash(source)) !== source.observationHash
      || item.evidenceSnapshotId !== source.evidenceSnapshotId || item.sourceUrl !== target.sourceUrl
      || item.sourceCapture.accessOutcome !== log.outcome || !nonEmpty(item.sourceCapture.relativePath)
      || item.sourceCapture.relativePath.includes("..") || !/^[a-f0-9]{64}$/u.test(item.sourceCapture.fileSha256)
      || !iso(item.sourceCapture.capturedAt) || Date.parse(item.sourceCapture.capturedAt) < Date.parse(log.requestedAt)
      || Date.parse(input.createdAt) < Date.parse(item.sourceCapture.capturedAt)) {
      throw new Error("SHADOW_DETAIL_EVIDENCE_IDENTITY_DRIFT");
    }
    const fields = allFields(item);
    if (["login_wall", "captcha", "access_denied", "variant_binding_unverified"].includes(log.outcome)
      && fields.some(([, field]) => field.status === "observed")) {
      throw new Error("SHADOW_DETAIL_STOPPED_PAGE_HAS_OBSERVED_EVIDENCE");
    }
    fields.forEach(([label, field]) => validateDetailField(field, label, item.sourceCapture.capturedAt));
    orderedItems.push(item);
    return buildStage15ShadowObservation({
      schemaVersion: "stage15-shadow-observation-input.v1",
      batchId: source.batchId,
      productKey: source.productKey,
      evidenceSnapshotId: source.evidenceSnapshotId,
      marketValidation: {
        monthlyBought: item.monthlyBought,
        categoryRank: source.marketValidation.categoryRank,
        rating: item.exactVariantRating.status === "observed" ? item.exactVariantRating : source.marketValidation.rating,
        reviewCount: item.exactVariantReviewCount.status === "observed" ? item.exactVariantReviewCount : source.marketValidation.reviewCount,
      },
      listingMaturity: {
        firstAvailableAt: item.firstAvailableAt,
        ageDays: ageDays(item.firstAvailableAt, item.sourceCapture.capturedAt),
      },
      buyerReviews: {
        positive: item.exactVariantPositiveReviews,
        negative: item.exactVariantNegativeReviews,
        sampleCount: item.exactVariantReviewSampleCount,
      },
      decisionImpact: false,
    });
  });
  const isObserved = (field: ShadowEvidenceValue<unknown>) => field.status === "observed";
  const policyEligible = observations.filter((observation) =>
    observation.buyerReviews.sampleCount.status === "observed"
    && observation.buyerReviews.sampleCount.exactVariant === true).length;
  const completeReviews = observations.filter((observation) =>
    observation.buyerReviews.sampleCount.status === "observed"
    && observation.buyerReviews.positive.status === "observed"
    && observation.buyerReviews.negative.status === "observed").length;
  const coverage = {
    detailPagesAttempted: input.accessLog.length,
    detailPagesSucceeded: input.accessLog.filter((entry) => entry.outcome === "success").length,
    dimensionsObserved: orderedItems.filter((item) => isObserved(item.dimensions)).length,
    materialObserved: orderedItems.filter((item) => isObserved(item.material)).length,
    exactVariantReviewPolicyEligible: policyEligible,
    completeExactVariantReviewEvidence: completeReviews,
  };
  const body = {
    schemaVersion: "stage15-shadow-detail-evidence-package.v1" as const,
    batchId: input.request.batchId,
    sourceRequestHash: input.request.requestHash,
    sourceAuthorizationHash: stableHash(input.authorization),
    status: policyEligible >= 10
      ? "ready_for_human_packet_regeneration" as const
      : "insufficient_exact_variant_review_coverage" as const,
    accessLog: input.accessLog,
    items: orderedItems,
    observations,
    coverage,
    boundary: {
      decisionImpact: false as const,
      stage1OrStage15WeightsChanged: false as const,
      databaseWritten: false as const,
      candidateGenerated: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  return { ...body, packageHash: stableHash(body) };
}
