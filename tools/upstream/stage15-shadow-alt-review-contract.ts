import { createHash } from "node:crypto";
import { stableHash } from "../../lib/upstream/pipeline";

export const ALT_REVIEW_BATCH_ID = "stage15-shadow-calibration-c-20260717-01";
export const ALT_REVIEW_SAMPLE_SALT = "stage15-shadow-calibration-c-20260717-01:alt-review-public-probe-v1:";
export const ALT_REVIEW_SAMPLE_SIZE = 3;

export type AltReviewProductOutcome =
  | "probe_product_eligible"
  | "source_not_found"
  | "blocked_identity_conflict"
  | "mixed_variant_missing"
  | "stopped_source_access_condition"
  | "review_evidence_incomplete";

export type AltReviewBatchStatus =
  | "pending_user_access_approval"
  | "probe_source_registry_only"
  | "blocked_upstream_hash_conflict"
  | "probe_in_progress"
  | "probe_insufficient"
  | "probe_passed_pending_full_budget";

export type AltReviewSourceKind = "public_retailer" | "brand_storefront" | "public_review_page";

export type AltReviewRegistryEntry = {
  sourceId: string;
  sourceKind: AltReviewSourceKind;
  origin: string;
  allowedPathPrefixes: string[];
  publicBuyerReviewsRequired: true;
  loginRequired: false;
};

export type Stage15ShadowAltReviewProbeBrief = {
  schemaVersion: "stage15-shadow-alt-review-probe-brief.v1";
  batchId: string;
  role: "calibration";
  sourceManifest: { manifestId: string; manifestHash: string; fileSha256: string };
  sampleAlgorithm: {
    version: "raw-utf8-sha256-v1";
    salt: typeof ALT_REVIEW_SAMPLE_SALT;
    sampleSize: 3;
  };
  samples: Array<{ productKey: string; selectionHash: string }>;
  threshold: {
    eligibleProducts: 2;
    totalProducts: 3;
    minimumReviewsPerProduct: 2;
    positiveRequired: true;
    negativeRequired: true;
  };
  boundary: {
    decisionImpact: false;
    humanEvaluationAllowed: false;
    batchVUnlocked: false;
    databaseWritten: false;
    productionEffect: false;
  };
  createdAt: string;
  briefHash: string;
};

export type Stage15ShadowAltReviewSourceRegistry = {
  schemaVersion: "stage15-shadow-alt-review-source-registry.v1";
  batchId: string;
  briefHash: string;
  status: "frozen";
  entries: AltReviewRegistryEntry[];
  createdAt: string;
  registryHash: string;
};

export type Stage15ShadowAltReviewAccessRequest = {
  schemaVersion: "stage15-shadow-alt-review-access-request.v1";
  batchId: string;
  briefHash: string;
  registryHash: string;
  sourceManifestHash: string;
  sourceManifestFileSha256: string;
  queries: Array<{ productKey: string; query: string }>;
  budget: {
    maxSearchQueries: 3;
    maxPageOpens: 6;
    maxPagesPerProduct: 2;
    maxOpensPerUrl: 1;
    maxAutomaticRetries: 0;
  };
  forbiddenActions: readonly string[];
  authorizationStatus: "pending_user_approval";
  executionAllowed: false;
  createdAt: string;
  requestHash: string;
};

export type Stage15ShadowAltReviewAuthorization = {
  schemaVersion: "stage15-shadow-alt-review-access-authorization.v1";
  batchId: string;
  requestHash: string;
  registryHash: string;
  approvedBudget: Stage15ShadowAltReviewAccessRequest["budget"];
  status: "approved";
  approvedAt: string;
  approvalTextHash: string;
  authorizationHash: string;
};

export type AltReviewSearchLogEntry = {
  kind: "search_query";
  productKey: string;
  query: string;
  attempt: 1;
  outcome: "success" | "source_not_found" | "network_error";
  requestedAt: string;
};

export type AltReviewPageLogEntry = {
  kind: "page_open";
  productKey: string;
  sourceId: string;
  url: string;
  attempt: 1;
  outcome: "success" | "login_wall" | "captcha" | "access_denied" | "identity_unverified" | "network_error";
  requestedAt: string;
};

export type AltReviewAccessLogEntry = AltReviewSearchLogEntry | AltReviewPageLogEntry;

export type AltReviewStableIdentifier = {
  kind: "gtin" | "upc" | "ean" | "mpn" | "manufacturer_number";
  value: string;
};

export type AltReviewCapture = {
  schemaVersion: "stage15-shadow-alt-review-capture.v1";
  productKey: string;
  sourceId: string;
  sourceUrl: string;
  sourceCapture: { relativePath: string; fileSha256: string; capturedAt: string };
  identityBinding: {
    status: "exact" | "conflict" | "mixed_variant" | "unverified";
    brand: string;
    model: string;
    stableIdentifiers: AltReviewStableIdentifier[];
    variantSignature: Array<{ dimension: string; value: string }>;
    evidenceRefs: string[];
  };
  aggregate: { rating: number | null; reviewCount: number | null };
  reviews: Array<{
    sentiment: "positive" | "negative";
    rating: number;
    reviewedAt: string;
    theme: string;
    evidenceRefs: string[];
  }>;
  privacy: { personalDataStored: false };
  captureHash: string;
};

export type BuildAltReviewRegistryInput = Omit<
  Stage15ShadowAltReviewSourceRegistry,
  "schemaVersion" | "status" | "registryHash"
>;

export type BuildAltReviewEvidenceInput = {
  brief: Stage15ShadowAltReviewProbeBrief;
  registry: Stage15ShadowAltReviewSourceRegistry;
  request: Stage15ShadowAltReviewAccessRequest;
  authorization: Stage15ShadowAltReviewAuthorization;
  accessLog: AltReviewAccessLogEntry[];
  captures: AltReviewCapture[];
  createdAt: string;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_KINDS = new Set<AltReviewSourceKind>(["public_retailer", "brand_storefront", "public_review_page"]);

const budget: Stage15ShadowAltReviewAccessRequest["budget"] = {
  maxSearchQueries: 3,
  maxPageOpens: 6,
  maxPagesPerProduct: 2,
  maxOpensPerUrl: 1,
  maxAutomaticRetries: 0,
};

const forbiddenActions = [
  "amazon_detail_or_review_access",
  "login",
  "captcha_handling",
  "proxy_rotation",
  "anti_detection",
  "mirror_or_cache_bypass",
  "image_download",
  "ai_or_paid_api",
  "database_write",
] as const;

function rawUtf8Sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validDate(value: string): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function requireHash(value: string, code: string): void {
  if (!HASH_PATTERN.test(value)) throw new Error(code);
}

function briefBody(brief: Stage15ShadowAltReviewProbeBrief) {
  const { briefHash: _briefHash, ...body } = brief;
  return body;
}

function registryBody(registry: Stage15ShadowAltReviewSourceRegistry) {
  const { registryHash: _registryHash, ...body } = registry;
  return body;
}

function requestBody(request: Stage15ShadowAltReviewAccessRequest) {
  const { requestHash: _requestHash, ...body } = request;
  return body;
}

function authorizationBody(authorization: Stage15ShadowAltReviewAuthorization) {
  const { authorizationHash: _authorizationHash, ...body } = authorization;
  return body;
}

export function assertStage15ShadowAltReviewBriefIntegrity(brief: Stage15ShadowAltReviewProbeBrief): void {
  if (brief.schemaVersion !== "stage15-shadow-alt-review-probe-brief.v1"
    || brief.batchId !== ALT_REVIEW_BATCH_ID || brief.role !== "calibration"
    || !validDate(brief.createdAt) || stableHash(briefBody(brief)) !== brief.briefHash) {
    throw new Error("SHADOW_ALT_REVIEW_BRIEF_DRIFT");
  }
}

export function assertStage15ShadowAltReviewRegistryIntegrity(
  registry: Stage15ShadowAltReviewSourceRegistry,
): void {
  if (registry.schemaVersion !== "stage15-shadow-alt-review-source-registry.v1"
    || registry.batchId !== ALT_REVIEW_BATCH_ID || registry.status !== "frozen"
    || !validDate(registry.createdAt) || stableHash(registryBody(registry)) !== registry.registryHash) {
    throw new Error("SHADOW_ALT_REVIEW_REGISTRY_DRIFT");
  }
}

export function assertStage15ShadowAltReviewRequestIntegrity(request: Stage15ShadowAltReviewAccessRequest): void {
  if (request.schemaVersion !== "stage15-shadow-alt-review-access-request.v1"
    || request.batchId !== ALT_REVIEW_BATCH_ID || request.authorizationStatus !== "pending_user_approval"
    || request.executionAllowed !== false || !validDate(request.createdAt)
    || stableHash(requestBody(request)) !== request.requestHash) {
    throw new Error("SHADOW_ALT_REVIEW_REQUEST_DRIFT");
  }
}

export function assertStage15ShadowAltReviewAuthorizationIntegrity(
  authorization: Stage15ShadowAltReviewAuthorization,
): void {
  if (authorization.schemaVersion !== "stage15-shadow-alt-review-access-authorization.v1"
    || authorization.batchId !== ALT_REVIEW_BATCH_ID || authorization.status !== "approved"
    || !validDate(authorization.approvedAt)
    || stableHash(authorizationBody(authorization)) !== authorization.authorizationHash) {
    throw new Error("SHADOW_ALT_REVIEW_AUTHORIZATION_DRIFT");
  }
}

export function selectStage15ShadowAltReviewSamples(productKeys: string[]) {
  if (productKeys.length !== 20 || new Set(productKeys).size !== 20
    || productKeys.some((key) => !/^amazon:US:B0[A-Z0-9]{8}$/u.test(key))) {
    throw new Error("SHADOW_ALT_REVIEW_BATCH_INVALID");
  }
  return productKeys.map((productKey) => ({
    productKey,
    selectionHash: rawUtf8Sha256(`${ALT_REVIEW_SAMPLE_SALT}${productKey}`),
  })).sort((left, right) => left.selectionHash.localeCompare(right.selectionHash)).slice(0, ALT_REVIEW_SAMPLE_SIZE);
}

export function buildStage15ShadowAltReviewProbeBrief(input: {
  batchId: string;
  role: "calibration";
  sourceManifest: Stage15ShadowAltReviewProbeBrief["sourceManifest"];
  productKeys: string[];
  createdAt: string;
}): Stage15ShadowAltReviewProbeBrief {
  if (input.batchId !== ALT_REVIEW_BATCH_ID || input.role !== "calibration" || !validDate(input.createdAt)
    || !input.sourceManifest.manifestId || input.sourceManifest.manifestId !== input.sourceManifest.manifestId.trim()) {
    throw new Error("SHADOW_ALT_REVIEW_BRIEF_INVALID");
  }
  requireHash(input.sourceManifest.manifestHash, "SHADOW_ALT_REVIEW_BRIEF_INVALID");
  requireHash(input.sourceManifest.fileSha256, "SHADOW_ALT_REVIEW_BRIEF_INVALID");
  const body: Omit<Stage15ShadowAltReviewProbeBrief, "briefHash"> = {
    schemaVersion: "stage15-shadow-alt-review-probe-brief.v1" as const,
    batchId: input.batchId,
    role: input.role,
    sourceManifest: { ...input.sourceManifest },
    sampleAlgorithm: {
      version: "raw-utf8-sha256-v1" as const,
      salt: ALT_REVIEW_SAMPLE_SALT,
      sampleSize: 3 as const,
    },
    samples: selectStage15ShadowAltReviewSamples(input.productKeys),
    threshold: {
      eligibleProducts: 2 as const,
      totalProducts: 3 as const,
      minimumReviewsPerProduct: 2 as const,
      positiveRequired: true as const,
      negativeRequired: true as const,
    },
    boundary: {
      decisionImpact: false as const,
      humanEvaluationAllowed: false as const,
      batchVUnlocked: false as const,
      databaseWritten: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  return { ...body, briefHash: stableHash(body) };
}

function validateRegistryEntry(entry: AltReviewRegistryEntry): void {
  let origin: URL;
  try {
    origin = new URL(entry.origin);
  } catch {
    throw new Error("SHADOW_ALT_REVIEW_REGISTRY_INVALID");
  }
  if (!entry.sourceId || entry.sourceId !== entry.sourceId.trim() || !SOURCE_KINDS.has(entry.sourceKind)
    || entry.loginRequired !== false || entry.publicBuyerReviewsRequired !== true
    || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash || /(^|\.)amazon\./iu.test(origin.hostname)
    || entry.allowedPathPrefixes.length === 0
    || new Set(entry.allowedPathPrefixes).size !== entry.allowedPathPrefixes.length
    || entry.allowedPathPrefixes.some((prefix) => !prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#"))) {
    throw new Error("SHADOW_ALT_REVIEW_REGISTRY_INVALID");
  }
}

export function buildStage15ShadowAltReviewSourceRegistry(
  input: BuildAltReviewRegistryInput,
): Stage15ShadowAltReviewSourceRegistry {
  if (input.batchId !== ALT_REVIEW_BATCH_ID || !validDate(input.createdAt)
    || input.entries.length < 1 || input.entries.length > 2) {
    throw new Error("SHADOW_ALT_REVIEW_REGISTRY_INVALID");
  }
  requireHash(input.briefHash, "SHADOW_ALT_REVIEW_REGISTRY_INVALID");
  input.entries.forEach(validateRegistryEntry);
  const sourceIds = input.entries.map((entry) => entry.sourceId);
  const origins = input.entries.map((entry) => new URL(entry.origin).origin);
  if (new Set(sourceIds).size !== sourceIds.length || new Set(origins).size !== origins.length) {
    throw new Error("SHADOW_ALT_REVIEW_REGISTRY_INVALID");
  }
  const body = {
    schemaVersion: "stage15-shadow-alt-review-source-registry.v1" as const,
    batchId: input.batchId,
    briefHash: input.briefHash,
    status: "frozen" as const,
    entries: input.entries.map((entry) => ({
      ...entry,
      origin: new URL(entry.origin).origin,
      allowedPathPrefixes: [...entry.allowedPathPrefixes],
    })),
    createdAt: input.createdAt,
  };
  return { ...body, registryHash: stableHash(body) };
}

export function buildStage15ShadowAltReviewAccessRequest(input: {
  brief: Stage15ShadowAltReviewProbeBrief;
  registry: Stage15ShadowAltReviewSourceRegistry;
  queries: Stage15ShadowAltReviewAccessRequest["queries"];
  createdAt: string;
}): Stage15ShadowAltReviewAccessRequest {
  assertStage15ShadowAltReviewBriefIntegrity(input.brief);
  assertStage15ShadowAltReviewRegistryIntegrity(input.registry);
  if (input.registry.batchId !== input.brief.batchId || input.registry.briefHash !== input.brief.briefHash
    || !validDate(input.createdAt) || Date.parse(input.createdAt) < Date.parse(input.registry.createdAt)) {
    throw new Error("SHADOW_ALT_REVIEW_REQUEST_INVALID");
  }
  const sampleKeys = input.brief.samples.map((sample) => sample.productKey);
  const queryByProduct = new Map(input.queries.map((item) => [item.productKey, item]));
  if (input.queries.length !== ALT_REVIEW_SAMPLE_SIZE || queryByProduct.size !== ALT_REVIEW_SAMPLE_SIZE
    || input.queries.some((item) => !sampleKeys.includes(item.productKey) || !item.query
      || item.query !== item.query.trim())
    || new Set(input.queries.map((item) => item.query)).size !== input.queries.length) {
    throw new Error("SHADOW_ALT_REVIEW_QUERY_INVALID");
  }
  const queries = sampleKeys.map((productKey) => queryByProduct.get(productKey));
  if (queries.some((query) => !query)) throw new Error("SHADOW_ALT_REVIEW_QUERY_INVALID");
  const body = {
    schemaVersion: "stage15-shadow-alt-review-access-request.v1" as const,
    batchId: input.brief.batchId,
    briefHash: input.brief.briefHash,
    registryHash: input.registry.registryHash,
    sourceManifestHash: input.brief.sourceManifest.manifestHash,
    sourceManifestFileSha256: input.brief.sourceManifest.fileSha256,
    queries: queries as Stage15ShadowAltReviewAccessRequest["queries"],
    budget: { ...budget },
    forbiddenActions: [...forbiddenActions],
    authorizationStatus: "pending_user_approval" as const,
    executionAllowed: false as const,
    createdAt: input.createdAt,
  };
  return { ...body, requestHash: stableHash(body) };
}

export function altReviewAuthorizationPhrase(requestHash: string, registryHash: string): string {
  return `我批准替代评论探针 requestHash=${requestHash} 与 registryHash=${registryHash}：最多3次搜索查询、6个页面、每商品2页、每URL 1次、0重试；不访问Amazon详情或评论入口，不登录、不处理验证码、不使用代理、反检测、镜像绕过、图片下载、AI、付费API或数据库写入。`;
}

export function buildStage15ShadowAltReviewAuthorization(input: {
  request: Stage15ShadowAltReviewAccessRequest;
  registry: Stage15ShadowAltReviewSourceRegistry;
  approvalText: string;
  approvedAt: string;
}): Stage15ShadowAltReviewAuthorization {
  assertStage15ShadowAltReviewRequestIntegrity(input.request);
  assertStage15ShadowAltReviewRegistryIntegrity(input.registry);
  if (input.request.batchId !== input.registry.batchId || input.request.registryHash !== input.registry.registryHash
    || !validDate(input.approvedAt) || Date.parse(input.approvedAt) < Date.parse(input.request.createdAt)) {
    throw new Error("SHADOW_ALT_REVIEW_AUTHORIZATION_DRIFT");
  }
  const expectedText = altReviewAuthorizationPhrase(input.request.requestHash, input.registry.registryHash);
  if (input.approvalText !== expectedText) throw new Error("SHADOW_ALT_REVIEW_AUTHORIZATION_TEXT_MISMATCH");
  const body = {
    schemaVersion: "stage15-shadow-alt-review-access-authorization.v1" as const,
    batchId: input.request.batchId,
    requestHash: input.request.requestHash,
    registryHash: input.registry.registryHash,
    approvedBudget: { ...input.request.budget },
    status: "approved" as const,
    approvedAt: input.approvedAt,
    approvalTextHash: stableHash(expectedText),
  };
  return { ...body, authorizationHash: stableHash(body) };
}
