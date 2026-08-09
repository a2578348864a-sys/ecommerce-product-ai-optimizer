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

// ── Types ───────────────────────────────────────

export interface DemoAccessRecord {
  id: string;
  label: string;
  passwordHash: string;
  salt: string;
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

export function verifyDemoPassword(password: string, storedHash: string, salt: string): boolean {
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

// ── Store I/O ───────────────────────────────────

export function loadDemoAccessStore(): DemoAccessStore {
  const storePath = getStorePath();
  ensureDataDir();
  if (!existsSync(storePath)) {
    return { version: 1, accesses: [] };
  }
  try {
    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.accesses)) {
      return parsed as DemoAccessStore;
    }
    return { version: 1, accesses: [] };
  } catch {
    return { version: 1, accesses: [] };
  }
}

export function saveDemoAccessStore(store: DemoAccessStore): void {
  ensureDataDir();
  const storePath = getStorePath();
  const tempPath = `${storePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf-8");
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

const DEMO_STORE_LOCK_MAX_ATTEMPTS = 100;
const DEMO_STORE_LOCK_RETRY_MS = 10;
const DEMO_STORE_STALE_LOCK_MS = 2 * 60 * 1000;

function waitSynchronously(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withDemoAccessStoreTransaction<T>(operation: (store: DemoAccessStore) => T): T {
  ensureDataDir();
  const lockPath = `${getStorePath()}.lock`;
  let lockFd: number | null = null;
  for (let attempt = 0; attempt < DEMO_STORE_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      lockFd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > DEMO_STORE_STALE_LOCK_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      waitSynchronously(DEMO_STORE_LOCK_RETRY_MS);
    }
  }
  if (lockFd === null) throw new Error("demo_access_store_busy");
  try {
    const store = loadDemoAccessStore();
    const result = operation(store);
    saveDemoAccessStore(store);
    return result;
  } finally {
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* another process can remove only a stale lock */ }
  }
}

// ── CRUD ────────────────────────────────────────

export function createDemoAccess(input: CreateDemoAccessInput): CreateDemoAccessOutput {
  const store = loadDemoAccessStore();
  const plainPassword = generateDemoPassword();
  const salt = generateSalt();
  const passwordHash = hashPassword(plainPassword, salt);
  const now = new Date();
  // V2.1.7: Visitor-code lifetime is no longer time based. Login tokens remain short lived.
  const expiresAt = null;

  const record: DemoAccessRecord = {
    id: generateDemoId(),
    label: input.label,
    passwordHash,
    salt,
    expiresAt,
    maxAiCalls: input.maxAiCalls ?? 0,
    usedAiCalls: 0,
    isActive: true,
    createdAt: now.toISOString(),
    lastUsedAt: null,
    notes: input.notes || "",
  };

  store.accesses.push(record);
  saveDemoAccessStore(store);

  return { record, plainPassword };
}

export function getDemoAccessById(id: string): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  return store.accesses.find((a) => a.id === id) || null;
}

export function findDemoAccessByPassword(password: string): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  for (const access of store.accesses) {
    if (verifyDemoPassword(password, access.passwordHash, access.salt)) {
      return access;
    }
  }
  return null;
}

// ── Status checks ───────────────────────────────

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
  const store = loadDemoAccessStore();
  const idx = store.accesses.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  const access = store.accesses[idx];
  if (access.expiresAt !== null) {
    access.expiresAt = null;
    saveDemoAccessStore(store);
  }
  return access;
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
  const store = loadDemoAccessStore();
  const idx = store.accesses.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  store.accesses[idx].usedAiCalls += count;
  store.accesses[idx].lastUsedAt = new Date().toISOString();
  saveDemoAccessStore(store);
  return store.accesses[idx];
}

export type DemoAiImageQuotaResult =
  | { ok: true; record: DemoAccessRecord; duplicate: boolean }
  | { ok: false; code: "access_not_found" | "access_inactive" | "access_expired" | "quota_exceeded" | "reservation_conflict" };

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
  }
  return changed;
}

export function recoverExpiredDemoAiReservations(id: string, nowMs = Date.now()): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  const access = store.accesses.find((item) => item.id === id);
  if (!access) return null;
  if (recoverExpiredReservations(access, nowMs)) saveDemoAccessStore(store);
  return access;
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
  const store = loadDemoAccessStore();
  const idx = store.accesses.findIndex((access) => access.id === id);
  if (idx === -1) return { ok: false, code: "access_not_found" };
  const access = store.accesses[idx];
  const nowMs = options.nowMs ?? Date.now();
  const recovered = recoverExpiredReservations(access, nowMs);
  const saveRecovery = () => { if (recovered) saveDemoAccessStore(store); };
  if (!access.isActive) { saveRecovery(); return { ok: false, code: "access_inactive" }; }
  if (isDemoAccessExpired(access)) { saveRecovery(); return { ok: false, code: "access_expired" }; }
  const reservations = access.aiImageQuotaReservations || {};
  const existing = reservations[requestHash];
  if (existing) {
    if (existing.count !== count
      || existing.quotaMetric !== options.quotaMetric
      || existing.jobType !== options.jobType
      || existing.jobRequestId !== options.jobRequestId
      || existing.providerCallsPlanned !== options.providerCallsPlanned) {
      saveRecovery();
      return { ok: false, code: "reservation_conflict" };
    }
    saveRecovery();
    return { ok: true, record: access, duplicate: true };
  }
  if (!Number.isInteger(count) || count <= 0 || getRemainingAiCalls(access) < count) {
    saveRecovery();
    return { ok: false, code: "quota_exceeded" };
  }
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
  saveDemoAccessStore(store);
  return { ok: true, record: access, duplicate: false };
}

export function commitDemoAiImageCalls(id: string, requestHash: string): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
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
    saveDemoAccessStore(store);
  }
  return reservation.status === "committed" ? access : null;
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
  const store = loadDemoAccessStore();
  const access = store.accesses.find((item) => item.id === id);
  if (!access) return { ok: false, code: "access_not_found" };

  const reservation = access.aiImageQuotaReservations?.[requestHash];
  if (!reservation) return { ok: false, code: "reservation_not_found" };
  if (reservation.kind && reservation.kind !== "text"
    && reservation.quotaMetric !== "ai_jobs_v1") {
    return { ok: false, code: "reservation_conflict" };
  }
  const providerLimit = reservation.quotaMetric === "ai_jobs_v1"
    ? reservation.providerCallsPlanned ?? 0
    : reservation.count;
  if (!Number.isInteger(startedCount) || startedCount <= 0 || startedCount > providerLimit) {
    return { ok: false, code: "invalid_started_count" };
  }
  if (reservation.status !== "reserved") {
    return reservation.providerStartedCount === startedCount
      ? { ok: true, record: access, duplicate: true }
      : { ok: false, code: "reservation_conflict" };
  }

  const currentCount = reservation.providerStartedCount ?? 0;
  if (startedCount === currentCount) {
    return { ok: true, record: access, duplicate: true };
  }
  if (startedCount !== currentCount + 1) {
    return { ok: false, code: "reservation_conflict" };
  }

  const now = new Date(nowMs).toISOString();
  reservation.providerStartedCount = startedCount;
  reservation.providerStartedAt = reservation.providerStartedAt || now;
  reservation.updatedAt = now;
  saveDemoAccessStore(store);
  return { ok: true, record: access, duplicate: false };
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
  const store = loadDemoAccessStore();
  const access = store.accesses.find((item) => item.id === id);
  if (!access) return { ok: false, code: "access_not_found" };

  const reservation = access.aiImageQuotaReservations?.[requestHash];
  if (!reservation) return { ok: false, code: "reservation_not_found" };
  if (reservation.kind && reservation.kind !== "text") {
    return { ok: false, code: "reservation_conflict" };
  }
  const providerLimit = reservation.quotaMetric === "ai_jobs_v1"
    ? reservation.providerCallsPlanned ?? 0
    : reservation.count;
  if (!Number.isInteger(startedCount) || startedCount < 0 || startedCount > providerLimit) {
    return { ok: false, code: "invalid_started_count" };
  }
  const completedCount = audit.providerCallsCompleted ?? Math.max(0, startedCount);
  const failedCount = audit.providerCallsFailed ?? 0;
  if (!Number.isInteger(completedCount) || completedCount < 0
    || !Number.isInteger(failedCount) || failedCount < 0
    || completedCount + failedCount !== startedCount) {
    return { ok: false, code: "invalid_started_count" };
  }
  if (reservation.providerStartedCount !== undefined
    && reservation.providerStartedCount !== startedCount) {
    return { ok: false, code: "reservation_conflict" };
  }

  if (reservation.status !== "reserved") {
    return reservation.providerStartedCount === startedCount
      && (reservation.providerCallsCompleted ?? completedCount) === completedCount
      && (reservation.providerCallsFailed ?? failedCount) === failedCount
      ? { ok: true, record: access, duplicate: true }
      : { ok: false, code: "reservation_conflict" };
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
  saveDemoAccessStore(store);
  return { ok: true, record: access, duplicate: false };
}

export function refundDemoAiImageCalls(id: string, requestHash: string): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  const access = store.accesses.find((item) => item.id === id);
  const reservation = access?.aiImageQuotaReservations?.[requestHash];
  if (!access || !reservation) return null;
  if (reservation.status === "reserved") {
    access.usedAiCalls = Math.max(0, access.usedAiCalls - reservation.count);
    reservation.status = "refunded";
    reservation.updatedAt = new Date().toISOString();
    saveDemoAccessStore(store);
  }
  return access;
}

export function updateDemoLastUsed(id: string): void {
  const store = loadDemoAccessStore();
  const idx = store.accesses.findIndex((a) => a.id === id);
  if (idx === -1) return;
  store.accesses[idx].lastUsedAt = new Date().toISOString();
  saveDemoAccessStore(store);
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
        | "invalid_units";
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
  const limit = kind === "listing"
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
    return { ok: true, record: access, duplicate: false, status: "released" } as const;
  });
}
