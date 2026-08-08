import "server-only";

import { createHash } from "node:crypto";
import {
  loadDemoAccessStore,
  saveDemoAccessStore,
  type DemoAccessRecord,
  type DemoAccessStore,
} from "@/lib/server/demoAccess";
import { readDemoSandboxStoreStrict } from "@/lib/server/demoSandboxStore.internal";
import type { DemoSandboxStore, SandboxTask } from "@/lib/server/demoSandbox";

export const MAX_PRODUCT_CHAINS = 5;
export const PRODUCT_JOURNEY_RESERVATION_LEASE_MS = 5 * 60 * 1000;
export const PRODUCT_JOURNEY_QUOTA_METRIC = "product_journeys_v1" as const;

const MIGRATION_VERSION = "sandbox-product-journeys-v1" as const;
const EXHAUSTED_MESSAGE = "该访客码的 5 个商品体验名额已全部使用。";

type ProductJourneyReservation = NonNullable<DemoAccessRecord["productJourneyReservations"]>[string];
type ProductJourneyStatus = ProductJourneyReservation["status"];

export type DemoProductJourneySnapshot = {
  id: string;
  label: string;
  expiresAt: null;
  isActive: boolean;
  quotaMetric: typeof PRODUCT_JOURNEY_QUOTA_METRIC;
  maxProducts: number;
  usedProducts: number;
  reservedProducts: number;
  remainingProducts: number;
  migrationStatus: "migrated";
};

export type DemoProductJourneySuccess = {
  ok: true;
  duplicate: boolean;
  status: ProductJourneyStatus;
  snapshot: DemoProductJourneySnapshot;
};

export type DemoProductJourneyFailure = {
  ok: false;
  code:
    | "visitor_access_not_found"
    | "visitor_access_inactive"
    | "visitor_product_quota_exhausted"
    | "product_journey_in_progress"
    | "product_journey_reservation_missing"
    | "product_journey_reservation_conflict"
    | "product_journey_store_invalid";
  message: string;
  snapshot: DemoProductJourneySnapshot | null;
};

export type DemoProductJourneyResult = DemoProductJourneySuccess | DemoProductJourneyFailure;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedProductName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Stable identity used for slot ownership; never contains a password or token. */
export function buildProductJourneyIdentity(input: {
  candidateId?: string | null;
  productName: string;
}): string {
  const candidateId = (input.candidateId || "").normalize("NFKC").trim();
  if (candidateId) return `candidate:${candidateId}`;
  const productName = normalizedProductName(input.productName);
  if (!productName) throw new Error("PRODUCT_JOURNEY_IDENTITY_INVALID");
  return `manual:${sha256(productName)}`;
}

function reservationKey(identity: string): string {
  return `journey-${sha256(identity)}`;
}

function activeReservations(access: DemoAccessRecord): ProductJourneyReservation[] {
  return Object.values(access.productJourneyReservations || {}).filter(
    (reservation) => reservation.status === "reserved" || reservation.status === "committed",
  );
}

export function buildDemoProductJourneySnapshot(access: DemoAccessRecord): DemoProductJourneySnapshot {
  const reservations = Object.values(access.productJourneyReservations || {});
  const committed = reservations.filter((reservation) => reservation.status === "committed").length;
  const reserved = reservations.filter((reservation) => reservation.status === "reserved").length;
  return {
    id: access.id,
    label: access.label,
    expiresAt: null,
    isActive: access.isActive,
    quotaMetric: PRODUCT_JOURNEY_QUOTA_METRIC,
    maxProducts: MAX_PRODUCT_CHAINS,
    usedProducts: Math.min(MAX_PRODUCT_CHAINS, committed),
    reservedProducts: Math.min(MAX_PRODUCT_CHAINS, reserved),
    remainingProducts: Math.max(0, MAX_PRODUCT_CHAINS - Math.min(MAX_PRODUCT_CHAINS, committed + reserved)),
    migrationStatus: "migrated",
  };
}

function taskCandidateId(task: SandboxTask): string | null {
  try {
    const parsed: unknown = JSON.parse(task.resultJson || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const candidateToTask = typeof record.candidateToTask === "object" && record.candidateToTask !== null
      ? record.candidateToTask as Record<string, unknown>
      : null;
    const researchRecord = typeof record.researchRecord === "object" && record.researchRecord !== null
      ? record.researchRecord as Record<string, unknown>
      : null;
    const candidateId = candidateToTask?.candidateId ?? researchRecord?.candidateId;
    return typeof candidateId === "string" && candidateId.trim() ? candidateId.trim() : null;
  } catch {
    return null;
  }
}

export function deriveLegacyProductJourneyIdentities(
  sandbox: DemoSandboxStore,
  demoAccessId: string,
): { identities: string[]; sourceTaskCount: number; sourceCandidateCount: number } {
  const tasks = sandbox.tasks.filter(
    (task) => task.demoAccessId === demoAccessId && task.type === "workflow",
  );
  const candidates = sandbox.candidates.filter((candidate) => candidate.demoAccessId === demoAccessId);
  const linkedCandidates = candidates.filter((candidate) => Boolean(candidate.convertedTaskId));
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidateByTaskId = new Map(
    linkedCandidates.map((candidate) => [candidate.convertedTaskId!, candidate]),
  );
  const identities = new Set<string>();

  for (const candidate of linkedCandidates) {
    identities.add(buildProductJourneyIdentity({ candidateId: candidate.id, productName: candidate.name }));
  }
  for (const task of tasks) {
    const linked = candidateByTaskId.get(task.id);
    if (linked) {
      identities.add(buildProductJourneyIdentity({ candidateId: linked.id, productName: linked.name }));
      continue;
    }
    const embeddedCandidateId = taskCandidateId(task);
    const embeddedCandidate = embeddedCandidateId ? candidatesById.get(embeddedCandidateId) : null;
    if (embeddedCandidate) {
      identities.add(buildProductJourneyIdentity({
        candidateId: embeddedCandidate.id,
        productName: embeddedCandidate.name,
      }));
      continue;
    }
    // A persisted workflow task is itself reliable evidence that one formal
    // product chain existed, even when old data predates candidate binding.
    identities.add(`legacy-task:${task.id}`);
  }

  return {
    identities: [...identities],
    sourceTaskCount: tasks.length,
    sourceCandidateCount: linkedCandidates.length,
  };
}

function findAccess(store: DemoAccessStore, id: string): DemoAccessRecord | null {
  return store.accesses.find((access) => access.id === id) || null;
}

function applyLegacyMigration(access: DemoAccessRecord, sandbox: DemoSandboxStore, nowMs: number): boolean {
  if (access.productJourneyMigration?.version === MIGRATION_VERSION) return false;
  const legacy = deriveLegacyProductJourneyIdentities(sandbox, access.id);
  const now = new Date(nowMs).toISOString();
  const reservations = access.productJourneyReservations || {};
  for (const identity of legacy.identities) {
    const key = reservationKey(identity);
    if (reservations[key]) continue;
    reservations[key] = {
      identity,
      requestId: `legacy:${sha256(identity)}`,
      status: "committed",
      createdAt: now,
      updatedAt: now,
      leaseExpiresAt: now,
      committedAt: now,
      source: "legacy_sandbox",
    };
  }
  access.productJourneyReservations = reservations;
  access.productJourneyMigration = {
    version: MIGRATION_VERSION,
    migratedAt: now,
    sourceTaskCount: legacy.sourceTaskCount,
    sourceCandidateCount: legacy.sourceCandidateCount,
  };
  return true;
}

function recoverExpiredReservations(access: DemoAccessRecord, nowMs: number): boolean {
  let changed = false;
  for (const reservation of Object.values(access.productJourneyReservations || {})) {
    if (reservation.status !== "reserved") continue;
    const leaseExpiresAt = Date.parse(reservation.leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt > nowMs) continue;
    const now = new Date(nowMs).toISOString();
    reservation.status = "released";
    reservation.updatedAt = now;
    reservation.releasedAt = now;
    changed = true;
  }
  return changed;
}

function loadMigratedAccess(id: string, nowMs: number): {
  store: DemoAccessStore;
  access: DemoAccessRecord | null;
  changed: boolean;
} {
  const store = loadDemoAccessStore();
  const access = findAccess(store, id);
  if (!access) return { store, access: null, changed: false };
  const sandbox = readDemoSandboxStoreStrict();
  const migrated = applyLegacyMigration(access, sandbox, nowMs);
  const recovered = recoverExpiredReservations(access, nowMs);
  const changed = migrated || recovered;
  return { store, access, changed };
}

function storeFailure(): DemoProductJourneyFailure {
  return {
    ok: false,
    code: "product_journey_store_invalid",
    message: "访客商品名额状态暂不可用，请稍后重试。",
    snapshot: null,
  };
}

export function getDemoProductJourneySnapshot(id: string, nowMs = Date.now()): DemoProductJourneySnapshot {
  const loaded = loadMigratedAccess(id, nowMs);
  if (!loaded.access) throw new Error("VISITOR_ACCESS_NOT_FOUND");
  if (loaded.changed) saveDemoAccessStore(loaded.store);
  return buildDemoProductJourneySnapshot(loaded.access);
}

export function reserveDemoProductJourney(
  id: string,
  identity: string,
  requestId: string,
  options: { nowMs?: number; leaseMs?: number } = {},
): DemoProductJourneyResult {
  const nowMs = options.nowMs ?? Date.now();
  let loaded: ReturnType<typeof loadMigratedAccess>;
  try {
    loaded = loadMigratedAccess(id, nowMs);
  } catch {
    return storeFailure();
  }
  const { store, access } = loaded;
  if (!access) {
    return { ok: false, code: "visitor_access_not_found", message: "访客码不存在。", snapshot: null };
  }
  if (!access.isActive) {
    if (loaded.changed) saveDemoAccessStore(store);
    return {
      ok: false,
      code: "visitor_access_inactive",
      message: "该访客码已被停用。",
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }
  if (!identity.trim() || identity.length > 256 || !requestId.trim() || requestId.length > 128) {
    if (loaded.changed) saveDemoAccessStore(store);
    return {
      ok: false,
      code: "product_journey_reservation_conflict",
      message: "商品研究链标识无效。",
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }

  const key = reservationKey(identity);
  const reservations = access.productJourneyReservations || {};
  const existing = reservations[key];
  if (existing?.status === "committed") {
    if (loaded.changed) saveDemoAccessStore(store);
    return { ok: true, duplicate: true, status: "committed", snapshot: buildDemoProductJourneySnapshot(access) };
  }
  if (existing?.status === "reserved") {
    if (loaded.changed) saveDemoAccessStore(store);
    if (existing.requestId === requestId) {
      return { ok: true, duplicate: true, status: "reserved", snapshot: buildDemoProductJourneySnapshot(access) };
    }
    return {
      ok: false,
      code: "product_journey_in_progress",
      message: "该商品研究链正在建立，请勿重复提交。",
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }
  if (activeReservations(access).length >= MAX_PRODUCT_CHAINS) {
    if (loaded.changed) saveDemoAccessStore(store);
    return {
      ok: false,
      code: "visitor_product_quota_exhausted",
      message: EXHAUSTED_MESSAGE,
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }

  const now = new Date(nowMs).toISOString();
  reservations[key] = {
    identity,
    requestId,
    status: "reserved",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    leaseExpiresAt: new Date(nowMs + Math.max(1, options.leaseMs ?? PRODUCT_JOURNEY_RESERVATION_LEASE_MS)).toISOString(),
    source: "current",
  };
  access.productJourneyReservations = reservations;
  access.lastUsedAt = now;
  saveDemoAccessStore(store);
  return { ok: true, duplicate: false, status: "reserved", snapshot: buildDemoProductJourneySnapshot(access) };
}

function settleProductJourney(
  id: string,
  identity: string,
  requestId: string,
  target: "committed" | "released",
  nowMs = Date.now(),
): DemoProductJourneyResult {
  let loaded: ReturnType<typeof loadMigratedAccess>;
  try {
    loaded = loadMigratedAccess(id, nowMs);
  } catch {
    return storeFailure();
  }
  const { store, access } = loaded;
  if (!access) {
    return { ok: false, code: "visitor_access_not_found", message: "访客码不存在。", snapshot: null };
  }
  const reservation = access.productJourneyReservations?.[reservationKey(identity)];
  if (!reservation) {
    if (loaded.changed) saveDemoAccessStore(store);
    return {
      ok: false,
      code: "product_journey_reservation_missing",
      message: "商品研究链名额预留状态缺失。",
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }
  if (reservation.requestId !== requestId) {
    if (reservation.status === "committed" && target === "committed") {
      if (loaded.changed) saveDemoAccessStore(store);
      return { ok: true, duplicate: true, status: "committed", snapshot: buildDemoProductJourneySnapshot(access) };
    }
    if (loaded.changed) saveDemoAccessStore(store);
    return {
      ok: false,
      code: "product_journey_reservation_conflict",
      message: "商品研究链名额预留与当前请求不一致。",
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }
  if (reservation.status === target) {
    if (loaded.changed) saveDemoAccessStore(store);
    return { ok: true, duplicate: true, status: target, snapshot: buildDemoProductJourneySnapshot(access) };
  }
  if (reservation.status !== "reserved") {
    if (loaded.changed) saveDemoAccessStore(store);
    return {
      ok: false,
      code: "product_journey_reservation_conflict",
      message: "商品研究链名额已进入不可变终态。",
      snapshot: buildDemoProductJourneySnapshot(access),
    };
  }

  const now = new Date(nowMs).toISOString();
  reservation.status = target;
  reservation.updatedAt = now;
  if (target === "committed") reservation.committedAt = now;
  else reservation.releasedAt = now;
  saveDemoAccessStore(store);
  return { ok: true, duplicate: false, status: target, snapshot: buildDemoProductJourneySnapshot(access) };
}

export function commitDemoProductJourney(
  id: string,
  identity: string,
  requestId: string,
  nowMs = Date.now(),
): DemoProductJourneyResult {
  return settleProductJourney(id, identity, requestId, "committed", nowMs);
}

export function releaseDemoProductJourney(
  id: string,
  identity: string,
  requestId: string,
  nowMs = Date.now(),
): DemoProductJourneyResult {
  return settleProductJourney(id, identity, requestId, "released", nowMs);
}
