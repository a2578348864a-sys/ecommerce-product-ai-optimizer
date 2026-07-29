import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeCanonicalBase64(value: string): Uint8Array | null {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    return null;
  }
  try {
    const binary = atob(value);
    if (btoa(binary) !== value) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function readProductBatchItemImageSnapshot(
  imageSnapshotJson: string,
): ResearchProductImageDisplay | null {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(imageSnapshotJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(snapshot)
    || snapshot.status !== "cached"
    || (snapshot.mimeType !== "image/jpeg" && snapshot.mimeType !== "image/png")
    || !Number.isSafeInteger(snapshot.sizeBytes)
    || typeof snapshot.sizeBytes !== "number"
    || snapshot.sizeBytes < 1
    || snapshot.sizeBytes > MAX_IMAGE_BYTES
    || typeof snapshot.sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(snapshot.sha256)
    || typeof snapshot.base64 !== "string") {
    return null;
  }
  const bytes = decodeCanonicalBase64(snapshot.base64);
  if (!bytes || bytes.byteLength !== snapshot.sizeBytes) return null;

  const jpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  const png = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  if ((snapshot.mimeType === "image/jpeg" && !jpeg)
    || (snapshot.mimeType === "image/png" && !png)) {
    return null;
  }
  return {
    dataUrl: `data:${snapshot.mimeType};base64,${snapshot.base64}`,
    mimeType: snapshot.mimeType,
    contentHash: snapshot.sha256,
    provenance: "product_batch_snapshot",
  };
}
