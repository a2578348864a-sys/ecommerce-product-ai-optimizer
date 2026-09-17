/**
 * Phase Demo-Login.1-B — DemoAccess File Store
 *
 * Pure server module. Manages demo access records in data/demo-access.json.
 * Uses Node.js built-in crypto (SHA-256 + random salt) — no bcrypt dependency.
 * No plain-text passwords persisted to disk.
 *
 * This module does NOT:
 * - Read .env
 * - Call AI
 * - Touch Prisma / database
 * - Depend on browser APIs
 */

import "server-only";
import { randomBytes, createHash } from "crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { resolve } from "path";
import { withFileLock, atomicWriteJson, readJsonStore } from "@/lib/server/atomicFileStore";
import { reserveGlobalProviderCalls, refundGlobalProviderCalls, type ProviderKind } from "@/lib/server/providerUsageLedger";

export const DEMO_TEXT_AI_RESERVATION_LEASE_MS = 5 * 60 * 1000;
export const DEMO_IMAGE_AI_RESERVATION_LEASE_MS = 30 * 60 * 1000;
export const DEMO_AI_JOB_TYPES = [
  "product_research",
  "listing_generation",
  "image_generation",
] as const;
export type DemoAiJobType = typeof DEMO_AI_JOB_TYPES[number];
export const DEMO_STANDALONE_LISTING_LIMIT = 3;
export const DEMO_STANDALONE_IMAGE_UNIT_LIMIT = 3;
export type DemoStandaloneStudioKind = "listing" | "image";

// ── V3.1 Phase 1: Public guest quota（契约 04-2 / §24，ENV CONFIGURABLE，禁止散落硬编码）──
export const PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA_ENV = "PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA";
export const PUBLIC_GUEST_LISTING_GENERATION_QUOTA_ENV = "PUBLIC_GUEST_LISTING_GENERATION_QUOTA";
export const PUBLIC_GUEST_IMAGE_GENERATION_QUOTA_ENV = "PUBLIC_GUEST_IMAGE_GENERATION_QUOTA";

function readQuotaEnv(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA（缺省 0 = 研究/AI 动作 OFF，fail-closed）。 */
export function getPublicGuestResearchQuota(): number {
  return readQuotaEnv(PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA_ENV, 0);
}

/** PUBLIC_GUEST_LISTING_GENERATION_QUOTA / IMAGE（缺省 1，ENV 可配）。 */
export function getPublicGuestStandaloneLimit(kind: DemoStandaloneStudioKind): number {
  return kind === "listing"
    ? readQuotaEnv(PUBLIC_GUEST_LISTING_GENERATION_QUOTA_ENV, 1)
    : readQuotaEnv(PUBLIC_GUEST_IMAGE_GENERATION_QUOTA_ENV, 1);
}

/** 显式凭据判别（契约 02 / §9）；缺省 = "password"（遗留兼容）。 */
export type DemoAccessCredentialKind = "password" | "anonymous";

export function getCredentialKind(record: Pick<DemoAccessRecord, "credentialKind">): DemoAccessCredentialKind {
  return record.credentialKind === "anonymous" ? "anonymous" : "password";
}

// ── Types ───────────────────────────────────────

export interface DemoAccessRecord {
  id: string;
  label: string;
  /** 有口令记录必填；匿名记录缺省不写（契约 02：不得以 hash 缺失作为唯一隐式判别）。 */
  passwordHash?: string;
  salt?: string;
  /** V3.1 Phase 1：显式凭据判别（§9）。缺省 = "password"（遗留兼容）。 */
  credentialKind?: DemoAccessCredentialKind;
  /** Legacy compatibility field. V2.1.7 keeps Visitor codes non-expiring and persists null. */
  expiresAt: string | null;
  maxAiCalls: number;
  usedAiCalls: number;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  notes: string;
  /**
   * V2.1.7 Visitor product-journey quota.
   *
   * This is intentionally separate from the legacy AI-job ledger below. A
   * product journey is bound to one stable candidate/manual-product identity
   * and is never incremented by Listing/Image Provider calls.
   */
  productJourneyReservations?: Record<string, {
    identity: string;
    requestId: string;
    status: "reserved" | "committed" | "released";
    createdAt: string;
    updatedAt: string;
    leaseExpiresAt: string;
    committedAt?: string;
    releasedAt?: string;
    source: "current" | "legacy_sandbox";
  }>;
  productJourneyMigration?: {
    version: "sandbox-product-journeys-v1";
    migratedAt: string;
    sourceTaskCount: number;
    sourceCandidateCount: number;
  };
  /** V2.2.6 standalone Studio quota, independent from product research journeys. */
  standaloneListingUsed?: number;
  standaloneImageUnitsUsed?: number;
  standaloneStudioQuotaReservations?: Record<string, {
    kind: DemoStandaloneStudioKind;
    requestId: string;
    units: number;
    status: "reserved" | "committed" | "released";
    createdAt: string;
    updatedAt: string;
    leaseExpiresAt?: string;
    providerStartedAt?: string;
    releasedAt?: string;
  }>;
  aiImageQuotaReservations?: Record<string, {
    count: number;
    status: "reserved" | "committed" | "refunded";
    createdAt: string;
    updatedAt: string;
    kind?: "text" | "image";
    leaseExpiresAt?: string;
    chargedCount?: number;
    providerStartedCount?: number;
    providerStartedAt?: string;
    quotaMetric?: "ai_jobs_v1";
    jobType?: DemoAiJobType;
    jobRequestId?: string;
    providerCallsPlanned?: number;
    providerCallsCompleted?: number;
    providerCallsFailed?: number;
    settledAt?: string;
  }>;
}

export interface DemoAccessStore {
  version: 1;
  accesses: DemoAccessRecord[];
}

export interface CreateDemoAccessInput {
  label: string;
  /** @deprecated Visitor codes no longer have a time-based lifetime. */
  hours?: number;
  /** @deprecated Legacy standalone Provider-cost ledger; not a product quota. */
  maxAiCalls?: number;
  /** V3.1 Phase 1：anonymous 记录不生成 passwordHash/salt，研究配额取 env 缺省 0。 */
  credentialKind?: DemoAccessCredentialKind;
  notes?: string;
  /** @deprecated Visitor codes no longer expire by time; retained for script compatibility. */
  startFromCreation?: boolean;
}

export interface CreateDemoAccessOutput {
  record: DemoAccessRecord;
  plainPassword: string;
}

// ── File path ───────────────────────────────────

function getStorePath(): string {
  // Allow tests to override via env var
  if (process.env.DEMO_ACCESS_STORE_PATH) {
    return process.env.DEMO_ACCESS_STORE_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return resolve(process.cwd(), ".next", "test-stores", "demo-access.default.json");
  }
  const dataDir = resolve(process.cwd(), "data");
  return resolve(dataDir, "demo-access.json");
}

function ensureDataDir(): void {
  const p = getStorePath();
  const dir = resolve(p, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Crypto ──────────────────────────────────────

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string): string {
  const h = createHash("sha256").update(salt + password).digest("hex");
  return `sha256:${h}`;
}

export function verifyDemoPassword(password: string, storedHash: string | undefined, salt: string | undefined): boolean {
  if (!storedHash || !salt) return false; // 缺 hash 的记录（含匿名）永远不通过密码校验（契约 02-9）
  const { hash } = makeHash(password, salt);
  return hash === storedHash;
}

function makeHash(password: string, salt: string): { hash: string; salt: string } {
  return { hash: hashPassword(password, salt), salt };
}

export function generateDemoPassword(): string {
  return randomBytes(12).toString("base64url");
}

export function generateDemoId(): string {
  return `demo_${randomBytes(8).toString("hex")}`;
}

// ── Store I/O（D2：统一复用 atomicFileStore 锁 + 原子写，禁止第二套 mutex）──

export function loadDemoAccessStore(): DemoAccessStore {
  return readJsonStore<DemoAccessStore>(getStorePath(), { version: 1, accesses: [] });
}

export function saveDemoAccessStore(store: DemoAccessStore): void {
  atomicWriteJson(getStorePath(), store);
}

/**
 * demo-access 统一串行事务（D2，§8）：所有 guest quota mutation / reservation /
 * guest creation 都经由此锁；内部再嵌套 provider ledger 锁（固定 demo→ledger 顺序，无死锁）。
 */
export function withDemoAccessStoreTransaction<T>(operation: (store: DemoAccessStore) => T): T {
  return withFileLock(getStorePath(), () => {
    const store = loadDemoAccessStore();
    const result = operation(store);
    saveDemoAccessStore(store);
    return result;
  });
}

// ── CRUD ────────────────────────────────────────

export function createDemoAccess(input: CreateDemoAccessInput): CreateDemoAccessOutput {
  return withDemoAccessStoreTransaction((store) => {
  const anonymous = input.credentialKind === "anonymous";
  let plainPassword = "";
  let salt: string | undefined;
  let passwordHash: string | undefined;
  if (!anonymous) {
    plainPassword = generateDemoPassword();
    salt = generateSalt();
    passwordHash = hashPassword(plainPassword, salt);
  }
  const now = new Date();
  // V2.1.7: Visitor-code lifetime is no longer time based. Login tokens remain short lived.
  const expiresAt = null;

  const record: DemoAccessRecord = {
    id: generateDemoId(),
    label: input.label,
    ...(passwordHash !== undefined ? { passwordHash } : {}),
    ...(salt !== undefined ? { salt } : {}),
    expiresAt,
    maxAiCalls: anonymous ? getPublicGuestResearchQuota() : (input.maxAiCalls ?? 0),
    usedAiCalls: 0,
    isActive: true,
    createdAt: now.toISOString(),
    lastUsedAt: null,
    notes: input.notes || "",
    ...(anonymous ? { credentialKind: "anonymous" as const } : {}),
  };

  store.accesses.push(record);

  return { record, plainPassword };
  });
}

export function getDemoAccessById(id: string): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  return store.accesses.find((a) => a.id === id) || null;
}

export function findDemoAccessByPassword(password: string): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  for (const access of store.accesses) {
    // 匿名记录 / 缺 hash 记录绝不能被遗留密码登录接受（契约 02-9 / §9 / §19）
    if (getCredentialKind(access) === "anonymous") continue;
    if (!access.passwordHash) continue;
    if (verifyDemoPassword(password, access.passwordHash, access.salt)) {
      return access;
    }
  }
  return null;
}

// ── Status checks ───────────────────────────────

/**
 * Demo 记录永不失效（契约：12h Token/Cookie 控制访问；GC 独立）。
 * - 访问有效期由访问 Token（12h，signedToken.ts）与服务端 Session（12h，accessSession.ts）控制；
 * - 记录本身无过期语义：expiresAt 在登录/迁移时被清除（clearDemoAccessLegacyExpiry），
 *   状态开关由 isActive 承担（见 isDemoAccessActive）；
 * - 数据清理（GC）独立于访问生命周期，不依赖本函数。
 */

export function isDemoAccessExpired(access: DemoAccessRecord): boolean {
  void access;
  return false;
}

export function isDemoAccessActive(access: DemoAccessRecord): boolean {
  return access.isActive;
}

/**
 * Clear the legacy Visitor-code expiry during login/migration.
 */
export function clearDemoAccessLegacyExpiry(id: string): DemoAccessRecord | null {
  return withDemoAccessStoreTransaction((store) => {
    const idx = store.accesses.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const access = store.accesses[idx];
    if (access.expiresAt !== null) access.expiresAt = null;
    return access;
  });
}

/** @deprecated Use clearDemoAccessLegacyExpiry; retained for older scripts/tests. */
export function activateDemoAccessOnFirstLogin(id: string, _hours: number): DemoAccessRecord | null {
  return clearDemoAccessLegacyExpiry(id);
}

export function getRemainingAiCalls(access: DemoAccessRecord): number {
  return Math.max(0, access.maxAiCalls - access.usedAiCalls);
}

export function isDemoAiQuotaExhausted(access: DemoAccessRecord): boolean {
  return getRemainingAiCalls(access) <= 0;
}

// ── Mutations (for future phases) ───────────────

export function incrementDemoAiCalls(id: string, count: number): DemoAccessRecord | null {
  return withDemoAccessStoreTransaction((store) => {
    const idx = store.accesses.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    store.accesses[idx].usedAiCalls += count;
    store.accesses[idx].lastUsedAt = new Date().toISOString();
    return store.accesses[idx];
  });
}

export type DemoAiImageQuotaResult =
  | { ok: true; record: DemoAccessRecord; duplicate: boolean }
  | { ok: false; code: "access_not_found" | "access_inactive" | "access_expired" | "quota_exceeded" | "reservation_conflict" | "global_provider_cap_exceeded" };

function recoverExpiredReservations(access: DemoAccessRecord, nowMs: number): boolean {
  let changed = false;
  for (const reservation of Object.values(access.aiImageQuotaReservations || {})) {
    if (reservation.status !== "reserved") continue;
    const explicitExpiry = Date.parse(reservation.leaseExpiresAt || "");
    const createdAt = Date.parse(reservation.createdAt);
    const leaseExpiresAt = Number.isFinite(explicitExpiry)
      ? explicitExpiry
      : Number.isFinite(createdAt) ? createdAt + DEMO_IMAGE_AI_RESERVATION_LEASE_MS : Number.POSITIVE_INFINITY;
    if (leaseExpiresAt > nowMs) continue;
    const providerLimit = reservation.quotaMetric === "ai_jobs_v1"
      ? reservation.providerCallsPlanned ?? 0
      : reservation.count;
    const persistedStartedCount = (reservation.kind === "text"
      || reservation.quotaMetric === "ai_jobs_v1")
      && Number.isInteger(reservation.providerStartedCount)
      ? Math.max(0, Math.min(providerLimit, reservation.providerStartedCount || 0))
      : 0;
    const chargedCount = reservation.quotaMetric === "ai_jobs_v1"
      ? (persistedStartedCount > 0 ? 1 : 0)
      : persistedStartedCount;
    access.usedAiCalls = Math.max(0, access.usedAiCalls - (reservation.count - chargedCount));
    reservation.status = persistedStartedCount > 0 ? "committed" : "refunded";
    reservation.chargedCount = chargedCount;
    reservation.settledAt = new Date(nowMs).toISOString();
    reservation.updatedAt = new Date(nowMs).toISOString();
    changed = true;
    if (reservation.status === "refunded") {
      refundGlobalProviderCalls(reservation.kind === "text" ? "text" : "image", reservation.count);
    }
  }
  return changed;
}

export function recoverExpiredDemoAiReservations(id: string, nowMs = Date.now()): DemoAccessRecord | null {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    if (!access) return null;
    recoverExpiredReservations(access, nowMs);
    return access;
  });
}

export function reserveDemoAiImageCalls(
  id: string,
  requestHash: string,
  count: number,
  options: {
    kind?: "text" | "image";
    leaseMs?: number;
    nowMs?: number;
    quotaMetric?: "ai_jobs_v1";
    jobType?: DemoAiJobType;
    jobRequestId?: string;
    providerCallsPlanned?: number;
  } = {},
): DemoAiImageQuotaResult {
  return withDemoAccessStoreTransaction((store) => {
  const idx = store.accesses.findIndex((access) => access.id === id);
  if (idx === -1) return { ok: false, code: "access_not_found" } as const;
  const access = store.accesses[idx];
  const nowMs = options.nowMs ?? Date.now();
  recoverExpiredReservations(access, nowMs);
  if (!access.isActive) return { ok: false, code: "access_inactive" } as const;
  if (isDemoAccessExpired(access)) return { ok: false, code: "access_expired" } as const;
  const reservations = access.aiImageQuotaReservations || {};
  const existing = reservations[requestHash];
  if (existing) {
    if (existing.count !== count
      || existing.quotaMetric !== options.quotaMetric
      || existing.jobType !== options.jobType
      || existing.jobRequestId !== options.jobRequestId
      || existing.providerCallsPlanned !== options.providerCallsPlanned) {
      return { ok: false, code: "reservation_conflict" } as const;
    }
    return { ok: true, record: access, duplicate: true } as const;
  }
  if (!Number.isInteger(count) || count <= 0 || getRemainingAiCalls(access) < count) {
    return { ok: false, code: "quota_exceeded" } as const;
  }
  // Global Provider Hard Cap（§13-17）：与 guest quota 同一事务串行预留；失败 → 整体拒绝
  const global = reserveGlobalProviderCalls(options.kind === "text" ? "text" : "image", count);
  if (!global.ok) return { ok: false, code: "global_provider_cap_exceeded" } as const;
  const now = new Date(nowMs).toISOString();
  const leaseMs = options.leaseMs ?? (options.kind === "text" ? DEMO_TEXT_AI_RESERVATION_LEASE_MS : DEMO_IMAGE_AI_RESERVATION_LEASE_MS);
  access.usedAiCalls += count;
  access.lastUsedAt = now;
  access.aiImageQuotaReservations = {
    ...reservations,
    [requestHash]: {
      count,
      status: "reserved",
      createdAt: now,
      updatedAt: now,
      kind: options.kind || "image",
      leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(),
      ...(options.quotaMetric ? { quotaMetric: options.quotaMetric } : {}),
      ...(options.jobType ? { jobType: options.jobType } : {}),
      ...(options.jobRequestId ? { jobRequestId: options.jobRequestId } : {}),
      ...(options.providerCallsPlanned !== undefined
        ? { providerCallsPlanned: options.providerCallsPlanned }
        : {}),
    },
  };
  return { ok: true, record: access, duplicate: false } as const;
  });
}

export function commitDemoAiImageCalls(id: string, requestHash: string): DemoAccessRecord | null {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    const reservation = access?.aiImageQuotaReservations?.[requestHash];
    if (!access || !reservation) return null;
    if (reservation.status === "reserved") {
      reservation.status = "committed";
      reservation.chargedCount = reservation.quotaMetric === "ai_jobs_v1"
        ? 1
        : reservation.providerStartedCount ?? reservation.count;
      reservation.updatedAt = new Date().toISOString();
      reservation.settledAt = reservation.updatedAt;
    }
    return reservation.status === "committed" ? access : null;
  });
}

export type DemoAiCallSettlementResult =
  | { ok: true; record: DemoAccessRecord; duplicate: boolean }
  | {
      ok: false;
      code: "access_not_found" | "reservation_not_found" | "reservation_conflict" | "invalid_started_count";
    };

export type DemoAiProviderStartResult = DemoAiCallSettlementResult;

/**
 * Persist one text Provider start before the external SDK call.
 * `startedCount` is the cumulative count, making repeated delivery idempotent
 * while rejecting skipped or out-of-order boundaries.
 */
export function markDemoAiCallProviderStarted(
  id: string,
  requestHash: string,
  startedCount: number,
  nowMs = Date.now(),
): DemoAiProviderStartResult {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    if (!access) return { ok: false, code: "access_not_found" } as const;

    const reservation = access.aiImageQuotaReservations?.[requestHash];
    if (!reservation) return { ok: false, code: "reservation_not_found" } as const;
    if (reservation.kind && reservation.kind !== "text"
      && reservation.quotaMetric !== "ai_jobs_v1") {
      return { ok: false, code: "reservation_conflict" } as const;
    }
    const providerLimit = reservation.quotaMetric === "ai_jobs_v1"
      ? reservation.providerCallsPlanned ?? 0
      : reservation.count;
    if (!Number.isInteger(startedCount) || startedCount <= 0 || startedCount > providerLimit) {
      return { ok: false, code: "invalid_started_count" } as const;
    }
    if (reservation.status !== "reserved") {
      return reservation.providerStartedCount === startedCount
        ? { ok: true, record: access, duplicate: true } as const
        : { ok: false, code: "reservation_conflict" } as const;
    }

    const currentCount = reservation.providerStartedCount ?? 0;
    if (startedCount === currentCount) {
      return { ok: true, record: access, duplicate: true } as const;
    }
    if (startedCount !== currentCount + 1) {
      return { ok: false, code: "reservation_conflict" } as const;
    }

    const now = new Date(nowMs).toISOString();
    reservation.providerStartedCount = startedCount;
    reservation.providerStartedAt = reservation.providerStartedAt || now;
    reservation.updatedAt = now;
    return { ok: true, record: access, duplicate: false } as const;
  });
}

export function settleDemoAiCallReservation(
  id: string,
  requestHash: string,
  startedCount: number,
  audit: {
    providerCallsCompleted?: number;
    providerCallsFailed?: number;
  } = {},
): DemoAiCallSettlementResult {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    if (!access) return { ok: false, code: "access_not_found" } as const;

    const reservation = access.aiImageQuotaReservations?.[requestHash];
    if (!reservation) return { ok: false, code: "reservation_not_found" } as const;
    if (reservation.kind && reservation.kind !== "text") {
      return { ok: false, code: "reservation_conflict" } as const;
    }
    const providerLimit = reservation.quotaMetric === "ai_jobs_v1"
      ? reservation.providerCallsPlanned ?? 0
      : reservation.count;
    if (!Number.isInteger(startedCount) || startedCount < 0 || startedCount > providerLimit) {
      return { ok: false, code: "invalid_started_count" } as const;
    }
    const completedCount = audit.providerCallsCompleted ?? Math.max(0, startedCount);
    const failedCount = audit.providerCallsFailed ?? 0;
    if (!Number.isInteger(completedCount) || completedCount < 0
      || !Number.isInteger(failedCount) || failedCount < 0
      || completedCount + failedCount !== startedCount) {
      return { ok: false, code: "invalid_started_count" } as const;
    }
    if (reservation.providerStartedCount !== undefined
      && reservation.providerStartedCount !== startedCount) {
      return { ok: false, code: "reservation_conflict" } as const;
    }

    if (reservation.status !== "reserved") {
      return reservation.providerStartedCount === startedCount
        && (reservation.providerCallsCompleted ?? completedCount) === completedCount
        && (reservation.providerCallsFailed ?? failedCount) === failedCount
        ? { ok: true, record: access, duplicate: true } as const
        : { ok: false, code: "reservation_conflict" } as const;
    }

    const chargedCount = reservation.quotaMetric === "ai_jobs_v1"
      ? (startedCount > 0 ? 1 : 0)
      : startedCount;
    const unusedCount = reservation.count - chargedCount;
    access.usedAiCalls = Math.max(0, access.usedAiCalls - unusedCount);
    reservation.status = startedCount > 0 ? "committed" : "refunded";
    reservation.chargedCount = chargedCount;
    reservation.providerStartedCount = startedCount;
    reservation.providerCallsCompleted = completedCount;
    reservation.providerCallsFailed = failedCount;
    reservation.updatedAt = new Date().toISOString();
    reservation.settledAt = reservation.updatedAt;
    if (reservation.status === "refunded") {
      refundGlobalProviderCalls(reservation.kind === "text" ? "text" : "image", reservation.count);
    }
    return { ok: true, record: access, duplicate: false } as const;
  });
}

export function refundDemoAiImageCalls(id: string, requestHash: string): DemoAccessRecord | null {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    const reservation = access?.aiImageQuotaReservations?.[requestHash];
    if (!access || !reservation) return null;
    if (reservation.status === "reserved") {
      access.usedAiCalls = Math.max(0, access.usedAiCalls - reservation.count);
      reservation.status = "refunded";
      reservation.updatedAt = new Date().toISOString();
      refundGlobalProviderCalls(reservation.kind === "text" ? "text" : "image", reservation.count);
    }
    return access;
  });
}

export function updateDemoLastUsed(id: string): void {
  withDemoAccessStoreTransaction((store) => {
    const idx = store.accesses.findIndex((a) => a.id === id);
    if (idx === -1) return;
    store.accesses[idx].lastUsedAt = new Date().toISOString();
  });
}

export type DemoStandaloneStudioQuotaResult =
  | {
      ok: true;
      record: DemoAccessRecord;
      duplicate: boolean;
      status: "reserved" | "committed" | "released";
    }
  | {
      ok: false;
      code:
        | "access_not_found"
        | "access_inactive"
        | "quota_exceeded"
        | "reservation_not_found"
        | "reservation_conflict"
        | "invalid_units"
        | "global_provider_cap_exceeded";
    };

function standaloneReservationKey(kind: DemoStandaloneStudioKind, requestId: string) {
  return `${kind}:${requestId}`;
}

export function getDemoStandaloneStudioQuotaUsage(
  access: DemoAccessRecord,
  kind: DemoStandaloneStudioKind,
  nowMs = Date.now(),
) {
  const used = kind === "listing"
    ? Math.max(0, access.standaloneListingUsed ?? 0)
    : Math.max(0, access.standaloneImageUnitsUsed ?? 0);
  const reserved = Object.values(access.standaloneStudioQuotaReservations || {})
    .filter((reservation) => reservation.kind === kind
      && reservation.status === "reserved"
      && (!reservation.leaseExpiresAt || Date.parse(reservation.leaseExpiresAt) > nowMs))
    .reduce((total, reservation) => total + reservation.units, 0);
  const limit = getCredentialKind(access) === "anonymous"
    ? getPublicGuestStandaloneLimit(kind)
    : kind === "listing"
      ? DEMO_STANDALONE_LISTING_LIMIT
      : DEMO_STANDALONE_IMAGE_UNIT_LIMIT;
  return {
    limit,
    used,
    reserved,
    remaining: Math.max(0, limit - used - reserved),
  };
}

/**
 * Atomically holds standalone Studio capacity. The committed counter is not
 * incremented until the external Provider boundary is durably recorded.
 */
export function reserveDemoStandaloneStudioQuota(
  id: string,
  kind: DemoStandaloneStudioKind,
  requestId: string,
  units: number,
  nowMs = Date.now(),
): DemoStandaloneStudioQuotaResult {
  if (!requestId.trim() || !Number.isInteger(units) || units <= 0) {
    return { ok: false, code: "invalid_units" };
  }
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    if (!access) return { ok: false, code: "access_not_found" } as const;
    if (!access.isActive) return { ok: false, code: "access_inactive" } as const;

    const key = standaloneReservationKey(kind, requestId);
    const reservations = access.standaloneStudioQuotaReservations || {};
    const existing = reservations[key];
    if (existing && (existing.kind !== kind || existing.requestId !== requestId || existing.units !== units)) {
      return { ok: false, code: "reservation_conflict" } as const;
    }
    if (existing?.status === "reserved"
      && existing.leaseExpiresAt
      && Date.parse(existing.leaseExpiresAt) <= nowMs) {
      existing.status = "released";
      existing.releasedAt = new Date(nowMs).toISOString();
      existing.updatedAt = existing.releasedAt;
      refundGlobalProviderCalls(kind === "listing" ? "text" : "image", existing.units);
    }
    if (existing?.status === "reserved" || existing?.status === "committed") {
      return {
        ok: true,
        record: access,
        duplicate: true,
        status: existing.status,
      } as const;
    }

    const usage = getDemoStandaloneStudioQuotaUsage(access, kind, nowMs);
    if (usage.remaining < units) return { ok: false, code: "quota_exceeded" } as const;

    // Global Provider Hard Cap（§13-17）：与 guest quota 同一事务串行预留
    const global = reserveGlobalProviderCalls(kind === "listing" ? "text" : "image", units);
    if (!global.ok) return { ok: false, code: "global_provider_cap_exceeded" } as const;

    const now = new Date(nowMs).toISOString();
    access.standaloneStudioQuotaReservations = {
      ...reservations,
      [key]: {
        kind,
        requestId,
        units,
        status: "reserved",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        leaseExpiresAt: new Date(nowMs + DEMO_TEXT_AI_RESERVATION_LEASE_MS).toISOString(),
      },
    };
    access.lastUsedAt = now;
    return { ok: true, record: access, duplicate: false, status: "reserved" } as const;
  });
}

/** Persist the cost boundary before invoking the external Provider. */
export function markDemoStandaloneStudioProviderStarted(
  id: string,
  kind: DemoStandaloneStudioKind,
  requestId: string,
  units: number,
  nowMs = Date.now(),
): DemoStandaloneStudioQuotaResult {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    if (!access) return { ok: false, code: "access_not_found" } as const;
    const reservation = access.standaloneStudioQuotaReservations?.[
      standaloneReservationKey(kind, requestId)
    ];
    if (!reservation) return { ok: false, code: "reservation_not_found" } as const;
    if (reservation.kind !== kind || reservation.requestId !== requestId || reservation.units !== units) {
      return { ok: false, code: "reservation_conflict" } as const;
    }
    if (reservation.status === "committed") {
      return { ok: true, record: access, duplicate: true, status: "committed" } as const;
    }
    if (reservation.status !== "reserved") {
      return { ok: false, code: "reservation_conflict" } as const;
    }

    const now = new Date(nowMs).toISOString();
    reservation.status = "committed";
    reservation.providerStartedAt = now;
    reservation.updatedAt = now;
    if (kind === "listing") {
      access.standaloneListingUsed = Math.max(0, access.standaloneListingUsed ?? 0) + units;
    } else {
      access.standaloneImageUnitsUsed = Math.max(0, access.standaloneImageUnitsUsed ?? 0) + units;
    }
    access.lastUsedAt = now;
    return { ok: true, record: access, duplicate: false, status: "committed" } as const;
  });
}

/** Release only a pre-Provider hold. A committed cost is intentionally never refunded. */
export function releaseDemoStandaloneStudioQuota(
  id: string,
  kind: DemoStandaloneStudioKind,
  requestId: string,
  units: number,
  nowMs = Date.now(),
): DemoStandaloneStudioQuotaResult {
  return withDemoAccessStoreTransaction((store) => {
    const access = store.accesses.find((item) => item.id === id);
    if (!access) return { ok: false, code: "access_not_found" } as const;
    const reservation = access.standaloneStudioQuotaReservations?.[
      standaloneReservationKey(kind, requestId)
    ];
    if (!reservation) return { ok: false, code: "reservation_not_found" } as const;
    if (reservation.kind !== kind || reservation.requestId !== requestId || reservation.units !== units) {
      return { ok: false, code: "reservation_conflict" } as const;
    }
    if (reservation.status === "committed" || reservation.status === "released") {
      return { ok: true, record: access, duplicate: true, status: reservation.status } as const;
    }

    const now = new Date(nowMs).toISOString();
    reservation.status = "released";
    reservation.releasedAt = now;
    reservation.updatedAt = now;
    refundGlobalProviderCalls(kind === "listing" ? "text" : "image", units);
    return { ok: true, record: access, duplicate: false, status: "released" } as const;
  });
}