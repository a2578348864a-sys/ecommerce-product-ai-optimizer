import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2EvidenceGapInventory, Stage2EvidenceFieldName } from "./stage2-evidence-intake";
import type { Stage2SourcePacket } from "./stage2-advancement";

const REQUESTED_FIELDS = [
  "supplierUrl",
  "supplierCapturedAt",
  "moq",
  "bom",
  "packageLengthCm",
  "packageWidthCm",
  "packageHeightCm",
  "packageWeightKg",
] as const satisfies readonly Stage2EvidenceFieldName[];

const STOP_CONDITIONS = [
  "captcha_or_robot_check",
  "login_wall",
  "access_denied_or_service_unavailable",
  "unexpected_origin_redirect",
  "unknown_page_state",
  "variant_identity_cannot_be_confirmed",
  "requested_navigation_budget_exhausted",
] as const;

export type Stage2EvidenceCollectionBrief = {
  schemaVersion: "stage2-evidence-collection-brief.v1";
  briefId: string;
  status: "pending_user_authorization";
  createdAt: string;
  sourceGapInventoryHash: string;
  sourceStage2PacketHash: string;
  sample: {
    sampleId: string;
    candidateId: string;
    productKey: string;
    amazonObservedTitle: string | null;
    amazonSourceUrl: string | null;
    amazonCapturedAt: string;
    evaluationVariantStatus: "requires_same_variant_confirmation";
  };
  decisionPurpose: "validate_supplier_identity_variant_and_procurement_inputs";
  requestedEvidenceFields: typeof REQUESTED_FIELDS[number][];
  requestedScope: {
    requestedOrigin: "https://www.alibaba.com";
    maxTotalNavigations: 4;
    maxSearchResultPages: 1;
    maxSupplierProductPages: 3;
    maxSamples: 1;
    automaticRetryCount: 0;
  };
  authorization: {
    status: "not_granted";
    allowedOrigins: [];
    authorizedAt: null;
    authorizedBy: null;
  };
  missingValuePolicy: {
    keepNullWithReason: true;
    noEstimationFromAmazonSignals: true;
    noCurrencyConversionToFillMissingCost: true;
  };
  stopConditions: typeof STOP_CONDITIONS[number][];
  boundary: {
    noLogin: true;
    noCookieOrPrivateProfile: true;
    noCaptchaBypass: true;
    noProxyOrAntiDetection: true;
    noPaidApi: true;
    noExternalAi: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage1Rewrite: true;
    thisBriefIsNotAuthorization: true;
  };
  expectedOutput: {
    schemaVersion: "stage2-evidence-submission.v1";
    evidenceMode: "real_evidence";
    humanDecisionExcluded: true;
  };
  briefHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateSources(inventory: Stage2EvidenceGapInventory, packet: Stage2SourcePacket) {
  const { packetHash: inventoryHash, ...inventoryBody } = inventory;
  const { packetHash: stage2Hash, ...stage2Body } = packet;
  if (stableHash(inventoryBody) !== inventoryHash
    || stableHash(stage2Body) !== stage2Hash
    || inventory.schemaVersion !== "solo-stage2-evidence-gap-inventory.v1"
    || packet.schemaVersion !== "solo-stage2-objective-calibration-packet.v1") {
    throw new Error("STAGE2_COLLECTION_SOURCE_INVALID");
  }
}

export function buildStage2EvidenceCollectionBrief(input: {
  inventory: Stage2EvidenceGapInventory;
  stage2Packet: Stage2SourcePacket;
  sampleId: string;
  createdAt: string;
}): Stage2EvidenceCollectionBrief {
  validateSources(input.inventory, input.stage2Packet);
  if (!validIso(input.createdAt)) throw new Error("STAGE2_COLLECTION_CREATED_AT_INVALID");
  const gapSample = input.inventory.samples.find((sample) => sample.sampleId === input.sampleId);
  const sourceSample = input.stage2Packet.samples.find((sample) => sample.sampleId === input.sampleId);
  if (!gapSample || !sourceSample) throw new Error("STAGE2_COLLECTION_SAMPLE_NOT_FOUND");
  if (gapSample.productKey !== sourceSample.productKey) throw new Error("STAGE2_COLLECTION_SOURCE_INVALID");
  const requiredGapFields = new Set(gapSample.evidenceGaps.map((gap) => gap.field));
  if (REQUESTED_FIELDS.some((field) => !requiredGapFields.has(field))) {
    throw new Error("STAGE2_COLLECTION_SOURCE_INVALID");
  }

  const body = {
    schemaVersion: "stage2-evidence-collection-brief.v1" as const,
    briefId: `stage2-collection-${stableHash({ sampleId: input.sampleId, inventoryHash: input.inventory.packetHash }).slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    sourceGapInventoryHash: input.inventory.packetHash,
    sourceStage2PacketHash: input.stage2Packet.packetHash,
    sample: {
      sampleId: sourceSample.sampleId,
      candidateId: sourceSample.candidateId,
      productKey: sourceSample.productKey,
      amazonObservedTitle: sourceSample.sourceEvidence.title,
      amazonSourceUrl: sourceSample.sourceEvidence.sourceUrl,
      amazonCapturedAt: sourceSample.sourceEvidence.capturedAt,
      evaluationVariantStatus: "requires_same_variant_confirmation" as const,
    },
    decisionPurpose: "validate_supplier_identity_variant_and_procurement_inputs" as const,
    requestedEvidenceFields: [...REQUESTED_FIELDS],
    requestedScope: {
      requestedOrigin: "https://www.alibaba.com" as const,
      maxTotalNavigations: 4 as const,
      maxSearchResultPages: 1 as const,
      maxSupplierProductPages: 3 as const,
      maxSamples: 1 as const,
      automaticRetryCount: 0 as const,
    },
    authorization: {
      status: "not_granted" as const,
      allowedOrigins: [] as [],
      authorizedAt: null,
      authorizedBy: null,
    },
    missingValuePolicy: {
      keepNullWithReason: true as const,
      noEstimationFromAmazonSignals: true as const,
      noCurrencyConversionToFillMissingCost: true as const,
    },
    stopConditions: [...STOP_CONDITIONS],
    boundary: {
      noLogin: true as const,
      noCookieOrPrivateProfile: true as const,
      noCaptchaBypass: true as const,
      noProxyOrAntiDetection: true as const,
      noPaidApi: true as const,
      noExternalAi: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage1Rewrite: true as const,
      thisBriefIsNotAuthorization: true as const,
    },
    expectedOutput: {
      schemaVersion: "stage2-evidence-submission.v1" as const,
      evidenceMode: "real_evidence" as const,
      humanDecisionExcluded: true as const,
    },
  };
  return { ...body, briefHash: stableHash(body) };
}

export function validateStage2EvidenceCollectionBrief(brief: Stage2EvidenceCollectionBrief) {
  const reasonCodes: string[] = [];
  const { briefHash, ...body } = brief;
  if (stableHash(body) !== briefHash) reasonCodes.push("brief_hash_mismatch");
  if (brief.schemaVersion !== "stage2-evidence-collection-brief.v1") reasonCodes.push("schema_version_invalid");
  if (brief.status !== "pending_user_authorization"
    || brief.authorization.status !== "not_granted"
    || brief.authorization.allowedOrigins.length !== 0) reasonCodes.push("authorization_state_invalid");
  if (!validIso(brief.createdAt)) reasonCodes.push("created_at_invalid");
  if (brief.requestedEvidenceFields.length !== REQUESTED_FIELDS.length
    || brief.requestedEvidenceFields.some((field, index) => field !== REQUESTED_FIELDS[index])) {
    reasonCodes.push("requested_evidence_fields_invalid");
  }
  if (brief.requestedScope.requestedOrigin !== "https://www.alibaba.com") reasonCodes.push("requested_origin_invalid");
  if (brief.requestedScope.maxTotalNavigations !== 4
    || brief.requestedScope.maxSearchResultPages !== 1
    || brief.requestedScope.maxSupplierProductPages !== 3
    || brief.requestedScope.maxSamples !== 1
    || brief.requestedScope.automaticRetryCount !== 0) reasonCodes.push("navigation_scope_invalid");
  if (brief.boundary.thisBriefIsNotAuthorization !== true
    || brief.boundary.noLogin !== true
    || brief.boundary.noCaptchaBypass !== true
    || brief.boundary.noPaidApi !== true
    || brief.boundary.noDatabaseWrite !== true
    || brief.boundary.noCandidateCreation !== true) reasonCodes.push("boundary_invalid");
  return {
    schemaVersion: "stage2-evidence-collection-brief-validation.v1" as const,
    status: reasonCodes.includes("brief_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_pending_authorization" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash, reasonCodes }),
  };
}
