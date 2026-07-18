import { stableHash } from "../../lib/upstream/pipeline";

export type SourceNativeSourceKind =
  | "official_api_export"
  | "licensed_structured_dataset"
  | "public_source_native_site";

export type SourceNativeEffectivenessConclusion =
  | "screening_workflow_effectiveness_supported_on_batch_d"
  | "directional_workflow_signal_observed"
  | "screening_workflow_signal_not_observed"
  | "evaluation_inconclusive"
  | "blocked";

export type SourceNativeBatchReadiness =
  | { state: "blocked"; reasonCodes: string[]; evaluationAllowed: false }
  | { state: "upstream_only"; pendingStages: string[]; evaluationAllowed: false }
  | { state: "ready_for_screening_operator"; screeningOperatorSlots: 1; evaluationAllowed: true }
  | { state: "ready_for_outcome_assessment"; outcomeAssessorSlots: 2; evaluationAllowed: true }
  | { state: "outcome_assessment_in_progress"; completedOutcomeAssessors: 0 | 1; evaluationAllowed: true }
  | { state: "ready_for_analysis"; completedOutcomeAssessors: 2; evaluationAllowed: false }
  | { state: "analysis_complete"; conclusion: SourceNativeEffectivenessConclusion; evaluationAllowed: false };

export type SourceNativeStableIdentifier = {
  kind: "gtin" | "upc" | "ean" | "mpn" | "manufacturer_number";
  value: string;
};

export type SourceNativeSourceQualification = {
  schemaVersion: "stage15-source-native-qualification.v1";
  sourceId: string;
  sourceKind: SourceNativeSourceKind;
  sourceOrigin: string;
  loginRequired: false;
  robotsStatus: "allowed";
  licenseStatus: "verified" | "not_required";
  stableIdentifierKinds: SourceNativeStableIdentifier["kind"][];
  qualificationHash: string;
};

export type SourceNativeAccessPolicy = {
  allowedApiEndpoints: string[];
  allowedPagePathPrefixes: string[];
};

export type SourceNativeAccessBudget = {
  maxApiRequests: number;
  maxReviewPages: number;
  maxPaidAmountUsd: number;
};

export type SourceNativeAccessRequest = {
  schemaVersion: "stage15-source-native-access-request.v1";
  requestId: string;
  qualificationHash: string;
  requestedActions: Array<"api_request" | "page_open">;
  policy: SourceNativeAccessPolicy;
  budget: SourceNativeAccessBudget;
  requestHash: string;
};

export type SourceNativeAuthorization = {
  schemaVersion: "stage15-source-native-authorization.v1";
  requestHash: string;
  qualificationHash: string;
  approvedTextSha256: string;
  approvedActions: Array<"api_request" | "page_open">;
  approvedPolicy: SourceNativeAccessPolicy;
  approvedBudget: SourceNativeAccessBudget;
  maxAutomaticRetries: 0;
  approvedLedgerHeadHash: string | null;
  authorizationHash: string;
};

export type SourceNativeAccessLogEntry = {
  schemaVersion: "stage15-source-native-access-log-entry.v1";
  requestHash: string;
  kind: "api_request" | "page_open";
  sourceId: string;
  target: string;
  requestedAt: string;
  attempt: number;
  paidAmountUsd: number;
  previousLogHash: string | null;
  outcome: "success" | "login_wall" | "captcha" | "access_denied" | "robots_unknown" | "license_unknown" | "network_error";
  logHash: string;
};

export type SourceNativeReviewSignal = {
  sentiment: "positive" | "negative";
  rating: number;
  reviewedAt: string;
  signal: string;
  evidenceRef: string;
};

export type SourceNativeProductRecord = {
  schemaVersion: "stage15-source-native-product-record.v1";
  sourceId: string;
  sourceProductId: string;
  variantSignature: string;
  variantBinding: { status: "exact" | "mixed_variant" | "unverified" };
  stableIdentifiers: SourceNativeStableIdentifier[];
  title: string;
  brand: string;
  model: string;
  sourceUrl: string;
  imageUrls: string[];
  price: { amount: number; currency: string };
  aggregate: { rating: number; reviewCount: number };
  specifications: { dimensions: string; weight: string; materials: string[]; features: string[] };
  reviewSignals: SourceNativeReviewSignal[];
  rawCapture: { relativePath: string; fileSha256: string; capturedAt: string };
  captureSha256: string;
  recordHash: string;
};

export type SourceNativeSelectionBrief = {
  schemaVersion: "stage15-source-native-selection-brief.v1";
  qualificationHash: string;
  market: string;
  language: string;
  currency: string;
  category: string;
  targetUseCase: string;
  priceRange: { min: number; max: number };
  exclusions: { terms: string[]; categories: string[]; variants: string[]; compliance: string[] };
  sampling: { sortFields: string[]; dedupeKeys: string[]; seed: string };
  stage1RuleFileHash: string;
  stage15RuleFileHash: string;
  weightsHash: string;
  implementationVersion: string;
  imagePolicy: "external_https_only_no_download";
  requestedSampleSize: 20;
  selectionBriefHash: string;
};

export type SourceNativeSample = {
  productKey: string;
  sourceId: string;
  sourceProductId: string;
  variantSignature: string;
  recordHash: string;
  sampleHash: string;
};

export type SourceNativeEvaluationRole = "screening_operator" | "outcome_assessor_a" | "outcome_assessor_b";

export type SourceNativeScreeningOperatorResult = {
  role: "screening_operator";
  sampleHash: string;
  completedAt: string;
  resultHash: string;
};

export type SourceNativeOutcomeAssessorResult = {
  role: "outcome_assessor_a" | "outcome_assessor_b";
  sampleHash: string;
  completedAt: string;
  resultHash: string;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const AMAZON_SOURCE_NAMESPACE = /^amazon(?:$|[-_:])/iu;
const AMAZON_US_COMPONENT = /amazon:US/iu;
const SOURCE_KINDS = new Set<SourceNativeSourceKind>([
  "official_api_export",
  "licensed_structured_dataset",
  "public_source_native_site",
]);
const STABLE_IDENTIFIER_KINDS = new Set<SourceNativeStableIdentifier["kind"]>([
  "gtin", "upc", "ean", "mpn", "manufacturer_number",
]);
const FORBIDDEN_RECORD_PRIVACY_FIELDS = new Set([
  "reviewername", "email", "ip", "ipaddress", "devicefingerprint", "orderid", "fullreviewbody", "avatar", "location", "reviewerid",
]);
const AUTHORIZATION_KEYS = new Set([
  "schemaVersion", "requestHash", "qualificationHash", "approvedTextSha256", "approvedActions", "approvedPolicy",
  "approvedBudget", "maxAutomaticRetries", "approvedLedgerHeadHash", "authorizationHash",
]);

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isHttpsUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function hasForbiddenRecordPrivacyField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_RECORD_PRIVACY_FIELDS.has(normalizeFieldName(key)) || hasForbiddenRecordPrivacyField(child));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSelfHashed(value: unknown, hashField: string): value is Record<string, unknown> {
  if (!isRecord(value) || !HASH_PATTERN.test(String(value[hashField]))) return false;
  const { [hashField]: _selfHash, ...body } = value;
  return stableHash(body) === value[hashField];
}

function invalid(code: string): never {
  throw new Error(code);
}

function isArrayOfNonEmptyText(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText);
}

function isAccessPolicy(value: unknown): value is SourceNativeAccessPolicy {
  return isRecord(value)
    && isArrayOfNonEmptyText(value.allowedApiEndpoints)
    && isArrayOfNonEmptyText(value.allowedPagePathPrefixes)
    && value.allowedApiEndpoints.every((endpoint) => endpoint.startsWith("/") && !endpoint.startsWith("//"))
    && value.allowedPagePathPrefixes.every((prefix) => prefix.startsWith("/") && !prefix.startsWith("//"));
}

function isAccessBudget(value: unknown): value is SourceNativeAccessBudget {
  return isRecord(value)
    && [value.maxApiRequests, value.maxReviewPages, value.maxPaidAmountUsd]
      .every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
    && Number.isInteger(value.maxApiRequests) && Number.isInteger(value.maxReviewPages);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

export function assertSourceNativeQualificationIntegrity(qualification: unknown): void {
  const code = "SOURCE_NATIVE_QUALIFICATION_INVALID";
  if (!isSelfHashed(qualification, "qualificationHash")) invalid(code);
  let origin: URL;
  try {
    origin = new URL(String(qualification.sourceOrigin));
  } catch {
    invalid(code);
  }
  const identifierKinds = qualification.stableIdentifierKinds;
  if (qualification.schemaVersion !== "stage15-source-native-qualification.v1"
    || !isNonEmptyText(qualification.sourceId) || !SOURCE_KINDS.has(qualification.sourceKind as SourceNativeSourceKind)
    || origin.protocol !== "https:" || origin.username || origin.password || qualification.sourceOrigin !== origin.origin
    || qualification.loginRequired !== false || qualification.robotsStatus !== "allowed"
    || !["verified", "not_required"].includes(qualification.licenseStatus as string)
    || !Array.isArray(identifierKinds) || identifierKinds.length === 0
    || new Set(identifierKinds).size !== identifierKinds.length
    || identifierKinds.some((kind) => !STABLE_IDENTIFIER_KINDS.has(kind as SourceNativeStableIdentifier["kind"]))) {
    invalid(code);
  }
}

export function assertSourceNativeAccessRequestIntegrity(request: unknown): void {
  const code = "SOURCE_NATIVE_ACCESS_REQUEST_INVALID";
  if (!isSelfHashed(request, "requestHash")
    || request.schemaVersion !== "stage15-source-native-access-request.v1"
    || !isNonEmptyText(request.requestId) || !HASH_PATTERN.test(String(request.qualificationHash))
    || !Array.isArray(request.requestedActions) || request.requestedActions.length === 0
    || new Set(request.requestedActions).size !== request.requestedActions.length
    || request.requestedActions.some((action) => action !== "api_request" && action !== "page_open")
    || !isAccessPolicy(request.policy) || !isAccessBudget(request.budget)) invalid(code);
}

export function assertSourceNativeAuthorizationIntegrity(authorization: unknown): void {
  const code = "SOURCE_NATIVE_AUTHORIZATION_INVALID";
  if (!isSelfHashed(authorization, "authorizationHash")
    || authorization.schemaVersion !== "stage15-source-native-authorization.v1"
    || ![authorization.requestHash, authorization.qualificationHash, authorization.approvedTextSha256]
      .every((value) => HASH_PATTERN.test(String(value)))
    || !Array.isArray(authorization.approvedActions) || authorization.approvedActions.length === 0
    || new Set(authorization.approvedActions).size !== authorization.approvedActions.length
    || authorization.approvedActions.some((action) => action !== "api_request" && action !== "page_open")
    || !isAccessPolicy(authorization.approvedPolicy) || !isAccessBudget(authorization.approvedBudget)
    || authorization.maxAutomaticRetries !== 0
    || (authorization.approvedLedgerHeadHash !== null && !HASH_PATTERN.test(String(authorization.approvedLedgerHeadHash)))
    || !hasExactKeys(authorization, AUTHORIZATION_KEYS)) invalid(code);
}

export function assertSourceNativeAccessLogEntryIntegrity(accessLog: unknown): void {
  const code = "SOURCE_NATIVE_ACCESS_LOG_ENTRY_INVALID";
  if (!isSelfHashed(accessLog, "logHash")
    || accessLog.schemaVersion !== "stage15-source-native-access-log-entry.v1"
    || !HASH_PATTERN.test(String(accessLog.requestHash)) || !isNonEmptyText(accessLog.sourceId)
    || (accessLog.kind !== "api_request" && accessLog.kind !== "page_open") || !isValidDate(accessLog.requestedAt)
    || !isNonEmptyText(accessLog.target) || !Number.isInteger(accessLog.attempt) || Number(accessLog.attempt) < 1
    || typeof accessLog.paidAmountUsd !== "number" || !Number.isFinite(accessLog.paidAmountUsd) || accessLog.paidAmountUsd < 0
    || (accessLog.previousLogHash !== null && !HASH_PATTERN.test(String(accessLog.previousLogHash)))
    || !["success", "login_wall", "captcha", "access_denied", "robots_unknown", "license_unknown", "network_error"].includes(accessLog.outcome as string)) invalid(code);
}

export function assertSourceNativeSelectionBriefIntegrity(selectionBrief: unknown): void {
  const code = "SOURCE_NATIVE_SELECTION_BRIEF_INVALID";
  if (!isSelfHashed(selectionBrief, "selectionBriefHash")
    || selectionBrief.schemaVersion !== "stage15-source-native-selection-brief.v1"
    || !HASH_PATTERN.test(String(selectionBrief.qualificationHash)) || selectionBrief.requestedSampleSize !== 20
    || ![selectionBrief.market, selectionBrief.language, selectionBrief.currency, selectionBrief.category,
      selectionBrief.targetUseCase, selectionBrief.implementationVersion].every(isNonEmptyText)
    || !isRecord(selectionBrief.priceRange) || !Number.isFinite(selectionBrief.priceRange.min)
    || !Number.isFinite(selectionBrief.priceRange.max) || Number(selectionBrief.priceRange.min) > Number(selectionBrief.priceRange.max)
    || !isRecord(selectionBrief.exclusions) || ![selectionBrief.exclusions.terms, selectionBrief.exclusions.categories,
      selectionBrief.exclusions.variants, selectionBrief.exclusions.compliance].every((value) => Array.isArray(value) && value.every(isNonEmptyText))
    || !isRecord(selectionBrief.sampling) || stableHash(selectionBrief.sampling.sortFields) !== stableHash(["sourceProductId"])
    || stableHash(selectionBrief.sampling.dedupeKeys) !== stableHash(["sourceProductId", "variantSignature"])
    || !isNonEmptyText(selectionBrief.sampling.seed)
    || ![selectionBrief.stage1RuleFileHash, selectionBrief.stage15RuleFileHash, selectionBrief.weightsHash].every((value) => HASH_PATTERN.test(String(value)))
    || selectionBrief.imagePolicy !== "external_https_only_no_download") invalid(code);
}

export function assertSourceNativeSampleIntegrity(sample: unknown): void {
  const code = "SOURCE_NATIVE_SAMPLE_INVALID";
  const sourceId = String(sample && typeof sample === "object" ? (sample as Record<string, unknown>).sourceId : "");
  const sourceProductId = String(sample && typeof sample === "object" ? (sample as Record<string, unknown>).sourceProductId : "");
  const variantSignature = String(sample && typeof sample === "object" ? (sample as Record<string, unknown>).variantSignature : "");
  if (!isSelfHashed(sample, "sampleHash")
    || ![sample.productKey, sample.sourceId, sample.sourceProductId, sample.variantSignature].every(isNonEmptyText)
    || !HASH_PATTERN.test(String(sample.recordHash))
    || sourceId.includes(":") || sourceProductId.includes(":")
    || AMAZON_SOURCE_NAMESPACE.test(sourceId) || AMAZON_US_COMPONENT.test(sourceProductId)
    || /^B0[A-Z0-9]{8}$/u.test(sourceProductId)
    || sample.productKey !== `source:${sourceId}:${sourceProductId}:${stableHash(variantSignature).slice(0, 16)}`) invalid(code);
}

function assertEvaluationResultIntegrity(result: unknown, roles: string[], code: string): void {
  if (!isSelfHashed(result, "resultHash") || !roles.includes(String(result.role))
    || !HASH_PATTERN.test(String(result.sampleHash)) || !isValidDate(result.completedAt)) invalid(code);
}

export function assertSourceNativeScreeningOperatorResultIntegrity(result: unknown): void {
  assertEvaluationResultIntegrity(result, ["screening_operator"], "SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
}

export function assertSourceNativeOutcomeAssessorResultIntegrity(result: unknown): void {
  assertEvaluationResultIntegrity(result, ["outcome_assessor_a", "outcome_assessor_b"], "SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID");
}

export function assertSourceNativeProductRecordIntegrity(record: unknown): void {
  const code = "SOURCE_NATIVE_PRODUCT_RECORD_INVALID";
  if (!isRecord(record) || !Array.isArray(record.reviewSignals)) invalid(code);
  if (hasForbiddenRecordPrivacyField(record)) throw new Error("SOURCE_NATIVE_REVIEW_PRIVACY_FIELD_FORBIDDEN");
  const variantBinding = record.variantBinding;
  const stableIdentifiers = record.stableIdentifiers;
  const price = record.price;
  const aggregate = record.aggregate;
  const specifications = record.specifications;
  const rawCapture = record.rawCapture;
  const reviewSignals = record.reviewSignals;
  const hasBothSentiments = new Set(reviewSignals.filter(isRecord).map((review) => review.sentiment));
  if (!isSelfHashed(record, "recordHash") || record.schemaVersion !== "stage15-source-native-product-record.v1"
    || ![record.sourceId, record.sourceProductId, record.variantSignature, record.title, record.brand, record.model].every(isNonEmptyText)
    || !isRecord(variantBinding) || variantBinding.status !== "exact"
    || !Array.isArray(stableIdentifiers) || stableIdentifiers.length === 0 || stableIdentifiers.some((identifier) => !isRecord(identifier)
      || !STABLE_IDENTIFIER_KINDS.has(identifier.kind as SourceNativeStableIdentifier["kind"]) || !isNonEmptyText(identifier.value))
    || !isHttpsUrl(record.sourceUrl) || !isArrayOfNonEmptyText(record.imageUrls) || record.imageUrls.some((url) => !isHttpsUrl(url))
    || !isRecord(price) || !Number.isFinite(price.amount) || !isNonEmptyText(price.currency)
    || !isRecord(aggregate) || !Number.isFinite(aggregate.rating) || !Number.isInteger(aggregate.reviewCount) || Number(aggregate.reviewCount) < 0
    || !isRecord(specifications) || ![specifications.dimensions, specifications.weight].every(isNonEmptyText)
    || !isArrayOfNonEmptyText(specifications.materials) || !isArrayOfNonEmptyText(specifications.features)
    || !hasBothSentiments.has("positive") || !hasBothSentiments.has("negative")
    || reviewSignals.some((review) => !isRecord(review) || !Number.isFinite(review.rating) || !isValidDate(review.reviewedAt)
      || typeof review.signal !== "string" || review.signal.length < 1 || review.signal.length > 160 || !isNonEmptyText(review.evidenceRef))
    || !isRecord(rawCapture) || !isNonEmptyText(rawCapture.relativePath) || !HASH_PATTERN.test(String(rawCapture.fileSha256))
    || !isValidDate(rawCapture.capturedAt) || !HASH_PATTERN.test(String(record.captureSha256))) invalid(code);
}

export function assertSourceNativeProductRecordSetIntegrity(records: unknown): void {
  const code = "SOURCE_NATIVE_PRODUCT_RECORD_INVALID";
  if (!Array.isArray(records)) invalid(code);
  records.forEach(assertSourceNativeProductRecordIntegrity);
  const identities = records.map((record) => {
    if (!isRecord(record)) invalid(code);
    return `${record.sourceId}\u0000${record.sourceProductId}\u0000${record.variantSignature}`;
  });
  if (new Set(identities).size !== identities.length) invalid(code);
}
