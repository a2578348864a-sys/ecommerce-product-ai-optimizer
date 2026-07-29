import { createHash } from "node:crypto";

export type BatchStatus = "processing" | "ready" | "blocked" | "archived";
export type DataQualityStatus =
  | "pending"
  | "passed"
  | "passed_with_quarantine"
  | "blocked";
export type ProductBatchReportType = "search_results" | "category_current";
export type ProductBatchSourceType =
  | "sellersprite_xlsx"
  | "legacy_frozen_registration";

export type SellerSpriteProvisionalDisposition =
  | "provisional_score_only"
  | "insufficient_hard_gate_evidence"
  | "conflicting_provider_metrics"
  | "insufficient_required_signals";
export type SellerSpriteResearchPriority =
  | "priority_1"
  | "priority_2"
  | "priority_3"
  | "unranked_insufficient_evidence";
export type SellerSpriteEvidenceStatus =
  | "sufficient_for_comparison"
  | "limited_evidence"
  | "insufficient_evidence";

export const PRODUCT_BATCH_OWNER_SUBJECT = "owner:v1" as const;
export const PRODUCT_BATCH_MAX_XLSX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_BATCH_MAX_ITEMS = 500;
export const PRODUCT_BATCH_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const PRODUCT_BATCH_JSON_LIMITS = {
  normalizedSnapshotJson: 8 * 1024 * 1024,
  manifestJson: 2 * 1024 * 1024,
  qualitySummaryJson: 512 * 1024,
  errorJson: 256 * 1024,
  normalizedProductJson: 256 * 1024,
  occurrenceProjectionJson: 256 * 1024,
  familyProjectionJson: 256 * 1024,
  rankingJson: 128 * 1024,
  imageSnapshotJson: 3 * 1024 * 1024,
} as const;

export type ProductBatchJsonField = keyof typeof PRODUCT_BATCH_JSON_LIMITS;

export class ProductBatchContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductBatchContractError";
  }
}

const ALLOWED_BATCH_STATUS_TRANSITIONS: Readonly<
  Record<BatchStatus, readonly BatchStatus[]>
> = {
  processing: ["ready", "blocked"],
  blocked: ["processing"],
  ready: ["archived"],
  archived: [],
};

export function assertBatchStatusTransition(
  currentStatus: BatchStatus,
  targetStatus: BatchStatus,
): void {
  if (!ALLOWED_BATCH_STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    throw new ProductBatchContractError(
      "batch_status_transition_forbidden",
      `ProductBatch cannot transition from ${currentStatus} to ${targetStatus}.`,
    );
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function contractError(code: string, message: string): never {
  throw new ProductBatchContractError(code, message);
}

function assertSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    contractError("batch_hash_invalid", `${field} must be a lowercase SHA-256 value.`);
  }
}

function normalizeIdentityText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

function parseJsonObject(value: string, field: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      contractError("batch_json_invalid", `${field} must contain a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProductBatchContractError) throw error;
    return contractError("batch_json_invalid", `${field} must contain valid JSON.`);
  }
}

export function assertJsonFieldWithinLimit(
  field: ProductBatchJsonField,
  value: string,
): void {
  if (typeof value !== "string") {
    contractError("batch_json_invalid", `${field} must be a JSON string.`);
  }
  const sizeBytes = Buffer.byteLength(value, "utf8");
  if (sizeBytes > PRODUCT_BATCH_JSON_LIMITS[field]) {
    contractError(
      "batch_json_too_large",
      `${field} exceeds its ${PRODUCT_BATCH_JSON_LIMITS[field]} byte limit.`,
    );
  }
  parseJsonObject(value, field);
}

export interface ProductBatchDedupeInput {
  marketplace: string;
  reportType: ProductBatchReportType;
  query: string | null;
  category: string | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  briefHash: string;
  sourceFileSha256: string;
}

export function buildProductBatchDedupeKey(input: ProductBatchDedupeInput): string {
  assertSha256(input.briefHash, "briefHash");
  assertSha256(input.sourceFileSha256, "sourceFileSha256");
  if (input.reportType !== "search_results" && input.reportType !== "category_current") {
    contractError("batch_report_type_invalid", "Unsupported ProductBatch report type.");
  }
  const marketplace = normalizeIdentityText(input.marketplace);
  if (!marketplace) {
    contractError("batch_marketplace_invalid", "marketplace is required.");
  }
  for (const [field, value] of [
    ["priceMinCents", input.priceMinCents],
    ["priceMaxCents", input.priceMaxCents],
  ] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      contractError("batch_price_invalid", `${field} must be a non-negative integer.`);
    }
  }
  if (
    input.priceMinCents !== null
    && input.priceMaxCents !== null
    && input.priceMinCents > input.priceMaxCents
  ) {
    contractError("batch_price_invalid", "priceMinCents cannot exceed priceMaxCents.");
  }
  const canonicalIdentity = JSON.stringify({
    schemaVersion: "product-batch-dedupe.v1",
    marketplace,
    reportType: input.reportType,
    query: normalizeIdentityText(input.query),
    category: normalizeIdentityText(input.category),
    priceMinCents: input.priceMinCents,
    priceMaxCents: input.priceMaxCents,
    briefHash: input.briefHash,
    sourceFileSha256: input.sourceFileSha256,
  });
  return createHash("sha256").update(canonicalIdentity, "utf8").digest("hex");
}

export interface ReadyBatchCompletenessInput {
  normalizedBusinessHash: string | null;
  snapshotHash: string | null;
  manifestHash: string | null;
  itemCount: number | null;
  acceptedCount: number | null;
  quarantinedCount: number | null;
  dataQualityStatus: DataQualityStatus;
  importedAt: Date | null;
  sellerSpriteDisclaimerVersion: string | null;
  normalizedSnapshotJson: string | null;
  manifestJson: string | null;
  qualitySummaryJson: string;
  errorJson: string | null;
}

export function assertReadyBatchCompleteness(
  input: ReadyBatchCompletenessInput,
): void {
  assertSha256(input.normalizedBusinessHash, "normalizedBusinessHash");
  assertSha256(input.snapshotHash, "snapshotHash");
  assertSha256(input.manifestHash, "manifestHash");

  const counts = [input.itemCount, input.acceptedCount, input.quarantinedCount];
  if (counts.some((value) => !Number.isSafeInteger(value) || (value ?? -1) < 0)) {
    contractError("batch_ready_counts_invalid", "Ready batch counts must be non-negative integers.");
  }
  if ((input.acceptedCount ?? -1) + (input.quarantinedCount ?? -1) !== input.itemCount) {
    contractError(
      "batch_ready_counts_invalid",
      "acceptedCount plus quarantinedCount must equal itemCount.",
    );
  }
  if (input.acceptedCount! > PRODUCT_BATCH_MAX_ITEMS) {
    contractError("batch_item_limit_exceeded", "Ready batch has too many accepted products.");
  }
  if (
    input.dataQualityStatus !== "passed"
    && input.dataQualityStatus !== "passed_with_quarantine"
  ) {
    contractError(
      "batch_ready_quality_invalid",
      "Ready batch must have a passing data quality status.",
    );
  }
  if (!(input.importedAt instanceof Date) || Number.isNaN(input.importedAt.getTime())) {
    contractError("batch_ready_import_time_missing", "Ready batch requires importedAt.");
  }
  if (
    typeof input.sellerSpriteDisclaimerVersion !== "string"
    || !input.sellerSpriteDisclaimerVersion.trim()
    || input.sellerSpriteDisclaimerVersion.length > 128
  ) {
    contractError(
      "batch_ready_disclaimer_missing",
      "Ready batch requires a bounded SellerSprite disclaimer version.",
    );
  }
  if (input.normalizedSnapshotJson === null || input.manifestJson === null) {
    contractError("batch_ready_snapshot_missing", "Ready batch requires Snapshot and Manifest JSON.");
  }

  assertJsonFieldWithinLimit("normalizedSnapshotJson", input.normalizedSnapshotJson);
  assertJsonFieldWithinLimit("manifestJson", input.manifestJson);
  assertJsonFieldWithinLimit("qualitySummaryJson", input.qualitySummaryJson);
  if (input.errorJson !== null) {
    assertJsonFieldWithinLimit("errorJson", input.errorJson);
  }

  const snapshot = parseJsonObject(input.normalizedSnapshotJson, "normalizedSnapshotJson");
  if (snapshot.schemaVersion !== "sellersprite-market-snapshot.v3") {
    contractError(
      "batch_snapshot_version_invalid",
      "Only sellersprite-market-snapshot.v3 is supported.",
    );
  }
  const manifest = parseJsonObject(input.manifestJson, "manifestJson");
  if (manifest.schemaVersion !== "sellersprite-local-preview-manifest.v3") {
    contractError(
      "batch_manifest_version_invalid",
      "Only sellersprite-local-preview-manifest.v3 is supported.",
    );
  }
}

export interface ProductDiscoverySelectionInput {
  activeProductBatchId: string | null;
  activeLegacyRegistrationId: string | null;
}

export function assertActiveSelection(input: ProductDiscoverySelectionInput): void {
  const hasBatch = typeof input.activeProductBatchId === "string"
    && input.activeProductBatchId.trim().length > 0;
  const hasLegacy = typeof input.activeLegacyRegistrationId === "string"
    && input.activeLegacyRegistrationId.trim().length > 0;
  if (hasBatch === hasLegacy) {
    contractError(
      "active_selection_invalid",
      "Exactly one ProductBatch or legacy registration must be active.",
    );
  }
}

export type ProductBatchImageSnapshot =
  | { status: "not_cached" }
  | {
    version: "product-batch-image-snapshot.v1";
    status: "not_cached";
    reason:
      | "not_available"
      | "embedded_image_rejected"
      | "ambiguous_embedded_image"
      | "remote_url_rejected"
      | "remote_fetch_failed";
    capturedAt: string;
  }
  | {
    status: "cached";
    mimeType: "image/jpeg" | "image/png";
    sizeBytes: number;
    sha256: string;
    base64: string;
    version?: "product-batch-image-snapshot.v1";
    byteLength?: number;
    sourceKind?: "xlsx_embedded" | "xlsx_main_image_url";
    capturedAt?: string;
  };

function decodeStrictBase64(value: string): Buffer {
  if (
    !value
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    contractError("batch_image_base64_invalid", "Cached image bytes must be canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    contractError("batch_image_base64_invalid", "Cached image bytes must be canonical base64.");
  }
  return bytes;
}

export function assertProductBatchImageSnapshot(imageSnapshotJson: string): void {
  assertJsonFieldWithinLimit("imageSnapshotJson", imageSnapshotJson);
  const snapshot = parseJsonObject(imageSnapshotJson, "imageSnapshotJson");
  if (snapshot.status === "not_cached") {
    if (Object.keys(snapshot).length === 1) return;
    const reasons = new Set([
      "not_available",
      "embedded_image_rejected",
      "ambiguous_embedded_image",
      "remote_url_rejected",
      "remote_fetch_failed",
    ]);
    if (snapshot.version !== "product-batch-image-snapshot.v1"
      || !reasons.has(String(snapshot.reason))
      || typeof snapshot.capturedAt !== "string"
      || snapshot.capturedAt.length > 40
      || Number.isNaN(Date.parse(snapshot.capturedAt))
      || Object.keys(snapshot).some((key) => ![
        "version",
        "status",
        "reason",
        "capturedAt",
      ].includes(key))) {
      contractError(
        "batch_image_not_cached_invalid",
        "A versioned not_cached image snapshot requires only a safe reason and capture time.",
      );
    }
    return;
  }
  if (snapshot.status !== "cached") {
    contractError("batch_image_status_invalid", "Unsupported image snapshot status.");
  }
  if (snapshot.mimeType !== "image/jpeg" && snapshot.mimeType !== "image/png") {
    contractError("batch_image_mime_invalid", "Only JPEG and PNG images are supported.");
  }
  if (snapshot.version !== undefined) {
    if (snapshot.version !== "product-batch-image-snapshot.v1"
      || snapshot.byteLength !== snapshot.sizeBytes
      || (snapshot.sourceKind !== "xlsx_embedded"
        && snapshot.sourceKind !== "xlsx_main_image_url")
      || typeof snapshot.capturedAt !== "string"
      || snapshot.capturedAt.length > 40
      || Number.isNaN(Date.parse(snapshot.capturedAt))
      || Object.keys(snapshot).some((key) => ![
        "version",
        "status",
        "mimeType",
        "sizeBytes",
        "byteLength",
        "sha256",
        "base64",
        "sourceKind",
        "capturedAt",
      ].includes(key))) {
      contractError(
        "batch_image_snapshot_metadata_invalid",
        "Versioned cached images require bounded source metadata.",
      );
    }
  } else if (
    snapshot.byteLength !== undefined
    || snapshot.sourceKind !== undefined
    || snapshot.capturedAt !== undefined
  ) {
    contractError(
      "batch_image_snapshot_metadata_invalid",
      "Legacy cached images cannot partially claim versioned source metadata.",
    );
  }
  if (!Number.isSafeInteger(snapshot.sizeBytes) || (snapshot.sizeBytes as number) < 1) {
    contractError("batch_image_size_invalid", "Cached image size must be a positive integer.");
  }
  if ((snapshot.sizeBytes as number) > PRODUCT_BATCH_MAX_IMAGE_BYTES) {
    contractError("batch_image_too_large", "Cached image exceeds the 2 MiB limit.");
  }
  assertSha256(snapshot.sha256, "imageSnapshot.sha256");
  if (typeof snapshot.base64 !== "string") {
    contractError("batch_image_base64_invalid", "Cached image bytes are required.");
  }
  const bytes = decodeStrictBase64(snapshot.base64);
  if (bytes.byteLength !== snapshot.sizeBytes) {
    contractError("batch_image_size_invalid", "Cached image size does not match its bytes.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== snapshot.sha256) {
    contractError("batch_image_hash_invalid", "Cached image SHA-256 does not match its bytes.");
  }
  const jpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = bytes.length >= pngSignature.length
    && bytes.subarray(0, pngSignature.length).equals(pngSignature);
  if (
    (snapshot.mimeType === "image/jpeg" && !jpeg)
    || (snapshot.mimeType === "image/png" && !png)
  ) {
    contractError("batch_image_magic_invalid", "Cached image magic bytes do not match MIME.");
  }
}

export interface ProductBatchItemPersistenceInput {
  productKey: string;
  ordinal: number;
  itemIdentityHash: string;
  itemHash: string;
  evidenceHash: string;
  normalizedProductJson: string;
  occurrenceProjectionJson: string;
  familyProjectionJson: string;
  rankingJson: string;
  provisionalDisposition: SellerSpriteProvisionalDisposition | string;
  researchPriority: SellerSpriteResearchPriority | string;
  evidenceStatus: SellerSpriteEvidenceStatus | string;
  promotionEligible: boolean;
  imageSnapshotJson: string;
}

const PROVISIONAL_DISPOSITIONS = new Set<string>([
  "provisional_score_only",
  "insufficient_hard_gate_evidence",
  "conflicting_provider_metrics",
  "insufficient_required_signals",
]);
const RESEARCH_PRIORITIES = new Set<string>([
  "priority_1",
  "priority_2",
  "priority_3",
  "unranked_insufficient_evidence",
]);
const EVIDENCE_STATUSES = new Set<string>([
  "sufficient_for_comparison",
  "limited_evidence",
  "insufficient_evidence",
]);

export function assertProductBatchItemForPersistence(
  input: ProductBatchItemPersistenceInput,
): void {
  if (
    typeof input.productKey !== "string"
    || !input.productKey.trim()
    || Buffer.byteLength(input.productKey, "utf8") > 512
  ) {
    contractError("batch_item_product_key_invalid", "Product item requires a bounded productKey.");
  }
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
    contractError("batch_item_ordinal_invalid", "Product item ordinal must be non-negative.");
  }
  assertSha256(input.itemIdentityHash, "itemIdentityHash");
  assertSha256(input.itemHash, "itemHash");
  assertSha256(input.evidenceHash, "evidenceHash");
  if (input.promotionEligible !== false) {
    contractError(
      "batch_item_promotion_forbidden",
      "SellerSprite V1 items cannot be promotion eligible.",
    );
  }
  if (!PROVISIONAL_DISPOSITIONS.has(input.provisionalDisposition)) {
    contractError(
      "batch_item_disposition_invalid",
      "SellerSprite V1 cannot use advance, watch, or reject semantics.",
    );
  }
  if (!RESEARCH_PRIORITIES.has(input.researchPriority)) {
    contractError("batch_item_priority_invalid", "Unsupported SellerSprite research priority.");
  }
  if (!EVIDENCE_STATUSES.has(input.evidenceStatus)) {
    contractError("batch_item_evidence_invalid", "Unsupported SellerSprite evidence status.");
  }
  assertJsonFieldWithinLimit("normalizedProductJson", input.normalizedProductJson);
  assertJsonFieldWithinLimit("occurrenceProjectionJson", input.occurrenceProjectionJson);
  assertJsonFieldWithinLimit("familyProjectionJson", input.familyProjectionJson);
  assertJsonFieldWithinLimit("rankingJson", input.rankingJson);
  assertProductBatchImageSnapshot(input.imageSnapshotJson);
}
