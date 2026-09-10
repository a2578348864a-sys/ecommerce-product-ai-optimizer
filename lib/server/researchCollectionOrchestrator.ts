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

export type SourceStatus =
  | "ready"
  | "running"
  | "awaiting_confirmation"
  | "needs_user"
  | "ready_to_search"
  | "blocked"
  | "failed";

export type OrchestratorAction = "inspect" | "orchestrate";

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
const RECENT_ORCHESTRATION_CACHE = new Map<string, LastOrchestrationCacheEntry>();
const ORCHESTRATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
};

const ACTIVE_SOURCING_JOBS = new Map<string, ActiveSourcingJob>();
const SOURCING_JOB_TIMEOUT_MS = 2 * 60 * 1000;

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
  action: OrchestratorAction,
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
    const pending = findPendingBrowserEvidencePreview({ subjectKey, taskId, asin });
    if (pending !== null) {
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
    if (hasLegacyAmazonFactClosure(parsedTaskResult)) {
      return {
        status: "ready",
        hasEvidence: false,
        message: "Amazon 商品资料已由已确认事实闭环（历史来源兼容）",
      };
    }

    // 7. inspect 模式仅检查状态，不执行采集
    if (action === "inspect") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集 Amazon 详情资料",
      };
    }

    // 8. orchestrate 模式：尝试采集 Preview（严格不自动确认入库）
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
    const evidenceId = `bev_preview_${Math.random().toString(36).slice(2, 12)}`;
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
        error.code === "page_blocked_captcha";
      const diagReason =
        error.code === "page_unknown"
          ? "页面无法识别"
          : error.code === "page_blocked_login_wall" || error.code === "page_blocked_captcha"
            ? "Amazon验证阻断"
            : error.code === "asin_mismatch" || error.code === "asin_not_found"
              ? "ASIN异常"
              : error.message;
      // 统一给前端一个稳定的用户语义：Amazon 的登录墙、验证码和中间验证页
      // 都属于 Amazon 验证阻断，避免错误文本中的 "ASIN" 触发 ASIN 异常展示。
      const message = error.code === "page_blocked_login_wall" || error.code === "page_blocked_captcha"
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
  action: OrchestratorAction,
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

    if (kwNeedsConfirm || compNeedsConfirm) {
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

    // 4. inspect 模式仅检查状态，不执行采集
    if (action === "inspect") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集关键词与竞品资料",
      };
    }

    // 5. orchestrate 模式：执行采集（Failure Isolation 重点保护）
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
  action: OrchestratorAction,
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
    if (pending !== null && isReusableReviewCollectPreview(pending)) {
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

    // 4. inspect 模式仅返回状态，绝不采集
    if (action === "inspect") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集买家评论",
      };
    }

    // 5. orchestrate：Demo 模式回放预置 Preview（与 review-evidence route 行为一致）
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

    // 7. orchestrate：调用现有 Review Collector（V1 仅 current_candidate 单 ASIN）
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
      const needsUser = ["browser_not_available", "login_required", "captcha_required"].includes(error.code);
      return {
        status: needsUser ? "needs_user" : "failed",
        hasEvidence: false,
        message: needsUser ? (error.code === "browser_not_available" ? "本机未检测到可用的系统浏览器，无法自动采集评论" : "Amazon 页面要求登录或验证，系统不会绕过，请完成后重试") : "买家评论采集失败，可稍后重试或手动导入",
        error: { code: error.code, message: needsUser ? (error.code === "browser_not_available" ? "本机未检测到可用的系统浏览器，无法自动采集评论" : "Amazon 页面要求登录或验证，系统不会绕过，请完成后重试") : "买家评论采集失败" },
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
        job.previewId = preview.previewId;
        job.itemCount = candidates.length;
        job.message = `1688 图搜完成，生成 ${candidates.length} 条待确认候选`;
      }
    } finally {
      if (tempDirToClean) {
        await rm(tempDirToClean, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } catch (error) {
    const normalized = normalizeImageAcquisitionError(error);
    const userFriendlyMessage =
      normalized.code === "auth_required"
        ? "1688 未登录，请在普通 Chrome 中登录 1688 后重试"
        : normalized.code === "no_1688_tab"
          ? "未检测到 1688 标签页，请在普通 Chrome 中打开 1688 页面"
          : normalized.code === "extension_not_installed"
            ? "未检测到 1688 助手扩展，请先加载扩展"
            : normalized.code === "extension_disconnected"
              ? "1688 助手连接中断，请检查 Chrome 窗口与助手状态后重试"
              : (normalized.message || "1688 图搜未成功，请重试");

    const job = ACTIVE_SOURCING_JOBS.get(taskId);
    if (job) {
      job.status = "failed";
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
  action: OrchestratorAction,
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

    // 2. 检查是否有待确认的货源预览（无副作用只读检测）
    const pending = findPendingSourcingPreview(taskId);
    if (pending !== null) {
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
        } else {
          ACTIVE_SOURCING_JOBS.delete(taskId);
        }
      } else if (activeJob.status === "failed") {
        return {
          status: "failed",
          hasEvidence: false,
          message: activeJob.message || "1688 图搜未成功",
          error: activeJob.error,
        };
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

    // 5. 只读检查（action === "inspect"）：不触发外部搜索，返回准备就绪
    if (action === "inspect") {
      return {
        status: "ready_to_search",
        hasEvidence: false,
        message: "已准备商品素材，可进入1688图片找货",
      };
    }

    // 6. 编排采集模式（action === "orchestrate"）：启动非阻塞后台任务并立即返回 running
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
}): Promise<ResearchOrchestratorResult> {
  const taskId = options.taskId.trim();
  const action: OrchestratorAction = options.action === "inspect" ? "inspect" : "orchestrate";

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
        updatedAt: new Date().toISOString(),
      };
    }
    RUNNING_ORCHESTRATIONS.set(taskId, Date.now());
  }

  try {
    // 2. 读取任务快照，校验任务存在性
    const task = await getTaskSnapshot(options.context, taskId);

    // 3. 并行执行 4 大来源的状态检测与采集（各源内部自包含 failure isolation）
    const [rawAmazon, rawKeywordCompetitor, rawVoc, rawSourcing1688] = await Promise.all([
      handleAmazonSource(options.context, taskId, action),
      handleKeywordCompetitorSource(options.context, taskId, task.resultJson, action),
      handleVocSource(options.context, taskId, action),
      handleSourcingSource(options.context, taskId, task.resultJson, action),
    ]);

    let amazon = rawAmazon;
    let keywordCompetitor = rawKeywordCompetitor;
    let voc = rawVoc;
    let sourcing1688 = rawSourcing1688;

    if (action === "orchestrate") {
      // 记录最新主动 orchestrate 结果缓存，供后续只读 inspect 保持状态延续
      RECENT_ORCHESTRATION_CACHE.set(taskId, {
        sources: { amazon, keywordCompetitor, voc, sourcing1688 },
        timestamp: Date.now(),
      });
    } else {
      // action === "inspect"
      const cached = RECENT_ORCHESTRATION_CACHE.get(taskId);
      if (cached && Date.now() - cached.timestamp <= ORCHESTRATION_CACHE_TTL_MS) {
        // 如果 inspect 探测为弱状态 needs_user（未生成新 evidence 也无新 preview），
        // 但最近主动 orchestrate 产生了真实状态（如 failed, ready_to_search, 或带具体错误的 needs_user），
        // 则予以保留，防止只读探测瞬间抹白刚刚执行的失败状态！
        if (amazon.status === "needs_user" && (cached.sources.amazon.status === "failed" || cached.sources.amazon.status === "ready")) {
          amazon = { ...cached.sources.amazon };
        }
        if (voc.status === "needs_user" && (cached.sources.voc.status === "failed" || cached.sources.voc.status === "ready" || cached.sources.voc.error)) {
          voc = { ...cached.sources.voc };
        }
        if (
          (sourcing1688.status === "needs_user" || sourcing1688.status === "ready_to_search") &&
          (cached.sources.sourcing1688.status === "awaiting_confirmation" || cached.sources.sourcing1688.status === "failed")
        ) {
          sourcing1688 = { ...cached.sources.sourcing1688 };
        }
        if (keywordCompetitor.status === "needs_user" && (cached.sources.keywordCompetitor.status === "failed" || cached.sources.keywordCompetitor.status === "awaiting_confirmation")) {
          keywordCompetitor = { ...cached.sources.keywordCompetitor };
        }
      }
    }

    const sources: ResearchOrchestratorSources = {
      amazon,
      keywordCompetitor,
      voc,
      sourcing1688,
    };

    const overallStatus = computeOverallStatus(sources);

    return {
      taskId,
      action,
      overallStatus,
      sources,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    // 4. 确保释放并发锁
    if (action === "orchestrate") {
      RUNNING_ORCHESTRATIONS.delete(taskId);
    }
  }
}
