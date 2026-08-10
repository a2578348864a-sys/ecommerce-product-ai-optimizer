/**
 * Smoke One-Shot Authorization Guard（R1.6）
 *
 * 修复 R1.5 重复运行 vitest 导致真实调用超限的问题：
 * providerCallsStarted 计数只存在单进程内，跨进程无法防止重复运行。
 *
 * 合同：
 * - 每次真实 Smoke 必须提供 SMOKE_AUTHORIZATION_ID
 * - 首次使用原子 claim 成功（create-if-absent）
 * - 同一 authorization ID 再次运行 → Provider 调用前拒绝
 * - ledger 放系统 TEMP（不入 Git 业务数据、不含 Secret）
 * - 并发下只有一个进程能 claim 成功（原子 create）
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LEDGER_DIR = "qingxuan-smoke-one-shot";
const LEDGER_FILE = "ledger.json";

function ledgerDir(): string {
  return process.env.SMOKE_GUARD_DIR || join(tmpdir(), LEDGER_DIR);
}

function ledgerPath(): string {
  return join(ledgerDir(), LEDGER_FILE);
}

function loadLedger(): string[] {
  try {
    if (!existsSync(ledgerPath())) return [];
    const raw = JSON.parse(readFileSync(ledgerPath(), "utf8"));
    return Array.isArray(raw.authorizationIds) ? raw.authorizationIds.filter((v: unknown) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 原子 claim 一个 authorization id（create-if-absent）。
 * 返回 "claimed"（本进程成功）或 "already_claimed"（此前已 claim）。
 * 并发安全：写文件用 flag "wx"（独占创建）保证只有一个进程成功。
 */
export function claimSmokeAuthorization(authorizationId: string): "claimed" | "already_claimed" {
  const normalized = authorizationId.trim();
  if (!normalized) throw new Error("smoke_authorization_id_required");
  if (normalized.length > 128) throw new Error("smoke_authorization_id_too_long");

  if (loadLedger().includes(normalized)) return "already_claimed";

  // 原子：独占创建锁文件 → 读-改-写回 ledger
  mkdirSync(ledgerDir(), { recursive: true });
  const lockPath = join(ledgerDir(), `${normalized}.lock`);
  let lockHandle: number | null = null;
  try {
    lockHandle = openSync(lockPath, "wx");
  } catch {
    // 并发竞争者已持锁 → 重新检查 ledger
    return loadLedger().includes(normalized) ? "already_claimed" : "already_claimed";
  }

  try {
    const ids = loadLedger();
    if (ids.includes(normalized)) return "already_claimed";
    ids.push(normalized);
    writeFileSync(ledgerPath(), JSON.stringify({ version: 1, authorizationIds: ids }, null, 2), { encoding: "utf8" });
    return "claimed";
  } finally {
    if (lockHandle !== null) {
      try { rmSync(lockPath, { force: true }); } catch { /* best effort */ }
    }
  }
}

/** 生成全新 authorization id（每次真实授权产生一次，由用户/任务提供） */
export function generateSmokeAuthorizationId(): string {
  return randomUUID();
}

/** 测试辅助：清空 ledger（仅测试环境使用） */
export function resetSmokeAuthorizationLedger(): void {
  rmSync(ledgerPath(), { force: true });
  rmSync(ledgerDir(), { recursive: true, force: true });
}
