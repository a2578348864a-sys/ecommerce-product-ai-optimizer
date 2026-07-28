import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  extractAiImageDraftSnapshot,
  isSafeAiImageStorageKey,
  normalizeAiImageDraftSnapshot,
  type AiImageAccessMode,
  type AiImageDraftSnapshot,
} from "@/lib/aiImageDraft";
import {
  buildVisitorImageScope,
  deleteAiImage,
} from "@/lib/server/aiImageDraftStorage";

export const STUDIO_IMAGE_RESULT_TTL_MS = 60 * 60 * 1_000;

type StudioImageManifest = {
  version: 1;
  accessMode: AiImageAccessMode;
  snapshot: AiImageDraftSnapshot;
  retiredStorageKeys: string[];
};

function resultRoot() {
  return resolve(process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || resolve(process.cwd(), "data", "studio-image-results"));
}

function manifestPath(accessMode: AiImageAccessMode, visitorAccessId?: string) {
  if (accessMode === "owner") return resolve(resultRoot(), "owner.json");
  if (!visitorAccessId) throw new Error("STUDIO_IMAGE_VISITOR_SCOPE_MISSING");
  const subject = createHash("sha256").update(visitorAccessId).digest("hex");
  return resolve(resultRoot(), `visitor-${subject}.json`);
}

function expectedStoragePrefix(accessMode: AiImageAccessMode, visitorAccessId?: string) {
  if (accessMode === "owner") return "owner/studio-image/";
  if (!visitorAccessId) throw new Error("STUDIO_IMAGE_VISITOR_SCOPE_MISSING");
  return `visitor/${buildVisitorImageScope(visitorAccessId)}/studio-image/`;
}

function validateScopedKeys(
  keys: string[],
  accessMode: AiImageAccessMode,
  visitorAccessId?: string,
) {
  const prefix = expectedStoragePrefix(accessMode, visitorAccessId);
  if (keys.length > 200 || keys.some((key) => !isSafeAiImageStorageKey(key) || !key.startsWith(prefix))) {
    throw new Error("STUDIO_IMAGE_MANIFEST_CORRUPT");
  }
}

function validateManifest(
  value: unknown,
  accessMode: AiImageAccessMode,
  visitorAccessId?: string,
): StudioImageManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STUDIO_IMAGE_MANIFEST_CORRUPT");
  const record = value as Record<string, unknown>;
  const rawSnapshot = record.snapshot;
  const snapshot = normalizeAiImageDraftSnapshot(rawSnapshot);
  const rawItems = rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)
    ? (rawSnapshot as Record<string, unknown>).items
    : null;
  const rawRetired = record.retiredStorageKeys === undefined ? [] : record.retiredStorageKeys;
  if (
    record.version !== 1
    || record.accessMode !== accessMode
    || !snapshot
    || snapshot.accessMode !== accessMode
    || !Array.isArray(rawItems)
    || rawItems.length !== snapshot.items.length
    || !Array.isArray(rawRetired)
    || rawRetired.some((key) => typeof key !== "string")
  ) {
    throw new Error("STUDIO_IMAGE_MANIFEST_CORRUPT");
  }
  const retiredStorageKeys = [...new Set(rawRetired as string[])];
  if (retiredStorageKeys.length !== rawRetired.length) throw new Error("STUDIO_IMAGE_MANIFEST_CORRUPT");
  validateScopedKeys(
    [...snapshot.items.map((item) => item.storageKey), ...retiredStorageKeys],
    accessMode,
    visitorAccessId,
  );
  return { version: 1, accessMode, snapshot, retiredStorageKeys };
}

async function readManifest(
  accessMode: AiImageAccessMode,
  visitorAccessId?: string,
): Promise<StudioImageManifest | null> {
  const path = manifestPath(accessMode, visitorAccessId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("STUDIO_IMAGE_MANIFEST_CORRUPT");
  }
  return validateManifest(parsed, accessMode, visitorAccessId);
}

async function saveManifest(
  accessMode: AiImageAccessMode,
  visitorAccessId: string | undefined,
  snapshot: AiImageDraftSnapshot,
  retiredStorageKeys: string[] = [],
) {
  validateScopedKeys(
    [...snapshot.items.map((item) => item.storageKey), ...retiredStorageKeys],
    accessMode,
    visitorAccessId,
  );
  const root = resultRoot();
  const path = manifestPath(accessMode, visitorAccessId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const temp = resolve(root, `.manifest-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  try {
    const payload: StudioImageManifest = { version: 1, accessMode, snapshot, retiredStorageKeys };
    await writeFile(temp, JSON.stringify(payload), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

async function persistAndCleanup(input: {
  accessMode: AiImageAccessMode;
  visitorAccessId?: string;
  snapshot: AiImageDraftSnapshot;
  retiredStorageKeys: string[];
}) {
  const activeKeys = new Set(input.snapshot.items.map((item) => item.storageKey));
  const pending = [...new Set(input.retiredStorageKeys)].filter((key) => !activeKeys.has(key));
  validateScopedKeys(pending, input.accessMode, input.visitorAccessId);

  // Persist the cleanup intent before deleting any file so failures remain recoverable.
  await saveManifest(input.accessMode, input.visitorAccessId, input.snapshot, pending);
  const failed: string[] = [];
  for (const storageKey of pending) {
    try {
      await deleteAiImage(storageKey);
    } catch {
      failed.push(storageKey);
    }
  }

  const path = manifestPath(input.accessMode, input.visitorAccessId);
  if (input.snapshot.items.length === 0 && failed.length === 0) {
    await rm(path, { force: true });
    return;
  }
  if (failed.length !== pending.length) {
    try {
      await saveManifest(input.accessMode, input.visitorAccessId, input.snapshot, failed);
    } catch {
      // The primary manifest already contains a safe superset of cleanup intent.
      // Leave it for an idempotent retry instead of invalidating the committed snapshot.
    }
  }
}

export async function loadStudioImageSnapshot(input: {
  accessMode: AiImageAccessMode;
  visitorAccessId?: string;
  now?: number;
}): Promise<AiImageDraftSnapshot | null> {
  const manifest = await readManifest(input.accessMode, input.visitorAccessId);
  if (!manifest) return null;

  const now = input.now ?? Date.now();
  const cutoff = now - STUDIO_IMAGE_RESULT_TTL_MS;
  const active = manifest.snapshot.items.filter((item) => Date.parse(item.createdAt) > cutoff);
  const expired = manifest.snapshot.items.filter((item) => !active.includes(item));
  if (expired.length === 0 && manifest.retiredStorageKeys.length === 0) return manifest.snapshot;

  const snapshot = {
    ...manifest.snapshot,
    items: active,
    updatedAt: expired.length > 0 ? new Date(now).toISOString() : manifest.snapshot.updatedAt,
  };
  await persistAndCleanup({
    accessMode: input.accessMode,
    visitorAccessId: input.visitorAccessId,
    snapshot,
    retiredStorageKeys: [
      ...manifest.retiredStorageKeys,
      ...expired.map((item) => item.storageKey),
    ],
  });
  return active.length > 0 ? snapshot : null;
}

export async function saveStudioImageSnapshot(input: {
  accessMode: AiImageAccessMode;
  visitorAccessId?: string;
  result: Record<string, unknown>;
}) {
  const snapshot = extractAiImageDraftSnapshot(input.result);
  if (!snapshot || snapshot.accessMode !== input.accessMode) throw new Error("STUDIO_IMAGE_MANIFEST_INVALID_RESULT");
  validateScopedKeys(
    snapshot.items.map((item) => item.storageKey),
    input.accessMode,
    input.visitorAccessId,
  );

  const previous = await readManifest(input.accessMode, input.visitorAccessId);
  const retained = new Set(snapshot.items.map((item) => item.storageKey));
  const evicted = previous?.snapshot.items
    .filter((item) => !retained.has(item.storageKey))
    .map((item) => item.storageKey) || [];
  await persistAndCleanup({
    accessMode: input.accessMode,
    visitorAccessId: input.visitorAccessId,
    snapshot,
    retiredStorageKeys: [...(previous?.retiredStorageKeys || []), ...evicted],
  });
}
