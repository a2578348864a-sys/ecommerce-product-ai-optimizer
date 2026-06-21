import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { ALL_KNOWN_PLATFORMS } from "@/lib/types";
import { normalizeTaskRecord } from "@/lib/tasks/normalizeTaskRecord";
import { checkAccessPassword } from "@/lib/server/accessPassword";
import { isDecisionStatus, normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";
import { SEARCHABLE_TASK_TYPES } from "@/lib/taskConcepts";

export const runtime = "nodejs";

const REQUEST_BODY_LIMIT_BYTES = 256 * 1024;
const allowedPlatforms = new Set<string>(ALL_KNOWN_PLATFORMS);
const allowedSources = new Set(["mock", "ai"]);
const allowedTypes = SEARCHABLE_TASK_TYPES;

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
  | { ok: true; data: { items: ViralTaskItem[] } }
  | {
    ok: true;
    records: ViralTaskItem[];
    data: { items: ViralTaskItem[] };
    page: {
      type: string;
      q: string;
      limit: number;
      offset: number;
      total: number;
      hasMore: boolean;
      nextOffset: number | null;
      decisionStatus: string;
    };
  }
  | { ok: false; error: ApiError };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown) {
  const text = asString(value);
  return text || null;
}

function asScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function parseLimit(value: string | null) {
  if (!value) return 10;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) return 10;
  return Math.min(Math.trunc(limit), 50);
}

function parseOffset(value: string | null) {
  if (!value) return 0;
  const offset = Number(value);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

function getSearchWhere(q: string): Prisma.ViralAnalysisRecordWhereInput[] {
  if (!q) return [];

  // SQLite stores resultJson as text here, so simple text contains search is stable enough.
  return [
    { title: { contains: q } },
    { productUrl: { contains: q } },
    { materialText: { contains: q } },
    { level: { contains: q } },
    { oneLineSummary: { contains: q } },
    { resultJson: { contains: q } },
  ];
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
  const normalized = normalizeTaskRecord({
    ...record,
    resultJson: record.resultJson,
  });

  return {
    id: normalized.id,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    type: normalized.type,
    decisionStatus: normalizeDecisionStatus(record.decisionStatus),
    title: normalized.title,
    platform: normalized.platform,
    productUrl: normalized.productUrl || null,
    materialText: normalized.materialText,
    source: normalized.source,
    score: normalized.score,
    level: normalized.level,
    oneLineSummary: normalized.oneLineSummary,
    result: normalized.result,
  };
}

function getResultSummary(result: Record<string, unknown>) {
  return {
    score: asScore(result.score),
    level: asString(result.level) || "未评级",
    oneLineSummary: asString(result.oneLineSummary) || "这条记录暂时没有一句话判断。",
  };
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

export async function GET(request: NextRequest) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  let typeParam = request.nextUrl.searchParams.get("type");
  const agentTypeParam = request.nextUrl.searchParams.get("agentType");
  const q = asString(request.nextUrl.searchParams.get("q"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const decisionStatusParam = asString(request.nextUrl.searchParams.get("decisionStatus"));

  // 兼容 agentType 参数：映射到 type（两者在本 schema 中等价）
  if (!typeParam && agentTypeParam && allowedTypes.has(agentTypeParam)) {
    typeParam = agentTypeParam;
  }

  const searchWhere = getSearchWhere(q);

  const where: Prisma.ViralAnalysisRecordWhereInput = {
    ...(typeParam && allowedTypes.has(typeParam) ? { type: typeParam } : {}),
    ...(isDecisionStatus(decisionStatusParam) ? { decisionStatus: decisionStatusParam } : {}),
    ...(searchWhere.length ? { OR: searchWhere } : {}),
  };

  const effectiveType = typeParam && allowedTypes.has(typeParam) ? typeParam : "";
  const effectiveDecisionStatus = isDecisionStatus(decisionStatusParam) ? decisionStatusParam : "";

  try {
    const [records, total] = await Promise.all([
      prisma.viralAnalysisRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.viralAnalysisRecord.count({ where }),
    ]);

    const items = records.map(toTaskItem);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < total;

    return jsonResponse({
      ok: true,
      records: items,
      data: { items },
      page: {
        type: effectiveType,
        q,
        limit,
        offset,
        total,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        decisionStatus: effectiveDecisionStatus,
      },
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: "body_too_large", message: "保存内容过大，请减少素材或结果内容后重试。" },
    }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_json", message: "请求体不是合法 JSON。" },
    }, 400);
  }

  if (!isRecord(body)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_body", message: "请求体必须是 JSON object。" },
    }, 400);
  }

  const authError = checkAccessPassword(request, body);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const taskType = asString(body.type) || "viral";
  if (!allowedTypes.has(taskType)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_type", message: "不支持该任务类型。" },
    }, 400);
  }

  const materialText = asString(body.materialText);
  const platform = asString(body.platform);
  const source = asString(body.source);

  if (!source || !allowedSources.has(source)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_source", message: "记录来源只能是 mock 或 ai。" },
    }, 400);
  }

  if (platform && !allowedPlatforms.has(platform)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_platform", message: "平台选择不正确，请重新选择。" },
    }, 400);
  }

  if (!isRecord(body.result)) {
    return jsonResponse({
      ok: false,
      error: { code: "missing_result", message: "请先生成分析结果再保存。" },
    }, 400);
  }

  const resultSummary = getResultSummary(body.result);

  try {
    const record = await prisma.viralAnalysisRecord.create({
      data: {
        type: taskType,
        title: asOptionalString(body.title) || asOptionalString(body.productName),
        platform: platform || "manual",
        productUrl: asOptionalString(body.productUrl),
        materialText: materialText || asString(body.title) || asString(body.productName) || "手动记录",
        source,
        score: resultSummary.score,
        level: resultSummary.level,
        oneLineSummary: resultSummary.oneLineSummary,
        resultJson: JSON.stringify(body.result),
      },
    });

    return jsonResponse({
      ok: true,
      data: toTaskItem(record),
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}
