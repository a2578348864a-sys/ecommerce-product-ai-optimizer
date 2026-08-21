/**
 * V4 P1 — API 公共辅助（Lead 独占，P1_CONTRACT D9）。
 * flag 门禁 + 鉴权 + owner/demo 沙箱范围解析 + GraphRunResult 错误映射。
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import type { AccessContext } from "@/lib/server/accessPassword";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import type { GraphRunResult } from "@/lib/v4/graph";

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

/** owner/demo 身份 → 运行作用域。 */
export function scopeForContext(ctx: AccessContext): { ownerScope: string; sandboxId: string | null } {
  if (ctx.mode === "demo") {
    return { ownerScope: ctx.demoAccessId, sandboxId: ctx.demoAccessId };
  }
  return { ownerScope: "owner", sandboxId: null };
}

export function requireV4Auth(
  req: NextRequest,
  body: Record<string, unknown>,
): { ok: true; ctx: AccessContext } | NextResponse {
  const gate = requireV4GraphEnabled();
  if (!gate.ok) return v4DisabledResponse();
  const auth = requireAuthenticated(req, body);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: auth.code, message: auth.message } },
      { status: auth.status },
    );
  }
  return { ok: true, ctx: auth.context };
}

export function requireV4OwnerAuth(
  req: NextRequest,
  body: Record<string, unknown>,
): { ok: true; ctx: AccessContext } | NextResponse {
  const gate = requireV4GraphEnabled();
  if (!gate.ok) return v4DisabledResponse();
  const auth = requireOwnerOnly(req, body);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: auth.code, message: auth.message } },
      { status: auth.status },
    );
  }
  return { ok: true, ctx: auth.context };
}

/** 运行级鉴权：按 run 行 scope 匹配身份（fail-closed，错域返回 404 防存在性泄露）。 */
export function scopeMatches(ctx: AccessContext, ownerScope: string, sandboxId: string | null): boolean {
  if (ctx.mode === "demo") {
    return sandboxId !== null && ctx.demoAccessId === ownerScope && ctx.demoAccessId === sandboxId;
  }
  return sandboxId === null && ownerScope === "owner";
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

