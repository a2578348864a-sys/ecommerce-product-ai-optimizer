import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireOwnerOnly } from "@/lib/server/demoGuard";
import {
  getSandboxTask,
  isSandboxTaskId,
  updateSandboxTask,
} from "@/lib/server/demoSandbox";
import {
  buildAiListingPackSaveResult,
  type AiListingPackSnapshot,
  type AiListingSaveErrorCode,
} from "@/lib/aiListingSnapshot";

export const runtime = "nodejs";

type ApiErrorCode =
  | "unauthorized"
  | "invalid_json"
  | "missing_task_context"
  | "task_not_found"
  | "invalid_ai_listing_pack"
  | "ai_listing_pack_already_exists"
  | "ai_listing_save_failed"
  | "invalid_result_json";

type ApiResponse =
  | {
      ok: true;
      data: {
        saved: true;
        savedAt: string;
        version: number;
        aiListingPackSnapshot: AiListingPackSnapshot;
      };
    }
  | { ok: false; error: { code: ApiErrorCode | string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function parseOptionalBody(request: NextRequest) {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  return isRecord(parsed) ? parsed : {};
}

function saveErrorStatus(code: AiListingSaveErrorCode) {
  if (code === "ai_listing_pack_already_exists") return 409;
  return 400;
}

function saveErrorCode(code: AiListingSaveErrorCode): ApiErrorCode {
  if (code === "invalid_result_json") return "ai_listing_save_failed";
  return code;
}

function saveErrorMessage(code: AiListingSaveErrorCode, message: string) {
  if (code === "invalid_result_json") return "保存失败，当前任务结果结构异常。";
  return message;
}

function success(snapshot: AiListingPackSnapshot): ApiResponse {
  return {
    ok: true,
    data: {
      saved: true,
      savedAt: snapshot.savedAt,
      version: snapshot.version,
      aiListingPackSnapshot: snapshot,
    },
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> },
) {
  const id = text((await params).id);
  if (!id) {
    return json({
      ok: false,
      error: { code: "missing_task_context", message: "缺少任务 ID，无法保存 AI Listing 草稿。" },
    }, 400);
  }

  let bodyRecord: Record<string, unknown>;
  try {
    bodyRecord = await parseOptionalBody(request);
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }

  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    const code = auth.status === 401 ? "unauthorized" : auth.code;
    const message = auth.status === 401 ? "请先回首页解锁工作台。" : auth.message;
    return json({ ok: false, error: { code, message } }, auth.status);
  }

  const listingPack = bodyRecord.listingPack;
  const overwrite = bodyRecord.overwrite === true;
  const savedAt = new Date().toISOString();

  try {
    if (isSandboxTaskId(id)) {
      const existing = getSandboxTask(auth.context.mode === "demo" ? auth.context.demoAccessId : "", id);
      if (!existing) {
        return json({ ok: false, error: { code: "task_not_found", message: "当前任务不存在或已被删除。" } }, 404);
      }

      const built = buildAiListingPackSaveResult({
        resultJson: existing.resultJson,
        listingPack,
        overwrite,
        savedAt,
      });

      if (!built.ok) {
        return json({
          ok: false,
          error: {
            code: saveErrorCode(built.error.code),
            message: saveErrorMessage(built.error.code, built.error.message),
          },
        }, saveErrorStatus(built.error.code));
      }

      const updated = updateSandboxTask(auth.context.mode === "demo" ? auth.context.demoAccessId : "", id, {
        resultJson: JSON.stringify(built.resultJson),
      });
      if (!updated) {
        return json({ ok: false, error: { code: "ai_listing_save_failed", message: "保存失败，当前草稿仍保留在页面中，可稍后重试。" } }, 500);
      }

      return json(success(built.snapshot));
    }

    const existing = await prisma.viralAnalysisRecord.findUnique({
      where: { id },
      select: { resultJson: true },
    });

    if (!existing) {
      return json({ ok: false, error: { code: "task_not_found", message: "当前任务不存在或已被删除。" } }, 404);
    }

    const built = buildAiListingPackSaveResult({
      resultJson: existing.resultJson,
      listingPack,
      overwrite,
      savedAt,
    });

    if (!built.ok) {
      return json({
        ok: false,
        error: {
          code: saveErrorCode(built.error.code),
          message: saveErrorMessage(built.error.code, built.error.message),
        },
      }, saveErrorStatus(built.error.code));
    }

    await prisma.viralAnalysisRecord.update({
      where: { id },
      data: { resultJson: JSON.stringify(built.resultJson) },
    });

    return json(success(built.snapshot));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return json({ ok: false, error: { code: "task_not_found", message: "当前任务不存在或已被删除。" } }, 404);
    }
    return json({ ok: false, error: { code: "ai_listing_save_failed", message: "保存失败，当前草稿仍保留在页面中，可稍后重试。" } }, 500);
  }
}
