import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AiImageAccessMode, AiImageDraftItem } from "@/lib/aiImageDraft";

export const AI_IMAGE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const AI_IMAGE_MAX_BASE64_CHARS = Math.ceil(AI_IMAGE_MAX_FILE_BYTES / 3) * 4;
export const AI_IMAGE_MAX_PIXELS = 8_294_400;
export const AI_IMAGE_VISITOR_GRACE_MS = 24 * 60 * 60 * 1000;

export type ValidatedImage = {
  bytes: Buffer;
  mimeType: AiImageDraftItem["mimeType"];
  extension: "png" | "jpg" | "webp";
  width?: number;
  height?: number;
  sha256: string;
};

export type StoredAiImage = Omit<ValidatedImage, "bytes" | "extension"> & {
  id: string;
  storageKey: string;
  fileSizeBytes: number;
};

function storageRoot(): string {
  return resolve(process.env.AI_IMAGE_DRAFT_STORAGE_ROOT || resolve(process.cwd(), "data", "ai-image-drafts"));
}

function safeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error(`AI_IMAGE_INVALID_${label.toUpperCase()}`);
  return value;
}

export function buildVisitorImageScope(visitorAccessId: string): string {
  return createHash("sha256").update(visitorAccessId).digest("hex").slice(0, 32);
}

function ensureInsideRoot(target: string): string {
  const root = storageRoot();
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("AI_IMAGE_PATH_OUTSIDE_ROOT");
  return target;
}

export function resolveAiImageStorageKey(storageKey: string): string {
  if (!storageKey || storageKey.includes("..") || storageKey.includes("\\") || storageKey.startsWith("/")) {
    throw new Error("AI_IMAGE_INVALID_STORAGE_KEY");
  }
  return ensureInsideRoot(resolve(storageRoot(), storageKey));
}

function pngDimensions(bytes: Buffer): { width?: number; height?: number } {
  if (bytes.length < 24) return {};
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return {};
    const marker = bytes[offset + 1];
    const size = bytes.readUInt16BE(offset + 2);
    if (size < 2) return {};
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return {};
}

function webpDimensions(bytes: Buffer): { width?: number; height?: number } {
  if (bytes.length < 30) return {};
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return {};
}

export function validateAiImageBytes(bytes: Buffer): ValidatedImage {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("AI_IMAGE_EMPTY_FILE");
  if (bytes.length > AI_IMAGE_MAX_FILE_BYTES) throw new Error("AI_IMAGE_FILE_TOO_LARGE");

  let mimeType: ValidatedImage["mimeType"];
  let extension: ValidatedImage["extension"];
  let dimensions: { width?: number; height?: number };
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = "image/png";
    extension = "png";
    dimensions = pngDimensions(bytes);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = "image/jpeg";
    extension = "jpg";
    dimensions = jpegDimensions(bytes);
  } else if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    mimeType = "image/webp";
    extension = "webp";
    dimensions = webpDimensions(bytes);
  } else {
    throw new Error("AI_IMAGE_UNSUPPORTED_CONTENT");
  }
  if (
    !dimensions.width
    || !dimensions.height
    || dimensions.width > 4096
    || dimensions.height > 4096
    || dimensions.width * dimensions.height > AI_IMAGE_MAX_PIXELS
  ) {
    throw new Error("AI_IMAGE_INVALID_DIMENSIONS");
  }
  return {
    bytes,
    mimeType,
    extension,
    width: dimensions.width,
    height: dimensions.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function decodeAiImageBase64(value: string): Buffer {
  if (
    !value
    || value.length > AI_IMAGE_MAX_BASE64_CHARS
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error(value.length > AI_IMAGE_MAX_BASE64_CHARS ? "AI_IMAGE_BASE64_TOO_LARGE" : "AI_IMAGE_INVALID_BASE64");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length) throw new Error("AI_IMAGE_EMPTY_FILE");
  if (bytes.length > AI_IMAGE_MAX_FILE_BYTES) throw new Error("AI_IMAGE_FILE_TOO_LARGE");
  return bytes;
}

export async function storeAiImage(input: {
  accessMode: AiImageAccessMode;
  visitorAccessId?: string;
  taskId: string;
  bytes: Buffer;
}): Promise<StoredAiImage> {
  const taskId = safeSegment(input.taskId, "task_id");
  const scope = input.accessMode === "owner"
    ? "owner"
    : `visitor/${safeSegment(buildVisitorImageScope(input.visitorAccessId || ""), "visitor_scope")}`;
  const validated = validateAiImageBytes(input.bytes);
  const id = randomUUID();
  const storageKey = `${scope}/${taskId}/${id}.${validated.extension}`;
  const finalPath = resolveAiImageStorageKey(storageKey);
  const tempPath = ensureInsideRoot(resolve(dirname(finalPath), `${id}.part`));
  await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(tempPath, validated.bytes, { flag: "wx", mode: 0o600 });
    await rename(tempPath, finalPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    id,
    storageKey,
    mimeType: validated.mimeType,
    width: validated.width,
    height: validated.height,
    sha256: validated.sha256,
    fileSizeBytes: validated.bytes.length,
  };
}

export async function readAiImage(storageKey: string): Promise<Buffer> {
  return readFile(resolveAiImageStorageKey(storageKey));
}

export async function deleteAiImage(storageKey: string): Promise<void> {
  await rm(resolveAiImageStorageKey(storageKey), { force: true });
}

export async function cleanupAiImageTask(input: {
  accessMode: AiImageAccessMode;
  visitorAccessId?: string;
  taskId: string;
}): Promise<void> {
  const taskId = safeSegment(input.taskId, "task_id");
  const key = input.accessMode === "owner"
    ? `owner/${taskId}`
    : `visitor/${buildVisitorImageScope(input.visitorAccessId || "")}/${taskId}`;
  await rm(resolveAiImageStorageKey(key), { recursive: true, force: true });
}

export async function cleanupExpiredVisitorAiImages(input: {
  visitorAccessId: string;
  expiresAt: string;
  now?: number;
}): Promise<boolean> {
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt) || (input.now ?? Date.now()) < expiresAt + AI_IMAGE_VISITOR_GRACE_MS) return false;
  const visitorPath = resolveAiImageStorageKey(`visitor/${buildVisitorImageScope(input.visitorAccessId)}`);
  await rm(visitorPath, { recursive: true, force: true });
  return true;
}

export async function aiImageExists(storageKey: string): Promise<boolean> {
  try {
    return (await stat(resolveAiImageStorageKey(storageKey))).isFile();
  } catch {
    return false;
  }
}
