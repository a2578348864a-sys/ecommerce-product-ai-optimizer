import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import {
  generateCreativeHandoffPreview,
  getCreativeHandoffDetail,
} from "@/lib/server/productCreativeHandoffPreview";
import {
  createOrAppendCreativeHandoff,
  revokeCreativeHandoffAction,
  CreativeHandoffPersistenceError,
} from "@/lib/server/productCreativeHandoffPersistence";
import type { ProductCreativeHandoffCandidate } from "@/lib/productCreativeHandoff";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getAuth(req: NextRequest, id: string, bodyRecord: Record<string, unknown>) {
  if (id.startsWith("demo-") || id.startsWith("sandbox-")) {
    const auth = requireAuthenticated(req, bodyRecord);
    if (!auth.ok) return { auth: null, ctx: null as unknown, error: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
    if (auth.context!.mode !== "demo") return { auth: null, ctx: null as unknown, error: NextResponse.json({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, { status: 404 }) };
    return { auth, ctx: auth.context!, error: null };
  }
  const auth = requireOwnerOnly(req, bodyRecord);
  if (!auth.ok) return { auth: null, ctx: null as unknown, error: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
  return { auth, ctx: auth.context!, error: null };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { ctx, error } = getAuth(req, id, {});
  if (error) return error;

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");

    if (mode === "preview") {
      const { preview, gate } = await generateCreativeHandoffPreview(id, ctx);
      return NextResponse.json({ preview, gateReason: gate.reason });
    }

    const { detail, gate } = await getCreativeHandoffDetail(id, ctx);
    return NextResponse.json({ detail, gateReason: gate.reason });
  } catch (err) {
    if (err instanceof CreativeHandoffPersistenceError) {
      return errorResponse(err.status, err.code, err.message);
    }
    if (err instanceof TaskResultJsonMutationError) {
      return errorResponse(err.status, err.code, err.message);
    }
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (!isRecord(body)) {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }

  const { ctx, error } = getAuth(req, id, body);
  if (error) return error;

  const action = body.action as string | undefined;

  if (action === "revoke") {
    // ── Revoke ──
    const requestId = body.requestId as string | undefined;
    const reasonCode = body.revokeReasonCode as string | undefined;
    const allowedReasons = ["explicit_user_revoke", "decision_changed", "identity_invalid", "verification_invalid"];

    if (!requestId || typeof requestId !== "string") {
      return errorResponse(400, "missing_request_id", "缺少幂等请求标识。");
    }
    if (!reasonCode || !allowedReasons.includes(reasonCode)) {
      return errorResponse(400, "invalid_revoke_reason", "撤回原因无效。");
    }

    try {
      const handoff = await revokeCreativeHandoffAction(id, ctx, {
        requestId,
        revokeReasonCode: reasonCode as "explicit_user_revoke",
      });
      return NextResponse.json({ handoffId: handoff.handoffId, controlState: handoff.controlState });
    } catch (err) {
      if (err instanceof CreativeHandoffPersistenceError) {
        return errorResponse(err.status, err.code, err.message);
      }
      if (err instanceof TaskResultJsonMutationError) {
        return errorResponse(err.status, err.code, err.message);
      }
      throw err;
    }
  }

  // ── Create / Append ──
  const requestId = body.requestId as string | undefined;
  const expectedResearchRevision = body.expectedResearchRevision as number | undefined;
  const expectedCurrentHandoffRevision = body.expectedCurrentHandoffRevision as number | undefined;
  const selectedFactIds = body.selectedFactIds as string[] | undefined;
  const confirmed = body.confirmed as boolean | undefined;

  if (!requestId || typeof requestId !== "string") {
    return errorResponse(400, "missing_request_id", "缺少幂等请求标识。");
  }
  if (typeof expectedResearchRevision !== "number" || expectedResearchRevision < 1) {
    return errorResponse(400, "invalid_research_revision", "研究版本无效。");
  }
  if (typeof expectedCurrentHandoffRevision !== "number" || expectedCurrentHandoffRevision < 0) {
    return errorResponse(400, "invalid_handoff_revision", "交接版本无效。");
  }
  if (confirmed !== true) {
    return errorResponse(400, "confirmation_required", "请确认创作交接内容后提交。");
  }

  try {
    // Get latest preview to build candidate
    const { preview, gate } = await generateCreativeHandoffPreview(id, ctx);
    if (!gate.allowed || !gate.candidate) {
      return errorResponse(422, "research_gate_failed", "当前研究状态不允许创建创作交接。");
    }

    // Build candidate from preview selections
    const candidate: ProductCreativeHandoffCandidate = {
      ...gate.candidate,
      confirmedFacts: gate.candidate.confirmedFacts.filter(
        (f) => selectedFactIds?.includes(f.factId)
      ),
    };

    // Validate at least one fact selected
    if (candidate.confirmedFacts.length < 1) {
      return errorResponse(400, "no_facts_selected", "请至少选择一项可用的商品事实。");
    }

    const result = await createOrAppendCreativeHandoff(id, ctx, {
      requestId,
      expectedResearchRevision,
      expectedCurrentHandoffRevision,
      candidate,
    });

    return NextResponse.json({
      handoffId: result.handoff.handoffId,
      currentRevision: result.handoff.currentRevision,
      isNewRevision: result.isNewRevision,
    }, { status: result.isNewRevision ? 201 : 200 });
  } catch (err) {
    if (err instanceof CreativeHandoffPersistenceError) {
      return errorResponse(err.status, err.code, err.message);
    }
    if (err instanceof TaskResultJsonMutationError) {
      return errorResponse(err.status, err.code, err.message);
    }
    throw err;
  }
}
