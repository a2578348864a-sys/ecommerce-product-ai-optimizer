/**
 * Phase Demo-Login.1-E+F — Demo Access Guard
 *
 * Unified permission helpers for Owner vs Demo/访客 mode.
 * All restrictions are enforced server-side — not just frontend button hiding.
 *
 * Does NOT:
 * - Call AI
 * - Touch database
 * - Read .env
 * - Depend on browser APIs
 */

import "server-only";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import {
  recoverExpiredDemoAiReservations,
  isDemoAccessActive,
  isDemoAiQuotaExhausted,
  getRemainingAiCalls,
  reserveDemoAiImageCalls,
  commitDemoAiImageCalls,
  refundDemoAiImageCalls,
  settleDemoAiCallReservation,
  markDemoAiCallProviderStarted,
  DEMO_TEXT_AI_RESERVATION_LEASE_MS,
  DEMO_IMAGE_AI_RESERVATION_LEASE_MS,
  type DemoAiJobType,
  type DemoAccessRecord,
  type DemoStandaloneStudioKind,
  getDemoStandaloneStudioQuotaUsage,
  markDemoStandaloneStudioProviderStarted,
  releaseDemoStandaloneStudioQuota,
  reserveDemoStandaloneStudioQuota,
} from "@/lib/server/demoAccess";
import { getAccessContext, type AccessContext, type DemoAccessContext } from "@/lib/server/accessPassword";
import { bindProviderCallStartBoundary } from "@/lib/server/aiClient";
import {
  buildDemoProductJourneySnapshot,
  type DemoProductJourneySnapshot,
} from "@/lib/server/demoProductJourneyQuota";

// ── Types ───────────────────────────────────────

export type GuardResult =
  | { ok: true; context: AccessContext }
  | { ok: false; status: number; code: string; message: string };

export interface DemoAccessSnapshot extends DemoProductJourneySnapshot {
  maxAiCalls: number;
  usedAiCalls: number;
  remainingAiCalls: number;
  legacyAiQuotaMetric: "ai_jobs_v1";
  maxAiJobs: number;
  usedAiJobs: number;
  remainingAiJobs: number;
  standaloneListingLimit: number;
  standaloneListingUsed: number;
  standaloneListingReserved: number;
  standaloneListingRemaining: number;
  standaloneImageUnitLimit: number;
  standaloneImageUnitsUsed: number;
  standaloneImageUnitsReserved: number;
  standaloneImageUnitsRemaining: number;
}

export type DemoAiQuotaReservation = {
  reservationId: string;
  plannedCount: number;
};

export type DemoAiJobQuotaReservation = {
  reservationId: string;
  jobType: DemoAiJobType;
  jobRequestId: string;
  quotaMetric: "ai_jobs_v1";
  providerCallsPlanned: number;
  duplicate: boolean;
  status: "reserved" | "committed" | "refunded";
  providerCallsStarted?: number;
  providerCallsCompleted?: number;
  providerCallsFailed?: number;
};

export type VisitorStandaloneStudioQuotaReservation = {
  kind: DemoStandaloneStudioKind;
  requestId: string;
  units: number;
  duplicate: boolean;
  status: "reserved" | "committed" | "released";
};

// ── Error helpers ───────────────────────────────

function guardError(status: number, code: string, message: string): GuardResult {
  return { ok: false, status, code, message };
}

export function demoForbiddenResponse(message?: string) {
  return {
    status: 403,
    body: {
      ok: false,
      error: {
        code: "demo_action_forbidden",
        message: message || "访客体验模式下禁止此操作。",
      },
    },
  };
}

export function demoQuotaExceededResponse() {
  return {
    status: 403,
    body: {
      ok: false,
      error: {
        code: "demo_ai_quota_exceeded",
        message: "本临时访问码的 AI 分析额度已用完，可继续浏览样例与复制报告。",
      },
    },
  };
}

export function demoExpiredResponse() {
  return {
    status: 403,
    body: {
      ok: false,
      error: {
        code: "demo_access_expired",
        message: "该临时访问已过期，请联系管理员获取新的访问码。",
      },
    },
  };
}

export function demoInactiveResponse() {
  return {
    status: 403,
    body: {
      ok: false,
      error: {
        code: "demo_access_inactive",
        message: "该临时访问码已被停用。",
      },
    },
  };
}

// ── Snapshot builder ─────────────────────────────

export function buildDemoAccessSnapshot(record: DemoAccessRecord): DemoAccessSnapshot {
  const remainingAiJobs = getRemainingAiCalls(record);
  const listing = getDemoStandaloneStudioQuotaUsage(record, "listing");
  const image = getDemoStandaloneStudioQuotaUsage(record, "image");
  return {
    ...buildDemoProductJourneySnapshot(record),
    maxAiCalls: record.maxAiCalls,
    usedAiCalls: record.usedAiCalls,
    remainingAiCalls: remainingAiJobs,
    legacyAiQuotaMetric: "ai_jobs_v1",
    maxAiJobs: record.maxAiCalls,
    usedAiJobs: record.usedAiCalls,
    remainingAiJobs,
    standaloneListingLimit: listing.limit,
    standaloneListingUsed: listing.used,
    standaloneListingReserved: listing.reserved,
    standaloneListingRemaining: listing.remaining,
    standaloneImageUnitLimit: image.limit,
    standaloneImageUnitsUsed: image.used,
    standaloneImageUnitsReserved: image.reserved,
    standaloneImageUnitsRemaining: image.remaining,
  };
}

// ── requireAuthenticated (Owner or Demo) ────────

/**
 * Require any valid authentication (Owner or Demo).
 * Rejects unauthenticated requests.
 */
export function requireAuthenticated(
  request: NextRequest,
  body?: Record<string, unknown>,
): GuardResult {
  const ctx = getAccessContext(request, body);
  if (!ctx) {
    return guardError(401, "invalid_access", "请先登录后再操作。");
  }
  return { ok: true, context: ctx };
}

// ── requireOwnerOnly ────────────────────────────

/**
 * Require Owner mode. Demo/访客 is rejected.
 * Use for: save-task, delete, modify, import, etc.
 */
export function requireOwnerOnly(
  request: NextRequest,
  body?: Record<string, unknown>,
): GuardResult {
  const ctx = getAccessContext(request, body);
  if (!ctx) {
    return guardError(401, "invalid_access", "请先登录后再操作。");
  }
  if (ctx.mode === "demo") {
    return guardError(403, "demo_action_forbidden", getDemoForbiddenMessage("write"));
  }
  return { ok: true, context: ctx };
}

// ── Demo forbidden messages ─────────────────────

function getDemoForbiddenMessage(action: string): string {
  const messages: Record<string, string> = {
    write: "访客体验模式下不写入正式任务数据。你可以复制报告查看完整分析结果。",
    delete_task: "访客体验模式下禁止删除正式任务数据。",
    delete_candidate: "访客体验模式下禁止删除正式候选数据。",
    modify_task: "访客体验模式下禁止修改正式任务状态。",
    modify_candidate: "访客体验模式下禁止修改候选状态。",
    import: "访客体验模式下禁止导入候选到正式库。",
  };
  return messages[action] || messages.write;
}

// ── AI quota checks ─────────────────────────────

const pendingTextAiReservations = new WeakMap<object, Array<{ requestHash: string; count: number }>>();

/**
 * Atomically reserve Demo AI quota before a text provider call.
 * Owner passes through automatically.
 */
export function ensureDemoAiQuota(
  ctx: AccessContext,
  neededCount: number,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (ctx.mode === "owner") return { ok: true };

  const demoCtx = ctx as DemoAccessContext;
  const requestHash = `text-${randomUUID()}`;
  const reserved = reserveDemoAiImageCalls(demoCtx.demoAccessId, requestHash, neededCount, {
    kind: "text",
    leaseMs: DEMO_TEXT_AI_RESERVATION_LEASE_MS,
  });
  if (!reserved.ok) {
    const errors = {
      access_not_found: { code: "demo_access_not_found", message: "临时访问码不存在。" },
      access_inactive: { code: "demo_access_inactive", message: "该临时访问码已被停用。" },
      access_expired: { code: "demo_access_expired", message: "该临时访问已过期，请联系管理员获取新的访问码。" },
      quota_exceeded: { code: "demo_ai_quota_exceeded", message: "本临时访问码的 AI 分析额度已用完，可继续浏览样例与复制报告。" },
      reservation_conflict: { code: "demo_ai_quota_conflict", message: "AI 额度预扣冲突，请稍后重试。" },
    } as const;
    return { ok: false, status: 403, ...errors[reserved.code] };
  }
  const pending = pendingTextAiReservations.get(ctx) || [];
  pending.push({ requestHash, count: neededCount });
  pendingTextAiReservations.set(ctx, pending);
  bindProviderCallStartBoundary(() => {
    const marked = markDemoAiCallProviderStarted(demoCtx.demoAccessId, requestHash, neededCount);
    if (!marked.ok) throw new Error(`demo_ai_quota_provider_start_failed:${marked.code}`);
  });
  return { ok: true };
}

function quotaReservationError(
  code: "access_not_found" | "access_inactive" | "access_expired" | "quota_exceeded" | "reservation_conflict",
) {
  const errors = {
    access_not_found: { code: "demo_access_not_found", message: "临时访问码不存在。" },
    access_inactive: { code: "demo_access_inactive", message: "该临时访问码已被停用。" },
    access_expired: { code: "demo_access_expired", message: "该临时访问已过期，请联系管理员获取新的访问码。" },
    quota_exceeded: { code: "demo_ai_quota_exceeded", message: "本临时访问码的 AI 分析额度不足。" },
    reservation_conflict: { code: "demo_ai_quota_conflict", message: "AI 额度预扣冲突，请稍后重试。" },
  } as const;
  return { ok: false as const, status: 403, ...errors[code] };
}

export function reserveDemoAiCalls(
  ctx: AccessContext,
  plannedCount: number,
  options: { leaseMs?: number; nowMs?: number } = {},
):
  | { ok: true; reservation: DemoAiQuotaReservation | null }
  | { ok: false; status: number; code: string; message: string } {
  if (ctx.mode === "owner") return { ok: true, reservation: null };

  const reservationId = `text-${randomUUID()}`;
  const leaseMs = Math.max(DEMO_TEXT_AI_RESERVATION_LEASE_MS, options.leaseMs ?? 0);
  const reserved = reserveDemoAiImageCalls(ctx.demoAccessId, reservationId, plannedCount, {
    kind: "text",
    leaseMs,
    nowMs: options.nowMs,
  });
  if (!reserved.ok) return quotaReservationError(reserved.code);
  return { ok: true, reservation: { reservationId, plannedCount } };
}

export function settleDemoAiCalls(
  ctx: AccessContext,
  reservation: DemoAiQuotaReservation | null,
  startedCount: number,
):
  | { ok: true; snapshot: DemoAccessSnapshot | null }
  | { ok: false; status: number; code: string; message: string } {
  if (ctx.mode === "owner") return { ok: true, snapshot: null };

  if (!reservation) {
    console.error("Demo AI quota settlement failed", {
      code: "reservation_missing",
      demoAccessId: ctx.demoAccessId,
      plannedCount: null,
      startedCount,
    });
    return {
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "AI 额度结算状态缺失，请稍后重试。",
    };
  }

  const settled = settleDemoAiCallReservation(ctx.demoAccessId, reservation.reservationId, startedCount);
  if (!settled.ok) {
    console.error("Demo AI quota settlement failed", {
      code: settled.code,
      demoAccessId: ctx.demoAccessId,
      reservationId: reservation.reservationId,
      plannedCount: reservation.plannedCount,
      startedCount,
    });
    return {
      ok: false,
      status: 500,
      code: settled.code === "reservation_not_found"
        ? "demo_ai_quota_reservation_missing"
        : "demo_ai_quota_settlement_failed",
      message: "AI 额度结算失败，请稍后重试。",
    };
  }

  return { ok: true, snapshot: buildDemoAccessSnapshot(settled.record) };
}

export function markDemoAiProviderCallStarted(
  ctx: AccessContext,
  reservation: DemoAiQuotaReservation | null,
  startedCount: number,
):
  | { ok: true }
  | { ok: false; status: number; code: string; message: string } {
  if (ctx.mode === "owner") return { ok: true };
  if (!reservation) {
    return {
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "AI quota reservation is missing.",
    };
  }

  const marked = markDemoAiCallProviderStarted(
    ctx.demoAccessId,
    reservation.reservationId,
    startedCount,
  );
  if (!marked.ok) {
    console.error("Demo AI Provider-start boundary failed", {
      code: marked.code,
      demoAccessId: ctx.demoAccessId,
      reservationId: reservation.reservationId,
      plannedCount: reservation.plannedCount,
      startedCount,
    });
    return {
      ok: false,
      status: 500,
      code: marked.code === "reservation_not_found"
        ? "demo_ai_quota_reservation_missing"
        : "demo_ai_quota_provider_start_failed",
      message: "AI quota Provider-start boundary could not be persisted.",
    };
  }
  return { ok: true };
}

type ReserveDemoAiJobInput = {
  jobType: DemoAiJobType;
  jobRequestId: string;
  providerCallsPlanned: number;
  leaseMs?: number;
  nowMs?: number;
};

type DemoAiJobFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  snapshot: DemoAccessSnapshot | null;
};

function demoAiJobReservationId(jobType: DemoAiJobType, jobRequestId: string): string {
  return `job-${createHash("sha256").update(`${jobType}:${jobRequestId}`, "utf8").digest("hex")}`;
}

export function reserveDemoAiJob(
  ctx: AccessContext,
  input: ReserveDemoAiJobInput,
):
  | {
      ok: true;
      reservation: DemoAiJobQuotaReservation | null;
      snapshot: DemoAccessSnapshot | null;
    }
  | DemoAiJobFailure {
  if (ctx.mode === "owner") {
    return { ok: true, reservation: null, snapshot: null };
  }
  if (!input.jobRequestId.trim()
    || input.jobRequestId.length > 128
    || !Number.isInteger(input.providerCallsPlanned)
    || input.providerCallsPlanned <= 0) {
    return {
      ok: false,
      status: 400,
      code: "invalid_ai_job_request",
      message: "AI 作业请求标识或 Provider 计划无效。",
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }

  const reservationId = demoAiJobReservationId(input.jobType, input.jobRequestId);
  const reserved = reserveDemoAiImageCalls(ctx.demoAccessId, reservationId, 1, {
    kind: "text",
    leaseMs: Math.max(DEMO_TEXT_AI_RESERVATION_LEASE_MS, input.leaseMs ?? 0),
    nowMs: input.nowMs,
    quotaMetric: "ai_jobs_v1",
    jobType: input.jobType,
    jobRequestId: input.jobRequestId,
    providerCallsPlanned: input.providerCallsPlanned,
  });
  if (!reserved.ok) {
    const error = quotaReservationError(reserved.code);
    return {
      ...error,
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }
  const stored = reserved.record.aiImageQuotaReservations?.[reservationId];
  if (!stored) {
    return {
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "AI 作业额度预留状态缺失。",
      snapshot: buildDemoAccessSnapshot(reserved.record),
    };
  }
  return {
    ok: true,
    reservation: {
      reservationId,
      jobType: input.jobType,
      jobRequestId: input.jobRequestId,
      quotaMetric: "ai_jobs_v1",
      providerCallsPlanned: input.providerCallsPlanned,
      duplicate: reserved.duplicate,
      status: stored.status,
      ...(stored.providerStartedCount !== undefined
        ? { providerCallsStarted: stored.providerStartedCount }
        : {}),
      ...(stored.providerCallsCompleted !== undefined
        ? { providerCallsCompleted: stored.providerCallsCompleted }
        : {}),
      ...(stored.providerCallsFailed !== undefined
        ? { providerCallsFailed: stored.providerCallsFailed }
        : {}),
    },
    snapshot: buildDemoAccessSnapshot(reserved.record),
  };
}

export function markDemoAiJobProviderCallStarted(
  ctx: AccessContext,
  reservation: DemoAiJobQuotaReservation | null,
  startedCount: number,
):
  | { ok: true }
  | { ok: false; status: number; code: string; message: string } {
  if (ctx.mode === "owner") return { ok: true };
  if (!reservation) {
    return {
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "AI 作业额度预留状态缺失。",
    };
  }
  const marked = markDemoAiCallProviderStarted(
    ctx.demoAccessId,
    reservation.reservationId,
    startedCount,
  );
  if (!marked.ok) {
    return {
      ok: false,
      status: 500,
      code: marked.code === "reservation_not_found"
        ? "demo_ai_quota_reservation_missing"
        : "demo_ai_quota_provider_start_failed",
      message: "AI 作业 Provider 启动审计无法持久化。",
    };
  }
  return { ok: true };
}

export function settleDemoAiJob(
  ctx: AccessContext,
  reservation: DemoAiJobQuotaReservation | null,
  audit: {
    providerCallsStarted: number;
    providerCallsCompleted: number;
    providerCallsFailed: number;
  },
):
  | {
      ok: true;
      snapshot: DemoAccessSnapshot | null;
      status: "committed" | "refunded";
      duplicate: boolean;
    }
  | DemoAiJobFailure {
  if (ctx.mode === "owner") {
    return {
      ok: true,
      snapshot: null,
      status: audit.providerCallsStarted > 0 ? "committed" : "refunded",
      duplicate: false,
    };
  }
  if (!reservation) {
    return {
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "AI 作业额度结算状态缺失。",
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }
  const settled = settleDemoAiCallReservation(
    ctx.demoAccessId,
    reservation.reservationId,
    audit.providerCallsStarted,
    {
      providerCallsCompleted: audit.providerCallsCompleted,
      providerCallsFailed: audit.providerCallsFailed,
    },
  );
  if (!settled.ok) {
    return {
      ok: false,
      status: 500,
      code: settled.code === "reservation_not_found"
        ? "demo_ai_quota_reservation_missing"
        : "demo_ai_quota_settlement_failed",
      message: "AI 作业额度结算失败，请稍后重试。",
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }
  return {
    ok: true,
    snapshot: buildDemoAccessSnapshot(settled.record),
    status: audit.providerCallsStarted > 0 ? "committed" : "refunded",
    duplicate: settled.duplicate,
  };
}

/**
 * Commit an atomic reservation after a successful text AI provider response.
 * Missing reservations fail closed so callers cannot silently bypass the quota gate.
 * Returns updated snapshot for frontend, or null if owner.
 */
export function consumeDemoAiCalls(
  ctx: AccessContext,
  count: number,
): DemoAccessSnapshot | null {
  if (ctx.mode === "owner") return null;

  const demoCtx = ctx as DemoAccessContext;
  const pending = pendingTextAiReservations.get(ctx) || [];
  const reservationIndex = pending.findIndex((reservation) => reservation.count === count);
  if (reservationIndex >= 0) {
    const [reservation] = pending.splice(reservationIndex, 1);
    if (pending.length > 0) pendingTextAiReservations.set(ctx, pending);
    else pendingTextAiReservations.delete(ctx);
    const committed = commitDemoAiImageCalls(demoCtx.demoAccessId, reservation.requestHash);
    return committed ? buildDemoAccessSnapshot(committed) : null;
  }
  console.error("Demo AI quota settlement failed", {
    code: "reservation_missing",
    demoAccessId: demoCtx.demoAccessId,
    count,
  });
  throw new Error("demo_ai_quota_reservation_missing");
}

/**
 * Get latest demo access snapshot (for returning in API responses).
 */
export function getLatestDemoSnapshot(ctx: AccessContext): DemoAccessSnapshot | null {
  if (ctx.mode === "owner") return null;
  const demoCtx = ctx as DemoAccessContext;
  const access = recoverExpiredDemoAiReservations(demoCtx.demoAccessId);
  if (!access) return null;
  return buildDemoAccessSnapshot(access);
}

type VisitorStandaloneStudioQuotaError = {
  ok: false;
  status: number;
  code:
    | "demo_standalone_listing_quota_exceeded"
    | "demo_standalone_image_quota_exceeded"
    | "demo_access_not_found"
    | "demo_access_inactive"
    | "demo_standalone_quota_conflict"
    | "demo_standalone_quota_store_busy";
  message: string;
  snapshot?: DemoAccessSnapshot | null;
};

type VisitorStandaloneStudioQuotaSuccess = {
  ok: true;
  reservation: VisitorStandaloneStudioQuotaReservation | null;
  snapshot: DemoAccessSnapshot | null;
};

function standaloneQuotaError(
  kind: DemoStandaloneStudioKind,
  code: string,
  snapshot?: DemoAccessSnapshot | null,
): VisitorStandaloneStudioQuotaError {
  if (code === "quota_exceeded") {
    return kind === "listing"
      ? {
          ok: false,
          status: 403,
          code: "demo_standalone_listing_quota_exceeded",
          message: "该访客码的独立 Listing 体验额度已用完。",
          snapshot,
        }
      : {
          ok: false,
          status: 403,
          code: "demo_standalone_image_quota_exceeded",
          message: "该访客码的独立生图体验额度已用完。",
          snapshot,
        };
  }
  if (code === "access_not_found") {
    return { ok: false, status: 403, code: "demo_access_not_found", message: "访客码不存在。", snapshot };
  }
  if (code === "access_inactive") {
    return { ok: false, status: 403, code: "demo_access_inactive", message: "该访客码已停用。", snapshot };
  }
  return {
    ok: false,
    status: 409,
    code: "demo_standalone_quota_conflict",
    message: "访客体验额度状态冲突，请稍后重试。",
    snapshot,
  };
}

export function reserveVisitorStandaloneStudioQuota(
  ctx: AccessContext,
  input: { kind: DemoStandaloneStudioKind; requestId: string; units: number },
): VisitorStandaloneStudioQuotaSuccess | VisitorStandaloneStudioQuotaError {
  if (ctx.mode === "owner") return { ok: true, reservation: null, snapshot: null };
  try {
    const result = reserveDemoStandaloneStudioQuota(
      ctx.demoAccessId,
      input.kind,
      input.requestId,
      input.units,
    );
    if (!result.ok) return standaloneQuotaError(input.kind, result.code, getLatestDemoSnapshot(ctx));
    return {
      ok: true,
      reservation: {
        ...input,
        duplicate: result.duplicate,
        status: result.status,
      },
      snapshot: buildDemoAccessSnapshot(result.record),
    };
  } catch (error) {
    console.error("Visitor standalone quota reservation failed", {
      kind: input.kind,
      demoAccessId: ctx.demoAccessId,
      code: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      status: 503,
      code: "demo_standalone_quota_store_busy",
      message: "访客体验额度暂时不可用，请稍后重试。",
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }
}

export function markVisitorStandaloneStudioProviderStarted(
  ctx: AccessContext,
  reservation: VisitorStandaloneStudioQuotaReservation | null,
): (VisitorStandaloneStudioQuotaSuccess & { duplicate: boolean }) | VisitorStandaloneStudioQuotaError {
  if (ctx.mode === "owner" || !reservation) {
    return { ok: true, reservation: null, snapshot: null, duplicate: false };
  }
  try {
    const result = markDemoStandaloneStudioProviderStarted(
      ctx.demoAccessId,
      reservation.kind,
      reservation.requestId,
      reservation.units,
    );
    if (!result.ok) return standaloneQuotaError(reservation.kind, result.code, getLatestDemoSnapshot(ctx));
    return {
      ok: true,
      reservation: { ...reservation, duplicate: result.duplicate, status: result.status },
      snapshot: buildDemoAccessSnapshot(result.record),
      duplicate: result.duplicate,
    };
  } catch (error) {
    console.error("Visitor standalone quota Provider boundary failed", {
      kind: reservation.kind,
      demoAccessId: ctx.demoAccessId,
      code: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      status: 503,
      code: "demo_standalone_quota_store_busy",
      message: "访客体验额度暂时不可用，请稍后重试。",
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }
}

export function releaseVisitorStandaloneStudioQuota(
  ctx: AccessContext,
  reservation: VisitorStandaloneStudioQuotaReservation | null,
): (VisitorStandaloneStudioQuotaSuccess & { duplicate: boolean }) | VisitorStandaloneStudioQuotaError {
  if (ctx.mode === "owner" || !reservation) {
    return { ok: true, reservation: null, snapshot: null, duplicate: false };
  }
  try {
    const result = releaseDemoStandaloneStudioQuota(
      ctx.demoAccessId,
      reservation.kind,
      reservation.requestId,
      reservation.units,
    );
    if (!result.ok) return standaloneQuotaError(reservation.kind, result.code, getLatestDemoSnapshot(ctx));
    return {
      ok: true,
      reservation: { ...reservation, duplicate: result.duplicate, status: result.status },
      snapshot: buildDemoAccessSnapshot(result.record),
      duplicate: result.duplicate,
    };
  } catch (error) {
    console.error("Visitor standalone quota release failed", {
      kind: reservation.kind,
      demoAccessId: ctx.demoAccessId,
      code: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      status: 503,
      code: "demo_standalone_quota_store_busy",
      message: "访客体验额度暂时不可用，请稍后重试。",
      snapshot: getLatestDemoSnapshot(ctx),
    };
  }
}

export type VisitorImageQuotaResult =
  | { ok: true; snapshot: DemoAccessSnapshot | null; duplicate: boolean }
  | { ok: false; status: number; code: string; message: string };

export function reserveVisitorImageAiCalls(
  ctx: AccessContext,
  requestHash: string,
  _requestedImageCount: number,
): VisitorImageQuotaResult {
  if (ctx.mode === "owner") return { ok: true, snapshot: null, duplicate: false };
  const result = reserveDemoAiImageCalls((ctx as DemoAccessContext).demoAccessId, requestHash, 1, {
    kind: "image",
    leaseMs: DEMO_IMAGE_AI_RESERVATION_LEASE_MS,
    quotaMetric: "ai_jobs_v1",
    jobType: "image_generation",
    jobRequestId: requestHash,
    providerCallsPlanned: 1,
  });
  if (result.ok) {
    return { ok: true, snapshot: buildDemoAccessSnapshot(result.record), duplicate: result.duplicate };
  }
  const messages: Record<typeof result.code, { status: number; code: string; message: string }> = {
    access_not_found: { status: 403, code: "visitor_access_not_found", message: "临时访问不存在。" },
    access_inactive: { status: 403, code: "visitor_access_inactive", message: "该临时访问已停用。" },
    access_expired: { status: 403, code: "visitor_access_expired", message: "该临时访问已过期。" },
    quota_exceeded: { status: 403, code: "visitor_ai_quota_exceeded", message: "共享真实 AI 体验次数已用完。" },
    reservation_conflict: { status: 409, code: "image_request_conflict", message: "请求标识与已有请求不一致。" },
  };
  return { ok: false, ...messages[result.code] };
}

export function markVisitorImageAiProviderStarted(
  ctx: AccessContext,
  requestHash: string,
): { ok: true } | { ok: false; code: string } {
  if (ctx.mode === "owner") return { ok: true };
  const marked = markDemoAiCallProviderStarted(
    (ctx as DemoAccessContext).demoAccessId,
    requestHash,
    1,
  );
  return marked.ok ? { ok: true } : { ok: false, code: marked.code };
}

export function commitVisitorImageAiCalls(ctx: AccessContext, requestHash: string): DemoAccessSnapshot | null {
  if (ctx.mode === "owner") return null;
  const updated = commitDemoAiImageCalls((ctx as DemoAccessContext).demoAccessId, requestHash);
  return updated ? buildDemoAccessSnapshot(updated) : null;
}

export function refundVisitorImageAiCalls(ctx: AccessContext, requestHash: string): DemoAccessSnapshot | null {
  if (ctx.mode === "owner") return null;
  const updated = refundDemoAiImageCalls((ctx as DemoAccessContext).demoAccessId, requestHash);
  return updated ? buildDemoAccessSnapshot(updated) : null;
}
