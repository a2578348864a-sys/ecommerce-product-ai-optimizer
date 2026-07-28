import "server-only";

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateAiListingPackDraft,
  type AiListingPackDraft,
} from "@/lib/aiListingDraft";
import type { AiImageAccessMode } from "@/lib/aiImageDraft";

export const STUDIO_LISTING_RESULT_TTL_MS = 60 * 60 * 1_000;

type StudioListingResultManifest = {
  version: 1;
  accessMode: AiImageAccessMode;
  requestHash: string;
  idempotencyScopeHash: string;
  createdAt: string;
  data: AiListingPackDraft;
};

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function resultRoot() {
  return resolve(process.env.STUDIO_LISTING_RESULT_STORE_ROOT
    || resolve(process.cwd(), "data", "studio-listing-results"));
}

function resultPath(requestHash: string) {
  if (!HASH_PATTERN.test(requestHash)) throw new Error("STUDIO_LISTING_RESULT_ID_INVALID");
  return resolve(resultRoot(), `${requestHash}.json`);
}

function validateManifest(
  value: unknown,
  expected: {
    accessMode: AiImageAccessMode;
    requestHash: string;
    idempotencyScopeHash: string;
  },
): StudioListingResultManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("STUDIO_LISTING_RESULT_CORRUPT");
  }
  const record = value as Record<string, unknown>;
  const validated = validateAiListingPackDraft(record.data);
  if (
    record.version !== 1
    || record.accessMode !== expected.accessMode
    || record.requestHash !== expected.requestHash
    || record.idempotencyScopeHash !== expected.idempotencyScopeHash
    || typeof record.createdAt !== "string"
    || Number.isNaN(Date.parse(record.createdAt))
    || !validated.ok
    || validated.data.source !== "real_ai_draft"
  ) {
    throw new Error("STUDIO_LISTING_RESULT_CORRUPT");
  }
  return {
    version: 1,
    accessMode: expected.accessMode,
    requestHash: expected.requestHash,
    idempotencyScopeHash: expected.idempotencyScopeHash,
    createdAt: record.createdAt,
    data: validated.data,
  };
}

export async function loadStudioListingResult(input: {
  accessMode: AiImageAccessMode;
  requestHash: string;
  idempotencyScopeHash: string;
  now?: number;
}): Promise<AiListingPackDraft | null> {
  const path = resultPath(input.requestHash);
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
    throw new Error("STUDIO_LISTING_RESULT_CORRUPT");
  }
  const manifest = validateManifest(parsed, input);
  if ((input.now ?? Date.now()) - Date.parse(manifest.createdAt) >= STUDIO_LISTING_RESULT_TTL_MS) {
    await rm(path, { force: true });
    return null;
  }
  return manifest.data;
}

export async function saveStudioListingResult(input: {
  accessMode: AiImageAccessMode;
  requestHash: string;
  idempotencyScopeHash: string;
  data: AiListingPackDraft;
  now?: string;
}): Promise<void> {
  const validated = validateAiListingPackDraft(input.data);
  if (!validated.ok || validated.data.source !== "real_ai_draft") {
    throw new Error("STUDIO_LISTING_RESULT_INVALID");
  }
  const root = resultRoot();
  const path = resultPath(input.requestHash);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const temp = resolve(root, `.result-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  try {
    const payload: StudioListingResultManifest = {
      version: 1,
      accessMode: input.accessMode,
      requestHash: input.requestHash,
      idempotencyScopeHash: input.idempotencyScopeHash,
      createdAt: input.now || new Date().toISOString(),
      data: validated.data,
    };
    await writeFile(temp, JSON.stringify(payload), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}
