import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { isDecisionStatus, normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";
import {
  getSandboxTask,
  updateSandboxTask,
  deleteSandboxTask,
  sandboxTaskToDetail,
  isSandboxTaskId,
} from "@/lib/server/demoSandbox";

export const runtime = "nodejs";

type ApiError = {
  code: string;
  message: string;
};

type ViralTaskItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  decisionStatus: DecisionStatus;
  title: string | null;
  platform: string;
  productUrl: string | null;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  result: unknown;
};

type ApiResponse =
  | { ok: true; data: ViralTaskItem }
  | { ok: true; data: { id: string } }
  | { ok: true; data: { id: string; decisionStatus: DecisionStatus } }
  | { ok: false; error: ApiError };

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toTaskItem(record: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  type: string;
  decisionStatus?: string | null;
  title: string | null;
  platform: string;
  productUrl: string | null;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  resultJson: string;
}): ViralTaskItem {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    type: record.type,
    decisionStatus: normalizeDecisionStatus(record.decisionStatus),
    title: record.title,
    platform: record.platform,
    productUrl: record.productUrl,
    materialText: record.materialText,
    source: record.source,
    score: record.score,
    level: record.level,
    oneLineSummary: record.oneLineSummary,
    result: safeParseJson(record.resultJson),
  };
}

function invalidIdResponse() {
  return jsonResponse({
    ok: false,
    error: { code: "invalid_id", message: "请提供有效的任务记录 ID。" },
  }, 400);
}

function notFoundResponse() {
  return jsonResponse({
    ok: false,
    error: { code: "not_found", message: "任务记录不存在或已删除。" },
  }, 404);
}

function invalidDecisionStatusResponse() {
  return jsonResponse({
    ok: false,
    error: { code: "invalid_decision_status", message: "人工状态只能是待判断、可继续、需补资料或已淘汰。" },
  }, 400);
}

function databaseError() {
  return jsonResponse({
    ok: false,
    error: {
      code: "database_error",
      message: "本地数据库暂时不可用，请确认 Prisma/SQLite 配置后再试。",
    },
  }, 500);
}

function serverError() {
  return jsonResponse({
    ok: false,
    error: {
      code: "server_error",
      message: "任务记录处理失败，请稍后再试。",
    },
  }, 500);
}

function isDatabaseError(error: unknown) {
  return error instanceof Error && (
    error.message.includes("DATABASE_URL") ||
    error.message.includes("Environment variable not found") ||
    error.message.includes("Can't reach database") ||
    error.message.includes("database") ||
    error.message.includes("no such table")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getId(context: RouteContext) {
  const { id: rawId } = await context.params;
  return typeof rawId === "string" ? rawId.trim() : "";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const id = await getId(context);
  if (!id) return invalidIdResponse();

  // Demo-Sandbox.1-B: handle sandbox task IDs
  if (isSandboxTaskId(id)) {
    const ctx = getAccessContext(request);
    if (!ctx || ctx.mode !== "demo") return notFoundResponse();
    const task = getSandboxTask(ctx.demoAccessId, id);
    if (!task) return notFoundResponse();
    return jsonResponse({ ok: true, data: sandboxTaskToDetail(task) });
  }

  try {
    const record = await prisma.viralAnalysisRecord.findFirst({
      where: { id },
    });

    if (!record) return notFoundResponse();

    return jsonResponse({
      ok: true,
      data: toTaskItem(record),
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const id = await getId(context);
  if (!id) return invalidIdResponse();

  // Demo-Sandbox.1-B: allow sandbox delete for demo, block official
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const deleted = deleteSandboxTask(auth.context.demoAccessId, id);
      if (!deleted) return notFoundResponse();
      return jsonResponse({ ok: true, data: { id } });
    }
    // Non-demo user with sandbox ID — not found
    return notFoundResponse();
  }

  // Official task: Owner only
  const auth = requireAuthenticated(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  try {
    await prisma.viralAnalysisRecord.delete({
      where: { id },
    });

    return jsonResponse({
      ok: true,
      data: { id },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return notFoundResponse();
    }

    return isDatabaseError(error) ? databaseError() : serverError();
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_json", message: "请求体不是合法 JSON。" },
    }, 400);
  }

  const bodyRecord = isRecord(body) ? body : {};

  const id = await getId(context);
  if (!id) return invalidIdResponse();

  // Demo-Sandbox.1-B: allow sandbox PATCH for demo, block official
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const decisionStatus = bodyRecord.decisionStatus;
      if (!isDecisionStatus(decisionStatus)) return invalidDecisionStatusResponse();
      const updated = updateSandboxTask(auth.context.demoAccessId, id, { decisionStatus: decisionStatus as string });
      if (!updated) return notFoundResponse();
      return jsonResponse({ ok: true, data: { id: updated.id, decisionStatus: updated.decisionStatus as DecisionStatus } });
    }
    return notFoundResponse();
  }

  // Official task: Owner only
  const auth = requireAuthenticated(request, bodyRecord);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const decisionStatus = bodyRecord.decisionStatus;

  if (!isDecisionStatus(decisionStatus)) return invalidDecisionStatusResponse();

  try {
    const record = await prisma.viralAnalysisRecord.update({
      where: { id },
      data: { decisionStatus },
      select: { id: true, decisionStatus: true },
    });

    return jsonResponse({
      ok: true,
      data: {
        id: record.id,
        decisionStatus: normalizeDecisionStatus(record.decisionStatus),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return notFoundResponse();
    }

    return isDatabaseError(error) ? databaseError() : serverError();
  }
}
