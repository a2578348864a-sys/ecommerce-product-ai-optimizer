/**
 * 研究采集编排器（Research Collection Orchestrator）
 *
 * 核心职责：
 * 1. 统一管理 4 大研究数据来源的状态探测与采集触发：
 *    - amazon (Browser Evidence)
 *    - keywordCompetitor (Browser Use SellerSprite 关键词 + Amazon 竞品发现)
 *    - voc (Review Evidence)
 *    - sourcing1688 (1688 Sourcing Evidence)
 * 2. 状态合同：SourceStatus = "ready" | "running" | "awaiting_confirmation" | "needs_user" | "failed"
 * 3. 并发保护与幂等：
 *    - 同一个 taskId 正在执行采集时返回 "running"；
 *    - 已有正式 Evidence 则返回 "ready"（不重复调用采集）；
 *    - 已有待确认预览（Pending Preview）则返回 "awaiting_confirmation"（不重复调用采集）。
 * 4. 严格红线：
 *    - 严禁任何 autoConfirm / autoSaveEvidence / confirmed=true / humanConfirmed=true 行为；
 *    - 严禁调用任何 LLM Provider（Provider calls = 0）；
 *    - 错误信息严格脱敏，严禁泄漏 secret / token / cookie / raw exception stack；
 *    - Failure Isolation：Keyword+Competitor 等单源失败绝不导致整次请求异常，返回 sources.*.status = "failed"。
 */

import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";

// 来源 1：Amazon Browser Evidence
import {
  readBrowserEvidence,
  readBrowserEvidenceTaskAsin,
} from "@/lib/server/browserEvidence";
import {
  collectBrowserEvidencePreview,
  storeBrowserEvidencePreview,
  findPendingBrowserEvidencePreview,
  browserEvidenceSubjectKey,
  BrowserEvidenceCollectError,
} from "@/lib/server/browserEvidenceCollect";
import {
  resolveBrowserAcquisitionCapability,
  browserUnavailableMessage,
  REVIEW_LOCAL_ENV_REQUIRED_MESSAGE,
} from "@/lib/server/acquisitionCapability";
import {
  DEMO_ACQUISITION_EVIDENCE_ID,
  buildDemoBrowserCollectPreview,
  buildDemoReviewCollectPageResults,
  buildDemoReviewCollectPreviewItems,
} from "@/lib/server/demoAcquisitionSamples";

// 来源 2：Keyword + Competitor (Browser Use)
import {
  getKeywordEvidence,
} from "@/lib/server/keywordEvidence";
import {
  getCompetitorEvidence,
} from "@/lib/server/competitorEvidence";
import {
  findPendingBrowserUsePreview,
  resolveBrowserUseSeed,
  marketplaceToAmazonTld,
  selectReliableSearchKeyword,
  storeBrowserUsePreview,
  browserUseSubjectKey,
  type BrowserUseKeywordPreviewItem,
} from "@/lib/server/browserUseResearch";
import { runSellerSpriteCollection } from "@/tools/collectors/browser-use/sellerSpriteCollector";
import {
  runAmazonCompetitorCollection,
  amazonCompetitorObservationToPreview,
} from "@/tools/collectors/browser-use/amazonCompetitorCollector";
import { getRuntimeMode } from "@/lib/server/runtimeMode";
import { findAmazonPreviewResolution, hasLegacyAmazonFactClosure } from "@/lib/factCandidates";

// 来源 3：VOC Review Evidence
import {
  getReviewEvidence,
} from "@/lib/server/reviewEvidence";
import {
  createReviewCollectPreview,
  storeReviewCollectPreview,
  findPendingReviewCollectPreview,
  isReusableReviewCollectPreview,
  reviewCollectSubjectKey,
  ReviewCollectorError,
  type ReviewSnippetPreviewItem,
  type ReviewCollectPageResult,
} from "@/lib/server/reviewCollector";


// 来源 4：1688 Sourcing Evidence & Collector
import {
  getSourcingEvidence,
  findPendingSourcingPreview,
  createSourcingPreview,
  sourcingPreviewSubjectKey,
} from "@/lib/server/sourcingEvidence";
import {
  acquireByImage,
  normalizeImageAcquisitionError,
  IMAGE_ACQUISITION_DRIVER_VERSION,
} from "@/lib/server/sourcingImageAcquisition";
import { getTaskProductImageBuffer } from "@/lib/server/taskProductImage";
import { DEMO_SOURCING_EVIDENCE_SAMPLE } from "@/lib/server/demoAcquisitionSamples";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePublicSourceImageUrl } from "@/lib/client/sourceImageUrl";
import { logInfo, logError } from "@/lib/server/agentEventLogger";
import {
  deriveAllUnifiedStatuses,
  logUnifiedStatusEvents,
  type UnifiedStatusesMap,
} from "@/lib/server/unifiedCollectionStatus";

export type {
  UnifiedStatusesMap,
  UnifiedCollectionStatus,
} from "@/lib/server/unifiedCollectionStatus";

export type SourceStatus =
  | "ready"
  | "running"
  | "awaiting_confirmation"
  | "needs_user"
  | "ready_to_search"
  | "blocked"
  | "failed";

export type OrchestratorAction = "inspect" | "orchestrate";

/** 四个来源的稳定 key（API/前端共用；顺序即展示顺序） */
export const ORCHESTRATOR_SOURCE_KEYS = [
  "amazon",
  "keywordCompetitor",
  "voc",
  "sourcing1688",
] as const;

export type OrchestratorSourceKey = (typeof ORCHESTRATOR_SOURCE_KEYS)[number];

/**
 * 单源采集意图：
 * - probe：只读探测，绝不采集（inspect，或本轮未列入重试范围的来源）
 * - collect：仅在"该来源确实还没有任何可交付状态"时采集（缺省一键补齐）
 * - refresh：显式单源重试，即使已有 Pending 预览也必须重新采集一次
 *   （用于"预览已生成但用户无法确认"或"上次结果不可用"的恢复路径）
 */
export type OrchestratorCollectMode = "probe" | "collect" | "refresh";

export type OrchestratorSourceDetail = {
  status: SourceStatus;
  message?: string;
  previewId?: string | null;
  keywordPreviewId?: string | null;
  competitorPreviewId?: string | null;
  hasEvidence?: boolean;
  itemCount?: number;
  error?: {
    code: string;
    message: string;
    /** 仅供服务端诊断；不改变前端用户文案。 */
    diagnosticCode?: string;
  } | null;
};

export type ResearchOrchestratorSources = {
  amazon: OrchestratorSourceDetail;
  keywordCompetitor: OrchestratorSourceDetail;
  voc: OrchestratorSourceDetail;
  sourcing1688: OrchestratorSourceDetail;
};

export type ResearchOrchestratorResult = {
  taskId: string;
  action: OrchestratorAction;
  overallStatus: SourceStatus | "mixed";
  sources: ResearchOrchestratorSources;
  /** 四大上游模块（Amazon、VOC、1688、AI Listing）的统一标准化状态矩阵 */
  unifiedStatuses?: UnifiedStatusesMap;
  /** 本轮真正被采集的来源；未列出即表示本轮只做了只读探测。 */
  attemptedSources: OrchestratorSourceKey[];
  updatedAt: string;
};

export class ResearchOrchestratorError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ResearchOrchestratorError";
  }
}

/* ── 错误脱敏 ──────────────────────────────────────────────────────────── */

/**
 * 生成编排器侧的 Amazon 预览 ID。
 *
 * 必须与保存路由的格式校验一致（`/^[a-z0-9-]{8,64}$/i`，见
 * app/api/tasks/[id]/browser-evidence/route.ts）。历史实现用下划线
 * （`bev_preview_xxxxxxxxxx`），导致该预览虽然生成了却永远无法通过
 * action=save 保存，用户点「查看并确认」后只能走事实确认分支。
 */
function buildBrowserEvidencePreviewId(): string {
  const entropy = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `bev-preview-${entropy}`;
}

export function sanitizeErrorMessage(error: unknown): string {
  if (!error) return "未知错误";
  let msg = error instanceof Error ? error.message : String(error);
  // 屏蔽常见的敏感信息（token, secret, key, password, cookie 等）
  msg = msg.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "bearer ***");
  msg = msg.replace(
    /(password|passwd|pwd|token|secret|api[-_]?key|cookie)\s*[:=]\s*[^\s,;]+/gi,
    "$1=***",
  );
  // 屏蔽文件路径（Windows 驱动器路径及 Unix 路径）
  msg = msg.replace(/[a-zA-Z]:\\[^\s:;,?"*|<>]+/gi, "[filepath]");
  msg = msg.replace(/\/(?:Users|home|root|var|etc|opt|tmp|private)\/[^\s:;,?"*|<>]*/gi, "[filepath]");
  // 防止未经处理的原生堆栈暴露，只保留第一行有界描述
  const firstLine = msg.split("\n")[0] ?? msg;
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "..." : firstLine;
}

/* ── 并发锁与幂等运行账本 ──────────────────────────────────────────────── */

const RUNNING_ORCHESTRATIONS = new Map<string, number>();
const RUNNING_TIMEOUT_MS = 5 * 60 * 1000; // 5分钟自愈超时，防止单次异常阻断后续

type LastOrchestrationCacheEntry = {
  sources: ResearchOrchestratorSources;
  timestamp: number;
};
/**
 * 每任务的"最近一次采集尝试账本"（进程内）。
 *
 * 它只承担一个职责：在只读 inspect 探测到**信息量更弱**的结果时，
 * 保住刚刚真实发生过的失败/待确认状态，避免前端把一次真实失败刷成
 * 模糊的“待补齐”。
 *
 * 严格边界（避免制造脏状态）：
 * - 只允许把 failed / awaiting_confirmation 这类"确定性结论"回填；
 * - 绝不回填 ready —— ready 必须永远由当前真实证据推导；
 * - 只读 inspect 绝不写账本，账本只记录真实发生过的采集。
 */
const RECENT_ORCHESTRATION_CACHE = new Map<string, LastOrchestrationCacheEntry>();
const ORCHESTRATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 这些状态是"确定性结论"，在只读探测退化为 needs_user 时允许保留。 */
const STICKY_CONCLUSION_STATUSES: ReadonlySet<SourceStatus> = new Set<SourceStatus>([
  "failed",
  "awaiting_confirmation",
]);

/**
 * 只读探测退化为弱状态时，用最近一次真实采集结论兜底。
 * 返回 null 表示应直接采用探测结果。
 */
function preserveStickyConclusion(
  probe: OrchestratorSourceDetail,
  cached: OrchestratorSourceDetail | undefined,
): OrchestratorSourceDetail | null {
  if (!cached) return null;
  // 只读探测退化成"信息量更弱"的状态时才兜底：
  // 探测结果如果已经带来证据/预览/明确错误，就以探测为准。
  if (probe.status !== "needs_user" && probe.status !== "ready_to_search") return null;
  if (!STICKY_CONCLUSION_STATUSES.has(cached.status)) return null;
  if (probe.status === "needs_user" && probe.error) return null;
  return { ...cached, hasEvidence: probe.hasEvidence ?? cached.hasEvidence };
}

export function isOrchestrationRunning(taskId: string): boolean {
  const startedAt = RUNNING_ORCHESTRATIONS.get(taskId);
  if (!startedAt) return false;
  if (Date.now() - startedAt > RUNNING_TIMEOUT_MS) {
    RUNNING_ORCHESTRATIONS.delete(taskId);
    return false;
  }
  return true;
}

type ActiveSourcingJob = {
  taskId: string;
  status: "running" | "done" | "failed";
  message?: string;
  error?: { code: string; message: string; diagnosticCode?: string };
  previewId?: string;
  itemCount?: number;
  startedAt: number;
  /** 后台 run 已确认结束（成功或失败），可安全重启 */
  finished?: boolean;
  /** 因超过 SOURCING_JOB_TIMEOUT_MS 被判超时；旧 run 可能仍在执行，禁止隐式重启 */
  timedOut?: boolean;
};

const ACTIVE_SOURCING_JOBS = new Map<string, ActiveSourcingJob>();
/**
 * 后台任务的"展示层"自愈上限。注意：acquireByImage 的内部步骤超时加总最坏约 10 分钟，
 * 因此这个值**不是**用来中止真实采集的，只用于把长时间无回报的任务标成可操作失败态。
 */
const SOURCING_JOB_TIMEOUT_MS = 10 * 60 * 1000;
const SOURCING_TIMEOUT_MESSAGE =
  "1688 图搜执行时间超出预期，已在后台停止等待。请确认 1688 页面可正常打开后点「重试」。";

export function _clearSourcingJobsForTests(): void {
  ACTIVE_SOURCING_JOBS.clear();
}

export function _clearOrchestratorRunningStateForTests(): void {
  RUNNING_ORCHESTRATIONS.clear();
  RECENT_ORCHESTRATION_CACHE.clear();
  ACTIVE_SOURCING_JOBS.clear();
}

/* ── 计算总体状态 ──────────────────────────────────────────────────────── */

function computeOverallStatus(
  sources: ResearchOrchestratorSources,
  isRunning = false,
): SourceStatus | "mixed" {
  if (isRunning) return "running";
  const statuses = [
    sources.amazon.status,
    sources.keywordCompetitor.status,
    sources.voc.status,
    sources.sourcing1688.status,
  ];
  if (statuses.some((s) => s === "running")) return "running";
  const unique = new Set(statuses);
  if (unique.size === 1) {
    return statuses[0];
  }
  return "mixed";
}

/* ── 任务快照获取 ──────────────────────────────────────────────────────── */

async function getTaskSnapshot(
  context: AccessContext,
  taskId: string,
): Promise<{ id: string; updatedAt: Date | string; resultJson: string }> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) {
      throw new ResearchOrchestratorError("not_found", 404, "任务不存在。");
    }
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) {
      throw new ResearchOrchestratorError("not_found", 404, "任务不存在。");
    }
    return { id: task.id, updatedAt: task.updatedAt, resultJson: task.resultJson };
  }
  if (isSandboxTaskId(taskId)) {
    throw new ResearchOrchestratorError("not_found", 404, "任务不存在。");
  }
  const record = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, updatedAt: true, resultJson: true },
  });
  if (!record) {
    throw new ResearchOrchestratorError("not_found", 404, "任务不存在。");
  }
  return record;
}

function parseJsonSafe(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* ── Source 1: Amazon 来源处理 ─────────────────────────────────────────── */

async function handleAmazonSource(
  context: AccessContext,
  taskId: string,
  mode: OrchestratorCollectMode,
): Promise<OrchestratorSourceDetail> {
  try {
    // 1. 检查已保存的正式证据
    const existing = await readBrowserEvidence(context, taskId);
    if (existing !== null) {
      return {
        status: "ready",
        hasEvidence: true,
        message: "Amazon 详情资料已就绪",
      };
    }

    // 2. 检查是否有任务绑定的 ASIN
    const asin = await readBrowserEvidenceTaskAsin(context, taskId);
    if (!asin) {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "缺少商品 ASIN，无法采集 Amazon 资料",
      };
    }

    // 3. 读取最新事实快照。Pending Preview 是内存态，不能在它之前
    //    无条件返回 awaiting_confirmation：历史确认流程可能已经把全部
    //    canonical field 确认完，但没有留下 preview resolution。
    const taskAfterResolution = await getTaskSnapshot(context, taskId);
    const parsedTaskResult = parseJsonSafe(taskAfterResolution.resultJson) ?? {};

    // 4. 已持久化的来源 resolution 是确认动作的完成凭据。即使旧 Preview
    //    因消费竞态仍短暂存在，也不能让它把已闭环状态重新显示为 pending。
    const subjectKey = browserEvidenceSubjectKey(context);
    const resolved = findAmazonPreviewResolution({
      resultJson: parsedTaskResult,
      taskId,
      asin,
      subjectKey,
    });
    if (resolved) {
      return {
        status: "ready",
        hasEvidence: false,
        itemCount: resolved.candidateRefs.length,
        message: "Amazon 商品资料已完成事实确认闭环",
      };
    }

    // 5. Pending Preview 必须有真实的用户确认动作，不能因为 canonical
    //    field 已有同值事实就由 Orchestrator 直接推导为 ready。
    //    refresh（显式单源重试）例外：用户明确要求重采时不再复用旧预览，
    //    否则失败源会长期卡在同一个用户无法确认的预览上。旧预览仍留在 Store 中
    //    到期自然失效，不会覆盖任何已确认数据。
    const pending = findPendingBrowserEvidencePreview({ subjectKey, taskId, asin });
    if (pending !== null && mode !== "refresh") {
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: pending.evidenceId,
        itemCount: 1,
        message: "Amazon 详情已有待确认采集预览",
      };
    }

    // 6. Fact Candidate 确认闭环：Preview 已按 taskId/ASIN/主体/previewId/
    // candidate source identity 完成处理并被消费后，事实确认本身就是该来源的
    // 可追溯完成凭据；不能因为内存 Preview 已消费就再次启动采集。
    if (hasLegacyAmazonFactClosure(parsedTaskResult) && mode !== "refresh") {
      return {
        status: "ready",
        hasEvidence: false,
        message: "Amazon 商品资料已由已确认事实闭环（历史来源兼容）",
      };
    }

    // 7. probe 模式仅检查状态，不执行采集
    if (mode === "probe") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集 Amazon 详情资料",
      };
    }

    // 8. collect / refresh：尝试采集 Preview（严格不自动确认入库）
    if (context.mode === "demo") {
      // Demo 模式回放预置 preview
      const preview = buildDemoBrowserCollectPreview(asin);
      storeBrowserEvidencePreview({
        evidenceId: DEMO_ACQUISITION_EVIDENCE_ID,
        preview,
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey,
        taskId,
        asin,
      });
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: DEMO_ACQUISITION_EVIDENCE_ID,
        itemCount: 1,
        message: "Amazon 详情采集完成（演示数据），等待人工确认",
      };
    }

    // 本地环境检查能力
    const capability = resolveBrowserAcquisitionCapability();
    if (capability.state !== "available") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "本地未检测到可用的系统浏览器，请手动补充或检查浏览器环境",
      };
    }

    // 执行真实浏览器采集单页 Preview
    const preview = await collectBrowserEvidencePreview({
      asin,
      capturedAt: new Date().toISOString(),
    });
    const evidenceId = buildBrowserEvidencePreviewId();
    storeBrowserEvidencePreview({
      evidenceId,
      preview,
      capturedAt: new Date().toISOString(),
      expiresAt: Date.now() + 15 * 60 * 1000,
      subjectKey,
      taskId,
      asin,
    });

    return {
      status: "awaiting_confirmation",
      hasEvidence: false,
      previewId: evidenceId,
      itemCount: 1,
      message: "Amazon 详情采集完成，等待人工确认",
    };
  } catch (error) {
    if (error instanceof BrowserEvidenceCollectError) {
      const isTypedBlockerOrUnavailable =
        error.code === "browser_unavailable" ||
        error.code === "page_blocked_login_wall" ||
        error.code === "page_blocked_captcha" ||
        // Amazon 自动化访问校验（/errors_page/validateCaptcha + "Continue shopping" 中间页）：
        // 属"需要用户处理"（本机浏览器确认 / 稍后重试），不是系统失败。
        error.code === "automation_blocked";
      const diagReason =
        error.code === "page_unknown"
          ? "页面无法识别"
          : error.code === "automation_blocked"
            ? "Amazon自动化访问校验"
            : error.code === "page_blocked_login_wall" || error.code === "page_blocked_captcha"
              ? "Amazon验证阻断"
              : error.code === "asin_mismatch" || error.code === "asin_not_found"
                ? "ASIN异常"
                : error.message;
      // 统一给前端一个稳定的用户语义：Amazon 的登录墙、验证码和中间验证页
      // 都属于 Amazon 验证阻断，避免错误文本中的 "ASIN" 触发 ASIN 异常展示。
      // 自动化访问校验保留可操作的说明文案（明确"不是登录墙"）。
      const message = error.code === "automation_blocked"
        ? error.message || "Amazon 触发了自动化访问校验，请在本机浏览器手动打开该商品页确认，或稍后重试。"
        : error.code === "page_blocked_login_wall" || error.code === "page_blocked_captcha"
          ? "Amazon验证阻断"
          : error.message || diagReason;
      return {
        status: isTypedBlockerOrUnavailable ? "needs_user" : "failed",
        hasEvidence: false,
        message,
        error: { code: error.code, message },
      };
    }
    const sanitized = sanitizeErrorMessage(error);
    return {
      status: "failed",
      hasEvidence: false,
      message: sanitized,
      error: {
        code: "amazon_collect_failed",
        message: sanitized,
      },
    };
  }
}

/* ── Source 2: Keyword + Competitor 来源处理（Failure Isolation）───────── */

async function handleKeywordCompetitorSource(
  context: AccessContext,
  taskId: string,
  taskResultJson: string,
  mode: OrchestratorCollectMode,
): Promise<OrchestratorSourceDetail> {
  try {
    // 1. 检查已保存的正式证据：竞品与关键词
    const compEvidence = await getCompetitorEvidence(context, taskId);
    const kwEvidence = await getKeywordEvidence(context, taskId);
    const compAsins = (compEvidence?.asins ?? (compEvidence as unknown as { competitors?: unknown[] })?.competitors) ?? [];
    const kwRows = (kwEvidence?.rows ?? (kwEvidence as unknown as { items?: unknown[] })?.items) ?? [];
    const hasComp = compEvidence !== null && compAsins.length > 0;
    const hasKw = kwEvidence !== null && kwRows.length > 0;

    if (hasComp && hasKw) {
      return {
        status: "ready",
        hasEvidence: true,
        itemCount: compAsins.length + kwRows.length,
        message: "关键词与竞品资料已就绪",
      };
    }

    // 2. 检查任务权威种子
    const parsedResult = parseJsonSafe(taskResultJson);
    const seed = resolveBrowserUseSeed(parsedResult);
    if (!seed) {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "任务未绑定权威商品身份（批次/卖家精灵事实缺失），无法启动自动采集",
      };
    }

    // 3. 检查是否有待确认的 Pending 预览（无副作用只读检测）
    const previewBinding = { subjectKey: browserUseSubjectKey(context), taskId };
    const pendingKw = findPendingBrowserUsePreview(seed.asin, "keyword", previewBinding);
    const pendingComp = findPendingBrowserUsePreview(seed.asin, "competitor", previewBinding);
    const kwNeedsConfirm = !hasKw && pendingKw !== null;
    const compNeedsConfirm = !hasComp && pendingComp !== null;

    if ((kwNeedsConfirm || compNeedsConfirm) && mode !== "refresh") {
      const kwCount = kwNeedsConfirm && Array.isArray(pendingKw.preview.results) ? pendingKw.preview.results.length : 0;
      const compCount = compNeedsConfirm && Array.isArray(pendingComp.preview.results) ? pendingComp.preview.results.length : 0;
      let msg = "";
      if (kwNeedsConfirm && compNeedsConfirm) {
        msg = `关键词 ${kwCount} 条 · 竞品 ${compCount} 个预览已生成，等待人工确认`;
      } else if (kwNeedsConfirm) {
        msg = `关键词 ${kwCount} 条预览已生成，等待人工确认`;
      } else {
        msg = `竞品 ${compCount} 个预览已生成，等待人工确认`;
      }
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: pendingComp?.previewId ?? pendingKw?.previewId ?? null,
        keywordPreviewId: pendingKw?.previewId ?? null,
        competitorPreviewId: pendingComp?.previewId ?? null,
        itemCount: kwCount + compCount,
        message: msg,
      };
    }

    // 4. probe 模式仅检查状态，不执行采集
    if (mode === "probe") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集关键词与竞品资料",
      };
    }

    // 5. collect / refresh：执行采集（Failure Isolation 重点保护）
    // 必须限本机 Owner 环境使用
    if (context.mode !== "owner" || getRuntimeMode() !== "local_owner") {
      return {
        status: "failed",
        hasEvidence: false,
        message: "自动采集仅限本机环境与 Owner 使用",
        error: {
          code: "browser_use_local_owner_only",
          message: "自动采集仅限本机环境与 Owner 使用",
        },
      };
    }

    // ① SellerSprite 关键词采集
    const kwRun = await runSellerSpriteCollection({
      kind: "keyword",
      seedAsin: seed.asin,
      marketplaceTld: marketplaceToAmazonTld(seed.marketplace),
      productUrl: seed.productUrl,
    });
    if (!kwRun.ok) {
      const code =
        kwRun.failureReason === "collector_unavailable"
          ? "seller_sprite_collector_unavailable"
          : "seller_sprite_keyword_failed";
      const message =
        kwRun.failureReason === "collector_unavailable"
          ? "SellerSprite 采集引擎不可用（未启动或超时）"
          : "SellerSprite 关键词采集失败：未获得有效页面观察";
      return {
        status: "failed",
        hasEvidence: false,
        message,
        error: {
          code,
          message,
        },
      };
    }

    // 显式白名单失败原因检查（kwRun.preview.failureReason）
    if (kwRun.preview.failureReason === "login_required") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "SellerSprite 插件未登录，请在浏览器中登录后重试",
        error: {
          code: "seller_sprite_login_required",
          message: "SellerSprite 插件未登录，请在浏览器中登录后重试",
        },
      };
    }
    if (kwRun.preview.failureReason === "captcha_required") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "SellerSprite 遇到图形验证码，请在浏览器中完成验证",
        error: {
          code: "seller_sprite_captcha_required",
          message: "SellerSprite 遇到图形验证码，请在浏览器中完成验证",
        },
      };
    }
    if (kwRun.preview.failureReason === "panel_not_detected") {
      return {
        status: "failed",
        hasEvidence: false,
        message: "未检测到 SellerSprite 插件面板，请确认插件已开启",
        error: {
          code: "seller_sprite_panel_not_detected",
          message: "未检测到 SellerSprite 插件面板，请确认插件已开启并刷新页面",
        },
      };
    }
    if (kwRun.preview.failureReason === "seller_sprite_keyword_timeout") {
      return {
        status: "failed",
        hasEvidence: false,
        message: "SellerSprite 关键词加载超时，请确认网络连接或重试",
        error: {
          code: "seller_sprite_keyword_timeout",
          message: "SellerSprite 关键词加载超时，请确认网络连接或重试",
        },
      };
    }

    // ② 选取可靠搜索词（非品牌词，fail-closed）
    const keyword = selectReliableSearchKeyword(
      kwRun.preview.results as BrowserUseKeywordPreviewItem[],
      seed.productName,
    );
    if (!keyword) {
      return {
        status: "failed",
        hasEvidence: false,
        message: "SellerSprite 关键词没有可用的非品牌查询词，已停止",
        error: {
          code: "no_reliable_search_keyword",
          message: "SellerSprite 关键词没有可用的非品牌查询词，已停止自动竞品采集",
        },
      };
    }

    // ③ Amazon 搜索竞品发现
    const compRun = await runAmazonCompetitorCollection({
      seedAsin: seed.asin,
      marketplaceTld: marketplaceToAmazonTld(seed.marketplace),
      keyword,
    });
    if (!compRun.ok) {
      const code =
        compRun.failureReason === "collector_unavailable"
          ? "amazon_competitor_collector_unavailable"
          : "amazon_competitor_collect_failed";
      const message =
        compRun.failureReason === "collector_unavailable"
          ? "Amazon 竞品采集引擎不可用（未启动或超时）"
          : "Amazon 搜索采集失败：未获得有效页面观察";
      return {
        status: "failed",
        hasEvidence: false,
        message,
        error: {
          code,
          message,
        },
      };
    }

    // ④ 组装并暂存 Preview 供人工确认（严禁任何自动确认保存！）
    const competitorPreview = amazonCompetitorObservationToPreview(
      { seedAsin: seed.asin, marketplaceTld: marketplaceToAmazonTld(seed.marketplace), keyword },
      compRun.observation,
      kwRun.preview.collector.version,
    );
    const competitorPreviewId = storeBrowserUsePreview(competitorPreview, previewBinding);
    const keywordPreviewId = storeBrowserUsePreview(kwRun.preview, previewBinding);
    const kwCount = Array.isArray(kwRun.preview.results) ? kwRun.preview.results.length : 0;
    const compCount = Array.isArray(competitorPreview.results) ? competitorPreview.results.length : 0;

    return {
      status: "awaiting_confirmation",
      hasEvidence: false,
      previewId: competitorPreviewId,
      keywordPreviewId,
      competitorPreviewId,
      itemCount: kwCount + compCount,
      message: `关键词 ${kwCount} 条 · 竞品 ${compCount} 个预览已生成，等待人工确认`,
    };
  } catch (error) {
    // 捕获所有未知异常，实现严格的 Failure Isolation，绝不向外抛出 500
    const sanitized = sanitizeErrorMessage(error);
    return {
      status: "failed",
      hasEvidence: false,
      message: sanitized,
      error: {
        code: "keyword_competitor_failed",
        message: sanitized,
      },
    };
  }
}

/* ── Source 3: VOC 买家评论处理 ─────────────────────────────────────────── */

async function handleVocSource(
  context: AccessContext,
  taskId: string,
  mode: OrchestratorCollectMode,
): Promise<OrchestratorSourceDetail> {
  try {
    // 1. 已有正式 Review Evidence → ready（collector calls = 0）
    const reviewEv = await getReviewEvidence(context, taskId);
    if (reviewEv !== null && reviewEv.dataset.reviews.length > 0) {
      return {
        status: "ready",
        hasEvidence: true,
        itemCount: reviewEv.dataset.reviews.length,
        message: "买家评论样本已就绪",
      };
    }

    // 2. 解析权威当前商品 ASIN（readBrowserEvidenceTaskAsin；不猜、不信客户端）
    const asin = await readBrowserEvidenceTaskAsin(context, taskId);
    if (!asin) {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "当前任务缺少可验证的 Amazon 商品身份，无法自动采集评论",
      };
    }

    // 3. Pending Review Preview 幂等（无副作用查询；subjectKey/taskId 严格匹配；过期不复用）。
    //    只有「用户可操作」的 Pending 才复用（有待确认条目 / 页面被阻断 / 明确无评论）；
    //    extraction_empty 等瞬时失败不复用，落到下方正常采集分支重试，否则空 Preview
    //    会在 TTL 内把所有「补齐研究资料」点击都挡在同一个失败上。
    const subjectKey = reviewCollectSubjectKey(context);
    const pending = findPendingReviewCollectPreview({ subjectKey, taskId, asin });
    // refresh（显式单源重试）时不复用任何 Pending：用户已明确要求重采，
    // 继续复用同一个失败/空预览会让"重试"永远停在原地。
    if (pending !== null && isReusableReviewCollectPreview(pending) && mode !== "refresh") {
      const pendingItems = pending.items.length;
      const blockingPage = pending.pageResults.find((page) =>
        page.status === "blocked_redirect" || page.status === "login_required" || page.status === "captcha_required",
      );
      if (pendingItems === 0 && blockingPage) {
        if (blockingPage.status === "blocked_redirect") {
          const message = blockingPage.note ?? "页面导航被安全白名单阻断，未判定为登录墙；请检查站点或网络后重试";
          return {
            status: "failed",
            hasEvidence: false,
            previewId: pending.previewId,
            itemCount: 0,
            message,
            error: { code: "navigation_not_allowed", message },
          };
        }
        const code = blockingPage.status === "captcha_required" ? "captcha_required" : "login_required";
        const message = blockingPage.note ?? "Amazon 页面要求登录或验证，系统不会绕过，请完成后重试";
        return {
          status: "needs_user",
          hasEvidence: false,
          previewId: pending.previewId,
          itemCount: 0,
          message,
          error: { code, message },
        };
      }
      if (pendingItems === 0) {
        // 复用判定过滤后，到这里且条目为空的只剩「页面明确无评论」这一种可操作空态。
        const message = "Amazon 页面明确显示暂无公开评论";
        return {
          status: "needs_user",
          hasEvidence: false,
          previewId: pending.previewId,
          itemCount: 0,
          message,
          error: { code: "confirmed_no_reviews", message },
        };
      }
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: pending.previewId,
        itemCount: pendingItems,
        message: "买家评论已有待确认采集预览",
      };
    }

    // 4. probe 模式仅返回状态，绝不采集
    if (mode === "probe") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集买家评论",
      };
    }

    // 5. collect / refresh：Demo 模式回放预置 Preview（与 review-evidence route 行为一致）
    const capability = resolveBrowserAcquisitionCapability();
    if (capability.state === "local_env_required" && context.mode === "demo") {
      const items = buildDemoReviewCollectPreviewItems().map((item) => ({ ...item, duplicate: false }));
      const pageResults = buildDemoReviewCollectPageResults();
      storeDemoReviewPreview({ subjectKey, taskId, items, pageResults });
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: DEMO_ACQUISITION_EVIDENCE_ID,
        itemCount: items.length,
        message: "买家评论预览已生成（演示数据），等待人工确认",
      };
    }

    // 6. capability gate：不可用 → needs_user（typed message，不泄露内部信息）
    if (capability.state !== "available") {
      const message = capability.state === "local_env_required"
        ? REVIEW_LOCAL_ENV_REQUIRED_MESSAGE
        : browserUnavailableMessage(capability.reasonCategory);
      return {
        status: "needs_user",
        hasEvidence: false,
        message,
        error: {
          code: capability.state === "local_env_required" ? "local_environment_required" : "acquisition_unavailable",
          message,
        },
      };
    }

    // 7. collect / refresh：调用现有 Review Collector（V1 仅 current_candidate 单 ASIN）
    //    只创建 Preview，绝不 collect-confirm / analyze / importReviews
    const preview = await createReviewCollectPreview({
      context,
      taskId,
      asins: [{ asin, role: "current_candidate" }],
    });
    const blockingPage = preview.pageResults.find((page) =>
      page.status === "blocked_redirect" || page.status === "login_required" || page.status === "captcha_required",
    );
    if (preview.items.length === 0 && blockingPage) {
      if (blockingPage.status === "blocked_redirect") {
        const message = blockingPage.note ?? "页面导航被安全白名单阻断，未判定为登录墙；请检查站点或网络后重试";
        return {
          status: "failed",
          hasEvidence: false,
          previewId: preview.previewId,
          itemCount: 0,
          message,
          error: { code: "navigation_not_allowed", message },
        };
      }
      const code = blockingPage.status === "captcha_required" ? "captcha_required" : "login_required";
      const message = blockingPage.note ?? "Amazon 页面要求登录或验证，系统不会绕过，请完成后重试";
      return {
        status: "needs_user",
        hasEvidence: false,
        previewId: preview.previewId,
        itemCount: 0,
        message,
        error: { code, message },
      };
    }
    const errorPage = preview.pageResults.find((page) => page.status === "error");
    if (preview.items.length === 0 && errorPage) {
      const message = errorPage.note ?? "买家评论页面访问异常或超时，请稍后重试";
      return {
        status: "failed",
        hasEvidence: false,
        previewId: preview.previewId,
        itemCount: 0,
        message,
        error: { code: "review_collect_error", message },
      };
    }
    if (preview.items.length === 0) {
      const confirmedNoReviews = preview.pageResults.some((page) => page.status === "confirmed_no_reviews");
      const message = confirmedNoReviews
        ? "Amazon 页面明确显示暂无公开评论"
        : "评论模块未完成提取，暂时无法确认是否无评论，请重试";
      return {
        status: "needs_user",
        hasEvidence: false,
        previewId: preview.previewId,
        itemCount: 0,
        message,
        error: { code: confirmedNoReviews ? "confirmed_no_reviews" : "extraction_empty", message },
      };
    }
    return {
      status: "awaiting_confirmation",
      hasEvidence: false,
      previewId: preview.previewId,
      itemCount: preview.items.length,
      message: "买家评论预览已生成，等待人工确认",
    };
  } catch (error) {
    if (error instanceof ReviewCollectorError) {
      // typed collector failures → 按现有分类归入安全状态
      const needsUser = ["browser_not_available", "login_required", "captcha_required", "automation_blocked"].includes(error.code);
      const blockerMessage = error.code === "automation_blocked"
        ? "Amazon 触发了自动化访问校验（“Continue shopping”中间页），系统不会绕过：请在本机浏览器手动打开该商品页确认，或稍后重试。"
        : "Amazon 页面要求登录或验证，系统不会绕过，请完成后重试";
      const message = needsUser
        ? (error.code === "browser_not_available" ? "本机未检测到可用的系统浏览器，无法自动采集评论" : blockerMessage)
        : "买家评论采集失败，可稍后重试或手动导入";
      return {
        status: needsUser ? "needs_user" : "failed",
        hasEvidence: false,
        message,
        error: { code: error.code, message },
      };
    }
    const sanitized = sanitizeErrorMessage(error);
    return {
      status: "failed",
      hasEvidence: false,
      message: sanitized,
      error: {
        code: "voc_collect_failed",
        message: sanitized,
      },
    };
  }
}

/** Demo 模式回放：把预置评论样本作为 Pending Preview 存储（不写入正式 Evidence） */
function storeDemoReviewPreview(input: {
  subjectKey: string;
  taskId: string;
  items: ReviewSnippetPreviewItem[];
  pageResults: ReviewCollectPageResult[];
}): void {
  storeReviewCollectPreview({
    previewId: DEMO_ACQUISITION_EVIDENCE_ID,
    items: input.items,
    pageResults: input.pageResults,
    capturedAt: new Date().toISOString(),
    expiresAt: Date.now() + 15 * 60 * 1000,
    subjectKey: input.subjectKey,
    taskId: input.taskId,
  });
}


/* ── Source 4: 1688 货源处理 ───────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasProductImageForSourcing(parsedResult: Record<string, unknown> | null): boolean {
  if (!parsedResult) return false;
  // 必须具备真实商品主图（公网 HTTPS 图片 URL，用于 1688 图搜）
  const publicUrl = resolvePublicSourceImageUrl(parsedResult);
  return Boolean(publicUrl);
}

// 检查 sourceMeta.candidateSnapshot.productImageSnapshot.dataUrl
// 是否为合法的 data:image/(jpeg|png);base64,... 快照
function hasBase64ImageForSourcing(parsedResult: Record<string, unknown> | null): boolean {
  if (!parsedResult) return false;
  const sourceMeta = isRecord(parsedResult.sourceMeta) ? parsedResult.sourceMeta : null;
  if (!sourceMeta) return false;
  const candidateSnapshot = isRecord(sourceMeta.candidateSnapshot) ? sourceMeta.candidateSnapshot : null;
  if (!candidateSnapshot) return false;
  const productImageSnapshot = isRecord(candidateSnapshot.productImageSnapshot)
    ? candidateSnapshot.productImageSnapshot
    : null;
  if (!productImageSnapshot) return false;
  const dataUrl = productImageSnapshot.dataUrl;
  if (typeof dataUrl !== "string" || dataUrl.length === 0) return false;
  return /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/u.test(dataUrl);
}

// 检查 result/productIdentity/sourceMeta.productBatchSnapshot 任意一个标题字段
// 是否为非空字符串（trim 后长度 ≥ 1）
function hasProductTitleForSourcing(parsedResult: Record<string, unknown> | null): boolean {
  if (!parsedResult) return false;
  const rootTitle = typeof parsedResult.productName === "string"
    ? parsedResult.productName.trim()
    : "";
  if (rootTitle.length >= 1) return true;

  const productIdentity = isRecord(parsedResult.productIdentity) ? parsedResult.productIdentity : null;
  if (productIdentity && typeof productIdentity.title === "string"
    && productIdentity.title.trim().length >= 1) {
    return true;
  }

  const sourceMeta = isRecord(parsedResult.sourceMeta) ? parsedResult.sourceMeta : null;
  const batchSnapshot = sourceMeta && isRecord(sourceMeta.productBatchSnapshot)
    ? sourceMeta.productBatchSnapshot
    : null;
  if (batchSnapshot) {
    if (typeof batchSnapshot.productTitle === "string"
      && batchSnapshot.productTitle.trim().length >= 1) {
      return true;
    }
    if (typeof batchSnapshot.query === "string"
      && batchSnapshot.query.trim().length >= 1) {
      return true;
    }
    const productFacts = isRecord(batchSnapshot.productFacts) ? batchSnapshot.productFacts : null;
    if (productFacts && typeof productFacts.productTitle === "string"
      && productFacts.productTitle.trim().length >= 1) {
      return true;
    }
  }
  return false;
}

async function runSourcingJobAsync(
  context: AccessContext,
  taskId: string,
  publicUrl: string | null,
  taskImage: { buffer: Buffer; mimeType: string } | null,
): Promise<void> {
  try {
    // Demo 模式：生成演示候选预览
    if (context.mode === "demo") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const demoCandidates = DEMO_SOURCING_EVIDENCE_SAMPLE.candidates.map((c) => ({ ...c }));
      const preview = createSourcingPreview({
        context,
        taskId,
        method: "image",
        query: publicUrl || `/api/tasks/${taskId}/image`,
        runTrace: {
          source: "1688",
          method: "image",
          query: "demo-image",
          timestamp: new Date().toISOString(),
          driverVersion: IMAGE_ACQUISITION_DRIVER_VERSION,
          resolverVersion: null,
          success: true,
          failClosedReason: null,
        },
        candidates: demoCandidates,
      });
      const job = ACTIVE_SOURCING_JOBS.get(taskId);
      if (job) {
        job.status = "done";
        job.previewId = preview.previewId;
        job.itemCount = demoCandidates.length;
        job.message = `1688 图搜完成（演示数据），已生成 ${demoCandidates.length} 条待确认候选`;
      }
      return;
    }

    // 真实运行模式：bridge 生命周期与扩展 readiness 统一由 acquireByImage 负责。
    // 编排器不再复制一套短 timeout 检查，避免 bridge 冷启动时提前误判扩展未就绪。

    // 构造本地临时文件（若存在 taskImage Buffer）
    let tempDirToClean: string | undefined;
    let localImagePath: string | undefined;
    try {
      if (taskImage) {
        const tempDir = await mkdtemp(join(tmpdir(), "v35-orch-sourcing-img-"));
        tempDirToClean = tempDir;
        const ext = taskImage.mimeType === "image/png" ? "png" : "jpg";
        const tempFile = join(tempDir, `product-image.${ext}`);
        await writeFile(tempFile, taskImage.buffer);
        localImagePath = tempFile;
      }

      const { candidates, trace } = await acquireByImage({
        imageUrl: localImagePath ? undefined : (publicUrl ?? undefined),
        localImagePath,
        taskId,
        candidateId: `task:${taskId}`,
      });

      const preview = createSourcingPreview({
        context,
        taskId,
        method: "image",
        query: publicUrl || `/api/tasks/${taskId}/image`,
        runTrace: {
          source: "1688",
          method: "image",
          query: publicUrl || `/api/tasks/${taskId}/image`,
          timestamp: new Date().toISOString(),
          driverVersion: trace.driverVersion,
          resolverVersion: trace.resolverVersion,
          success: trace.success,
          failClosedReason: trace.failClosedReason,
        },
        candidates,
      });

      const job = ACTIVE_SOURCING_JOBS.get(taskId);
      if (job) {
        job.status = "done";
        job.finished = true;
        job.previewId = preview.previewId;
        job.itemCount = candidates.length;
        job.message = `1688 图搜完成，生成 ${candidates.length} 条待确认候选`;
      }
      // 任务已完成：从在途账本移除，否则同一个请求内的后续来源处理
      // （以及下一次 inspect）会先命中"在途 job"分支，把已经产出预览的任务
      // 误报成 failed/awaiting，而真正的待确认预览要等下一轮才可见。
      ACTIVE_SOURCING_JOBS.delete(taskId);
    } finally {
      if (tempDirToClean) {
        await rm(tempDirToClean, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } catch (error) {
    const normalized = normalizeImageAcquisitionError(error);
    // 错误码 → 可操作中文文案。这里必须覆盖 acquireByImage 真实产出的全部错误码，
    // 否则用户会看到内部兜底文案而不知道下一步该做什么。
    const userFriendlyMessage =
      normalized.code === "auth_required"
        ? "1688 未登录，请在普通 Chrome 中登录 1688 后重试。"
        : normalized.code === "no_1688_tab"
          ? "普通 Chrome 中没有可用的 1688 页面，请先打开 1688 网站后重试。"
          : normalized.code === "extension_not_installed"
            ? "未检测到轻选 1688 助手，请先在普通 Chrome 中安装并启用助手后重试。"
            : normalized.code === "extension_disconnected"
              ? "1688 助手连接中断，请检查 Chrome 窗口与助手状态后重试。"
              : normalized.code === "risk_control_required"
                ? "1688 触发了安全验证，请在 1688 页面完成验证后重试（系统不会绕过）。"
                : normalized.code === "page_identity_unknown"
                  ? "无法识别当前 1688 图搜页面（页面结构已变化或助手与页面不同步）。请刷新 1688 页面后重试；若仍失败，请改用人工粘贴 1688 商品链接。"
                  : normalized.code === "timeout"
                    ? "1688 图搜超时，请确认网络与 1688 页面状态后重试。"
                    : normalized.code === "extension_bridge_not_available"
                      ? "1688 助手桥接服务未就绪，请确认助手已启用后重试。"
                      : (normalized.message || "1688 图搜未成功，请重试。");

    const job = ACTIVE_SOURCING_JOBS.get(taskId);
    if (job) {
      job.status = "failed";
      job.finished = true;
      job.message = userFriendlyMessage;
      job.error = {
        code: normalized.code,
        message: userFriendlyMessage,
        ...(normalized.diagnosticCode ? { diagnosticCode: normalized.diagnosticCode } : {}),
      };
    }
  }
}

async function handleSourcingSource(
  context: AccessContext,
  taskId: string,
  taskResultJson: string,
  mode: OrchestratorCollectMode,
): Promise<OrchestratorSourceDetail> {
  try {
    // 1. 检查已保存的正式货源证据
    const sourcingEv = await getSourcingEvidence(context, taskId);
    if (sourcingEv !== null && sourcingEv.humanConfirmed.length > 0) {
      ACTIVE_SOURCING_JOBS.delete(taskId);
      return {
        status: "ready",
        hasEvidence: true,
        itemCount: sourcingEv.humanConfirmed.length,
        message: "1688 货源证据已就绪",
      };
    }

    // 2. 检查是否有待确认的货源预览（无副作用只读检测；按主体隔离）
    const pending = findPendingSourcingPreview(taskId, sourcingPreviewSubjectKey(context));
    if (pending !== null && mode !== "refresh") {
      ACTIVE_SOURCING_JOBS.delete(taskId);
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: pending.previewId,
        itemCount: pending.candidates.length,
        message: `1688 货源已有待确认预览（${pending.candidates.length} 条候选）`,
      };
    }

    // 3. 检查是否有处于后台运行中的异步 Sourcing 任务
    const activeJob = ACTIVE_SOURCING_JOBS.get(taskId);
    if (activeJob) {
      if (activeJob.status === "running") {
        if (Date.now() - activeJob.startedAt < SOURCING_JOB_TIMEOUT_MS) {
          return {
            status: "running",
            hasEvidence: false,
            message: activeJob.message || "1688 图片找货执行中...",
          };
        }
        // 超时自愈：任务已超过上限仍未回报。这里**不能**直接删除记录再放行，
        // 否则旧 run 仍在执行（acquireByImage 内部最坏可达约 10 分钟）时会与
        // 新 run 共用同一个 bridge 与同一个 1688 页面，造成双上传/双提交。
        // 保留记录并标记为超时占位，只有显式 refresh 才允许重启（见第 6 步）。
        activeJob.status = "failed";
        activeJob.finished = true;
        activeJob.timedOut = true;
        activeJob.message = SOURCING_TIMEOUT_MESSAGE;
        activeJob.error = { code: "sourcing_job_timeout", message: SOURCING_TIMEOUT_MESSAGE };
      }
      if (activeJob.status === "failed") {
        // 失败任务在只读检查与普通编排时都保留给用户查看。
        // 但"任务已确认结束（含真实失败）"的旧失败占位必须在普通编排时清除，
        // 否则“重试”永远返回同一条失败记录而没有真实发起新采集。
        // 只有"超时但旧 run 可能仍在跑"这一种情况禁止隐式重启 —— 那会与旧 run
        // 共用同一个 bridge 与同一个 1688 页面，造成双上传/双提交；此时必须由
        // 用户显式 refresh（单源重试）才重启。
        const blockImplicitRestart = activeJob.timedOut === true && mode !== "refresh";
        if (mode === "probe" || blockImplicitRestart) {
          return {
            status: "failed",
            hasEvidence: false,
            message: activeJob.message || "1688 图搜未成功",
            error: activeJob.error,
          };
        }
        ACTIVE_SOURCING_JOBS.delete(taskId);
      }
    }

    // 4. 检查任务是否已具备商品素材（公网主图 / Base64 快照 / 商品标题）
    const parsedTask = parseJsonSafe(taskResultJson);
    const publicUrl = resolvePublicSourceImageUrl(parsedTask, taskId);
    const taskImage = await getTaskProductImageBuffer(taskId);
    const hasImageMaterial = Boolean(publicUrl || taskImage);
    const hasBase64 = hasBase64ImageForSourcing(parsedTask);
    const hasTitle = hasProductTitleForSourcing(parsedTask);

    if (!hasImageMaterial && !hasBase64 && !hasTitle) {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待补充商品主图后搜索 1688 货源",
      };
    }

    // 5. 只读检查（probe）：不触发外部搜索，返回准备就绪
    if (mode === "probe") {
      return {
        status: "ready_to_search",
        hasEvidence: false,
        message: "已准备商品素材，可进入1688图片找货",
      };
    }

    // 6. collect / refresh：启动非阻塞后台任务并立即返回 running
    if (!hasImageMaterial) {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "当前任务无商品主图素材，无法自动发起图搜",
      };
    }

    const job: ActiveSourcingJob = {
      taskId,
      status: "running",
      message: "1688 图片找货执行中...",
      startedAt: Date.now(),
    };
    ACTIVE_SOURCING_JOBS.set(taskId, job);

    void runSourcingJobAsync(context, taskId, publicUrl, taskImage);

    return {
      status: "running",
      hasEvidence: false,
      message: "1688 图片找货执行中...",
    };
  } catch (error) {
    const sanitized = sanitizeErrorMessage(error);
    return {
      status: "failed",
      hasEvidence: false,
      message: sanitized,
      error: {
        code: "sourcing_failed",
        message: sanitized,
      },
    };
  }
}

/* ── 核心编排执行入口 ──────────────────────────────────────────────────── */

export async function orchestrateResearchCollection(options: {
  context: AccessContext;
  taskId: string;
  action?: OrchestratorAction;
  /** 仅对这些来源执行采集；缺省表示所有仍可采集的来源。只读探测始终覆盖全部来源。 */
  sources?: OrchestratorSourceKey[];
}): Promise<ResearchOrchestratorResult> {
  const taskId = options.taskId.trim();
  const action: OrchestratorAction = options.action === "inspect" ? "inspect" : "orchestrate";

  // 单源重试的意图白名单：非法/为空一律视为"未限定"（路由层已做严格校验）。
  const requestedSources: OrchestratorSourceKey[] | null =
    Array.isArray(options.sources) && options.sources.length > 0
      ? ORCHESTRATOR_SOURCE_KEYS.filter((key) => options.sources!.includes(key))
      : null;
  const isSingleSourceRetry = requestedSources !== null && requestedSources.length < ORCHESTRATOR_SOURCE_KEYS.length;

  const modeFor = (key: OrchestratorSourceKey): OrchestratorCollectMode => {
    if (action === "inspect") return "probe";
    if (requestedSources === null) return "collect";
    // 客户端显式限定来源 = 用户点了某一个来源的「重试」，
    // 语义是"我要这个来源产生一份新的采集结果"，因此允许突破既有 Pending 预览；
    // 未列出的来源退回只读探测，绝不重新采集。
    return requestedSources.includes(key) ? "refresh" : "probe";
  };

  const attemptedSources: OrchestratorSourceKey[] =
    action === "inspect" ? [] : (requestedSources ?? [...ORCHESTRATOR_SOURCE_KEYS]);

  // 1. 并发保护（同步先查先锁，杜绝 await 间隙并发穿透）
  if (action === "orchestrate") {
    if (isOrchestrationRunning(taskId)) {
      return {
        taskId,
        action,
        overallStatus: "running",
        sources: {
          amazon: { status: "running", message: "采集正在执行中" },
          keywordCompetitor: { status: "running", message: "采集正在执行中" },
          voc: { status: "running", message: "采集正在执行中" },
          sourcing1688: { status: "running", message: "采集正在执行中" },
        },
        unifiedStatuses: {
          amazon: { module: "amazon", status: "running", succeeded: false, summary: "采集正在执行中" },
          voc: { module: "voc", status: "running", summary: "采集正在执行中" },
          "1688": { module: "1688", status: "running", summary: "采集正在执行中" },
          ai: { module: "ai", status: "idle", generated: false, passedGate: false, savedStatus: "not_saved", summary: "待上游采集完成" },
        },
        attemptedSources: [],
        updatedAt: new Date().toISOString(),
      };
    }
    RUNNING_ORCHESTRATIONS.set(taskId, Date.now());
    logInfo("agent", "orchestration_started", `开始执行研究采集编排 (任务: ${taskId})`, {
      taskId,
      metadata: { attemptedSources, action },
    }).catch(() => undefined);
  }

  try {
    // 2. 读取任务快照，校验任务存在性
    const task = await getTaskSnapshot(options.context, taskId);

    const durations: Partial<Record<"amazon" | "voc" | "1688" | "ai", number>> = {};
    const runTimed = async <T>(key: "amazon" | "voc" | "1688", fn: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        return await fn();
      } finally {
        durations[key] = Date.now() - start;
      }
    };

    // 3. 并行执行 4 大来源的状态检测（+ 被本轮授权的采集）；各源内部自包含 failure isolation
    const [rawAmazon, rawKeywordCompetitor, rawVoc, rawSourcing1688] = await Promise.all([
      runTimed("amazon", () => handleAmazonSource(options.context, taskId, modeFor("amazon"))),
      handleKeywordCompetitorSource(options.context, taskId, task.resultJson, modeFor("keywordCompetitor")),
      runTimed("voc", () => handleVocSource(options.context, taskId, modeFor("voc"))),
      runTimed("1688", () => handleSourcingSource(options.context, taskId, task.resultJson, modeFor("sourcing1688"))),
    ]);

    const probeSources: ResearchOrchestratorSources = {
      amazon: rawAmazon,
      keywordCompetitor: rawKeywordCompetitor,
      voc: rawVoc,
      sourcing1688: rawSourcing1688,
    };

    const cached = RECENT_ORCHESTRATION_CACHE.get(taskId);
    const cacheAlive = cached !== undefined && Date.now() - cached.timestamp <= ORCHESTRATION_CACHE_TTL_MS;
    const cachedSources = cacheAlive ? cached!.sources : undefined;

    const sources: ResearchOrchestratorSources = {
      amazon: preserveStickyConclusion(probeSources.amazon, cachedSources?.amazon) ?? probeSources.amazon,
      keywordCompetitor: preserveStickyConclusion(probeSources.keywordCompetitor, cachedSources?.keywordCompetitor) ?? probeSources.keywordCompetitor,
      voc: preserveStickyConclusion(probeSources.voc, cachedSources?.voc) ?? probeSources.voc,
      sourcing1688: preserveStickyConclusion(probeSources.sourcing1688, cachedSources?.sourcing1688) ?? probeSources.sourcing1688,
    };

    const taskResult = parseJsonSafe(task.resultJson);
    const unifiedStatuses = deriveAllUnifiedStatuses({
      sources,
      taskResult,
      durations,
    });

    // 账本与事件仅记录真实发生过的采集（orchestrate），只读 inspect 绝不写入。
    if (action === "orchestrate") {
      void logUnifiedStatusEvents({
        taskId,
        statuses: unifiedStatuses,
        contextAction: action,
      });

      const nextSources: ResearchOrchestratorSources = cachedSources
        ? {
            amazon: attemptedSources.includes("amazon") ? sources.amazon : (cachedSources.amazon ?? sources.amazon),
            keywordCompetitor: attemptedSources.includes("keywordCompetitor") ? sources.keywordCompetitor : (cachedSources.keywordCompetitor ?? sources.keywordCompetitor),
            voc: attemptedSources.includes("voc") ? sources.voc : (cachedSources.voc ?? sources.voc),
            sourcing1688: attemptedSources.includes("sourcing1688") ? sources.sourcing1688 : (cachedSources.sourcing1688 ?? sources.sourcing1688),
          }
        : sources;
      RECENT_ORCHESTRATION_CACHE.set(taskId, { sources: nextSources, timestamp: Date.now() });

      const overall = computeOverallStatus(sources);
      logInfo("agent", "orchestration_completed", `研究采集编排完成，状态: ${overall}`, {
        taskId,
        metadata: {
          overallStatus: overall,
          sources: {
            amazon: sources.amazon.status,
            keywordCompetitor: sources.keywordCompetitor.status,
            voc: sources.voc.status,
            sourcing1688: sources.sourcing1688.status,
          },
          unifiedStatuses,
        },
      }).catch(() => undefined);
    }

    return {
      taskId,
      action,
      overallStatus: computeOverallStatus(sources),
      sources,
      unifiedStatuses,
      attemptedSources,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (action === "orchestrate") {
      logError("agent", "orchestration_failed", `研究采集编排失败: ${error instanceof Error ? error.message : String(error)}`, {
        taskId,
        metadata: { error: String(error) },
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    // 4. 确保释放并发锁
    if (action === "orchestrate") {
      RUNNING_ORCHESTRATIONS.delete(taskId);
    }
  }
}
