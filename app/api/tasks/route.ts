import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
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
  readCandidateProductImageSnapshot,
  resolveResearchTaskProductImage,
  type ResearchProductImageDisplay,
} from "@/lib/productResearchImage";
import { projectTaskResultForBrowser } from "@/lib/productResearchPublicDto";
import { getResearchStaleState } from "@/lib/productResearchRecord";
import { classifyResearchLifecycle } from "@/lib/researchLifecycle";
import { parseMarketScreeningCandidateIdentity } from "@/lib/server/opportunityCandidateService";
import { parseProductBatchCandidateSource } from "@/lib/server/productBatchCandidateSource";
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
  productProjectKey: string;
  /** §2.3 服务端正式安全投影的 AI 运行状态（仅 product-research scope 下发）。 */
  aiRunStatus?: AiRunStatusSafe;
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

/** §2.3 服务端正式 AI 运行状态（安全枚举，浏览器不接触内部状态码）。 */
export type AiRunStatusSafe =
  | "research_stale"
  | "running"
  | "waiting"
  | "failed_recoverable"
  | "failed_terminal"
  | "cancelled"
  | "completed"
  | "not_started";

const RUN_IN_FLIGHT = new Set(["planning", "running", "revising"]);
const RUN_WAITING = new Set(["waiting_human", "waiting_auth", "waiting_input", "paused_budget", "draft"]);
const RUN_TERMINAL = new Set(["failed_recoverable", "failed_terminal", "cancelled", "completed"]);

function deriveSafeAiRunStatus(runStatus: string | null): AiRunStatusSafe {
  if (!runStatus) return "not_started";
  if (RUN_IN_FLIGHT.has(runStatus)) return "running";
  if (RUN_WAITING.has(runStatus)) return "waiting";
  if (RUN_TERMINAL.has(runStatus)) return runStatus as AiRunStatusSafe;
  return "not_started";
}

type ProductProjectCandidate = { id: string; name?: string; sourceMetaJson: string };

/**
 * §1 商品项目身份（fail-closed）：
 * 只信任经过既有正式解析器验证的商品身份，绝不直接读取原始 productKey 字段。
 * - marketScreeningIdentity：parseMarketScreeningCandidateIdentity（校验 schema/identityHash/
 *   marketplace/ASIN/manifest 与 productKey，identityHash 必须与重算一致）。
 * - productImageSnapshot：readCandidateProductImageSnapshot（正式图片快照解析器，含内容哈希）。
 * - ProductBatch 来源：parseProductBatchCandidateSource（正式批次来源解析器）。
 * 任一来源缺失/残缺/相互冲突 → 返回 null（不合并）。
 */
function verifiedProductKeyForCandidate(candidate: ProductProjectCandidate | undefined): string | null {
  if (!candidate) return null;
  const sourceMeta = safeParseJson(candidate.sourceMetaJson);
  if (!isRecord(sourceMeta)) return null;
  const hasMarketIdentity = Object.prototype.hasOwnProperty.call(sourceMeta, "marketScreeningIdentity");
  const identity = hasMarketIdentity
    ? parseMarketScreeningCandidateIdentity(candidate.sourceMetaJson)
    : null;
  // 身份字段存在但解析失败（残缺/hash 不匹配）→ fail-closed，不信任图片或批次中的 productKey。
  if (hasMarketIdentity && !identity) return null;
  // 图片快照/批次来源：字段存在但解析失败 → 冲突或残缺，fail-closed（不信任其中任一来源的 productKey）。
  const hasImage = Object.prototype.hasOwnProperty.call(sourceMeta, "productImageSnapshot");
  const image = hasImage ? readCandidateProductImageSnapshot(candidate.sourceMetaJson) : null;
  if (hasImage && !image) return null;
  const isBatchOrigin = sourceMeta.originKind === "seller_sprite_product_batch";
  const batch = isBatchOrigin ? parseProductBatchCandidateSource(sourceMeta) : null;
  if (isBatchOrigin && !batch) return null;
  const keys = new Set<string>();
  if (identity) keys.add(identity.productKey);
  if (image) keys.add(image.productKey);
  if (batch) keys.add(batch.productKey);
  if (keys.size !== 1) return null;
  const productKey = Array.from(keys)[0];
  if (identity && image && image.candidateIdentityHash !== identity.identityHash) return null;
  if (batch && image && batch.itemIdentityHash !== image.candidateIdentityHash) return null;
  return productKey;
}

/** 访问主体：沙箱任务按 sandbox 区分，Owner 统一 owner —— 回退键必须含主体避免跨主体关联。 */
function accessSubject(ctx: { mode: string; demoAccessId?: string } | null): string {
  return ctx && ctx.mode === "demo" ? `sandbox:${ctx.demoAccessId}` : "owner";
}

/** §1/§2.2 Candidate 必须恰好命中一条：0 条或 >1 条都回退（绝不取第一条）。 */
function exactCandidateById(
  candidates: readonly ProductProjectCandidate[],
  candidateId: string | null,
): ProductProjectCandidate | null {
  if (!candidateId) return null;
  const matches = candidates.filter((item) => item.id === candidateId);
  return matches.length === 1 ? matches[0] : null;
}

function productProjectKey(
  taskId: string,
  rawResult: unknown,
  subject: string,
  candidates: readonly ProductProjectCandidate[] = [],
) {
  const candidateId = getResearchTaskCandidateId(rawResult);
  const candidate = exactCandidateById(candidates, candidateId);
  const productKey = verifiedProductKeyForCandidate(candidate ?? undefined);
  // fail-closed：只有身份完全验证通过才按商品键合并；否则回退到当前任务自身（含主体，跨沙箱不可关联）。
  const stableBinding = productKey
    ? `formal-v2-product-project:v1:${subject}:product:${productKey}`
    : `formal-v2-product-project:v1:${subject}:task:${taskId}`;
  return `ppk_${createHash("sha256").update(stableBinding, "utf8").digest("base64url")}`;
}

/** §2.3 product-research scope：移除通用 result.status（客户端不得信任），只保留服务端 stale 信号。 */
function stripRawProjectedStatus(formalScope: boolean, projected: Record<string, unknown>, rawResult: unknown): Record<string, unknown> {
  if (!formalScope) return projected;
  const { status: rawStatus, ...rest } = projected;
  return rest;
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
}, subject: string, formalScope = false): ViralTaskItem {
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
    result: stripRawProjectedStatus(
      formalScope,
      projectTaskResultForBrowser(normalized.result, "list", {
        id: normalized.id,
        type: normalized.type,
        title: normalized.title,
        materialText: normalized.materialText,
        oneLineSummary: normalized.oneLineSummary,
        level: normalized.level,
        decisionStatus: normalizeDecisionStatus(record.decisionStatus),
      }) as Record<string, unknown>,
      normalized.result,
    ),
    productImage: null,
    productProjectKey: productProjectKey(normalized.id, normalized.result, subject),
  };
}

function addProductImage(
  item: ViralTaskItem,
  rawResult: unknown,
  subject: string,
  candidates: readonly ProductProjectCandidate[],
): ViralTaskItem {
  return {
    ...item,
    productProjectKey: productProjectKey(item.id, rawResult, subject, candidates),
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
  // §2.1/§2.2 正式工作台数据域：只返回正式商品研究任务（type=workflow），排除 source=mock 等通用任务。
  if (scope === "product-research") {
    return { type: "workflow", source: { not: "mock" } };
  }
  if (scope === "active" || scope === "research") {
    return {
      OR: [
        { resultJson: { not: { contains: '"researchRecord"' } }, decisionStatus: { in: ["pending", "continue", "need_info"] } },
        { resultJson: { contains: '"researchRecord"' }, decisionStatus: { notIn: ["rejected"] } },
      ],
    };
  }
  if (scope === "historical") {
    // V3 Current Research Normalization：完成标记（researchCompletion）与放弃（rejected）均属研究记录；
    // 已完成任务 decisionStatus 仍为 continue（兼容列），必须显式纳入。
    return {
      OR: [
        { decisionStatus: "rejected" },
        { resultJson: { contains: '"researchCompletion"' } },
      ],
    };
  }
  if (scope === "need_info") return { decisionStatus: "need_info" };
  if (scope === "completed") {
    // V3 Current Research Normalization：已完成 = researchCompletion 完成标记（creative_ready → continue）
    return { decisionStatus: "continue", resultJson: { contains: '"researchCompletion"' } };
  }
  if (scope === "abandoned") return { decisionStatus: "rejected" };
  return null;
}

/** §2.3 cand 维度最新 AI 运行状态（按 updatedAt 取最新；仅 product-research scope）。 */
async function loadLatestRunStatusByCandidate(
  ctx: { mode: string; demoAccessId?: string } | null,
  candidateIds: string[],
  formalScope: boolean,
): Promise<Map<string, { status: string; updatedAt: string }>> {
  const result = new Map<string, { status: string; updatedAt: string }>();
  if (!formalScope || candidateIds.length === 0) return result;
  const rows = await prisma.v4ResearchRun.findMany({
    where: {
      candidateId: { in: candidateIds },
      ...(ctx && ctx.mode === "demo"
        ? { ownerScope: ctx.demoAccessId, sandboxId: ctx.demoAccessId }
        : { ownerScope: "owner", sandboxId: null }),
    },
    select: { candidateId: true, status: true, updatedAt: true },
  });
  const latest = new Map<string, number>();
  for (const row of rows) {
    const time = row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.parse(String(row.updatedAt));
    if (!Number.isFinite(time)) continue;
    if (time >= (latest.get(row.candidateId) ?? Number.MIN_SAFE_INTEGER)) {
      latest.set(row.candidateId, time);
      result.set(row.candidateId, {
        status: row.status,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      });
    }
  }
  return result;
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
  const effectiveScope = ["active", "research", "historical", "need_info", "completed", "abandoned", "product-research"].includes(scopeParam) ? scopeParam : "";

  // Access-Control-Fix.1: Resolve access context before any Prisma query.
  // Demo users only see their own sandbox tasks — never Owner tasks.
  const ctx = getAccessContext(request);

  if (ctx && ctx.mode === "demo") {
    try {
      const subject = accessSubject(ctx);
      const formalScope = effectiveScope === "product-research";
      let sandboxTasks = listSandboxTasks(ctx.demoAccessId);
      // §2.2：正式工作台数据域（沙箱侧同样只放行正式商品研究任务）
      if (formalScope) {
        sandboxTasks = sandboxTasks.filter((task) => task.type === "workflow" && task.source !== "mock");
      }
      // scope（R5：research=active 全集 / historical=rejected+legacy；旧 Tab 语义保留）——sandbox 用 JS 侧同语义过滤
      if (effectiveScope) {
        sandboxTasks = sandboxTasks.filter((task) => {
          const parsed = safeParseJson(task.resultJson);
          const hasResearchRecord = parsed !== null && (
            Object.prototype.hasOwnProperty.call(parsed, "researchRecord")
            || Object.prototype.hasOwnProperty.call(parsed, "researchVerification")
          );
          // V3 Current Research Normalization：完成标记（researchCompletion）与放弃（rejected）均属研究记录
          const hasResearchCompletion = parsed !== null
            && isRecord(parsed.researchCompletion)
            && parsed.researchCompletion.schema === "research-completion.v1";
          const status = normalizeDecisionStatus(task.decisionStatus);
          if (effectiveScope === "active" || effectiveScope === "research") {
            return !hasResearchRecord ? (status === "pending" || status === "continue" || status === "need_info") : status !== "rejected" && !hasResearchCompletion;
          }
          if (effectiveScope === "historical") return status === "rejected" || hasResearchCompletion;
          if (effectiveScope === "need_info") return status === "need_info";
          if (effectiveScope === "completed") return hasResearchCompletion && status === "continue";
          if (effectiveScope === "abandoned") return status === "rejected";
          return true;
        });
      }
      const sandboxCandidates = listSandboxCandidates(ctx.demoAccessId);
      const sandboxCandidateIds = Array.from(new Set(
        sandboxTasks
          .map((task) => getResearchTaskCandidateId(safeParseJson(task.resultJson)))
          .filter((id): id is string => Boolean(id)),
      ));
      // §2.3 Sandbox 真实最新 run 投影（ownerScope+sandboxId = demoAccessId；Visitor 隔离）
      const sandboxStatusByCandidate = await loadLatestRunStatusByCandidate(ctx, sandboxCandidateIds, formalScope);
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
        const stale = getResearchStaleState(isRecord(rawResult) ? rawResult : null).stale;
        const candidateId = getResearchTaskCandidateId(rawResult);
        const runRow = candidateId ? sandboxStatusByCandidate.get(candidateId) ?? null : null;
        const item = {
          ...listedTask,
          result: stripRawProjectedStatus(formalScope, result as Record<string, unknown>, rawResult),
          productImage: null,
          productProjectKey: productProjectKey(listedTask.id, rawResult, subject, sandboxCandidates),
          aiRunStatus: formalScope ? (stale ? "research_stale" as const : deriveSafeAiRunStatus(runRow?.status ?? null)) : undefined,
          runUpdatedAt: formalScope && runRow ? runRow.updatedAt : undefined,
        } as unknown as ViralTaskItem;
        return addProductImage(item, rawResult, subject, sandboxCandidates);
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
    const subject = accessSubject(ctx);
    const formalScope = effectiveScope === "product-research";
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
    let baseItems = records.map((record) => toTaskItem(record, subject, formalScope));
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
    // §2.3：正式工作台 scope 才查询最新 AI 运行状态（candidate 维度，服务端正式投影）
    const statusByCandidate = await loadLatestRunStatusByCandidate(ctx, candidateIds, formalScope);
    const items = baseItems.map((item, index) => {
      const withImage = addProductImage(item, filteredRawResults[index], subject, candidates);
      if (!formalScope) return withImage;
      const candidateId = getResearchTaskCandidateId(filteredRawResults[index]);
      const runRow = candidateId ? statusByCandidate.get(candidateId) ?? null : null;
      const stale = getResearchStaleState(isRecord(filteredRawResults[index]) ? filteredRawResults[index] : null).stale;
      return {
        ...withImage,
        aiRunStatus: stale ? "research_stale" as const : deriveSafeAiRunStatus(runRow?.status ?? null),
        runUpdatedAt: runRow ? runRow.updatedAt : undefined,
      };
    });

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
        productProjectKey: productProjectKey(sandboxTask.id, body.result, accessSubject(auth.context)),
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
      data: toTaskItem(record, accessSubject(auth.context)),
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}
