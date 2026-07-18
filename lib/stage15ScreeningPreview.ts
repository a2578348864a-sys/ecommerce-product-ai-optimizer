import { stableHash } from "@/lib/upstream/pipeline";

export type Stage15ScreeningStatus = "advance" | "watch" | "reject" | "insufficient";

export type Stage15PreviewImageInput = {
  status: "available" | "image_not_cached" | "image_integrity_failed";
  dataUrl: string | null;
  reason: string | null;
};

export type Stage15ScreeningPreviewItem = {
  productKey: string;
  blindItemId: string;
  status: Stage15ScreeningStatus;
  stage1Rank: number | null;
  stage1PromotionDecision: "promoted" | "rejected" | "insufficient_evidence";
  title: string | null;
  productTypeZh: string;
  primaryUseZh: string;
  presentationSourceType: "ai_generated";
  presentationStatus: "presentation_aid_not_source_fact";
  evidence: {
    price: number | null;
    rating: number | null;
    reviewCount: number | null;
  };
  image: Stage15PreviewImageInput;
  gates: {
    screeningEvidenceSufficient: boolean;
    userUnderstandsProduct: boolean;
    willingToContinueResearch: boolean;
  };
  rawHumanAnswer: {
    productUnderstood: "yes" | "no" | "uncertain" | "missing";
    evidenceSufficient: "yes" | "no" | "uncertain" | "missing";
    obviousConcern: "yes" | "no" | "uncertain" | "missing";
    investigateNext10Minutes: "yes" | "no" | "uncertain" | "missing";
    confidence: "high" | "medium" | "low" | "missing";
    elapsedSeconds: number | null;
    note: string | null;
  };
  reasons: {
    marketEvidence: string[];
    humanGate: string[];
    supportingEvidence: string[];
    counterEvidence: string[];
    missingEvidence: string[];
  };
  nextValidationPlan: string[];
  killCriteria: string[];
};

export type Stage15ScreeningPreviewView = {
  schemaVersion: "stage1-5-screening-preview-view.v1";
  proofLevel: "local_read_only_artifact_projection";
  sourceScreeningHash: string;
  sourceAcceptanceEvidenceHash: string;
  sourceVisualPacketHash: string;
  displayName: "调查短名单预览";
  runStatus: "completed" | "insufficient_advance_pool";
  engineeringConclusion: "deterministic_scope_reduction_verified";
  effectivenessConclusion: "screening_effectiveness_not_validated";
  advanceMeaning: "top_k_investigation_quota_not_quality_or_commercial_approval";
  summary: Record<Stage15ScreeningStatus, number>;
  items: Stage15ScreeningPreviewItem[];
  readOnly: true;
  formalCandidateGenerated: false;
  productionDatabaseWritten: false;
  externalNetworkRequired: false;
};

export type Stage15ScreeningPreviewErrorCode =
  | "preview_schema_invalid"
  | "preview_hash_binding_invalid"
  | "preview_partition_invalid"
  | "preview_visual_binding_invalid"
  | "preview_product_identity_conflict";

export class Stage15ScreeningPreviewError extends Error {
  readonly code: Stage15ScreeningPreviewErrorCode;

  constructor(code: Stage15ScreeningPreviewErrorCode) {
    super(code);
    this.name = "Stage15ScreeningPreviewError";
    this.code = code;
  }
}

export type Stage15ScreeningPreviewInput = {
  screeningRun: unknown;
  acceptance: unknown;
  generationSummary: unknown;
  visualPacket: unknown;
  localImages: Readonly<Record<string, Stage15PreviewImageInput>>;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(): never {
  throw new Stage15ScreeningPreviewError("preview_schema_invalid");
}

function asRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) schemaError();
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) schemaError();
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value !== null && typeof value !== "string") schemaError();
  return value;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) schemaError();
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") schemaError();
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) schemaError();
  return [...value];
}

function assertLiteral<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) schemaError();
  return value as T;
}

function assertHash(record: JsonRecord, hashField: string) {
  const actual = asString(record[hashField]);
  const body = { ...record };
  delete body[hashField];
  if (stableHash(body) !== actual) {
    throw new Stage15ScreeningPreviewError("preview_hash_binding_invalid");
  }
  return actual;
}

function asinFromProductKey(productKey: string): string {
  const match = /^amazon:US:([A-Z0-9]{10})$/.exec(productKey);
  if (!match) throw new Stage15ScreeningPreviewError("preview_product_identity_conflict");
  return match[1];
}

function asinFromSourceUrl(sourceUrl: string): string {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Stage15ScreeningPreviewError("preview_product_identity_conflict");
  }
  if (url.origin !== "https://www.amazon.com") {
    throw new Stage15ScreeningPreviewError("preview_product_identity_conflict");
  }
  const match = /^\/dp\/([A-Z0-9]{10})(?:\/|$)/.exec(url.pathname);
  if (!match) throw new Stage15ScreeningPreviewError("preview_product_identity_conflict");
  return match[1];
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string, code: Stage15ScreeningPreviewErrorCode) {
  const map = new Map<string, T>();
  for (const value of values) {
    const key = keyFor(value);
    if (!key || map.has(key)) throw new Stage15ScreeningPreviewError(code);
    map.set(key, value);
  }
  return map;
}

function parseSummary(value: unknown): Record<Stage15ScreeningStatus, number> {
  const summary = asRecord(value);
  const result = {
    advance: summary.advance,
    watch: summary.watch,
    reject: summary.reject,
    insufficient: summary.insufficient,
  };
  if (Object.values(result).some((count) => typeof count !== "number" || !Number.isInteger(count) || count < 0)) {
    schemaError();
  }
  return result as Record<Stage15ScreeningStatus, number>;
}

function parseImageInput(value: Stage15PreviewImageInput | undefined): Stage15PreviewImageInput {
  if (!value) throw new Stage15ScreeningPreviewError("preview_visual_binding_invalid");
  const status = assertLiteral(value.status, ["available", "image_not_cached", "image_integrity_failed"] as const);
  if (status === "available") {
    if (typeof value.dataUrl !== "string" || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value.dataUrl)
      || value.reason !== null) {
      throw new Stage15ScreeningPreviewError("preview_visual_binding_invalid");
    }
  } else if (value.dataUrl !== null || typeof value.reason !== "string" || value.reason.length === 0) {
    throw new Stage15ScreeningPreviewError("preview_visual_binding_invalid");
  }
  return { status, dataUrl: value.dataUrl, reason: value.reason };
}

export function buildStage15ScreeningPreview(input: Stage15ScreeningPreviewInput): Stage15ScreeningPreviewView {
  const run = asRecord(input.screeningRun);
  const acceptance = asRecord(input.acceptance);
  const generation = asRecord(input.generationSummary);
  const visual = asRecord(input.visualPacket);

  if (run.schemaVersion !== "novice-market-screening-run.v1"
    || acceptance.schemaVersion !== "novice-market-screening-acceptance.v1"
    || generation.schemaVersion !== "novice-market-screening-generation-summary.v1"
    || visual.schemaVersion !== "solo-novice-visual-blind-review-packet.v2") {
    schemaError();
  }

  const screeningHash = assertHash(run, "screeningHash");
  const acceptanceEvidenceHash = assertHash(acceptance, "evidenceHash");
  assertHash(generation, "evidenceHash");
  const visualPacketHash = assertHash(visual, "packetHash");

  if (acceptance.sourceScreeningHash !== screeningHash
    || generation.screeningHash !== screeningHash
    || generation.acceptanceEvidenceHash !== acceptanceEvidenceHash) {
    throw new Stage15ScreeningPreviewError("preview_hash_binding_invalid");
  }

  const engineering = asRecord(acceptance.engineering);
  const effectiveness = asRecord(acceptance.effectiveness);
  const engineeringConclusion = assertLiteral(engineering.conclusion, ["deterministic_scope_reduction_verified"] as const);
  const effectivenessConclusion = assertLiteral(
    effectiveness.conclusion,
    ["screening_effectiveness_not_validated"] as const,
  );
  if (engineering.status !== "passed"
    || effectiveness.status !== "not_validated"
    || generation.engineeringConclusion !== engineeringConclusion
    || generation.effectivenessConclusion !== effectivenessConclusion
    || generation.stage2FieldsConsumed !== false
    || generation.formalCandidateGenerated !== false
    || generation.productionDatabaseWritten !== false
    || run.formalCandidateGenerated !== false
    || run.productionDatabaseWritten !== false
    || run.externalAiApiCalled !== false) {
    schemaError();
  }

  const runItemsValue = run.items;
  const visualItemsValue = visual.items;
  if (!Array.isArray(runItemsValue) || !Array.isArray(visualItemsValue)) schemaError();
  const runItems = runItemsValue.map(asRecord);
  const visualItems = visualItemsValue.map(asRecord);
  const summary = parseSummary(run.summary);
  const generationCounts = parseSummary(generation.itemCounts);
  const expectedStatuses: Stage15ScreeningStatus[] = ["advance", "watch", "reject", "insufficient"];

  const actualSummary = runItems.reduce<Record<Stage15ScreeningStatus, number>>((counts, item) => {
    const status = assertLiteral(item.status, expectedStatuses);
    counts[status] += 1;
    return counts;
  }, { advance: 0, watch: 0, reject: 0, insufficient: 0 });
  const summaryTotal = Object.values(summary).reduce((total, count) => total + count, 0);
  if (runItems.length !== 20
    || summaryTotal !== runItems.length
    || expectedStatuses.some((status) => summary[status] !== actualSummary[status]
      || summary[status] !== generationCounts[status])) {
    throw new Stage15ScreeningPreviewError("preview_partition_invalid");
  }

  const runByBlindId = uniqueBy(runItems, (item) => {
    const rawHumanAnswer = asRecord(item.rawHumanAnswer);
    return asString(rawHumanAnswer.blindItemId);
  }, "preview_partition_invalid");
  uniqueBy(runItems, (item) => asString(item.productKey), "preview_partition_invalid");
  const visualByBlindId = uniqueBy(
    visualItems,
    (item) => asString(item.blindItemId),
    "preview_visual_binding_invalid",
  );
  const visualSummary = asRecord(visual.visualSummary);
  if (visualItems.length !== runItems.length
    || visualSummary.totalItemCount !== visualItems.length
    || visualByBlindId.size !== runByBlindId.size
    || [...runByBlindId.keys()].some((blindItemId) => !visualByBlindId.has(blindItemId))) {
    throw new Stage15ScreeningPreviewError("preview_visual_binding_invalid");
  }

  const items = runItems.map((runItem): Stage15ScreeningPreviewItem => {
    const rawHumanAnswer = asRecord(runItem.rawHumanAnswer);
    const blindItemId = asString(rawHumanAnswer.blindItemId);
    const productKey = asString(runItem.productKey);
    const visualItem = visualByBlindId.get(blindItemId);
    if (!visualItem) throw new Stage15ScreeningPreviewError("preview_visual_binding_invalid");
    if (asinFromProductKey(productKey) !== asinFromSourceUrl(asString(visualItem.sourceUrl))) {
      throw new Stage15ScreeningPreviewError("preview_product_identity_conflict");
    }
    const presentation = asRecord(visualItem.chinesePresentation);
    const evidence = asRecord(visualItem.evidence);
    const image = asRecord(visualItem.image);
    const localAsset = asRecord(image.localAsset);
    const declaredImageStatus = assertLiteral(localAsset.status, ["available", "not_cached"] as const);
    const projectedImage = parseImageInput(input.localImages[blindItemId]);
    if ((declaredImageStatus === "not_cached" && projectedImage.status !== "image_not_cached")
      || (declaredImageStatus === "available" && projectedImage.status === "image_not_cached")) {
      throw new Stage15ScreeningPreviewError("preview_visual_binding_invalid");
    }

    return {
      productKey,
      blindItemId,
      status: assertLiteral(runItem.status, expectedStatuses),
      stage1Rank: asNullableNumber(runItem.stage1Rank),
      stage1PromotionDecision: assertLiteral(
        runItem.stage1PromotionDecision,
        ["promoted", "rejected", "insufficient_evidence"] as const,
      ),
      title: asNullableString(visualItem.title),
      productTypeZh: asString(presentation.productTypeZh),
      primaryUseZh: asString(presentation.primaryUseZh),
      presentationSourceType: assertLiteral(presentation.sourceType, ["ai_generated"] as const),
      presentationStatus: assertLiteral(
        presentation.status,
        ["presentation_aid_not_source_fact"] as const,
      ),
      evidence: {
        price: asNullableNumber(evidence.price),
        rating: asNullableNumber(evidence.rating),
        reviewCount: asNullableNumber(evidence.reviewCount),
      },
      image: projectedImage,
      gates: {
        screeningEvidenceSufficient: asBoolean(runItem.screeningEvidenceSufficient),
        userUnderstandsProduct: asBoolean(runItem.userUnderstandsProduct),
        willingToContinueResearch: asBoolean(runItem.willingToContinueResearch),
      },
      rawHumanAnswer: {
        productUnderstood: assertLiteral(rawHumanAnswer.productUnderstood, ["yes", "no", "uncertain", "missing"] as const),
        evidenceSufficient: assertLiteral(rawHumanAnswer.evidenceSufficient, ["yes", "no", "uncertain", "missing"] as const),
        obviousConcern: assertLiteral(rawHumanAnswer.obviousConcern, ["yes", "no", "uncertain", "missing"] as const),
        investigateNext10Minutes: assertLiteral(
          rawHumanAnswer.investigateNext10Minutes,
          ["yes", "no", "uncertain", "missing"] as const,
        ),
        confidence: assertLiteral(rawHumanAnswer.confidence, ["high", "medium", "low", "missing"] as const),
        elapsedSeconds: asNullableNumber(rawHumanAnswer.elapsedSeconds),
        note: asNullableString(rawHumanAnswer.note),
      },
      reasons: {
        marketEvidence: asStringArray(runItem.marketEvidenceReasons),
        humanGate: asStringArray(runItem.humanGateReasons),
        supportingEvidence: asStringArray(runItem.supportingEvidence),
        counterEvidence: asStringArray(runItem.counterEvidence),
        missingEvidence: asStringArray(runItem.missingEvidence),
      },
      nextValidationPlan: asStringArray(runItem.nextValidationPlan),
      killCriteria: asStringArray(runItem.killCriteria),
    };
  });

  const runStatus = assertLiteral(run.status, ["completed", "insufficient_advance_pool"] as const);
  const advanceMeaning = assertLiteral(
    run.advanceMeaning,
    ["top_k_investigation_quota_not_quality_or_commercial_approval"] as const,
  );
  if (run.displayName !== "调查短名单预览" || run.selectionMechanism !== "deterministic_top_k_quota") schemaError();

  return {
    schemaVersion: "stage1-5-screening-preview-view.v1",
    proofLevel: "local_read_only_artifact_projection",
    sourceScreeningHash: screeningHash,
    sourceAcceptanceEvidenceHash: acceptanceEvidenceHash,
    sourceVisualPacketHash: visualPacketHash,
    displayName: "调查短名单预览",
    runStatus,
    engineeringConclusion,
    effectivenessConclusion,
    advanceMeaning,
    summary: { ...summary },
    items,
    readOnly: true,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
    externalNetworkRequired: false,
  };
}
