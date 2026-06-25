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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

// ── Types ───────────────────────────────────────

export interface DemoAccessRecord {
  id: string;
  label: string;
  passwordHash: string;
  salt: string;
  expiresAt: string; // ISO 8601
  maxAiCalls: number;
  usedAiCalls: number;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  notes: string;
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
}

export interface CreateDemoAccessOutput {
  record: DemoAccessRecord;
  plainPassword: string;
}

// ── File path ───────────────────────────────────

const DATA_DIR = resolve(process.cwd(), "data");
const STORE_PATH = resolve(DATA_DIR, "demo-access.json");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
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
  ensureDataDir();
  if (!existsSync(STORE_PATH)) {
    return { version: 1, accesses: [] };
  }
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
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
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ── CRUD ────────────────────────────────────────

export function createDemoAccess(input: CreateDemoAccessInput): CreateDemoAccessOutput {
  const store = loadDemoAccessStore();
  const plainPassword = generateDemoPassword();
  const salt = generateSalt();
  const passwordHash = hashPassword(plainPassword, salt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.hours * 60 * 60 * 1000);

  const record: DemoAccessRecord = {
    id: generateDemoId(),
    label: input.label,
    passwordHash,
    salt,
    expiresAt: expiresAt.toISOString(),
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
  return new Date(access.expiresAt) < new Date();
}

export function isDemoAccessActive(access: DemoAccessRecord): boolean {
  return access.isActive && !isDemoAccessExpired(access);
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

export function updateDemoLastUsed(id: string): void {
  const store = loadDemoAccessStore();
  const idx = store.accesses.findIndex((a) => a.id === id);
  if (idx === -1) return;
  store.accesses[idx].lastUsedAt = new Date().toISOString();
  saveDemoAccessStore(store);
}
