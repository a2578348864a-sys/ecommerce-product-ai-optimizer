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
import {
  getDemoAccessById,
  isDemoAccessActive,
  isDemoAiQuotaExhausted,
  getRemainingAiCalls,
  incrementDemoAiCalls,
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
  expiresAt: string;
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

/**
 * Check if a Demo user has enough AI quota. Only checks, does NOT consume.
 * Owner passes through automatically.
 */
export function ensureDemoAiQuota(
  ctx: AccessContext,
  neededCount: number,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (ctx.mode === "owner") return { ok: true };

  const demoCtx = ctx as DemoAccessContext;

  // Re-fetch from store for latest state
  const access = getDemoAccessById(demoCtx.demoAccessId);
  if (!access) {
    return { ok: false, status: 403, code: "demo_access_not_found", message: "临时访问码不存在。" };
  }
  if (!access.isActive) {
    return { ok: false, status: 403, code: "demo_access_inactive", message: "该临时访问码已被停用。" };
  }
  if (new Date(access.expiresAt) < new Date()) {
    return { ok: false, status: 403, code: "demo_access_expired", message: "该临时访问已过期，请联系管理员获取新的访问码。" };
  }
  if (getRemainingAiCalls(access) < neededCount) {
    return { ok: false, status: 403, code: "demo_ai_quota_exceeded", message: "本临时访问码的 AI 分析额度已用完，可继续浏览样例与复制报告。" };
  }

  return { ok: true };
}

/**
 * Consume Demo AI calls after successful AI provider response.
 * Returns updated snapshot for frontend, or null if owner.
 */
export function consumeDemoAiCalls(
  ctx: AccessContext,
  count: number,
): DemoAccessSnapshot | null {
  if (ctx.mode === "owner") return null;

  const demoCtx = ctx as DemoAccessContext;
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
