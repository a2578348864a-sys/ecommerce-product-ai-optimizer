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
import { randomUUID } from "node:crypto";
import {
  getDemoAccessById,
  isDemoAccessActive,
  isDemoAiQuotaExhausted,
  getRemainingAiCalls,
  incrementDemoAiCalls,
  reserveDemoAiImageCalls,
  commitDemoAiImageCalls,
  refundDemoAiImageCalls,
  type DemoAccessRecord,
} from "@/lib/server/demoAccess";
import { getAccessContext, type AccessContext, type DemoAccessContext } from "@/lib/server/accessPassword";

// ── Types ───────────────────────────────────────

export type GuardResult =
  | { ok: true; context: AccessContext }
  | { ok: false; status: number; code: string; message: string };

export interface DemoAccessSnapshot {
  id: string;
  label: string;
  expiresAt: string | null;
  maxAiCalls: number;
  usedAiCalls: number;
  remainingAiCalls: number;
  isActive: boolean;
}

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
  return {
    id: record.id,
    label: record.label,
    expiresAt: record.expiresAt,
    maxAiCalls: record.maxAiCalls,
    usedAiCalls: record.usedAiCalls,
    remainingAiCalls: getRemainingAiCalls(record),
    isActive: record.isActive,
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
  const reserved = reserveDemoAiImageCalls(demoCtx.demoAccessId, requestHash, neededCount);
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
  return { ok: true };
}

/**
 * Commit an atomic reservation after a successful text AI provider response.
 * The legacy increment fallback preserves callers that did not reserve first.
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
  const updated = incrementDemoAiCalls(demoCtx.demoAccessId, count);
  if (!updated) return null;
  return buildDemoAccessSnapshot(updated);
}

/**
 * Get latest demo access snapshot (for returning in API responses).
 */
export function getLatestDemoSnapshot(ctx: AccessContext): DemoAccessSnapshot | null {
  if (ctx.mode === "owner") return null;
  const demoCtx = ctx as DemoAccessContext;
  const access = getDemoAccessById(demoCtx.demoAccessId);
  if (!access) return null;
  return buildDemoAccessSnapshot(access);
}

export type VisitorImageQuotaResult =
  | { ok: true; snapshot: DemoAccessSnapshot | null; duplicate: boolean }
  | { ok: false; status: number; code: string; message: string };

export function reserveVisitorImageAiCalls(
  ctx: AccessContext,
  requestHash: string,
  count: number,
): VisitorImageQuotaResult {
  if (ctx.mode === "owner") return { ok: true, snapshot: null, duplicate: false };
  const result = reserveDemoAiImageCalls((ctx as DemoAccessContext).demoAccessId, requestHash, count);
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
