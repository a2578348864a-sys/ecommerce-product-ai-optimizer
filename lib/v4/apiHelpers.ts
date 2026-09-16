/**
 * V4 P1 — API 公共辅助（Lead 独占，P1_CONTRACT D9）。
 * flag 门禁 + 鉴权 + owner/demo 沙箱范围解析 + GraphRunResult 错误映射。
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import type { GraphRunResult } from "@/lib/v4/graph";

export type SingleUserContext = {
  mode: "local_single_user" | "owner";
  ownerScope: "owner";
  sandboxId: null;
};

export type AccessContext = SingleUserContext;

export function v4DisabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "v4_graph_disabled", message: "V4 研究图未启用（QX_V4_GRAPH_ENABLED）。" } },
    { status: 404 },
  );
}

export function v4GateOrNull() {
  const gate = requireV4GraphEnabled();
  return gate.ok ? null : v4DisabledResponse();
}

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) }, { status });
}

/** 本地单用户模式：运行作用域恒定为 owner。 */
export function scopeForContext(_ctx?: unknown): { ownerScope: string; sandboxId: string | null } {
  return { ownerScope: "owner", sandboxId: null };
}

export function requireV4Auth(
  _req: NextRequest,
  _body?: Record<string, unknown>,
): { ok: true; ctx: SingleUserContext } | NextResponse {
  const gate = requireV4GraphEnabled();
  if (!gate.ok) return v4DisabledResponse();
  return { ok: true, ctx: { mode: "local_single_user", ownerScope: "owner", sandboxId: null } };
}

export function requireV4OwnerAuth(
  _req: NextRequest,
  _body?: Record<string, unknown>,
): { ok: true; ctx: SingleUserContext } | NextResponse {
  const gate = requireV4GraphEnabled();
  if (!gate.ok) return v4DisabledResponse();
  return { ok: true, ctx: { mode: "local_single_user", ownerScope: "owner", sandboxId: null } };
}

/** 运行级鉴权：单用户模式恒定匹配。 */
export function scopeMatches(_ctx?: unknown, _ownerScope?: string, _sandboxId?: string | null): boolean {
  return true;
}

/** GraphRunResult → HTTP 响应（409 携带 latestRevision；D9 契约）。 */
export function graphResultResponse(result: GraphRunResult, successStatus = 200): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, run: result.state, events: result.events }, { status: successStatus });
  }
  switch (result.code) {
    case "REVISION_CONFLICT":
      return NextResponse.json(
        { ok: false, error: { code: "REVISION_CONFLICT", message: result.safeMessage ?? "版本冲突，请刷新后重试。", latestRevision: result.latestRevision } },
        { status: 409 },
      );
    case "RUN_NOT_FOUND":
      return jsonError("run_not_found", "运行不存在。", 404);
    case "RUN_NOT_ACTIONABLE":
      return jsonError("run_not_actionable", result.safeMessage ?? "当前运行状态不可执行该操作。", 409);
    case "GRAPH_VERSION_MISMATCH":
      return jsonError("graph_version_mismatch", "运行图版本不匹配，拒绝恢复。", 409);
    case "CANDIDATE_INVALID":
      return jsonError("candidate_invalid", result.safeMessage ?? "候选商品无效。", 400);
    case "BUDGET_EXCEEDED":
      return jsonError("budget_exceeded", "预算已耗尽。", 409);
    default:
      return jsonError("internal_error", result.safeMessage ?? "内部错误。", 500);
  }
}

