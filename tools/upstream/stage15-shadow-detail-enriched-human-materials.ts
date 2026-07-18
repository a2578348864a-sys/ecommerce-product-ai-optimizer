import { stableHash } from "../../lib/upstream/pipeline";
import type { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";
import type { buildStage15ShadowDetailEvidencePackage } from "./stage15-shadow-detail-evidence";

type PublicUpstream = ReturnType<typeof generateStage15ShadowPublicUpstream>;
type SourcePacket = PublicUpstream["packet"];
type SourceBindings = PublicUpstream["privateBindings"];
type DetailEvidencePackage = ReturnType<typeof buildStage15ShadowDetailEvidencePackage>;

const PUBLIC_IDENTITY_LEAK = /amazon:US:|https:\/\/www\.amazon\.com\/(?:[^\s"/]+\/)?dp\/|\bB0[A-Z0-9]{8}\b|productKey|candidateId|evidenceSnapshotId/iu;

function withoutHash<T extends Record<string, unknown>>(value: T, key: keyof T) {
  const body = { ...value };
  delete body[key];
  return body;
}

function exactSet(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}

function visible<T>(field: { status: string; value: T | null }): T | null {
  return field.status === "observed" ? field.value : null;
}

export function buildStage15ShadowDetailEnrichedHumanMaterials(input: {
  sourcePacket: SourcePacket;
  sourceBindings: SourceBindings;
  detailEvidencePackage: DetailEvidencePackage;
  createdAt: string;
}) {
  const packetBody = withoutHash(input.sourcePacket as unknown as Record<string, unknown>, "packetHash");
  const bindingsBody = withoutHash(input.sourceBindings as unknown as Record<string, unknown>, "bindingHash");
  const detailBody = withoutHash(input.detailEvidencePackage as unknown as Record<string, unknown>, "packageHash");
  if (input.sourcePacket.schemaVersion !== "stage15-shadow-combined-human-evaluation-packet.v1"
    || input.sourcePacket.items.length !== 20 || stableHash(packetBody) !== input.sourcePacket.packetHash
    || input.sourceBindings.schemaVersion !== "stage15-shadow-combined-human-evaluation-bindings.private.v1"
    || input.sourceBindings.bindings.length !== 20 || input.sourceBindings.packetHash !== input.sourcePacket.packetHash
    || stableHash(bindingsBody) !== input.sourceBindings.bindingHash
    || input.detailEvidencePackage.schemaVersion !== "stage15-shadow-detail-evidence-package.v1"
    || stableHash(detailBody) !== input.detailEvidencePackage.packageHash
    || input.detailEvidencePackage.batchId !== input.sourceBindings.batchId
    || Number.isNaN(Date.parse(input.createdAt))
    || Date.parse(input.createdAt) < Date.parse(input.detailEvidencePackage.createdAt)) {
    throw new Error("SHADOW_DETAIL_ENRICHED_SOURCE_INVALID");
  }
  if (input.detailEvidencePackage.coverage.exactVariantReviewPolicyEligible < 10) {
    throw new Error("SHADOW_DETAIL_ENRICHED_REVIEW_COVERAGE_INSUFFICIENT");
  }
  const bindingByEvaluationId = new Map(input.sourceBindings.bindings.map((binding) => [binding.evaluationItemId, binding]));
  const observationByProduct = new Map(input.detailEvidencePackage.observations.map((observation) => [observation.productKey, observation]));
  const detailByProduct = new Map(input.detailEvidencePackage.items.map((item) => [item.productKey, item]));
  const packetIds = input.sourcePacket.items.map((item) => item.evaluationItemId);
  const bindingIds = input.sourceBindings.bindings.map((binding) => binding.evaluationItemId);
  const detailProducts = input.detailEvidencePackage.observations.map((observation) => observation.productKey);
  const bindingProducts = input.sourceBindings.bindings.map((binding) => binding.productKey);
  if (!exactSet(packetIds, bindingIds) || !exactSet(detailProducts, bindingProducts)
    || observationByProduct.size !== 20 || detailByProduct.size !== 20) {
    throw new Error("SHADOW_DETAIL_ENRICHED_IDENTITY_DRIFT");
  }
  const replacedMissingReasons = new Set([
    "dimensions_not_collected",
    "material_not_collected",
    "monthly_bought_not_reported_on_category_page",
    "first_available_date_not_collected",
    "exact_variant_reviews_not_collected",
  ]);
  const enrichedItems = input.sourcePacket.items.map((sourceItem) => {
    const binding = bindingByEvaluationId.get(sourceItem.evaluationItemId);
    const observation = binding ? observationByProduct.get(binding.productKey) : null;
    const detail = binding ? detailByProduct.get(binding.productKey) : null;
    if (!binding || !observation || !detail
      || observation.evidenceSnapshotId !== binding.evidenceSnapshotId
      || detail.evidenceSnapshotId !== binding.evidenceSnapshotId) {
      throw new Error("SHADOW_DETAIL_ENRICHED_IDENTITY_DRIFT");
    }
    const detailFields = [
      ["dimensions", detail.dimensions],
      ["material", detail.material],
      ["monthly_bought", detail.monthlyBought],
      ["first_available_at", detail.firstAvailableAt],
      ["exact_variant_rating", detail.exactVariantRating],
      ["exact_variant_review_count", detail.exactVariantReviewCount],
      ["exact_variant_positive_reviews", detail.exactVariantPositiveReviews],
      ["exact_variant_negative_reviews", detail.exactVariantNegativeReviews],
      ["exact_variant_review_sample_count", detail.exactVariantReviewSampleCount],
    ] as const;
    const missingReasons = [
      ...sourceItem.sourceEvidence.missingReasons.filter((reason) => !replacedMissingReasons.has(reason)),
      ...detailFields.flatMap(([label, field]) => field.status === "observed" ? [] : [`${label}:${field.missingReason}`]),
    ];
    return {
      ...sourceItem,
      sourceEvidence: {
        ...sourceItem.sourceEvidence,
        rating: visible(observation.marketValidation.rating),
        reviewCount: visible(observation.marketValidation.reviewCount),
        dimensions: visible(detail.dimensions),
        material: visible(detail.material),
        monthlyBought: visible(detail.monthlyBought),
        firstAvailableAt: visible(detail.firstAvailableAt),
        exactVariantPositiveReviews: visible(detail.exactVariantPositiveReviews),
        exactVariantNegativeReviews: visible(detail.exactVariantNegativeReviews),
        exactVariantReviewSampleCount: visible(detail.exactVariantReviewSampleCount),
        missingReasons,
        capturedAt: detail.sourceCapture.capturedAt,
      },
    };
  });
  const enrichedPacketBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1" as const,
    batchLabel: input.sourcePacket.batchLabel,
    status: "pending_human_evaluation" as const,
    proofLevel: "real_public_detail_page_exact_variant_evidence" as const,
    blindBoundary: input.sourcePacket.blindBoundary,
    items: enrichedItems,
  };
  if (PUBLIC_IDENTITY_LEAK.test(JSON.stringify(enrichedPacketBody))) {
    throw new Error("SHADOW_DETAIL_ENRICHED_PUBLIC_IDENTITY_LEAK");
  }
  const packet = { ...enrichedPacketBody, packetHash: stableHash(enrichedPacketBody) };
  const newBindingsBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-bindings.private.v1" as const,
    batchId: input.sourceBindings.batchId,
    packetHash: packet.packetHash,
    bindings: input.sourceBindings.bindings,
  };
  const bindings = { ...newBindingsBody, bindingHash: stableHash(newBindingsBody) };
  const resultTemplate = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-result-template.v1" as const,
    batchId: input.sourceBindings.batchId,
    sourcePacketHash: packet.packetHash,
    status: "pending_human_evaluation" as const,
    answers: packet.items.map((item) => ({
      evaluationItemId: item.evaluationItemId,
      productUnderstood: null,
      investigateNext10Minutes: null,
      screeningEvidenceSufficient: null,
      worthFurtherInvestigation: null,
      evidenceSufficient: null,
      dominantSignals: [],
      confidence: null,
      reason: "",
    })),
  };
  const readinessBody = {
    schemaVersion: "stage15-shadow-detail-enriched-human-readiness.v1" as const,
    batchId: input.sourceBindings.batchId,
    sourcePacketHash: input.sourcePacket.packetHash,
    sourceDetailEvidencePackageHash: input.detailEvidencePackage.packageHash,
    enrichedPacketHash: packet.packetHash,
    status: "ready_for_human_evaluation" as const,
    exactVariantReviewCoverage: input.detailEvidencePackage.coverage.exactVariantReviewPolicyEligible,
    sourceV1Overwritten: false as const,
    databaseWritten: false as const,
    productionEffect: false as const,
    createdAt: input.createdAt,
  };
  const readiness = { ...readinessBody, readinessHash: stableHash(readinessBody) };
  const materialsBody = { packet, bindings, resultTemplate, readiness };
  return { ...materialsBody, materialsHash: stableHash(materialsBody) };
}
