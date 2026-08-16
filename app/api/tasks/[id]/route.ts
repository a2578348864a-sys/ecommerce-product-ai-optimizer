import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isDecisionStatus, normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";
import {
  getSandboxTask,
  getSandboxCandidate,
  deleteSandboxTask,
  sandboxTaskToDetail,
  isSandboxTaskId,
} from "@/lib/server/demoSandbox";
import { cleanupAiImageTask } from "@/lib/server/aiImageDraftStorage";
import {
  getResearchTaskCandidateId,
  resolveResearchTaskProductImage,
  type ResearchProductImageDisplay,
} from "@/lib/productResearchImage";
import { hasProductResearchRecordNamespace } from "@/lib/productResearchRecord";
import { projectTaskResultForBrowser } from "@/lib/productResearchPublicDto";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
  updateLegacySandboxTaskDecisionStatusAtomic,
} from "@/lib/server/taskResultJsonMutation";

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
  productImage: ResearchProductImageDisplay | null;
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
    result: projectTaskResultForBrowser(safeParseJson(record.resultJson), "detail"),
    productImage: null,
  };
}

async function addOwnerProductImage(item: ViralTaskItem, rawResult: unknown): Promise<ViralTaskItem> {
  const fixedImage = resolveResearchTaskProductImage({
    taskResult: rawResult,
    candidates: [],
  });
  if (fixedImage) return { ...item, productImage: fixedImage };

  const candidateId = getResearchTaskCandidateId(rawResult);
  if (!candidateId) return item;
  const candidate = await prisma.opportunityCandidate.findFirst({
    where: { id: candidateId },
    select: { id: true, name: true, sourceMetaJson: true },
  });
  return {
    ...item,
    productImage: resolveResearchTaskProductImage({
      taskResult: rawResult,
      candidates: candidate ? [candidate] : [],
    }),
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

function versionedDecisionRouteRequiredResponse() {
  return jsonResponse({
    ok: false,
    error: {
      code: "versioned_decision_route_required",
      message: "该研究记录使用版本化人工决定，请通过研究决定接口更新。",
    },
  }, 409);
}

function invalidStoredResultResponse() {
  return jsonResponse({
    ok: false,
    error: { code: "invalid_result_json", message: "任务结果结构异常，已阻止兼容状态写入。" },
  }, 409);
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

async function cleanupTaskImages(input: {
  accessMode: "owner" | "visitor";
  visitorAccessId?: string;
  taskId: string;
}) {
  try {
    await cleanupAiImageTask(input);
  } catch {
    console.error("[ai-image-draft] task cleanup failed", {
      accessMode: input.accessMode,
      taskId: input.taskId,
    });
  }
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
    const result = safeParseJson(task.resultJson);
    const publicResult = projectTaskResultForBrowser(result, "detail");
    const candidateId = getResearchTaskCandidateId(result);
    const candidate = candidateId
      ? getSandboxCandidate(ctx.demoAccessId, candidateId)
      : null;
    const data = {
        ...sandboxTaskToDetail(task),
      resultJson: publicResult,
      result: publicResult,
      productImage: resolveResearchTaskProductImage({
        taskResult: result,
        candidates: candidate ? [candidate] : [],
      }),
    } as unknown as ViralTaskItem;
    return jsonResponse({ ok: true, data });
  }

  // Access-Control-Fix.1: Demo users cannot read official (Owner) task details.
  // Check after sandbox ID path so sandbox tasks still work for Demo users.
  const accessCtx = getAccessContext(request);
  if (accessCtx?.mode === "demo") return notFoundResponse();

  try {
    const record = await prisma.viralAnalysisRecord.findFirst({
      where: { id },
    });

    if (!record) return notFoundResponse();

    return jsonResponse({
      ok: true,
      data: await addOwnerProductImage(toTaskItem(record), safeParseJson(record.resultJson)),
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
      const deleted = await deleteSandboxTask(auth.context.demoAccessId, id);
      if (!deleted) return notFoundResponse();
      await cleanupTaskImages({
        accessMode: "visitor",
        visitorAccessId: auth.context.demoAccessId,
        taskId: id,
      });
      return jsonResponse({ ok: true, data: { id } });
    }
    // Non-demo user with sandbox ID — not found
    return notFoundResponse();
  }

  // Official task: Owner only
  const auth = requireOwnerOnly(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.viralAnalysisRecord.delete({
        where: { id },
      });
      await tx.opportunityCandidate.updateMany({
        where: { convertedTaskId: id },
        data: { convertedTaskId: null, lastActionAt: new Date() },
      });
    });
    await cleanupTaskImages({ accessMode: "owner", taskId: id });

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
      const current = getSandboxTask(auth.context.demoAccessId, id);
      if (!current) return notFoundResponse();
      const currentResult = safeParseJson(current.resultJson);
      if (!isRecord(currentResult)) return invalidStoredResultResponse();
      if (Object.prototype.hasOwnProperty.call(currentResult, "researchRecord")
        || hasProductResearchRecordNamespace(currentResult)) {
        return versionedDecisionRouteRequiredResponse();
      }
      try {
        await updateLegacySandboxTaskDecisionStatusAtomic({
          context: auth.context,
          taskId: id,
          decisionStatus: decisionStatus as string,
        });
      } catch (error) {
        if (error instanceof TaskResultJsonMutationError) {
          if (error.code === "not_found") return notFoundResponse();
          if (error.code === "versioned_research_decision_route_required") {
            return versionedDecisionRouteRequiredResponse();
          }
        }
        throw error;
      }
      return jsonResponse({ ok: true, data: { id, decisionStatus: decisionStatus as DecisionStatus } });
    }
    return notFoundResponse();
  }

  // Official task: Owner only
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const decisionStatus = bodyRecord.decisionStatus;

  if (!isDecisionStatus(decisionStatus)) return invalidDecisionStatusResponse();

  try {
    const current = await prisma.viralAnalysisRecord.findFirst({
      where: { id },
      select: { id: true, resultJson: true },
    });
    if (!current) return notFoundResponse();
    const currentResult = safeParseJson(current.resultJson);
    if (!isRecord(currentResult)) return invalidStoredResultResponse();
    if (Object.prototype.hasOwnProperty.call(currentResult, "researchRecord")
      || hasProductResearchRecordNamespace(currentResult)) {
      return versionedDecisionRouteRequiredResponse();
    }
    // F5：legacy 决定写入收敛到正式 mutation layer（writer legacy-decision）——
    // 不再直接 Prisma update（否则 @updatedAt 脱离 resultJson 语义产生假冲突）；
    // 同时保留 CAS 并发保护（真冲突才失败）。
    const mutation = await mutateTaskResultJson({
      context: auth.context,
      taskId: id,
      writer: "legacy-decision",
      mutate: (currentMutation) => {
        if (["researchRecord", "researchVerification", "researchHash", "decisionEvents"]
          .some((key) => Object.prototype.hasOwnProperty.call(currentMutation, key))) {
          throw new TaskResultJsonMutationError(
            "versioned_research_decision_route_required",
            409,
            "新版研究记录必须使用正式研究决定接口更新。",
          );
        }
        return {
          result: currentMutation,
          decisionStatus,
          value: { decisionStatus: normalizeDecisionStatus(decisionStatus) },
        };
      },
    });

    return jsonResponse({
      ok: true,
      data: {
        id,
        decisionStatus: normalizeDecisionStatus(mutation.decisionStatus ?? decisionStatus),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return notFoundResponse();
    }
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") return notFoundResponse();
      if (error.code === "versioned_research_decision_route_required") {
        return versionedDecisionRouteRequiredResponse();
      }
      return jsonResponse(
        { ok: false, error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}
