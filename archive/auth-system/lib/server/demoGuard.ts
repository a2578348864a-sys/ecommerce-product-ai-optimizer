/**
 * Demo Guard Compatibility Shim
 *
 * Re-exports authentication helpers from authGuard.ts.
 * Stubs legacy demo/visitor quota functions as no-ops for owner mode.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import {
  requireAuthenticated as baseRequireAuthenticated,
  requireOwnerOnly as baseRequireOwnerOnly,
  type GuardResult,
} from "@/lib/server/authGuard";
import type { AccessContext } from "@/lib/server/accessPassword";

export type { GuardResult };

export const requireAuthenticated = baseRequireAuthenticated;
export const requireOwnerOnly = baseRequireOwnerOnly;

// ── Types ───────────────────────────────────────

export interface DemoAccessSnapshot {
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
  credentialKind: "password" | "anonymous";
  globalCapExhausted?: { text: boolean; image: boolean };
}

export type DemoAiQuotaReservation = {
  reservationId: string;
  plannedCount: number;
};

export type DemoAiJobQuotaReservation = {
  reservationId: string;
  jobType: string;
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
  kind: string;
  requestId: string;
  status: "reserved" | "committed" | "released";
};

export type VisitorImageQuotaResult =
  | { ok: true; reservationId: string; duplicate?: boolean; snapshot?: DemoAccessSnapshot }
  | { ok: false; code: string; message: string; snapshot?: DemoAccessSnapshot };

export type DemoProviderActionInput = {
  jobType: string;
  requestId: string;
  providerCallsPlanned?: number;
};

export type DemoProviderActionToken = {
  mode: "owner" | "demo";
  reservation?: any;
};

export type DemoProviderActionGuard =
  | { ok: true; token: DemoProviderActionToken; response?: never; code?: string; message?: string; status?: number }
  | { ok: false; token?: never; response: NextResponse; code: string; message: string; status: number };

// ── Stubs ───────────────────────────────────────

export function demoForbiddenResponse(message = "当前操作仅管理员可用。") {
  return NextResponse.json({ ok: false, error: { code: "demo_action_forbidden", message } }, { status: 403 });
}

export function demoQuotaExceededResponse() {
  return NextResponse.json({ ok: false, error: { code: "demo_quota_exceeded", message: "体验额度已用完。" } }, { status: 403 });
}

export function demoExpiredResponse() {
  return NextResponse.json({ ok: false, error: { code: "demo_access_expired", message: "体验已过期。" } }, { status: 403 });
}

export function demoInactiveResponse() {
  return NextResponse.json({ ok: false, error: { code: "demo_access_inactive", message: "该访问码已被停用。" } }, { status: 403 });
}

export function buildDemoAccessSnapshot(): DemoAccessSnapshot {
  return {
    maxAiCalls: 999,
    usedAiCalls: 0,
    remainingAiCalls: 999,
    legacyAiQuotaMetric: "ai_jobs_v1",
    maxAiJobs: 999,
    usedAiJobs: 0,
    remainingAiJobs: 999,
    standaloneListingLimit: 999,
    standaloneListingUsed: 0,
    standaloneListingReserved: 0,
    standaloneListingRemaining: 999,
    standaloneImageUnitLimit: 999,
    standaloneImageUnitsUsed: 0,
    standaloneImageUnitsReserved: 0,
    standaloneImageUnitsRemaining: 999,
    credentialKind: "password",
  };
}

export function ensureDemoAiQuota(_ctx?: unknown, _count?: number) {
  return { ok: true as const, code: "" as string, status: 200 as number, message: "" as string };
}

export function reserveDemoAiCalls(_ctx?: unknown, plannedCount = 1) {
  return { ok: true as const, reservation: null, reservationId: "owner_res", plannedCount };
}

export type SettleDemoAiCallsResult =
  | { ok: true; status: 200; code: "ok"; message: "" }
  | { ok: false; status: number; code: string; message: string };

export function settleDemoAiCalls(_ctx?: unknown, _reservation?: unknown, _providerCallsStarted?: unknown): SettleDemoAiCallsResult {
  return { ok: true, status: 200, code: "ok", message: "" };
}

export function markDemoAiProviderCallStarted(_ctx?: unknown, _reservation?: unknown, _providerCallsStarted?: unknown) {
  return { ok: true as const, code: "" as string };
}

export function reserveDemoAiJob(_ctx?: unknown, jobType = "job", jobRequestId = "req", plannedCalls = 1) {
  return {
    ok: true as const,
    reservation: {
      reservationId: `res_${jobRequestId}`,
      jobType,
      jobRequestId,
      quotaMetric: "ai_jobs_v1" as const,
      providerCallsPlanned: plannedCalls,
      duplicate: false,
      status: "reserved" as const,
    },
  };
}

export function markDemoAiJobProviderCallStarted(_ctx?: unknown, _reservation?: unknown) {
  return { ok: true as const, code: "" as string };
}

export function settleDemoAiJob(_ctx?: unknown, _reservation?: unknown, _status?: unknown) {
  return { ok: true as const, code: "" as string };
}

export function consumeDemoAiCalls(_ctx?: unknown, _count?: number): DemoAccessSnapshot {
  return buildDemoAccessSnapshot();
}

export function getLatestDemoSnapshot(_ctx?: unknown): DemoAccessSnapshot | null {
  return null;
}

export function reserveVisitorStandaloneStudioQuota(
  _ctx?: unknown,
  _input?: { kind: string; requestId: string; units?: number } | string,
  _requestId?: string,
) {
  const kind = typeof _input === "string" ? _input : _input?.kind || "listing";
  const requestId = typeof _input === "string" ? (_requestId || "req") : (_input?.requestId || "req");
  return {
    ok: true as const,
    reservation: { kind, requestId, status: "reserved" as const },
    quota: { available: true },
    code: "" as string,
    status: 200 as number,
    message: "" as string,
  };
}

export function markVisitorStandaloneStudioProviderStarted(_ctx?: unknown, _reservation?: unknown) {
  return {
    ok: true as const,
    snapshot: null as DemoAccessSnapshot | null,
    code: "" as string,
    status: 200 as number,
    message: "" as string,
  };
}

export function releaseVisitorStandaloneStudioQuota(_ctx?: unknown, _reservation?: unknown) {
  return {
    ok: true as const,
    snapshot: null as DemoAccessSnapshot | null,
    code: "" as string,
    status: 200 as number,
    message: "" as string,
  };
}

export function reserveVisitorImageAiCalls(_ctx?: unknown, _requestHash?: unknown, _countOrPrompt?: unknown) {
  return {
    ok: true as const,
    reservationId: "owner_img",
    duplicate: false,
    snapshot: null as DemoAccessSnapshot | null,
    code: "" as string,
    status: 200 as number,
    message: "" as string,
  };
}

export function markVisitorImageAiProviderStarted(_ctx?: unknown, _requestHash?: unknown) {
  return {
    ok: true as const,
    code: "" as string,
    status: 200 as number,
    message: "" as string,
  };
}

export function commitVisitorImageAiCalls(_ctx?: unknown, _requestHash?: unknown): DemoAccessSnapshot | null {
  return null;
}

export function refundVisitorImageAiCalls(_ctx?: unknown, _requestHash?: unknown): DemoAccessSnapshot | null {
  return null;
}

export function guardDemoProviderAction(..._args: any[]): DemoProviderActionGuard {
  return { ok: true, token: { mode: "owner", reservation: null } };
}

export function finalizeDemoProviderAction(..._args: any[]) {
  // no-op
}