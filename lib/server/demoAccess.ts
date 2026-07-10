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
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { resolve } from "path";

export const DEMO_TEXT_AI_RESERVATION_LEASE_MS = 5 * 60 * 1000;
export const DEMO_IMAGE_AI_RESERVATION_LEASE_MS = 30 * 60 * 1000;

// ── Types ───────────────────────────────────────

export interface DemoAccessRecord {
  id: string;
  label: string;
  passwordHash: string;
  salt: string;
  expiresAt: string | null; // ISO 8601 — null means not yet activated (first login starts timer)
  maxAiCalls: number;
  usedAiCalls: number;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  notes: string;
  aiImageQuotaReservations?: Record<string, {
    count: number;
    status: "reserved" | "committed" | "refunded";
    createdAt: string;
    updatedAt: string;
    kind?: "text" | "image";
    leaseExpiresAt?: string;
  }>;
}

export interface DemoAccessStore {
  version: 1;
  accesses: DemoAccessRecord[];
}

export interface CreateDemoAccessInput {
  label: string;
  hours: number;
  maxAiCalls: number;
  notes?: string;
  /** If true, expiry starts from creation. If false (default), starts from first login. */
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

// ── CRUD ────────────────────────────────────────

export function createDemoAccess(input: CreateDemoAccessInput): CreateDemoAccessOutput {
  const store = loadDemoAccessStore();
  const plainPassword = generateDemoPassword();
  const salt = generateSalt();
  const passwordHash = hashPassword(plainPassword, salt);
  const now = new Date();
  // Expiry starts from first login by default; set `startFromCreation: true` for creation-time expiry
  const expiresAt = input.startFromCreation
    ? new Date(now.getTime() + input.hours * 60 * 60 * 1000).toISOString()
    : null;

  const record: DemoAccessRecord = {
    id: generateDemoId(),
    label: input.label,
    passwordHash,
    salt,
    expiresAt,
    maxAiCalls: input.maxAiCalls,
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
  // null = not yet activated (first login not happened yet)
  if (!access.expiresAt) return false;
  return new Date(access.expiresAt) < new Date();
}

export function isDemoAccessActive(access: DemoAccessRecord): boolean {
  // null expiresAt = not yet activated, still active
  return access.isActive && !isDemoAccessExpired(access);
}

/**
 * Activate a demo access on first login.
 * Sets expiresAt to now + hours, starting the 24h window from the first login time.
 */
export function activateDemoAccessOnFirstLogin(id: string, hours: number): DemoAccessRecord | null {
  const store = loadDemoAccessStore();
  const idx = store.accesses.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  const access = store.accesses[idx];
  // Only activate if not yet activated
  if (!access.expiresAt) {
    access.expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    saveDemoAccessStore(store);
  }
  return access;
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
    access.usedAiCalls = Math.max(0, access.usedAiCalls - reservation.count);
    reservation.status = "refunded";
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
  options: { kind?: "text" | "image"; leaseMs?: number; nowMs?: number } = {},
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
    if (existing.count !== count) { saveRecovery(); return { ok: false, code: "reservation_conflict" }; }
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
    reservation.updatedAt = new Date().toISOString();
    saveDemoAccessStore(store);
  }
  return access;
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
