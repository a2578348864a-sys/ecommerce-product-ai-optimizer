import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  ProductResearchStoreError,
  getProductResearchDecisionState,
  updateProductResearchDecision,
  type ProductResearchDecisionState,
} from "@/lib/server/productResearchRecordStore";
import type {
  ProductResearchDecisionEvent,
  ProductResearchDecisionInput,
} from "@/lib/productResearchRecord";
import { toResearchHashFingerprint } from "@/lib/productResearchPublicDto";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id?: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function getTaskId(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  return typeof id === "string" ? id.trim() : "";
}

function errorResponse(error: unknown) {
  if (error instanceof ProductResearchStoreError) {
    return json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
      },
    }, error.status);
  }
  return json({
    ok: false,
    error: { code: "server_error", message: "研究决定处理失败，请稍后重试。" },
  }, 500);
}

function invalidRequest() {
  return json({
    ok: false,
    error: { code: "invalid_research_decision_request", message: "研究决定请求格式无效。" },
  }, 400);
}

function safeEvent(event: ProductResearchDecisionEvent) {
  return {
    revision: event.revision,
    status: event.status,
    reason: event.reason,
    nextAction: event.nextAction,
    researchHashFingerprint: toResearchHashFingerprint(event.researchHash),
    decidedAt: event.decidedAt,
    actorMode: event.actor.mode,
  };
}

function safeState(state: ProductResearchDecisionState) {
  const record = state.record;
  return {
    taskId: state.taskId,
    legacy: state.legacy,
    readOnly: state.readOnly,
    record: record ? {
      schema: record.schema,
      revision: record.revision,
      researchHashFingerprint: toResearchHashFingerprint(record.researchHash),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      latestDecision: safeEvent(record.latestDecision),
      decisionEvents: record.decisionEvents.map(safeEvent),
    } : null,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }
  const taskId = await getTaskId(context);
  if (!taskId) return invalidRequest();
  try {
    return json({ ok: true, data: safeState(await getProductResearchDecisionState(auth.context, taskId)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }
  const taskId = await getTaskId(context);
  if (!taskId) return invalidRequest();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  if (!isRecord(body)
    || !Number.isSafeInteger(body.expectedRevision)
    || Number(body.expectedRevision) < 1
    || typeof body.decisionId !== "string"
    || typeof body.status !== "string"
    || typeof body.reason !== "string"
    || (body.nextAction !== undefined
      && body.nextAction !== null
      && typeof body.nextAction !== "string")) {
    return invalidRequest();
  }
  const allowedKeys = new Set(["expectedRevision", "decisionId", "status", "reason", "nextAction"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return invalidRequest();
  const decision: ProductResearchDecisionInput = {
    decisionId: body.decisionId,
    status: body.status as ProductResearchDecisionInput["status"],
    reason: body.reason,
    nextAction: body.nextAction as string | null | undefined,
  };

  try {
    const result = await updateProductResearchDecision(auth.context, taskId, {
      expectedRevision: body.expectedRevision as number,
      decision,
    });
    return json({
      ok: true,
      data: safeState(result.state),
      idempotent: result.kind === "idempotent",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
