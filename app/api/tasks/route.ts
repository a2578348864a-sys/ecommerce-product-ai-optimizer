import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { ALL_KNOWN_PLATFORMS } from "@/lib/types";
import { normalizeTaskRecord } from "@/lib/tasks/normalizeTaskRecord";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  listSandboxCandidates,
  listSandboxTasks,
  createGenericSandboxTask,
  sandboxTaskToListItem,
} from "@/lib/server/demoSandbox";
import { isDecisionStatus, normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";
import { SEARCHABLE_TASK_TYPES } from "@/lib/taskConcepts";
import {
  getResearchTaskCandidateId,
  resolveResearchTaskProductImage,
  type ResearchProductImageDisplay,
} from "@/lib/productResearchImage";
import { projectTaskResultForBrowser } from "@/lib/productResearchPublicDto";
import { classifyResearchLifecycle } from "@/lib/researchLifecycle";
import {
  assertGenericTaskResultAllowed,
  TaskResultNamespacePolicyError,
} from "@/lib/server/taskResultNamespacePolicy";

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
  productImage: ResearchProductImageDisplay | null;
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
    result: projectTaskResultForBrowser(normalized.result, "list", {
      id: normalized.id,
      type: normalized.type,
      title: normalized.title,
      materialText: normalized.materialText,
      oneLineSummary: normalized.oneLineSummary,
      level: normalized.level,
      decisionStatus: normalizeDecisionStatus(record.decisionStatus),
    }),
    productImage: null,
  };
}

function addProductImage(
  item: ViralTaskItem,
  rawResult: unknown,
  candidates: readonly { id: string; name?: string; sourceMetaJson: string }[],
): ViralTaskItem {
  return {
    ...item,
    productImage: resolveResearchTaskProductImage({
      taskResult: rawResult,
      candidates,
    }),
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

/**
 * OA1（Option B）+ R5：研究进度分组 → Prisma where。
 * 旧语义保留（active/need_info/completed/abandoned）；R5 新增两个导航语义：
 * - research：active 全集（无 researchRecord 或 decisionStatus ∈ {pending,continue,need_info}）——/research 商品研究
 * - historical：rejected + 旧版无活跃语义批次——/tasks 研究记录默认
 * 新版 product-research-record.v1 的 decision 存储于 resultJson（无法用 SQL 过滤），
 * 由 GET 的 JS 侧过滤兜底（见 classifyResearchLifecycle 用法）。
 */
function buildResearchScopeWhere(scope: string): Prisma.ViralAnalysisRecordWhereInput | null {
  if (scope === "active" || scope === "research") {
    return {
      OR: [
        { resultJson: { not: { contains: '"researchRecord"' } }, decisionStatus: { in: ["pending", "continue", "need_info"] } },
        { resultJson: { contains: '"researchRecord"' }, decisionStatus: { notIn: ["rejected"] } },
      ],
    };
  }
  if (scope === "historical") {
    return { decisionStatus: "rejected" };
  }
  if (scope === "need_info") return { decisionStatus: "need_info" };
  if (scope === "completed") {
    return { decisionStatus: "continue", resultJson: { contains: '"researchRecord"' } };
  }
  if (scope === "abandoned") return { decisionStatus: "rejected" };
  return null;
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
  // OA1（Option B）：研究记录内部进度分组 scope=active|need_info|completed|abandoned
  const scopeParam = asString(request.nextUrl.searchParams.get("scope"));

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
  // scope 与 decisionStatus 二选一（scope 优先）；scope 不改变分页返回结构
  const scopeWhere = buildResearchScopeWhere(scopeParam);
  if (scopeWhere) Object.assign(where, scopeWhere);

  const effectiveType = typeParam && allowedTypes.has(typeParam) ? typeParam : "";
  const effectiveDecisionStatus = isDecisionStatus(decisionStatusParam) ? decisionStatusParam : "";
  const effectiveScope = ["active", "research", "historical", "need_info", "completed", "abandoned"].includes(scopeParam) ? scopeParam : "";

  // Access-Control-Fix.1: Resolve access context before any Prisma query.
  // Demo users only see their own sandbox tasks — never Owner tasks.
  const ctx = getAccessContext(request);

  if (ctx && ctx.mode === "demo") {
    try {
      let sandboxTasks = listSandboxTasks(ctx.demoAccessId);
      // scope（R5：research=active 全集 / historical=rejected+legacy；旧 Tab 语义保留）——sandbox 用 JS 侧同语义过滤
      if (effectiveScope) {
        sandboxTasks = sandboxTasks.filter((task) => {
          const parsed = safeParseJson(task.resultJson);
          const hasResearchRecord = parsed !== null && (
            Object.prototype.hasOwnProperty.call(parsed, "researchRecord")
            || Object.prototype.hasOwnProperty.call(parsed, "researchVerification")
          );
          const status = normalizeDecisionStatus(task.decisionStatus);
          if (effectiveScope === "active" || effectiveScope === "research") {
            return !hasResearchRecord ? (status === "pending" || status === "continue" || status === "need_info") : status !== "rejected";
          }
          if (effectiveScope === "historical") return status === "rejected";
          if (effectiveScope === "need_info") return status === "need_info";
          if (effectiveScope === "completed") return hasResearchRecord && status === "continue";
          if (effectiveScope === "abandoned") return status === "rejected";
          return true;
        });
      }
      const sandboxCandidates = listSandboxCandidates(ctx.demoAccessId);
      const sandboxItems = sandboxTasks.map((task) => {
        const rawResult = safeParseJson(task.resultJson);
        const listedTask = sandboxTaskToListItem(task);
        const result = projectTaskResultForBrowser(rawResult, "list", {
          id: listedTask.id,
          type: listedTask.type,
          title: listedTask.title,
          materialText: listedTask.materialText,
          oneLineSummary: listedTask.oneLineSummary,
          level: listedTask.level,
          decisionStatus: normalizeDecisionStatus(listedTask.decisionStatus),
        });
        const item = {
          ...listedTask,
          result,
          productImage: null,
        } as unknown as ViralTaskItem;
        return addProductImage(item, rawResult, sandboxCandidates);
      });
      const total = sandboxItems.length;
      const paged = sandboxItems.slice(offset, offset + limit);

      return jsonResponse({
        ok: true,
        records: paged as unknown as ViralTaskItem[],
        data: { items: paged as unknown as ViralTaskItem[] },
        page: {
          type: effectiveType,
          q,
          limit,
          offset,
          total,
          hasMore: offset + limit < total,
          nextOffset: offset + limit < total ? offset + paged.length : null,
          decisionStatus: effectiveDecisionStatus,
        },
      });
    } catch (error) {
      return isDatabaseError(error) ? databaseError() : serverError();
    }
  }

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

    const rawResults = records.map((record) => safeParseJson(record.resultJson));
    // R5：research/historical 的 JS 侧精确过滤（新版 record 决策存于 resultJson，SQL 无法表达）
    let baseItems = records.map(toTaskItem);
    let filteredRawResults = rawResults;
    if (effectiveScope === "research" || effectiveScope === "historical") {
      const paired: Array<{ item: ReturnType<typeof toTaskItem>; raw: ReturnType<typeof safeParseJson> }> = [];
      baseItems.forEach((item, index) => {
        const lifecycle = classifyResearchLifecycle({
          decisionStatus: item.decisionStatus,
          result: rawResults[index],
          type: item.type,
        });
        const keep = effectiveScope === "research"
          ? lifecycle.lifecycle === "active"
          : lifecycle.lifecycle === "historical";
        if (keep) paired.push({ item, raw: rawResults[index] });
      });
      baseItems = paired.map((entry) => entry.item);
      filteredRawResults = paired.map((entry) => entry.raw);
    }
    const candidateIds = Array.from(new Set(
      rawResults
        .map((result) => getResearchTaskCandidateId(result))
        .filter((id): id is string => Boolean(id)),
    ));
    const candidates = candidateIds.length
      ? await prisma.opportunityCandidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, sourceMetaJson: true },
      })
      : [];
    const items = baseItems.map((item, index) => addProductImage(item, filteredRawResults[index], candidates));

    // R5：过滤后重新计算 total（分页语义以过滤结果为准）
    const effectiveTotal = effectiveScope === "research" || effectiveScope === "historical"
      ? baseItems.length
      : total;
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < effectiveTotal;

    return jsonResponse({
      ok: true,
      records: items as unknown as ViralTaskItem[],
      data: { items: items as unknown as ViralTaskItem[] },
      page: {
        type: effectiveType,
        q,
        limit,
        offset,
        total: effectiveTotal,
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

  // Demo-Sandbox.1-B: Allow both Owner and Demo
  const auth = requireAuthenticated(request, body);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

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

  try {
    assertGenericTaskResultAllowed(body.result);
  } catch (error) {
    if (!(error instanceof TaskResultNamespacePolicyError)) throw error;
    return jsonResponse({
      ok: false,
      error: {
        code: error.code,
        message: "正式商品研究记录只能由 Candidate 研究保存流程创建。",
      },
    }, 400);
  }

  const resultSummary = getResultSummary(body.result);

  // Demo-Sandbox.1-B: Demo writes to sandbox
  if (auth.context.mode === "demo") {
    const sandboxTask = await createGenericSandboxTask(auth.context.demoAccessId, {
      type: taskType,
      title: asOptionalString(body.title) || asOptionalString(body.productName),
      platform: platform || "manual",
      source,
      score: resultSummary.score,
      level: resultSummary.level,
      oneLineSummary: resultSummary.oneLineSummary,
      resultJson: JSON.stringify(body.result),
    });
    return jsonResponse({
      ok: true,
      data: {
        ...sandboxTaskToListItem(sandboxTask),
        result: projectTaskResultForBrowser(body.result, "list", {
          id: sandboxTask.id,
          type: sandboxTask.type,
          title: sandboxTask.title,
          materialText: sandboxTask.materialText,
          oneLineSummary: sandboxTask.oneLineSummary,
          level: sandboxTask.level,
          decisionStatus: normalizeDecisionStatus(sandboxTask.decisionStatus),
        }),
        productImage: null,
      } as unknown as ViralTaskItem,
    });
  }

  // Owner: write to Prisma DB
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
