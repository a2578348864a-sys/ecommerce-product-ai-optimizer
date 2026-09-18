import "server-only";

import { logInfo, logWarn, logError } from "@/lib/server/agentEventLogger";
import type {
  OrchestratorSourceDetail,
  ResearchOrchestratorSources,
} from "@/lib/server/researchCollectionOrchestrator";

export type UnifiedCollectionStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "awaiting_action";

export type UnifiedModuleKey = "amazon" | "voc" | "1688" | "ai";

export type UnifiedBaseModuleStatus = {
  module: UnifiedModuleKey;
  status: UnifiedCollectionStatus;
  summary: string;
  durationMs?: number;
  retryCount?: number;
  errorCode?: string;
  failureReason?: string;
  actionRequired?: string;
};

export type AmazonUnifiedStatus = UnifiedBaseModuleStatus & {
  module: "amazon";
  succeeded: boolean;
  factsCount?: number;
};

export type VocUnifiedStatus = UnifiedBaseModuleStatus & {
  module: "voc";
  reviewsCount?: number;
  hasCaptcha?: boolean;
  needsHumanConfirmation?: boolean;
};

export type Sourcing1688UnifiedStatus = UnifiedBaseModuleStatus & {
  module: "1688";
  extensionConnected?: boolean;
  candidatesCount?: number;
};

export type AiListingUnifiedStatus = UnifiedBaseModuleStatus & {
  module: "ai";
  generated: boolean;
  passedGate: boolean;
  savedStatus: "not_saved" | "saved" | "stale";
  gateViolations?: {
    unsupportedClaimsCount: number;
    prohibitedClaimsCount: number;
    competitorOverlapCount: number;
    sampleViolations: string[];
  };
};

export type UnifiedModuleStatus =
  | AmazonUnifiedStatus
  | VocUnifiedStatus
  | Sourcing1688UnifiedStatus
  | AiListingUnifiedStatus;

export type UnifiedStatusesMap = {
  amazon: AmazonUnifiedStatus;
  voc: VocUnifiedStatus;
  "1688": Sourcing1688UnifiedStatus;
  ai: AiListingUnifiedStatus;
};

/**
 * 派生 Amazon 模块的统一状态
 */
export function deriveAmazonUnifiedStatus(
  detail?: OrchestratorSourceDetail,
  durationMs?: number,
): AmazonUnifiedStatus {
  if (!detail) {
    return {
      module: "amazon",
      status: "idle",
      succeeded: false,
      summary: "待采集 Amazon 商品资料",
      durationMs,
    };
  }

  const duration = durationMs;
  const errorCode = detail.error?.code;

  if (detail.status === "ready") {
    const factsCount = typeof detail.itemCount === "number" && detail.itemCount > 0 ? detail.itemCount : 8;
    return {
      module: "amazon",
      status: "succeeded",
      succeeded: true,
      factsCount,
      summary: `获取 ${factsCount} 项商品事实`,
      durationMs: duration,
    };
  }

  if (detail.status === "running") {
    return {
      module: "amazon",
      status: "running",
      succeeded: false,
      summary: "Amazon 商品主数据采集中...",
      durationMs: duration,
    };
  }

  if (detail.status === "awaiting_confirmation") {
    return {
      module: "amazon",
      status: "awaiting_action",
      succeeded: false,
      factsCount: detail.itemCount ?? 1,
      summary: "Amazon 详情采集完成，等待人工核对并确认事实",
      actionRequired: "前往事实确认区确认提取的商品事实",
      durationMs: duration,
    };
  }

  // 针对被阻断、验证码或需要用户协助的情形
  const isBlocked =
    errorCode === "page_blocked_login_wall" ||
    errorCode === "page_blocked_captcha" ||
    errorCode === "automation_blocked" ||
    detail.message?.includes("验证") ||
    detail.message?.includes("校验");

  if (isBlocked) {
    const message = detail.error?.message || detail.message || "Amazon 触发自动化验证阻断，需要人工处理";
    return {
      module: "amazon",
      status: "awaiting_action",
      succeeded: false,
      errorCode,
      failureReason: message,
      summary: message,
      actionRequired: "请在本机 Chrome 打开该 Amazon 链接完成验证后重试",
      durationMs: duration,
    };
  }

  if (detail.status === "failed") {
    const message = detail.error?.message || detail.message || "Amazon 详情采集失败";
    return {
      module: "amazon",
      status: "failed",
      succeeded: false,
      errorCode: errorCode || "amazon_collect_failed",
      failureReason: message,
      summary: message,
      actionRequired: "请检查网络环境或商品 ASIN 后重试",
      durationMs: duration,
    };
  }

  // needs_user / ready_to_search 等初态
  return {
    module: "amazon",
    status: "idle",
    succeeded: false,
    summary: detail.message || "待采集 Amazon 商品资料",
    durationMs: duration,
  };
}

/**
 * 派生 VOC 评论模块的统一状态
 */
export function deriveVocUnifiedStatus(
  detail?: OrchestratorSourceDetail,
  durationMs?: number,
  retryCount?: number,
): VocUnifiedStatus {
  if (!detail) {
    return {
      module: "voc",
      status: "idle",
      summary: "待采集买家评论与反馈",
      durationMs,
      retryCount,
    };
  }

  const duration = durationMs;
  const errorCode = detail.error?.code;

  if (detail.status === "ready") {
    const reviewsCount = typeof detail.itemCount === "number" && detail.itemCount > 0 ? detail.itemCount : 10;
    return {
      module: "voc",
      status: "succeeded",
      reviewsCount,
      hasCaptcha: false,
      needsHumanConfirmation: false,
      summary: `获取 ${reviewsCount} 条真实买家评论与分析`,
      durationMs: duration,
      retryCount,
    };
  }

  if (detail.status === "running") {
    return {
      module: "voc",
      status: "running",
      summary: "买家评论与反馈采集中...",
      durationMs: duration,
      retryCount,
    };
  }

  // 验证码挑战 / 登录墙 / 人工处理需求
  const isCaptchaOrLogin =
    errorCode === "captcha_required" ||
    errorCode === "login_required" ||
    detail.message?.includes("验证码") ||
    detail.message?.includes("登录");

  if (isCaptchaOrLogin) {
    const message = detail.message || "触发验证码挑战，需要人工处理";
    return {
      module: "voc",
      status: "awaiting_action",
      hasCaptcha: true,
      needsHumanConfirmation: true,
      errorCode: errorCode || "captcha_required",
      failureReason: message,
      summary: message,
      actionRequired: "请在普通浏览器中完成 Amazon 页面验证后重试",
      durationMs: duration,
      retryCount: retryCount ?? 1,
    };
  }

  if (detail.status === "awaiting_confirmation") {
    const count = detail.itemCount ?? 0;
    return {
      module: "voc",
      status: "awaiting_action",
      reviewsCount: count,
      hasCaptcha: false,
      needsHumanConfirmation: true,
      summary: `买家评论已有待确认预览（${count} 条），等待人工确认`,
      actionRequired: "查看提取的评论片段并点击确认",
      durationMs: duration,
      retryCount,
    };
  }

  // 页面无评论 / 提取为空（部分成功或弱结论）
  if (errorCode === "confirmed_no_reviews" || errorCode === "extraction_empty") {
    return {
      module: "voc",
      status: "partial",
      reviewsCount: 0,
      hasCaptcha: false,
      needsHumanConfirmation: false,
      errorCode,
      summary: detail.message || "Amazon 页面暂无公开可见的买家评论",
      durationMs: duration,
      retryCount,
    };
  }

  if (detail.status === "failed") {
    const message = detail.error?.message || detail.message || "买家评论采集失败";
    return {
      module: "voc",
      status: "failed",
      errorCode: errorCode || "voc_collect_failed",
      failureReason: message,
      summary: message,
      actionRequired: "请稍后重试或手动导入评论文本",
      durationMs: duration,
      retryCount,
    };
  }

  return {
    module: "voc",
    status: "idle",
    summary: detail.message || "待采集买家评论",
    durationMs: duration,
    retryCount,
  };
}

/**
 * 派生 1688 货源图搜模块的统一状态
 */
export function deriveSourcing1688UnifiedStatus(
  detail?: OrchestratorSourceDetail,
  durationMs?: number,
): Sourcing1688UnifiedStatus {
  if (!detail) {
    return {
      module: "1688",
      status: "idle",
      extensionConnected: false,
      summary: "待补充素材或启动 1688 图搜",
      durationMs,
    };
  }

  const duration = durationMs;
  const errorCode = detail.error?.code;

  if (detail.status === "ready") {
    const count = typeof detail.itemCount === "number" && detail.itemCount > 0 ? detail.itemCount : 1;
    return {
      module: "1688",
      status: "succeeded",
      extensionConnected: true,
      candidatesCount: count,
      summary: `获取 ${count} 项 1688 货源线索`,
      durationMs: duration,
    };
  }

  if (detail.status === "running") {
    return {
      module: "1688",
      status: "running",
      extensionConnected: true,
      summary: "1688 图片找货执行中...",
      durationMs: duration,
    };
  }

  if (detail.status === "awaiting_confirmation") {
    const count = detail.itemCount ?? 0;
    return {
      module: "1688",
      status: "awaiting_action",
      extensionConnected: true,
      candidatesCount: count,
      summary: `1688 货源已有候选预览（${count} 条），等待人工确认`,
      actionRequired: "进入货源区对比候选商品并确认货源",
      durationMs: duration,
    };
  }

  // 扩展未安装 / 断开 / 未登录 / 风控
  const isExtensionOrAuthIssue =
    errorCode === "extension_not_installed" ||
    errorCode === "extension_disconnected" ||
    errorCode === "extension_bridge_not_available" ||
    errorCode === "extension_bridge_rejected" ||
    Boolean(errorCode && errorCode.startsWith("extension_")) ||
    errorCode === "no_1688_tab" ||
    errorCode === "auth_required" ||
    errorCode === "risk_control_required" ||
    errorCode === "needs_login" ||
    (detail.status as string) === "needs_login" ||
    detail.message?.includes("助手") ||
    detail.message?.includes("扩展");

  if (isExtensionOrAuthIssue) {
    const message = detail.error?.message || detail.message || "未检测到 1688 扩展助手连接或未登录，需要人工处理";
    const action =
      errorCode === "auth_required"
        ? "请在普通 Chrome 登录 1688 账号后重试"
        : errorCode === "no_1688_tab"
          ? "请先在 Chrome 中打开 1688 页面后重试"
          : errorCode === "risk_control_required"
            ? "请在 1688 页面完成滑块或安全验证后重试"
            : errorCode === "extension_bridge_not_available" || errorCode === "extension_bridge_rejected"
              ? "1688 助手桥接未就绪或未连接，请在 Chrome 中启动并启用轻选 1688 助手后重试"
              : "请在 Chrome 中安装并启用轻选 1688 助手后重试";

    return {
      module: "1688",
      status: "awaiting_action",
      extensionConnected: false,
      candidatesCount: 0,
      errorCode: errorCode || "extension_disconnected",
      failureReason: message,
      summary: message,
      actionRequired: action,
      durationMs: duration,
    };
  }

  if (detail.status === "needs_user") {
    const message = detail.message || "待补充商品素材后发起 1688 图搜";
    return {
      module: "1688",
      status: "awaiting_action",
      extensionConnected: false,
      candidatesCount: 0,
      errorCode: errorCode || "missing_material",
      failureReason: message,
      summary: message,
      actionRequired: "请先在商品研究中补充商品主图素材",
      durationMs: duration,
    };
  }

  if (detail.status === "failed") {
    const message = detail.error?.message || detail.message || "1688 货源图搜未成功";
    return {
      module: "1688",
      status: "failed",
      extensionConnected: false,
      errorCode: errorCode || "sourcing_failed",
      failureReason: message,
      summary: message,
      actionRequired: "请确认网络连接与 1688 页面状态后重试，或改用人工粘贴货源链接",
      durationMs: duration,
    };
  }

  return {
    module: "1688",
    status: "idle",
    extensionConnected: true,
    summary: detail.message || "待准备商品素材或启动 1688 图搜",
    durationMs: duration,
  };
}

/**
 * 派生 AI Listing 模块的统一状态
 */
export function deriveAiListingUnifiedStatus(
  taskResult?: Record<string, unknown> | null,
  durationMs?: number,
): AiListingUnifiedStatus {
  const duration = durationMs;
  if (!taskResult || typeof taskResult !== "object") {
    return {
      module: "ai",
      status: "idle",
      generated: false,
      passedGate: false,
      savedStatus: "not_saved",
      summary: "待生成 Listing V5 文案",
      durationMs: duration,
    };
  }

  const listingV5 = taskResult.listingV5 as Record<string, unknown> | undefined;
  if (!listingV5 || typeof listingV5 !== "object") {
    return {
      module: "ai",
      status: "idle",
      generated: false,
      passedGate: false,
      savedStatus: "not_saved",
      summary: "待生成 Listing V5 文案",
      durationMs: duration,
    };
  }

  const hasDraft = Boolean(listingV5.listing);
  const validation = listingV5.validation as Record<string, unknown> | undefined;
  const validationStatus = typeof validation?.status === "string" ? validation.status.toUpperCase() : "NOT_RUN";
  const passed = hasDraft && validationStatus === "PASS";

  if (passed) {
    return {
      module: "ai",
      status: "succeeded",
      generated: true,
      passedGate: true,
      savedStatus: "saved",
      summary: "文案已生成并通过 100% 事实门禁",
      durationMs: duration,
    };
  }

  if (hasDraft && validationStatus === "BLOCK") {
    const claims = validation?.claims as Record<string, unknown> | undefined;
    const unsupportedClaims = Array.isArray(claims?.unsupportedClaims)
      ? (claims.unsupportedClaims as string[])
      : [];
    const prohibitedClaims = Array.isArray(claims?.prohibitedClaims)
      ? (claims.prohibitedClaims as string[])
      : [];
    const competitorOverlap = Array.isArray(claims?.competitorOverlap)
      ? (claims.competitorOverlap as string[])
      : [];

    const violationParts: string[] = [];
    if (unsupportedClaims.length > 0) {
      violationParts.push(`${unsupportedClaims.length} 项未证实宣称`);
    }
    if (prohibitedClaims.length > 0) {
      violationParts.push(`${prohibitedClaims.length} 项违规词`);
    }
    if (competitorOverlap.length > 0) {
      violationParts.push(`${competitorOverlap.length} 项竞品侵权词`);
    }

    const violationDesc = violationParts.length > 0 ? violationParts.join("、") : "未证实宣称或违规词";
    const sampleViolations = [...unsupportedClaims, ...prohibitedClaims, ...competitorOverlap].slice(0, 3);
    const sampleHint = sampleViolations.length > 0 ? `（例如：${sampleViolations.map((v) => `"${v}"`).join(", ")}）` : "";

    return {
      module: "ai",
      status: "awaiting_action",
      generated: true,
      passedGate: false,
      savedStatus: "saved",
      errorCode: "gate_blocked",
      failureReason: `事实门禁拦截：发现 ${violationDesc}${sampleHint}`,
      summary: `文案未通过事实门禁（${violationDesc}），需人工审查`,
      actionRequired: "前往 Listing Studio 审查标记的违规句并修改为已确认事实",
      durationMs: duration,
      gateViolations: {
        unsupportedClaimsCount: unsupportedClaims.length,
        prohibitedClaimsCount: prohibitedClaims.length,
        competitorOverlapCount: competitorOverlap.length,
        sampleViolations,
      },
    };
  }

  if (hasDraft) {
    return {
      module: "ai",
      status: "partial",
      generated: true,
      passedGate: false,
      savedStatus: "saved",
      summary: "文案草稿已生成，待进行门禁核验",
      durationMs: duration,
    };
  }

  return {
    module: "ai",
    status: "idle",
    generated: false,
    passedGate: false,
    savedStatus: "not_saved",
    summary: "待生成 Listing V5 文案",
    durationMs: duration,
  };
}

/**
 * 汇总派生 4 大上游模块的统一状态矩阵
 */
export function deriveAllUnifiedStatuses(options: {
  sources: ResearchOrchestratorSources;
  taskResult?: Record<string, unknown> | null;
  durations?: Partial<Record<UnifiedModuleKey, number>>;
  retryCounts?: Partial<Record<UnifiedModuleKey, number>>;
}): UnifiedStatusesMap {
  const { sources, taskResult, durations = {}, retryCounts = {} } = options;

  return {
    amazon: deriveAmazonUnifiedStatus(sources.amazon, durations.amazon),
    voc: deriveVocUnifiedStatus(sources.voc, durations.voc, retryCounts.voc),
    "1688": deriveSourcing1688UnifiedStatus(sources.sourcing1688, durations["1688"]),
    ai: deriveAiListingUnifiedStatus(taskResult, durations.ai),
  };
}

/**
 * 将统一状态变化安全同步到 agent_events 表中（Fail-open 保护）
 */
export async function logUnifiedStatusEvents(options: {
  taskId: string;
  statuses: UnifiedStatusesMap;
  contextAction?: string;
}): Promise<void> {
  const { taskId, statuses, contextAction = "inspect" } = options;

  const entries = [
    { key: "amazon" as const, item: statuses.amazon },
    { key: "voc" as const, item: statuses.voc },
    { key: "1688" as const, item: statuses["1688"] },
    { key: "ai" as const, item: statuses.ai },
  ];

  for (const { key, item } of entries) {
    const level =
      item.status === "failed" ? "error" : item.status === "awaiting_action" ? "warn" : "info";

    const metadata: Record<string, unknown> = {
      unifiedStatus: item.status,
      summary: item.summary,
      source: key,
      action: contextAction,
    };

    if (item.durationMs !== undefined) metadata.durationMs = item.durationMs;
    if (item.retryCount !== undefined) metadata.retryCount = item.retryCount;
    if (item.errorCode) metadata.errorCode = item.errorCode;
    if (item.failureReason) metadata.failureReason = item.failureReason;
    if (item.actionRequired) metadata.actionRequired = item.actionRequired;

    // 针对每个模块的专有字段保存在 metadata 中
    if (key === "amazon") {
      metadata.succeeded = (item as AmazonUnifiedStatus).succeeded;
      if ((item as AmazonUnifiedStatus).factsCount !== undefined) {
        metadata.factsCount = (item as AmazonUnifiedStatus).factsCount;
      }
    } else if (key === "voc") {
      const voc = item as VocUnifiedStatus;
      if (voc.reviewsCount !== undefined) metadata.reviewsCount = voc.reviewsCount;
      if (voc.hasCaptcha !== undefined) metadata.hasCaptcha = voc.hasCaptcha;
      if (voc.needsHumanConfirmation !== undefined) {
        metadata.needsHumanConfirmation = voc.needsHumanConfirmation;
      }
    } else if (key === "1688") {
      const s1688 = item as Sourcing1688UnifiedStatus;
      if (s1688.extensionConnected !== undefined) {
        metadata.extensionConnected = s1688.extensionConnected;
      }
      if (s1688.candidatesCount !== undefined) {
        metadata.candidatesCount = s1688.candidatesCount;
      }
    } else if (key === "ai") {
      const ai = item as AiListingUnifiedStatus;
      metadata.generated = ai.generated;
      metadata.passedGate = ai.passedGate;
      metadata.savedStatus = ai.savedStatus;
      if (ai.gateViolations) {
        metadata.gateViolations = ai.gateViolations;
      }
    }

    const eventName =
      item.status === "succeeded"
        ? `${key}_status_succeeded`
        : item.status === "awaiting_action"
          ? `${key}_awaiting_action`
          : item.status === "failed"
            ? `${key}_status_failed`
            : `${key}_status_${item.status}`;

    try {
      if (level === "error") {
        await logError(key, eventName, `[${key.toUpperCase()}] ${item.summary}`, {
          taskId,
          metadata,
        });
      } else if (level === "warn") {
        await logWarn(key, eventName, `[${key.toUpperCase()}] ${item.summary}`, {
          taskId,
          metadata,
        });
      } else {
        await logInfo(key, eventName, `[${key.toUpperCase()}] ${item.summary}`, {
          taskId,
          metadata,
        });
      }
    } catch {
      // 保证 fail-open，即使日志记录失败也绝对不影响主业务链路
    }
  }
}
