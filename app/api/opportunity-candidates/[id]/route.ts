import { NextRequest, NextResponse } from "next/server";
import {
  CandidateSourcePolicyError,
  type CandidateSourcePolicyErrorCode,
} from "@/lib/candidateSourceIntegrity";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import {
  isSandboxCandidateId,
  getSandboxCandidate,
  updateSandboxCandidate,
  deleteSandboxCandidate,
  sandboxCandidateToListItem,
} from "@/lib/server/demoSandbox";
import {
  isValidCandidateStatus,
  deleteCandidate,
  updateCandidate,
  type CandidateUpdate,
} from "@/lib/server/opportunityCandidateService";
import { toPublicOpportunityCandidate } from "@/lib/server/candidateEvidenceReview";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; candidate: unknown }
  | { ok: true; data: { id: string } }
  | { ok: false; error: { code: string; message: string } };

type RouteContext = { params: Promise<{ id: string }> };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourcePolicyErrorResponse(error: unknown) {
  const code: CandidateSourcePolicyErrorCode | null = error instanceof CandidateSourcePolicyError
    ? error.code
    : isRecord(error)
      && (error.code === "source_review_required" || error.code === "verified_source_fields_locked")
      ? error.code
      : null;
  if (!code) return null;
  const message = code === "source_review_required"
    ? "未验证来源必须经过明确人工确认后才能进入待分析。"
    : "已验证公开来源的事实字段不能通过候选编辑修改。";
  return json({ ok: false, error: { code, message } }, 409);
}

function candidateTaskLinkLockedResponse(body: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(body, "convertedTaskId")) return null;
  return json({
    ok: false,
    error: {
      code: "candidate_task_link_locked",
      message: "Candidate 与 Task 的关联只能由可信任务保存流程创建。",
    },
  }, 409);
}

type CandidateDeleteResult = "deleted" | "not_found" | "linked_task";

function candidateDeleteResponse(
  result: CandidateDeleteResult,
  id: string,
  notFoundMessage: string,
) {
  if (result === "linked_task") {
    return json({
      ok: false,
      error: {
        code: "candidate_has_linked_task",
        message: "该候选已转为任务，需保留来源证据，不能删除。",
      },
    }, 409);
  }
  if (result === "not_found") {
    return json({ ok: false, error: { code: "not_found", message: notFoundMessage } }, 404);
  }
  return json({ ok: true, data: { id } });
}

/* ── PATCH ────────────────────────────────────── */

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return json({ ok: false, error: { code: "not_found", message: "缺少候选品 ID。" } }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }

  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  // Demo-Sandbox.1-C: allow sandbox candidate PATCH for demo
  if (isSandboxCandidateId(id)) {
    const auth = requireAuthenticated(request, body);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const taskLinkResponse = candidateTaskLinkLockedResponse(body);
      if (taskLinkResponse) return taskLinkResponse;
      const update: Record<string, unknown> = {};
      if (typeof body.status === "string" && isValidCandidateStatus(body.status)) update.status = body.status;
      if (typeof body.score === "number") update.score = body.score;
      if (typeof body.name === "string") update.name = body.name;
      if (body.link !== undefined) update.link = typeof body.link === "string" ? body.link : null;
      try {
        const updated = updateSandboxCandidate(auth.context.demoAccessId, id, update, {
          sourceReviewAcknowledged: body.sourceReviewAcknowledged === true ? true : undefined,
          requestedFields: Object.keys(body),
        });
        if (!updated) return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
        return json({
          ok: true,
          candidate: toPublicOpportunityCandidate(sandboxCandidateToListItem(updated)),
        });
      } catch (error) {
        const policyResponse = sourcePolicyErrorResponse(error);
        if (policyResponse) return policyResponse;
        return json({ ok: false, error: { code: "server_error", message: "更新失败，请稍后重试。" } }, 500);
      }
    }
    return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
  }

  const auth = requireOwnerOnly(request, body);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const taskLinkResponse = candidateTaskLinkLockedResponse(body);
  if (taskLinkResponse) return taskLinkResponse;

  const update: CandidateUpdate = {};

  if (body.status !== undefined) {
    if (!isValidCandidateStatus(body.status)) {
      return json({ ok: false, error: { code: "invalid_payload", message: "状态值不合法。" } }, 400);
    }
    update.status = body.status;
  }

  if (body.link !== undefined) update.link = typeof body.link === "string" ? body.link : null;
  if (typeof body.score === "number") update.score = body.score;
  if (typeof body.keyword === "string") update.keyword = body.keyword;

  try {
    const candidate = await updateCandidate(id, update, {
      sourceReviewAcknowledged: body.sourceReviewAcknowledged === true ? true : undefined,
      requestedFields: Object.keys(body),
    });
    if (!candidate) {
      return json({ ok: false, error: { code: "not_found", message: "候选品不存在。" } }, 404);
    }
    return json({
      ok: true,
      candidate: toPublicOpportunityCandidate(candidate),
    });
  } catch (error) {
    const policyResponse = sourcePolicyErrorResponse(error);
    if (policyResponse) return policyResponse;
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用。"
          : "更新失败，请稍后重试。",
      },
    }, 500);
  }
}

/* ── DELETE ───────────────────────────────────── */

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return json({ ok: false, error: { code: "not_found", message: "缺少候选品 ID。" } }, 400);

  // Demo-Sandbox.1-C: allow sandbox candidate DELETE for demo
  if (isSandboxCandidateId(id)) {
    const auth = requireAuthenticated(request);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const result = deleteSandboxCandidate(auth.context.demoAccessId, id);
      return candidateDeleteResponse(result, id, "未找到该候选。");
    }
    return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
  }

  const auth = requireOwnerOnly(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  try {
    const result = await deleteCandidate(id);
    return candidateDeleteResponse(result, id, "候选品不存在。");
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用。"
          : "删除失败，请稍后重试。",
      },
    }, 500);
  }
}
