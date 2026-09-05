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
} from "@/lib/server/browserEvidenceCollect";
import {
  resolveBrowserAcquisitionCapability,
} from "@/lib/server/acquisitionCapability";
import {
  DEMO_ACQUISITION_EVIDENCE_ID,
  buildDemoBrowserCollectPreview,
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
  type BrowserUseKeywordPreviewItem,
} from "@/lib/server/browserUseResearch";
import { runSellerSpriteCollection } from "@/tools/collectors/browser-use/sellerSpriteCollector";
import {
  runAmazonCompetitorCollection,
  amazonCompetitorObservationToPreview,
} from "@/tools/collectors/browser-use/amazonCompetitorCollector";
import { getRuntimeMode } from "@/lib/server/runtimeMode";

// 来源 3：VOC Review Evidence
import {
  getReviewEvidence,
} from "@/lib/server/reviewEvidence";

// 来源 4：1688 Sourcing Evidence
import {
  getSourcingEvidence,
  findPendingSourcingPreview,
} from "@/lib/server/sourcingEvidence";

export type SourceStatus =
  | "ready"
  | "running"
  | "awaiting_confirmation"
  | "needs_user"
  | "failed";

export type OrchestratorAction = "inspect" | "orchestrate";

export type OrchestratorSourceDetail = {
  status: SourceStatus;
  message?: string;
  previewId?: string | null;
  hasEvidence?: boolean;
  itemCount?: number;
  error?: {
    code: string;
    message: string;
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
  // 防止未经处理的原生堆栈暴露，只保留第一行有界描述
  const firstLine = msg.split("\n")[0] ?? msg;
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "..." : firstLine;
}

/* ── 并发锁与幂等运行账本 ──────────────────────────────────────────────── */

const RUNNING_ORCHESTRATIONS = new Map<string, number>();
const RUNNING_TIMEOUT_MS = 5 * 60 * 1000; // 5分钟自愈超时，防止单次异常阻断后续

export function isOrchestrationRunning(taskId: string): boolean {
  const startedAt = RUNNING_ORCHESTRATIONS.get(taskId);
  if (!startedAt) return false;
  if (Date.now() - startedAt > RUNNING_TIMEOUT_MS) {
    RUNNING_ORCHESTRATIONS.delete(taskId);
    return false;
  }
  return true;
}

export function _clearOrchestratorRunningStateForTests(): void {
  RUNNING_ORCHESTRATIONS.clear();
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

    // 3. inspect 模式仅检查状态，不执行采集
    if (action === "inspect") {
      return {
        status: "needs_user",
        hasEvidence: false,
        message: "待采集 Amazon 详情资料",
      };
    }

    // 4. orchestrate 模式：尝试采集 Preview（严格不自动确认入库）
    if (context.mode === "demo") {
      // Demo 模式回放预置 preview
      const preview = buildDemoBrowserCollectPreview(asin);
      storeBrowserEvidencePreview({
        evidenceId: DEMO_ACQUISITION_EVIDENCE_ID,
        preview,
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey: `visitor:${context.demoAccessId}`,
        taskId,
        asin,
      });
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: DEMO_ACQUISITION_EVIDENCE_ID,
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
      subjectKey: "owner:v1",
      taskId,
      asin,
    });

    return {
      status: "awaiting_confirmation",
      hasEvidence: false,
      previewId: evidenceId,
      message: "Amazon 详情采集完成，等待人工确认",
    };
  } catch (error) {
    return {
      status: "failed",
      hasEvidence: false,
      error: {
        code: "amazon_collect_failed",
        message: sanitizeErrorMessage(error),
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
    const hasComp = compEvidence !== null && compEvidence.asins.length > 0;
    const hasKw = kwEvidence !== null && kwEvidence.rows.length > 0;

    if (hasComp && hasKw) {
      return {
        status: "ready",
        hasEvidence: true,
        itemCount: compEvidence.asins.length + kwEvidence.rows.length,
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
    const pendingPreview = findPendingBrowserUsePreview(seed.asin);
    if (pendingPreview !== null) {
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: pendingPreview.previewId,
        itemCount: Array.isArray(pendingPreview.preview.results)
          ? pendingPreview.preview.results.length
          : 0,
        message: "关键词与竞品已有待确认采集预览",
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
      return {
        status: "failed",
        hasEvidence: false,
        error: {
          code: "seller_sprite_keyword_failed",
          message:
            kwRun.failureReason === "collector_unavailable"
              ? "SellerSprite 采集引擎不可用（未启动或超时）"
              : "SellerSprite 关键词采集失败：未获得有效页面观察",
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
        error: {
          code: "no_reliable_search_keyword",
          message: "SellerSprite 关键词没有可用的非品牌查询词，已停止",
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
      return {
        status: "failed",
        hasEvidence: false,
        error: {
          code: "amazon_competitor_collect_failed",
          message:
            compRun.failureReason === "collector_unavailable"
              ? "Amazon 竞品采集引擎不可用（未启动或超时）"
              : "Amazon 搜索采集失败：未获得有效页面观察",
        },
      };
    }

    // ④ 组装并暂存 Preview 供人工确认（严禁任何自动确认保存！）
    const competitorPreview = amazonCompetitorObservationToPreview(
      { seedAsin: seed.asin, marketplaceTld: marketplaceToAmazonTld(seed.marketplace), keyword },
      compRun.observation,
      kwRun.preview.collector.version,
    );
    const competitorPreviewId = storeBrowserUsePreview(competitorPreview);
    storeBrowserUsePreview(kwRun.preview);

    return {
      status: "awaiting_confirmation",
      hasEvidence: false,
      previewId: competitorPreviewId,
      itemCount: competitorPreview.results.length,
      message: "关键词与竞品预览已生成，等待人工确认",
    };
  } catch (error) {
    // 捕获所有未知异常，实现严格的 Failure Isolation，绝不向外抛出 500
    return {
      status: "failed",
      hasEvidence: false,
      error: {
        code: "keyword_competitor_failed",
        message: sanitizeErrorMessage(error),
      },
    };
  }
}

/* ── Source 3: VOC 买家评论处理 ─────────────────────────────────────────── */

async function handleVocSource(
  context: AccessContext,
  taskId: string,
  _action: OrchestratorAction,
): Promise<OrchestratorSourceDetail> {
  try {
    const reviewEv = await getReviewEvidence(context, taskId);
    if (reviewEv !== null && reviewEv.dataset.reviews.length > 0) {
      return {
        status: "ready",
        hasEvidence: true,
        itemCount: reviewEv.dataset.reviews.length,
        message: "买家评论样本已就绪",
      };
    }

    // 评论采集属于半自动/人工导入，通常需用户选定 ASIN 或粘贴样本
    return {
      status: "needs_user",
      hasEvidence: false,
      message: "需要用户选择待分析 ASIN 或导入评论样本",
    };
  } catch (error) {
    return {
      status: "failed",
      hasEvidence: false,
      error: {
        code: "voc_check_failed",
        message: sanitizeErrorMessage(error),
      },
    };
  }
}

/* ── Source 4: 1688 货源处理 ───────────────────────────────────────────── */

async function handleSourcingSource(
  context: AccessContext,
  taskId: string,
  _action: OrchestratorAction,
): Promise<OrchestratorSourceDetail> {
  try {
    // 1. 检查已保存的正式货源证据
    const sourcingEv = await getSourcingEvidence(context, taskId);
    if (sourcingEv !== null && sourcingEv.humanConfirmed.length > 0) {
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
      return {
        status: "awaiting_confirmation",
        hasEvidence: false,
        previewId: pending.previewId,
        itemCount: pending.candidates.length,
        message: "1688 货源已有待确认预览",
      };
    }

    // 3. 1688 找货需要指定具体搜词或图片，暂无输入时标记 needs_user
    return {
      status: "needs_user",
      hasEvidence: false,
      message: "待搜索或导入 1688 货源",
    };
  } catch (error) {
    return {
      status: "failed",
      hasEvidence: false,
      error: {
        code: "sourcing_check_failed",
        message: sanitizeErrorMessage(error),
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
    const [amazon, keywordCompetitor, voc, sourcing1688] = await Promise.all([
      handleAmazonSource(options.context, taskId, action),
      handleKeywordCompetitorSource(options.context, taskId, task.resultJson, action),
      handleVocSource(options.context, taskId, action),
      handleSourcingSource(options.context, taskId, action),
    ]);

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
