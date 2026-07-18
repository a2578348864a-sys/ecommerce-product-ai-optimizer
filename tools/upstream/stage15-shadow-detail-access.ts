import { stableHash } from "../../lib/upstream/pipeline";

type DetailAccessBudget = {
  maxDetailPageRequests: number;
  maxRequestsPerProduct: number;
  maxAutomaticRetries: number;
  maxImageDownloads: number;
};

type DetailAccessTarget = {
  productKey: string;
  platformProductId: string;
  sourceUrl: string;
};

export type Stage15ShadowDetailAccessRequest = {
  schemaVersion: "stage15-shadow-detail-access-request.v1";
  batchId: string;
  role: "calibration";
  sourceManifest: {
    manifestId: string;
    manifestHash: string;
    fileSha256: string;
  };
  targets: DetailAccessTarget[];
  proposedBudget: DetailAccessBudget;
  allowedFields: readonly [
    "dimensions",
    "material",
    "monthly_bought",
    "first_available_at",
    "exact_variant_rating",
    "exact_variant_review_count",
    "exact_variant_positive_reviews",
    "exact_variant_negative_reviews",
  ];
  stopConditions: readonly ["login_wall", "captcha", "access_denied", "variant_binding_unverified"];
  forbiddenActions: readonly ["automatic_retry", "proxy_rotation", "anti_detection", "image_download", "ai_or_paid_api", "database_write"];
  authorizationStatus: "pending_user_approval";
  executionAllowed: false;
  createdAt: string;
  requestHash: string;
};

export type Stage15ShadowDetailAccessAuthorization = {
  schemaVersion: "stage15-shadow-detail-access-authorization.v1";
  batchId: string;
  requestHash: string;
  status: "approved";
  approvedAt: string;
  approvedBudget: DetailAccessBudget;
};

export type Stage15ShadowDetailAccessLogEntry = {
  productKey: string;
  sourceUrl: string;
  attempt: number;
  outcome: "success" | "login_wall" | "captcha" | "access_denied" | "variant_binding_unverified" | "network_error";
  requestedAt: string;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function iso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function withoutRequestHash(request: Stage15ShadowDetailAccessRequest) {
  const { requestHash: _requestHash, ...body } = request;
  void _requestHash;
  return body;
}

function validateBudget(budget: DetailAccessBudget, targetCount: number): void {
  if (budget.maxDetailPageRequests !== targetCount
    || budget.maxRequestsPerProduct !== 1
    || budget.maxAutomaticRetries !== 0
    || budget.maxImageDownloads !== 0) {
    throw new Error("SHADOW_DETAIL_ACCESS_BUDGET_INVALID");
  }
}

function validateTargets(targets: DetailAccessTarget[]): void {
  const productKeys = targets.map((target) => target.productKey);
  const platformIds = targets.map((target) => target.platformProductId.toUpperCase());
  if (targets.length !== 20 || new Set(productKeys).size !== 20 || new Set(platformIds).size !== 20) {
    throw new Error("SHADOW_DETAIL_ACCESS_TARGET_INVALID");
  }
  for (const target of targets) {
    const platformId = target.platformProductId.toUpperCase();
    if (!nonEmpty(target.productKey) || !/^B0[A-Z0-9]{8}$/u.test(platformId)
      || target.productKey.toUpperCase() !== `AMAZON:US:${platformId}`
      || !new RegExp(`^https://www\\.amazon\\.com/(?:[^/?#]+/)?dp/${platformId}(?:[/?#]|$)`, "iu").test(target.sourceUrl)) {
      throw new Error("SHADOW_DETAIL_ACCESS_TARGET_INVALID");
    }
  }
}

export function buildStage15ShadowDetailAccessRequest(input: {
  schemaVersion: "stage15-shadow-detail-access-request-input.v1";
  batchId: string;
  role: "calibration";
  sourceManifest: Stage15ShadowDetailAccessRequest["sourceManifest"];
  targets: DetailAccessTarget[];
  proposedBudget: DetailAccessBudget;
  createdAt: string;
}): Stage15ShadowDetailAccessRequest {
  if (input.schemaVersion !== "stage15-shadow-detail-access-request-input.v1"
    || input.role !== "calibration" || !nonEmpty(input.batchId) || !iso(input.createdAt)
    || !nonEmpty(input.sourceManifest.manifestId) || !sha(input.sourceManifest.manifestHash)
    || !sha(input.sourceManifest.fileSha256)) {
    throw new Error("SHADOW_DETAIL_ACCESS_REQUEST_INVALID");
  }
  validateTargets(input.targets);
  validateBudget(input.proposedBudget, input.targets.length);
  const body = {
    schemaVersion: "stage15-shadow-detail-access-request.v1" as const,
    batchId: input.batchId,
    role: input.role,
    sourceManifest: input.sourceManifest,
    targets: input.targets.map((target) => ({ ...target, platformProductId: target.platformProductId.toUpperCase() })),
    proposedBudget: input.proposedBudget,
    allowedFields: [
      "dimensions",
      "material",
      "monthly_bought",
      "first_available_at",
      "exact_variant_rating",
      "exact_variant_review_count",
      "exact_variant_positive_reviews",
      "exact_variant_negative_reviews",
    ] as const,
    stopConditions: ["login_wall", "captcha", "access_denied", "variant_binding_unverified"] as const,
    forbiddenActions: ["automatic_retry", "proxy_rotation", "anti_detection", "image_download", "ai_or_paid_api", "database_write"] as const,
    authorizationStatus: "pending_user_approval" as const,
    executionAllowed: false as const,
    createdAt: input.createdAt,
  };
  return { ...body, requestHash: stableHash(body) };
}

export function evaluateStage15ShadowDetailAccessPreflight(input: {
  request: Stage15ShadowDetailAccessRequest;
  authorization: Stage15ShadowDetailAccessAuthorization | null;
  accessLog: Stage15ShadowDetailAccessLogEntry[];
}) {
  if (input.request.schemaVersion !== "stage15-shadow-detail-access-request.v1"
    || stableHash(withoutRequestHash(input.request)) !== input.request.requestHash) {
    throw new Error("SHADOW_DETAIL_ACCESS_REQUEST_DRIFT");
  }
  validateTargets(input.request.targets);
  validateBudget(input.request.proposedBudget, input.request.targets.length);
  if (input.authorization === null) {
    const body = {
      schemaVersion: "stage15-shadow-detail-access-preflight.v1" as const,
      batchId: input.request.batchId,
      requestHash: input.request.requestHash,
      status: "blocked_pending_user_approval" as const,
      executionAllowed: false as const,
      completedRequests: 0,
      remainingRequests: input.request.proposedBudget.maxDetailPageRequests,
      boundary: { externalWebsiteAccessed: false as const, databaseWritten: false as const },
    };
    return { ...body, preflightHash: stableHash(body) };
  }
  if (input.authorization.schemaVersion !== "stage15-shadow-detail-access-authorization.v1"
    || input.authorization.status !== "approved" || input.authorization.batchId !== input.request.batchId
    || input.authorization.requestHash !== input.request.requestHash || !iso(input.authorization.approvedAt)
    || Date.parse(input.authorization.approvedAt) < Date.parse(input.request.createdAt)
    || stableHash(input.authorization.approvedBudget) !== stableHash(input.request.proposedBudget)) {
    throw new Error("SHADOW_DETAIL_AUTHORIZATION_DRIFT");
  }
  const targetByProduct = new Map(input.request.targets.map((target) => [target.productKey, target]));
  const seen = new Set<string>();
  for (const entry of input.accessLog) {
    const target = targetByProduct.get(entry.productKey);
    if (seen.has(entry.productKey)) throw new Error("SHADOW_DETAIL_ACCESS_DUPLICATE_PRODUCT");
    if (entry.attempt !== 1) throw new Error("SHADOW_DETAIL_ACCESS_RETRY_FORBIDDEN");
    if (!target || target.sourceUrl !== entry.sourceUrl) throw new Error("SHADOW_DETAIL_ACCESS_TARGET_DRIFT");
    if (!iso(entry.requestedAt) || Date.parse(entry.requestedAt) < Date.parse(input.authorization.approvedAt)
      || !["success", "login_wall", "captcha", "access_denied", "variant_binding_unverified", "network_error"].includes(entry.outcome)) {
      throw new Error("SHADOW_DETAIL_ACCESS_LOG_INVALID");
    }
    seen.add(entry.productKey);
  }
  if (input.accessLog.length > input.request.proposedBudget.maxDetailPageRequests) {
    throw new Error("SHADOW_DETAIL_ACCESS_BUDGET_EXCEEDED");
  }
  const remainingRequests = input.request.proposedBudget.maxDetailPageRequests - input.accessLog.length;
  const stopEntry = input.accessLog.find((entry) =>
    ["login_wall", "captcha", "access_denied", "variant_binding_unverified"].includes(entry.outcome));
  const status = stopEntry
    ? "blocked_stop_condition" as const
    : remainingRequests === 0 ? "blocked_budget_exhausted" as const : "ready" as const;
  const body = {
    schemaVersion: "stage15-shadow-detail-access-preflight.v1" as const,
    batchId: input.request.batchId,
    requestHash: input.request.requestHash,
    authorizationHash: stableHash(input.authorization),
    status,
    executionAllowed: status === "ready",
    completedRequests: input.accessLog.length,
    remainingRequests,
    ...(stopEntry ? { stopCondition: stopEntry.outcome, stoppedProductKey: stopEntry.productKey } : {}),
    boundary: { externalWebsiteAccessedDuringPreflight: false as const, databaseWritten: false as const },
  };
  return { ...body, preflightHash: stableHash(body) };
}
