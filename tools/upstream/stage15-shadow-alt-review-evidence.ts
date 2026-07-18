import { isAbsolute } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  type AltReviewBatchStatus,
  type AltReviewCapture,
  type AltReviewProductOutcome,
  type BuildAltReviewEvidenceInput,
} from "./stage15-shadow-alt-review-contract";
import { evaluateStage15ShadowAltReviewPreflight } from "./stage15-shadow-alt-review-preflight";

export type Stage15ShadowAltReviewEvidenceItem = {
  productKey: string;
  outcome: AltReviewProductOutcome;
  sourceId: string | null;
  sourceUrl: string | null;
  captureHash: string | null;
  evidenceRefs: string[];
};

export type Stage15ShadowAltReviewReadiness = {
  status: Extract<AltReviewBatchStatus, "probe_in_progress" | "probe_insufficient" | "probe_passed_pending_full_budget">;
  eligibleProducts: number;
  terminalProducts: number;
  totalProducts: 3;
  executionAllowed: boolean;
  humanEvaluationAllowed: false;
  batchVUnlocked: false;
  policyCandidateGenerated: false;
  databaseWritten: false;
  productionEffect: false;
};

export type Stage15ShadowAltReviewEvidencePackage = {
  schemaVersion: "stage15-shadow-alt-review-evidence-package.v1";
  batchId: string;
  briefHash: string;
  registryHash: string;
  requestHash: string;
  authorizationHash: string;
  proofLevel: "public_alternative_review_probe_v1";
  items: Stage15ShadowAltReviewEvidenceItem[];
  readiness: Stage15ShadowAltReviewReadiness;
  createdAt: string;
  evidenceHash: string;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const FORBIDDEN_PRIVACY_KEYS = new Set([
  "reviewername",
  "avatar",
  "location",
  "orderid",
  "reviewbody",
  "fullreviewbody",
]);
const IDENTITY_STATUSES = new Set(["exact", "conflict", "mixed_variant", "unverified"]);
const IDENTIFIER_KINDS = new Set(["gtin", "upc", "ean", "mpn", "manufacturer_number"]);
const REVIEW_SENTIMENTS = new Set(["positive", "negative"]);

function captureBody(capture: AltReviewCapture) {
  const { captureHash: _captureHash, ...body } = capture;
  return body;
}

function containsForbiddenPrivacyField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenPrivacyField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    return FORBIDDEN_PRIVACY_KEYS.has(normalized) || containsForbiddenPrivacyField(child);
  });
}

function validRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/gu, "/");
  return value.length > 0 && !isAbsolute(value) && !normalized.startsWith("/")
    && normalized.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validEvidenceRefs(refs: string[]): boolean {
  return refs.length > 0 && new Set(refs).size === refs.length
    && refs.every((ref) => ref.startsWith("alt-review-capture:") && ref.length > "alt-review-capture:".length);
}

function validateCapture(input: BuildAltReviewEvidenceInput, capture: AltReviewCapture): void {
  if (capture.schemaVersion !== "stage15-shadow-alt-review-capture.v1"
    || stableHash(captureBody(capture)) !== capture.captureHash) {
    throw new Error("SHADOW_ALT_REVIEW_CAPTURE_HASH_DRIFT");
  }
  if (containsForbiddenPrivacyField(capture)) throw new Error("SHADOW_ALT_REVIEW_PRIVACY_FIELD_FORBIDDEN");
  if (capture.privacy.personalDataStored !== false) throw new Error("SHADOW_ALT_REVIEW_PRIVACY_FIELD_FORBIDDEN");
  if (!HASH_PATTERN.test(capture.sourceCapture.fileSha256) || !validRelativePath(capture.sourceCapture.relativePath)
    || Number.isNaN(Date.parse(capture.sourceCapture.capturedAt))
    || Date.parse(capture.sourceCapture.capturedAt) > Date.parse(input.createdAt)) {
    throw new Error("SHADOW_ALT_REVIEW_CAPTURE_PROVENANCE_INVALID");
  }
  const source = input.registry.entries.find((entry) => entry.sourceId === capture.sourceId);
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(capture.sourceUrl);
  } catch {
    throw new Error("SHADOW_ALT_REVIEW_CAPTURE_SOURCE_INVALID");
  }
  if (!source || sourceUrl.origin !== source.origin
    || !source.allowedPathPrefixes.some((prefix) => sourceUrl.pathname.startsWith(prefix))) {
    throw new Error("SHADOW_ALT_REVIEW_CAPTURE_SOURCE_INVALID");
  }
  const successfulPage = input.accessLog.find((entry) => entry.kind === "page_open"
    && entry.productKey === capture.productKey && entry.sourceId === capture.sourceId
    && new URL(entry.url).href === sourceUrl.href && entry.outcome === "success");
  if (!successfulPage) throw new Error("SHADOW_ALT_REVIEW_CAPTURE_URL_NOT_LOGGED");
  if (Date.parse(capture.sourceCapture.capturedAt) < Date.parse(successfulPage.requestedAt)) {
    throw new Error("SHADOW_ALT_REVIEW_CAPTURE_PROVENANCE_INVALID");
  }
  if (!IDENTITY_STATUSES.has(capture.identityBinding.status)
    || !capture.identityBinding.brand.trim() || !capture.identityBinding.model.trim()
    || !validEvidenceRefs(capture.identityBinding.evidenceRefs)
    || capture.identityBinding.stableIdentifiers.some((identifier) => !IDENTIFIER_KINDS.has(identifier.kind)
      || !identifier.value.trim())
    || capture.identityBinding.variantSignature.some((item) => !item.dimension.trim() || !item.value.trim())) {
    throw new Error("SHADOW_ALT_REVIEW_IDENTITY_EVIDENCE_INVALID");
  }
  if (capture.aggregate.rating !== null
    && (!Number.isFinite(capture.aggregate.rating) || capture.aggregate.rating < 1 || capture.aggregate.rating > 5)) {
    throw new Error("SHADOW_ALT_REVIEW_AGGREGATE_INVALID");
  }
  if (capture.aggregate.reviewCount !== null
    && (!Number.isInteger(capture.aggregate.reviewCount) || capture.aggregate.reviewCount < 0)) {
    throw new Error("SHADOW_ALT_REVIEW_AGGREGATE_INVALID");
  }
  for (const review of capture.reviews) {
    const themeLength = Array.from(review.theme.trim()).length;
    if (!REVIEW_SENTIMENTS.has(review.sentiment)
      || !Number.isFinite(review.rating) || review.rating < 1 || review.rating > 5
      || Number.isNaN(Date.parse(review.reviewedAt)) || themeLength < 1 || themeLength > 160
      || !validEvidenceRefs(review.evidenceRefs)) {
      throw new Error("SHADOW_ALT_REVIEW_REVIEW_EVIDENCE_INVALID");
    }
  }
}

function eligible(capture: AltReviewCapture): boolean {
  const sentiments = new Set(capture.reviews.map((review) => review.sentiment));
  return capture.identityBinding.status === "exact"
    && capture.identityBinding.stableIdentifiers.length > 0
    && capture.identityBinding.variantSignature.length > 0
    && capture.reviews.length >= 2
    && sentiments.has("positive")
    && sentiments.has("negative")
    && capture.reviews.every((review) => review.rating >= 1 && review.rating <= 5
      && !Number.isNaN(Date.parse(review.reviewedAt))
      && Array.from(review.theme.trim()).length >= 1
      && Array.from(review.theme.trim()).length <= 160
      && validEvidenceRefs(review.evidenceRefs))
    && capture.privacy.personalDataStored === false;
}

function captureOutcome(capture: AltReviewCapture): AltReviewProductOutcome {
  if (capture.identityBinding.status === "conflict") return "blocked_identity_conflict";
  if (capture.identityBinding.status === "mixed_variant") return "mixed_variant_missing";
  return eligible(capture) ? "probe_product_eligible" : "review_evidence_incomplete";
}

function missingCaptureOutcome(input: BuildAltReviewEvidenceInput, productKey: string): AltReviewProductOutcome | null {
  const search = input.accessLog.find((entry) => entry.kind === "search_query" && entry.productKey === productKey);
  if (search?.outcome === "source_not_found") return "source_not_found";
  if (search?.outcome === "network_error") return "stopped_source_access_condition";
  const pages = input.accessLog.filter((entry) => entry.kind === "page_open" && entry.productKey === productKey);
  if (pages.some((entry) => ["login_wall", "captcha", "access_denied"].includes(entry.outcome))) {
    return "stopped_source_access_condition";
  }
  if (pages.some((entry) => entry.outcome === "identity_unverified")) return "mixed_variant_missing";
  return null;
}

export function buildStage15ShadowAltReviewEvidencePackage(
  input: BuildAltReviewEvidenceInput,
): Stage15ShadowAltReviewEvidencePackage {
  if (Number.isNaN(Date.parse(input.createdAt))) throw new Error("SHADOW_ALT_REVIEW_EVIDENCE_TIME_INVALID");
  const preflight = evaluateStage15ShadowAltReviewPreflight(input);
  const sampleKeys = new Set(input.brief.samples.map((sample) => sample.productKey));
  if (input.captures.some((capture) => !sampleKeys.has(capture.productKey))) {
    throw new Error("SHADOW_ALT_REVIEW_CAPTURE_PRODUCT_NOT_FROZEN");
  }
  if (new Set(input.captures.map((capture) => capture.productKey)).size !== input.captures.length) {
    throw new Error("SHADOW_ALT_REVIEW_DUPLICATE_CAPTURE");
  }
  input.captures.forEach((capture) => validateCapture(input, capture));
  const capturesByProduct = new Map(input.captures.map((capture) => [capture.productKey, capture]));
  const items = input.brief.samples.flatMap((sample): Stage15ShadowAltReviewEvidenceItem[] => {
    const capture = capturesByProduct.get(sample.productKey);
    if (capture) {
      return [{
        productKey: sample.productKey,
        outcome: captureOutcome(capture),
        sourceId: capture.sourceId,
        sourceUrl: capture.sourceUrl,
        captureHash: capture.captureHash,
        evidenceRefs: [
          ...capture.identityBinding.evidenceRefs,
          ...capture.reviews.flatMap((review) => review.evidenceRefs),
        ],
      }];
    }
    const outcome = missingCaptureOutcome(input, sample.productKey);
    return outcome ? [{
      productKey: sample.productKey,
      outcome,
      sourceId: null,
      sourceUrl: null,
      captureHash: null,
      evidenceRefs: [],
    }] : [];
  });
  const eligibleProducts = items.filter((item) => item.outcome === "probe_product_eligible").length;
  const terminalProducts = items.length;
  const status: Stage15ShadowAltReviewReadiness["status"] = terminalProducts < 3
    ? "probe_in_progress"
    : eligibleProducts >= 2
      ? "probe_passed_pending_full_budget"
      : "probe_insufficient";
  const readiness: Stage15ShadowAltReviewReadiness = {
    status,
    eligibleProducts,
    terminalProducts,
    totalProducts: 3,
    executionAllowed: terminalProducts < 3 && preflight.executionAllowed,
    humanEvaluationAllowed: false,
    batchVUnlocked: false,
    policyCandidateGenerated: false,
    databaseWritten: false,
    productionEffect: false,
  };
  const body = {
    schemaVersion: "stage15-shadow-alt-review-evidence-package.v1" as const,
    batchId: input.brief.batchId,
    briefHash: input.brief.briefHash,
    registryHash: input.registry.registryHash,
    requestHash: input.request.requestHash,
    authorizationHash: input.authorization.authorizationHash,
    proofLevel: "public_alternative_review_probe_v1" as const,
    items,
    readiness,
    createdAt: input.createdAt,
  };
  return { ...body, evidenceHash: stableHash(body) };
}
