import "server-only";

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { DemoSandboxStore } from "@/lib/server/demoSandbox";

type StoreMutation<T> = {
  readonly value: T;
  readonly changed: boolean;
};

const storeLocks = new Map<string, Promise<void>>();

function getStorePath(): string {
  if (process.env.DEMO_SANDBOX_STORE_PATH) return resolve(process.env.DEMO_SANDBOX_STORE_PATH);
  if (process.env.NODE_ENV === "test") {
    return resolve(process.cwd(), ".next", "test-stores", "demo-sandbox.default.json");
  }
  return resolve(process.cwd(), "data", "demo-sandbox.json");
}

function getStoreLockKey(): string {
  return getStorePath().normalize("NFC").replaceAll("\\", "/").toLowerCase();
}

function ensureDirectory(storePath: string): void {
  mkdirSync(dirname(storePath), { recursive: true });
}

function recoverBackup(storePath: string): void {
  const backupPath = `${storePath}.backup`;
  if (existsSync(storePath)) {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    return;
  }
  if (existsSync(backupPath)) renameSync(backupPath, storePath);
}

function emptyStore(): DemoSandboxStore {
  return { version: 1, tasks: [], candidates: [] };
}

function isStore(value: unknown): value is DemoSandboxStore {
  return typeof value === "object"
    && value !== null
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { tasks?: unknown }).tasks)
    && Array.isArray((value as { candidates?: unknown }).candidates);
}

function readStore(strict: boolean): DemoSandboxStore {
  const storePath = getStorePath();
  ensureDirectory(storePath);
  recoverBackup(storePath);
  if (!existsSync(storePath)) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
    if (isStore(parsed)) return parsed;
  } catch {
    if (strict) throw new Error("DEMO_SANDBOX_STORE_INVALID");
  }
  if (strict) throw new Error("DEMO_SANDBOX_STORE_INVALID");
  return emptyStore();
}

function saveStoreAtomic(store: DemoSandboxStore): void {
  if (!isStore(store)) throw new Error("DEMO_SANDBOX_STORE_INVALID");
  const storePath = getStorePath();
  const backupPath = `${storePath}.backup`;
  const tempPath = `${storePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  ensureDirectory(storePath);
  recoverBackup(storePath);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(tempPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    try {
      renameSync(tempPath, storePath);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      let originalMoved = false;
      if (existsSync(storePath)) {
        renameSync(storePath, backupPath);
        originalMoved = true;
      }
      try {
        renameSync(tempPath, storePath);
      } catch (replacementError) {
        if (originalMoved && existsSync(backupPath) && !existsSync(storePath)) {
          try { renameSync(backupPath, storePath); } catch { /* preserve recovery copy */ }
        }
        throw replacementError;
      }
      if (originalMoved && existsSync(backupPath)) unlinkSync(backupPath);
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

async function withStoreLock<T>(action: () => Promise<T>): Promise<T> {
  const key = getStoreLockKey();
  const previous = storeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => { release = resolveLock; });
  const queued = previous.then(() => current);
  storeLocks.set(key, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (storeLocks.get(key) === queued) storeLocks.delete(key);
  }
}

export function readDemoSandboxStore(): DemoSandboxStore {
  return readStore(false);
}

/**
 * Quota migration must fail closed when an existing sandbox file is corrupt;
 * silently treating corrupt history as an empty store would grant fresh slots.
 */
export function readDemoSandboxStoreStrict(): DemoSandboxStore {
  return readStore(true);
}

export function mutateDemoSandboxStore<T>(
  action: (store: DemoSandboxStore) => StoreMutation<T> | Promise<StoreMutation<T>>,
): Promise<T> {
  return withStoreLock(async () => {
    const store = readStore(true);
    const mutation = await action(store);
    if (mutation.changed) saveStoreAtomic(store);
    return mutation.value;
  });
}
