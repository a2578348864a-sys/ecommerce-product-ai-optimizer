/**
 * V3.1 Phase 2 — Global Provider Usage Ledger（成本 Authority，§13-18）
 *
 * 全局每日 Provider 调用硬上限，独立于 Guest quota（§13）：
 *   攻击者清 Cookie / 无痕 / 重开 Guest 也绕不过全局预算。
 *
 * 配置（ENV CONFIGURABLE，禁止 undefined→unlimited）：
 *   PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP  缺省 200（Phase 0 Cost Contract RECOMMENDED 档）
 *   PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP 缺省 40
 *
 * 存储：data/provider-usage.json（新“成本 Authority”，不是第二 Guest Quota Store；§16）。
 * 原子性：复用 atomicFileStore 同一文件锁机制（§8 / §17：GLOBAL_CAP_ATOMICITY）。
 * 生效范围：仅 PUBLIC_SHOWCASE（local_owner/legacy 由管理员自行控制）。
 */
import "server-only";
import { resolve } from "node:path";
import { withFileLock, atomicWriteJson, readJsonStore } from "@/lib/server/atomicFileStore";
import { isPublicShowcase } from "@/lib/server/runtimeMode";

export type ProviderKind = "text" | "image";

export const PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV = "PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP";
export const PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP_ENV = "PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP";

/** Phase 0 Cost Contract：call count hard cap（RECOMMENDED 档），ENV 可覆盖。 */
export function getDailyProviderCap(kind: ProviderKind): number {
  const envName = kind === "text" ? PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV : PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP_ENV;
  const raw = (process.env[envName] || "").trim();
  const fallback = kind === "text" ? 200 : 40;
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function getStorePath(): string {
  if (process.env.PROVIDER_USAGE_STORE_PATH) return process.env.PROVIDER_USAGE_STORE_PATH;
  if (process.env.NODE_ENV === "test") {
    return resolve(process.cwd(), ".next", "test-stores", "provider-usage.default.json");
  }
  return resolve(process.cwd(), "data", "provider-usage.json");
}

interface ProviderUsageLedger {
  version: 1;
  day: string;
  textCalls: number;
  imageCalls: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyLedger(): ProviderUsageLedger {
  return { version: 1, day: todayKey(), textCalls: 0, imageCalls: 0 };
}

function loadLedger(): ProviderUsageLedger {
  const ledger = readJsonStore<ProviderUsageLedger>(getStorePath(), emptyLedger());
  if (ledger?.version !== 1 || !ledger.day) return emptyLedger();
  if (ledger.day !== todayKey()) {
    ledger.day = todayKey();
    ledger.textCalls = 0;
    ledger.imageCalls = 0;
  }
  return ledger;
}

export type GlobalReserveResult =
  | { ok: true }
  | { ok: false; code: "global_provider_cap_exceeded" };

function ledgerField(ledger: ProviderUsageLedger, kind: ProviderKind): number {
  return kind === "text" ? ledger.textCalls : ledger.imageCalls;
}

function addLedgerCalls(ledger: ProviderUsageLedger, kind: ProviderKind, delta: number): void {
  if (kind === "text") ledger.textCalls = Math.max(0, ledger.textCalls + delta);
  else ledger.imageCalls = Math.max(0, ledger.imageCalls + delta);
}

/**
 * 全局预留（在调用方同一事务内串行；与 guest quota 原子性联动，§17）。
 * 仅 PUBLIC_SHOWCASE 启用；调用方失败路径必须调用 refundGlobalProviderCalls 回补。
 */
export function reserveGlobalProviderCalls(kind: ProviderKind, count: number): GlobalReserveResult {
  if (!isPublicShowcase()) return { ok: true };
  if (!Number.isInteger(count) || count <= 0) return { ok: true };
  return withFileLock(getStorePath(), () => {
    const ledger = loadLedger();
    if (ledgerField(ledger, kind) + count > getDailyProviderCap(kind)) {
      return { ok: false, code: "global_provider_cap_exceeded" } as const;
    }
    addLedgerCalls(ledger, kind, count);
    atomicWriteJson(getStorePath(), ledger);
    return { ok: true } as const;
  });
}

/** 回补全局预留（仅当 Provider 调用未发生时的确定性失败路径；§7）。 */
export function refundGlobalProviderCalls(kind: ProviderKind, count: number): void {
  if (!isPublicShowcase() || !Number.isInteger(count) || count <= 0) return;
  withFileLock(getStorePath(), () => {
    const ledger = loadLedger();
    addLedgerCalls(ledger, kind, -count);
    atomicWriteJson(getStorePath(), ledger);
  });
}

export interface GlobalProviderUsageSnapshot {
  text: { used: number; cap: number; exhausted: boolean };
  image: { used: number; cap: number; exhausted: boolean };
}

/** 只读快照（供 UI 区分「本次体验额度」与「今日公开额度」，§39）。 */
export function getGlobalProviderUsage(): GlobalProviderUsageSnapshot {
  const ledger = loadLedger();
  const text = { used: ledger.textCalls, cap: getDailyProviderCap("text") };
  const image = { used: ledger.imageCalls, cap: getDailyProviderCap("image") };
  return {
    text: { ...text, exhausted: text.used >= text.cap },
    image: { ...image, exhausted: image.used >= image.cap },
  };
}