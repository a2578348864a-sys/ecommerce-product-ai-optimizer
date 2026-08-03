import "server-only";
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
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { DemoSandboxStore, SandboxTask } from "@/lib/server/demoSandbox";

function getStorePath(): string {
  if (process.env.DEMO_SANDBOX_STORE_PATH) return process.env.DEMO_SANDBOX_STORE_PATH;
  if (process.env.NODE_ENV === "test") {
    return resolve(process.cwd(), ".next", "test-stores", "demo-sandbox.default.json");
  }
  return resolve(process.cwd(), "data", "demo-sandbox.json");
}

function recoverBackup(storePath: string): void {
  const backupPath = `${storePath}.backup`;
  if (existsSync(storePath)) {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    return;
  }
  if (existsSync(backupPath)) renameSync(backupPath, storePath);
}

function loadStrict(): DemoSandboxStore {
  const storePath = getStorePath();
  mkdirSync(resolve(storePath, ".."), { recursive: true });
  recoverBackup(storePath);
  if (!existsSync(storePath)) return { version: 1, tasks: [], candidates: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8"));
  } catch {
    throw new Error("DEMO_SANDBOX_STORE_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null
    || (parsed as { version?: unknown }).version !== 1
    || !Array.isArray((parsed as { tasks?: unknown }).tasks)
    || !Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    throw new Error("DEMO_SANDBOX_STORE_INVALID");
  }
  return parsed as DemoSandboxStore;
}

function saveAtomic(store: DemoSandboxStore): void {
  const storePath = getStorePath();
  const backupPath = `${storePath}.backup`;
  const tempPath = `${storePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  mkdirSync(resolve(storePath, ".."), { recursive: true });
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
          try { renameSync(backupPath, storePath); } catch { /* retain backup */ }
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

const taskLocks = new Map<string, Promise<void>>();

function withSubjectLock<T>(demoAccessId: string, action: () => T | Promise<T>): Promise<T> {
  const key = `${getStorePath().toLowerCase()}::${demoAccessId}`;
  const previous = taskLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => { release = resolveLock; });
  const queued = previous.then(() => current);
  taskLocks.set(key, queued);
  return previous.then(action).finally(() => {
    release();
    if (taskLocks.get(key) === queued) taskLocks.delete(key);
  });
}

export function mutateSandboxTaskResultJsonInternal<T>(
  demoAccessId: string,
  taskId: string,
  action: (task: SandboxTask) => Promise<{ task: SandboxTask; value: T }> | { task: SandboxTask; value: T },
): Promise<{ status: "updated"; task: SandboxTask; value: T } | { status: "not_found" }> {
  return withSubjectLock(demoAccessId, async () => {
    const store = loadStrict();
    const index = store.tasks.findIndex(
      (task) => task.id === taskId && task.demoAccessId === demoAccessId,
    );
    if (index === -1) return { status: "not_found" as const };
    const current = structuredClone(store.tasks[index]);
    const result = await action(current);
    if (result.task.id !== current.id || result.task.demoAccessId !== current.demoAccessId) {
      throw new Error("SANDBOX_TASK_IDENTITY_MUTATION_FORBIDDEN");
    }
    saveAtomic({
      version: 1,
      tasks: store.tasks.map((task, taskIndex) => taskIndex === index ? result.task : task),
      candidates: store.candidates,
    });
    return { status: "updated" as const, task: result.task, value: result.value };
  });
}
