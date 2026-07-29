import { createHash } from "node:crypto";

export const PRODUCT_RESEARCH_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export type ProductResearchImageSnapshot = {
  version: "market-screening-product-image.v1" | "product-batch-product-image.v1";
  source: "stage15_screening_preview_cache" | "sellersprite_product_batch";
  status: "available";
  productKey: string;
  candidateIdentityHash: string;
  mimeType: "image/jpeg" | "image/png";
  bytes: number;
  contentHash: string;
  dataUrl: string;
  capturedAt: string;
};

export type ResearchProductImageDisplay = {
  dataUrl: string;
  mimeType: ProductResearchImageSnapshot["mimeType"];
  contentHash: string;
  provenance: "task_snapshot" | "candidate_fallback" | "product_batch_snapshot";
};

type CandidateImageRecord = {
  id: string;
  sourceMetaJson: string;
  name?: string;
};

export class ProductResearchImageConflictError extends Error {
  constructor(message = "Candidate 商品图片快照冲突。") {
    super(message);
    this.name = "ProductResearchImageConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function parseDataUrl(value: unknown): {
  mimeType: ProductResearchImageSnapshot["mimeType"];
  bytes: Buffer;
  dataUrl: string;
} | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;

  const mimeType = match[1] as ProductResearchImageSnapshot["mimeType"];
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length <= 0
    || bytes.length > PRODUCT_RESEARCH_IMAGE_MAX_BYTES
    || bytes.toString("base64") !== match[2]) {
    return null;
  }

  const isJpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  if ((mimeType === "image/jpeg" && !isJpeg)
    || (mimeType === "image/png" && !isPng)) {
    return null;
  }
  return { mimeType, bytes, dataUrl: value };
}

function validProductKey(value: unknown): value is string {
  return typeof value === "string"
    && /^amazon:[A-Z]{2,8}:[A-Z0-9]{10}$/u.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function buildAuthoritativeProductImageSnapshot(input: {
  dataUrl: string;
  productKey: string;
  candidateIdentityHash: string;
  capturedAt: string;
}): ProductResearchImageSnapshot {
  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed
    || !validProductKey(input.productKey)
    || !validHash(input.candidateIdentityHash)
    || !validIsoTimestamp(input.capturedAt)) {
    throw new Error("PRODUCT_RESEARCH_IMAGE_INVALID");
  }
  return {
    version: "market-screening-product-image.v1",
    source: "stage15_screening_preview_cache",
    status: "available",
    productKey: input.productKey,
    candidateIdentityHash: input.candidateIdentityHash,
    mimeType: parsed.mimeType,
    bytes: parsed.bytes.length,
    contentHash: sha256(parsed.bytes),
    dataUrl: parsed.dataUrl,
    capturedAt: input.capturedAt,
  };
}

export function parseProductImageSnapshot(value: unknown): ProductResearchImageSnapshot | null {
  const legacy = isRecord(value)
    && value.version === "market-screening-product-image.v1"
    && value.source === "stage15_screening_preview_cache";
  const productBatch = isRecord(value)
    && value.version === "product-batch-product-image.v1"
    && value.source === "sellersprite_product_batch";
  if (!isRecord(value)
    || (!legacy && !productBatch)
    || value.status !== "available"
    || !validProductKey(value.productKey)
    || !validHash(value.candidateIdentityHash)
    || !validHash(value.contentHash)
    || !validIsoTimestamp(value.capturedAt)
    || !Number.isInteger(value.bytes)) {
    return null;
  }
  const parsed = parseDataUrl(value.dataUrl);
  if (!parsed
    || value.mimeType !== parsed.mimeType
    || value.bytes !== parsed.bytes.length
    || value.contentHash !== sha256(parsed.bytes)) {
    return null;
  }
  return {
    version: value.version as ProductResearchImageSnapshot["version"],
    source: value.source as ProductResearchImageSnapshot["source"],
    status: "available",
    productKey: value.productKey,
    candidateIdentityHash: value.candidateIdentityHash,
    mimeType: parsed.mimeType,
    bytes: parsed.bytes.length,
    contentHash: value.contentHash,
    dataUrl: parsed.dataUrl,
    capturedAt: value.capturedAt,
  };
}

function parseCandidateImage(sourceMetaJson: string): ProductResearchImageSnapshot | null {
  const sourceMeta = parseJsonRecord(sourceMetaJson);
  if (!sourceMeta) return null;
  const image = parseProductImageSnapshot(sourceMeta.productImageSnapshot);
  const identity = isRecord(sourceMeta.marketScreeningIdentity)
    ? sourceMeta.marketScreeningIdentity
    : null;
  if (image
    && identity
    && identity.productKey === image.productKey
    && identity.identityHash === image.candidateIdentityHash) {
    return image;
  }
  if (sourceMeta.originKind !== "seller_sprite_product_batch"
    || !validProductKey(sourceMeta.productKey)
    || !validHash(sourceMeta.itemIdentityHash)
    || !validIsoTimestamp(sourceMeta.capturedAt)
    || !isRecord(sourceMeta.imageSnapshot)
    || sourceMeta.imageSnapshot.status !== "cached"
    || (sourceMeta.imageSnapshot.mimeType !== "image/jpeg"
      && sourceMeta.imageSnapshot.mimeType !== "image/png")
    || !Number.isInteger(sourceMeta.imageSnapshot.sizeBytes)
    || !validHash(sourceMeta.imageSnapshot.sha256)
    || typeof sourceMeta.imageSnapshot.base64 !== "string") {
    return null;
  }
  const dataUrl = `data:${sourceMeta.imageSnapshot.mimeType};base64,${sourceMeta.imageSnapshot.base64}`;
  const parsedData = parseDataUrl(dataUrl);
  if (!parsedData
    || parsedData.bytes.length !== sourceMeta.imageSnapshot.sizeBytes
    || sha256(parsedData.bytes) !== sourceMeta.imageSnapshot.sha256) {
    return null;
  }
  return parseProductImageSnapshot({
    version: "product-batch-product-image.v1",
    source: "sellersprite_product_batch",
    status: "available",
    productKey: sourceMeta.productKey,
    candidateIdentityHash: sourceMeta.itemIdentityHash,
    mimeType: parsedData.mimeType,
    bytes: parsedData.bytes.length,
    contentHash: sourceMeta.imageSnapshot.sha256,
    dataUrl: parsedData.dataUrl,
    capturedAt: sourceMeta.capturedAt,
  });
}

export function mergeCandidateProductImageSnapshot(
  sourceMetaJson: string,
  incoming: ProductResearchImageSnapshot | null,
): { changed: boolean; sourceMetaJson: string } {
  if (!incoming) return { changed: false, sourceMetaJson };
  const sourceMeta = parseJsonRecord(sourceMetaJson);
  if (!sourceMeta) throw new ProductResearchImageConflictError("Candidate 来源元数据损坏。");
  const identity = isRecord(sourceMeta.marketScreeningIdentity)
    ? sourceMeta.marketScreeningIdentity
    : null;
  if (!identity
    || identity.productKey !== incoming.productKey
    || identity.identityHash !== incoming.candidateIdentityHash) {
    throw new ProductResearchImageConflictError("Candidate 图片与商品身份不一致。");
  }

  if (sourceMeta.productImageSnapshot !== undefined) {
    const stored = parseProductImageSnapshot(sourceMeta.productImageSnapshot);
    if (!stored
      || stored.productKey !== incoming.productKey
      || stored.candidateIdentityHash !== incoming.candidateIdentityHash
      || stored.contentHash !== incoming.contentHash) {
      throw new ProductResearchImageConflictError();
    }
    return { changed: false, sourceMetaJson };
  }

  return {
    changed: true,
    sourceMetaJson: JSON.stringify({
      ...sourceMeta,
      productImageSnapshot: incoming,
    }),
  };
}

export function getResearchTaskCandidateId(taskResult: unknown): string | null {
  if (!isRecord(taskResult)) return null;
  const sourceMeta = isRecord(taskResult.sourceMeta) ? taskResult.sourceMeta : null;
  const candidateToTask = isRecord(taskResult.candidateToTask) ? taskResult.candidateToTask : null;
  const sourceCandidateId = sourceMeta?.source === "opportunity"
    && typeof sourceMeta.candidateId === "string"
    && sourceMeta.candidateId.trim()
    ? sourceMeta.candidateId.trim()
    : null;
  const bindingCandidateId = candidateToTask?.version === 1
    && typeof candidateToTask.candidateId === "string"
    && candidateToTask.candidateId.trim()
    ? candidateToTask.candidateId.trim()
    : null;
  if (sourceCandidateId && bindingCandidateId && sourceCandidateId !== bindingCandidateId) return null;
  return sourceCandidateId || bindingCandidateId;
}

export function resolveResearchTaskProductImage(input: {
  taskResult: unknown;
  candidates: readonly CandidateImageRecord[];
}): ResearchProductImageDisplay | null {
  const candidateId = getResearchTaskCandidateId(input.taskResult);
  if (!candidateId || !isRecord(input.taskResult)) return null;
  const sourceMeta = isRecord(input.taskResult.sourceMeta) ? input.taskResult.sourceMeta : null;
  const candidateSnapshot = sourceMeta && isRecord(sourceMeta.candidateSnapshot)
    ? sourceMeta.candidateSnapshot
    : null;
  if (candidateSnapshot?.productImageSnapshot !== undefined) {
    const image = parseProductImageSnapshot(candidateSnapshot.productImageSnapshot);
    if (!image
      || candidateSnapshot.version !== 1
      || candidateSnapshot.id !== candidateId
      || candidateSnapshot.identityHash !== image.candidateIdentityHash) {
      return null;
    }
    return {
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      contentHash: image.contentHash,
      provenance: "task_snapshot",
    };
  }

  const exactMatches = input.candidates.filter((candidate) => candidate.id === candidateId);
  if (exactMatches.length !== 1) return null;
  const image = parseCandidateImage(exactMatches[0].sourceMetaJson);
  if (!image) return null;
  return {
    dataUrl: image.dataUrl,
    mimeType: image.mimeType,
    contentHash: image.contentHash,
    provenance: "candidate_fallback",
  };
}

export function readCandidateProductImageSnapshot(sourceMetaJson: string) {
  return parseCandidateImage(sourceMetaJson);
}
