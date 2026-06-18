import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { checkAccessPassword } from "@/lib/server/accessPassword";

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

async function getId(context: RouteContext) {
  const { id: rawId } = await context.params;
  return typeof rawId === "string" ? rawId.trim() : "";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const id = await getId(context);
  if (!id) return invalidIdResponse();

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
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const id = await getId(context);
  if (!id) return invalidIdResponse();

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
