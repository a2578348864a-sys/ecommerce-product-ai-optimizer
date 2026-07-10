import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AiImageAccessMode } from "@/lib/aiImageDraft";

export type AiImageLedgerStatus =
  | "reserved"
  | "provider_succeeded"
  | "stored"
  | "committed"
  | "refunded"
  | "failed_non_refundable";

export type AiImageLedgerEntry = {
  requestHash: string;
  taskId: string;
  accessMode: AiImageAccessMode;
  status: AiImageLedgerStatus;
  createdAt: string;
  updatedAt: string;
  itemIds: string[];
  errorCode?: string;
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

export function buildAiImageRequestHash(input: {
  accessMode: AiImageAccessMode;
  accessScope: string;
  taskId: string;
  idempotencyKey: string;
}): string {
  return createHash("sha256")
    .update(`${input.accessMode}\0${input.accessScope}\0${input.taskId}\0${input.idempotencyKey}`)
    .digest("hex");
}

export function beginAiImageRequest(input: {
  requestHash: string;
  taskId: string;
  accessMode: AiImageAccessMode;
  now?: string;
}): { created: true; entry: AiImageLedgerEntry } | { created: false; entry: AiImageLedgerEntry } {
  const store = loadStore();
  const existing = store.entries.find((entry) => entry.requestHash === input.requestHash);
  if (existing) return { created: false, entry: existing };
  const now = input.now || new Date().toISOString();
  const entry: AiImageLedgerEntry = {
    requestHash: input.requestHash,
    taskId: input.taskId,
    accessMode: input.accessMode,
    status: "reserved",
    createdAt: now,
    updatedAt: now,
    itemIds: [],
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
  now?: string;
}): AiImageLedgerEntry | null {
  const store = loadStore();
  const entry = store.entries.find((item) => item.requestHash === input.requestHash);
  if (!entry) return null;
  if (entry.status === "committed" || entry.status === "refunded" || entry.status === "failed_non_refundable") {
    return entry;
  }
  entry.status = input.status;
  entry.updatedAt = input.now || new Date().toISOString();
  if (input.itemIds) entry.itemIds = [...new Set(input.itemIds)].slice(0, 2);
  if (input.errorCode) entry.errorCode = input.errorCode.slice(0, 100);
  saveStore(store);
  return entry;
}

export function getAiImageRequest(requestHash: string): AiImageLedgerEntry | null {
  return loadStore().entries.find((entry) => entry.requestHash === requestHash) || null;
}
