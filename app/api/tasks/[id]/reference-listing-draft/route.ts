import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import type { AccessContext } from "@/lib/server/accessPassword";
import { filterReferenceMaterials } from "@/lib/referenceListingDraft/referenceMaterialFilter";
import { generateReferenceListingDraft } from "@/lib/referenceListingDraft/referenceDraftGenerator";

export const runtime = "nodejs";

function safeParseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function resolveContext(
  request: NextRequest,
  taskId: string,
): Promise<{ ok: true; context: AccessContext } | { ok: false; response: NextResponse }> {
  if (isSandboxTaskId(taskId)) {
    const auth = requireAuthenticated(request);
    if (!auth.ok) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: { code: auth.code, message: auth.message } },
          { status: auth.status },
        ),
      };
    }
    if (auth.context.mode !== "demo") {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: { code: "not_found", message: "未找到该任务记录。" } },
          { status: 404 },
        ),
      };
    }
    return { ok: true, context: auth.context };
  }

  const auth = requireOwnerOnly(request);
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        { status: auth.status },
      ),
    };
  }
  return { ok: true, context: auth.context };
}

async function getTaskId(context: { params: Promise<{ id?: string }> }): Promise<string> {
  try {
    const { id } = await context.params;
    return typeof id === "string" ? id.trim() : "";
  } catch {
    return "";
  }
}

interface TaskRecordData {
  id: string;
  title: string | null;
  productUrl: string | null;
  resultJson: Record<string, unknown>;
}

async function loadTask(
  taskId: string,
  context: AccessContext,
): Promise<TaskRecordData | null> {
  if (isSandboxTaskId(taskId)) {
    if (context.mode !== "demo") return null;
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) return null;
    return {
      id: task.id,
      title: task.title,
      productUrl: task.productUrl,
      resultJson: safeParseJson(task.resultJson),
    };
  }

  const record = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      productUrl: true,
      resultJson: true,
    },
  });

  if (!record) return null;
  return {
    id: record.id,
    title: record.title,
    productUrl: record.productUrl,
    resultJson: safeParseJson(record.resultJson),
  };
}

/**
 * GET /api/tasks/[id]/reference-listing-draft
 * 读取任务的参考初稿准备度与资料清单（不触发生成）
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> },
) {
  const taskId = await getTaskId(context);
  if (!taskId) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_id", message: "缺少任务 ID。" } },
      { status: 400 },
    );
  }

  const ctxRes = await resolveContext(request, taskId);
  if (!ctxRes.ok) return ctxRes.response;

  try {
    const task = await loadTask(taskId, ctxRes.context);
    if (!task) {
      return NextResponse.json(
        { ok: false, error: { code: "not_found", message: "任务记录不存在或已删除。" } },
        { status: 404 },
      );
    }

    const accessSubject = ctxRes.context.mode === "demo"
      ? `demo:${ctxRes.context.demoAccessId}`
      : "owner";

    const readiness = filterReferenceMaterials({
      resultJson: task.resultJson,
      taskContext: {
        title: task.title,
        productUrl: task.productUrl,
      },
    });
    readiness.accessSubject = accessSubject;

    return NextResponse.json({ ok: true, data: readiness });
  } catch (error) {
    console.error("[reference-listing-draft] GET failed", error);
    return NextResponse.json(
      { ok: false, error: { code: "server_error", message: "读取参考资料失败，请稍后再试。" } },
      { status: 500 },
    );
  }
}

/**
 * POST /api/tasks/[id]/reference-listing-draft
 * 实时筛选最新资料并生成英文参考初稿（零费用本地规则，绝不修改 confirmedFacts，绝不写入数据库）
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> },
) {
  const taskId = await getTaskId(context);
  if (!taskId) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_id", message: "缺少任务 ID。" } },
      { status: 400 },
    );
  }

  const ctxRes = await resolveContext(request, taskId);
  if (!ctxRes.ok) return ctxRes.response;

  try {
    const task = await loadTask(taskId, ctxRes.context);
    if (!task) {
      return NextResponse.json(
        { ok: false, error: { code: "not_found", message: "任务记录不存在或已删除。" } },
        { status: 404 },
      );
    }

    const accessSubject = ctxRes.context.mode === "demo"
      ? `demo:${ctxRes.context.demoAccessId}`
      : "owner";

    // 重新在服务端读取筛选资料（不信任客户端）
    const readiness = filterReferenceMaterials({
      resultJson: task.resultJson,
      taskContext: {
        title: task.title,
        productUrl: task.productUrl,
      },
    });
    readiness.accessSubject = accessSubject;

    if (readiness.status === "blocked") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "blocked_material",
            message: readiness.reason || "缺少明确商品身份，无法生成参考初稿。",
          },
        },
        { status: 400 },
      );
    }

    const draft = generateReferenceListingDraft(readiness, taskId);
    draft.accessSubject = accessSubject;

    return NextResponse.json({ ok: true, data: draft });
  } catch (error) {
    console.error("[reference-listing-draft] POST failed", error);
    const msg = error instanceof Error ? error.message : "生成参考初稿失败。";
    return NextResponse.json(
      { ok: false, error: { code: "generation_failed", message: msg } },
      { status: 500 },
    );
  }
}
