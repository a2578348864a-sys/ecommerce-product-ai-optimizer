/**
 * V3.1 Phase 2 — 文件存储原子性原语（D2）
 *
 * 全仓库唯一的跨进程文件锁 + 原子写机制（§8 / §9）：
 *   - withFileLock：openSync(lockPath, "wx") + 重试 + 陈旧锁清理（与 Phase 1 demo-access 锁同机制）；
 *     单实例部署下等价于进程内串行事务；跨进程（未来多实例）同样成立。
 *   - atomicWriteJson：temp 文件 → rename（EPERM/EEXIST 退化为 unlink+rename）。
 *
 * 禁止创建第二套互不协调的 mutex：demo-access / provider ledger 等全部复用本原语。
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCK_MAX_ATTEMPTS = 100;
const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 2 * 60 * 1000;

function waitSynchronously(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function ensureFileDir(storePath: string): void {
  const dir = resolve(storePath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 跨进程文件锁（wx 创建 + 重试 + 陈旧锁清理）。锁内操作必须同步完成。 */
export function withFileLock<T>(storePath: string, operation: () => T): T {
  ensureFileDir(storePath);
  const lockPath = `${storePath}.lock`;
  let lockFd: number | null = null;
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      lockFd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      waitSynchronously(LOCK_RETRY_MS);
    }
  }
  if (lockFd === null) throw new Error("file_store_busy");
  try {
    return operation();
  } finally {
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* another process can remove only a stale lock */ }
  }
}

/** 原子写：temp 文件 → rename（EPERM/EEXIST 退化为 unlink+rename）。 */
export function atomicWriteJson(storePath: string, data: unknown): void {
  ensureFileDir(storePath);
  const tempPath = `${storePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    try {
      renameSync(tempPath, storePath);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      if (existsSync(storePath)) unlinkSync(storePath);
      renameSync(tempPath, storePath);
    }
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

/** 读取 JSON store（损坏/缺失 → fallback）。 */
export function readJsonStore<T>(storePath: string, fallback: T): T {
  ensureFileDir(storePath);
  if (!existsSync(storePath)) return fallback;
  try {
    return JSON.parse(readFileSync(storePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}