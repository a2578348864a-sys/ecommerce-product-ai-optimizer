import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export type OwnerAccessContext = {
  mode: "owner" | "local_single_user";
  token?: string;
  ownerRef?: string;
};

export type DemoAccessContext = {
  mode: "demo";
  token?: string;
  demoAccessId: string;
  isActive?: boolean;
  isExpired?: boolean;
  remainingAiCalls?: number;
  credentialKind?: "password" | "anonymous";
};

export type AccessContext = OwnerAccessContext | DemoAccessContext;

export type VisitorStandaloneStudioQuotaReservation = {
  kind: string;
  requestId: string;
  status: "reserved" | "committed" | "released";
};

export type GuardResult =
  | { ok: true; context: AccessContext }
  | { ok: false; status: number; code: string; message: string };

export const LOCAL_SINGLE_USER_CONTEXT: AccessContext = {
  mode: "local_single_user",
};

export function getLocalSingleUserContext(): AccessContext {
  return LOCAL_SINGLE_USER_CONTEXT;
}

export function getAccessPassword(): string {
  return "";
}

export type AccessPasswordCheckResult = { status: number; body: unknown } | null;

export function checkAccessPassword(_request?: NextRequest, _body?: Record<string, unknown>): AccessPasswordCheckResult {
  return null;
}

export function getAccessContext(_request?: NextRequest, _body?: Record<string, unknown>): AccessContext {
  return LOCAL_SINGLE_USER_CONTEXT;
}

export function resolveAccessContext(_request?: NextRequest, _body?: Record<string, unknown>) {
  return { ok: true as const, context: LOCAL_SINGLE_USER_CONTEXT };
}

export function requireAuthenticated(_request?: NextRequest, _body?: Record<string, unknown>): GuardResult {
  return { ok: true, context: LOCAL_SINGLE_USER_CONTEXT };
}

export function requireOwnerOnly(_request?: NextRequest, _body?: Record<string, unknown>): GuardResult {
  return { ok: true, context: LOCAL_SINGLE_USER_CONTEXT };
}

// ── Legacy Demo Stubs (No-op for Single User) ──

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
  return { ok: true as const, code: "", status: 200, message: "" };
}

export function reserveDemoAiCalls(_ctx?: unknown, plannedCount = 1) {
  return { ok: true as const, reservation: null, reservationId: "owner_res", plannedCount };
}

export type SettleDemoAiCallsResult =
  | { ok: true; status: number; code: string; message: string }
  | { ok: false; status: number; code: string; message: string };

export function settleDemoAiCalls(_ctx?: unknown, _reservation?: unknown, _providerCallsStarted?: unknown): SettleDemoAiCallsResult {
  return { ok: true, status: 200, code: "ok", message: "" };
}

export function markDemoAiProviderCallStarted(_ctx?: unknown, _reservation?: unknown, _providerCallsStarted?: unknown) {
  return { ok: true as const, code: "" };
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
  return { ok: true as const, code: "" };
}

export function settleDemoAiJob(_ctx?: unknown, _reservation?: unknown, _status?: unknown) {
  return { ok: true as const, code: "" };
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
    code: "",
    status: 200,
    message: "",
  };
}

export function markVisitorStandaloneStudioProviderStarted(_ctx?: unknown, _reservation?: unknown) {
  return { ok: true as const, snapshot: null as DemoAccessSnapshot | null, code: "", status: 200, message: "" };
}

export function releaseVisitorStandaloneStudioQuota(_ctx?: unknown, _reservation?: unknown) {
  return { ok: true as const, snapshot: null as DemoAccessSnapshot | null, code: "", status: 200, message: "" };
}

export function reserveVisitorImageAiCalls(_ctx?: unknown, _requestHash?: unknown, _countOrPrompt?: unknown) {
  return {
    ok: true as const,
    reservationId: "owner_img",
    duplicate: false,
    snapshot: null as DemoAccessSnapshot | null,
    code: "",
    status: 200,
    message: "",
  };
}

export function markVisitorImageAiProviderStarted(_ctx?: unknown, _requestHash?: unknown) {
  return { ok: true as const, code: "", status: 200, message: "" };
}

export function commitVisitorImageAiCalls(_ctx?: unknown, _requestHash?: unknown): DemoAccessSnapshot | null {
  return null;
}

export function refundVisitorImageAiCalls(_ctx?: unknown, _requestHash?: unknown): DemoAccessSnapshot | null {
  return null;
}

export type DemoProviderActionToken = { mode: "owner"; reservation: null };

export type DemoProviderActionGuard =
  | { ok: true; token: DemoProviderActionToken }
  | { ok: false; response: NextResponse; code: string; message: string; status: number };

export function guardDemoProviderAction(..._args: any[]): DemoProviderActionGuard {
  return { ok: true, token: { mode: "owner", reservation: null } };
}

export function finalizeDemoProviderAction(..._args: any[]) {
  // no-op
}

export function generateSignedToken(_payload?: unknown): string {
  return "mock_token";
}

