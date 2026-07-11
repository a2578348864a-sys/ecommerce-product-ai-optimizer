import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AiImageAccessMode, AiImageDraftType } from "@/lib/aiImageDraft";

export type AiImageLedgerStatus =
  | "reserved"
  | "provider_called"
  | "provider_result_received"
  | "asset_ingested"
  | "provider_succeeded"
  | "stored"
  | "committed"
  | "refunded"
  | "failed_non_refundable"
  | "failed_after_provider_result";

export type AiImageProviderStage =
  | "provider_not_called"
  | "provider_called"
  | "provider_result_received"
  | "asset_ingested"
  | "completed";

export type AiImageFailureStage =
  | "provider_call"
  | "provider_response"
  | "asset_download"
  | "asset_validation"
  | "asset_storage"
  | "snapshot_persistence";

export type AiImageLedgerEntry = {
  requestHash: string;
  idempotencyScopeHash?: string;
  taskId: string;
  accessMode: AiImageAccessMode;
  status: AiImageLedgerStatus;
  createdAt: string;
  updatedAt: string;
  itemIds: string[];
  errorCode?: string;
  providerStage?: AiImageProviderStage;
  providerCostConsumed?: boolean;
  failureStage?: AiImageFailureStage;
};

type AiImageLedgerStore = {
  version: 1;
  entries: AiImageLedgerEntry[];
};

function getLedgerPath(): string {
  if (process.env.AI_IMAGE_DRAFT_LEDGER_PATH) return resolve(process.env.AI_IMAGE_DRAFT_LEDGER_PATH);
  return resolve(process.cwd(), "data", "ai-image-drafts", "requests", "ledger.json");
}

function loadStore(): AiImageLedgerStore {
  const path = getLedgerPath();
  if (!existsSync(path)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed as AiImageLedgerStore;
  } catch {
    // Fail closed: a corrupt ledger cannot authorize another provider call.
  }
  throw new Error("AI_IMAGE_LEDGER_CORRUPT");
}

function saveStore(store: AiImageLedgerStore): void {
  const path = getLedgerPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(store, null, 2), "utf8");
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

type AiImageRequestIdentity = {
  accessMode: AiImageAccessMode;
  accessScope: string;
  taskId: string;
  idempotencyKey: string;
};

export function buildAiImageIdempotencyScopeHash(input: AiImageRequestIdentity): string {
  return createHash("sha256")
    .update(`${input.accessMode}\0${input.accessScope}\0${input.taskId}\0${input.idempotencyKey}`)
    .digest("hex");
}

export function buildAiImageRequestHash(input: AiImageRequestIdentity & {
  imageType: AiImageDraftType;
  count: 1 | 2;
  additionalDirection?: string;
}): string {
  return createHash("sha256")
    .update(`${buildAiImageIdempotencyScopeHash(input)}\0${input.imageType}\0${input.count}\0${input.additionalDirection || ""}`)
    .digest("hex");
}

export function beginAiImageRequest(input: {
  requestHash: string;
  idempotencyScopeHash: string;
  taskId: string;
  accessMode: AiImageAccessMode;
  now?: string;
}): { created: true; entry: AiImageLedgerEntry } | { created: false; conflict: boolean; entry: AiImageLedgerEntry } {
  const store = loadStore();
  const existing = store.entries.find((entry) => entry.requestHash === input.requestHash);
  if (existing) return { created: false, conflict: false, entry: existing };
  const conflicting = store.entries.find((entry) => (
    entry.idempotencyScopeHash === input.idempotencyScopeHash
    || (!entry.idempotencyScopeHash && entry.requestHash === input.idempotencyScopeHash)
  ));
  if (conflicting) return { created: false, conflict: true, entry: conflicting };
  const now = input.now || new Date().toISOString();
  const entry: AiImageLedgerEntry = {
    requestHash: input.requestHash,
    idempotencyScopeHash: input.idempotencyScopeHash,
    taskId: input.taskId,
    accessMode: input.accessMode,
    status: "reserved",
    createdAt: now,
    updatedAt: now,
    itemIds: [],
    providerStage: "provider_not_called",
    providerCostConsumed: false,
  };
  store.entries.push(entry);
  saveStore(store);
  return { created: true, entry };
}

export function updateAiImageRequest(input: {
  requestHash: string;
  status: AiImageLedgerStatus;
  itemIds?: string[];
  errorCode?: string;
  providerStage?: AiImageProviderStage;
  providerCostConsumed?: boolean;
  failureStage?: AiImageFailureStage;
  now?: string;
}): AiImageLedgerEntry | null {
  const store = loadStore();
  const entry = store.entries.find((item) => item.requestHash === input.requestHash);
  if (!entry) return null;
  if (["committed", "refunded", "failed_non_refundable", "failed_after_provider_result"].includes(entry.status)) {
    return entry;
  }
  entry.status = input.status;
  entry.updatedAt = input.now || new Date().toISOString();
  if (input.itemIds) entry.itemIds = [...new Set(input.itemIds)].slice(0, 2);
  if (input.errorCode) entry.errorCode = input.errorCode.slice(0, 100);
  if (input.providerStage) entry.providerStage = input.providerStage;
  if (input.providerCostConsumed !== undefined) {
    entry.providerCostConsumed = Boolean(entry.providerCostConsumed || input.providerCostConsumed);
  }
  if (input.failureStage) entry.failureStage = input.failureStage;
  saveStore(store);
  return entry;
}

export function getAiImageRequest(requestHash: string): AiImageLedgerEntry | null {
  return loadStore().entries.find((entry) => entry.requestHash === requestHash) || null;
}
