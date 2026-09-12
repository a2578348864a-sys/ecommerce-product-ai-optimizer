"use client";

/**
 * Phase 3 — 研究资料编排卡片（ResearchCollectionOrchestratorCard）
 *
 * 位于商品研究详情页资料区顶部（分类导航/当前资料之上），
 * 提供克制、专业的四项核心研究资料状态概览与一键编排入口。
 * 遵循沉稳 B2B 风格（Slate / Neutral），Emerald 仅用于成功状态，Amber 用于待处理/待确认，Rose 用于失败。
 * 绝不自动代为确认用户数据，发现新 Preview 时引导用户前往对应区域人工复核。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  AlertTriangle,
  Circle,
  XCircle,
  RotateCw,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  derivePendingReviewQueue,
  deriveNeedsUserQueue,
  type PendingQueueItem,
  type NeedsUserQueueItem,
} from "@/lib/evidence/pendingReviewQueue";
import type { ResearchOrchestratorSources } from "@/lib/server/researchCollectionOrchestrator";

/* ── 类型定义 ─────────────────────────────────────────── */

export type OrchestratorSourceKey =
  | "amazon"
  | "keywords_competitors"
  | "voc"
  | "sourcing_1688";

export type OrchestratorSourceState =
  | "ready" // ✓ 已有
  | "needs_supplement" // ⚠ 需要补充 (Amazon)
  | "pending_review" // ⚠ 待确认 (关键词与竞品 / 1688)
  | "pending" // ○ 待补齐 (关键词与竞品)
  | "failed" // ❌ 失败 (关键词与竞品 / Amazon / VOC)
  | "needs_action" // ⚠ 需要处理 (VOC)
  | "needs_login" // ⚠ 需要登录 (1688)
  | "needs_user" // ⚠ 需要人工处理
  | "ready_to_search" // ⚡ 图搜已就绪 (1688)
  | "confirmed_no_reviews" // ○ 页面明确无公开评论 (VOC)
  | "extraction_empty" // ⚠ 评论模块未完成提取 (VOC)
  | "no_public_reviews" // legacy：历史结果未能确认是否无评论
  | "running"; // ⚡ 执行中

export type OrchestratorSourceItem = {
  key: OrchestratorSourceKey;
  title: string;
  state: OrchestratorSourceState;
  stateLabel?: string;
  detail?: string;
  anchorId: string;
  tabKey: "market" | "buyers" | "sourcing" | "cost-risk";
  previewId?: string | null;
  canRetry?: boolean;
};

export type OrchestratorSummary = {
  text: string;
  reusedCount: number;
  pendingReviewCount: number;
  manualActionCount: number;
  allReady: boolean;
};

export type ResearchCollectionOrchestratorCardProps = {
  taskId: string;
  onDataChanged?: () => void;
  onNavigate?: (tab: "market" | "buyers" | "sourcing" | "cost-risk", anchorId?: string) => void;
  className?: string;
  /** 供单元测试或外部注入初始状态 */
  initialData?: {
    summary?: string;
    items?: Partial<Record<OrchestratorSourceKey, { state: OrchestratorSourceState; detail?: string }>>;
    hasNewPreview?: boolean;
    rawSources?: ResearchOrchestratorSources;
  };
  /** 测试时跳过自动 inspect */
  skipAutoInspect?: boolean;
  /** 外部驱动的数据版本号，递增且大于0时自动重新 inspect 刷新状态 */
  dataRevision?: number;
};

/* ── 权威元数据定义 ───────────────────────────────────── */

const SOURCE_META: Record<
  OrchestratorSourceKey,
  {
    title: string;
    anchorId: string;
    tabKey: "market" | "buyers" | "sourcing" | "cost-risk";
    defaultState: OrchestratorSourceState;
    allowedStates: ReadonlySet<OrchestratorSourceState>;
  }
> = {
  amazon: {
    title: "Amazon 商品资料",
    // 统一入口生成的待确认 Preview 最终在事实确认区提供动作；
    // 避免用户被带到只读的原始证据区后看到“待确认 0 项”。
    anchorId: "fact-candidate-review",
    tabKey: "market",
    defaultState: "needs_supplement",
    allowedStates: new Set(["ready", "pending_review", "needs_supplement", "needs_user", "failed", "running"]),
  },
  keywords_competitors: {
    title: "关键词与竞品",
    anchorId: "formal-v2-market-evidence",
    tabKey: "market",
    defaultState: "pending",
    allowedStates: new Set(["ready", "pending_review", "pending", "failed", "needs_user", "running"]),
  },
  voc: {
    title: "买家评论 / VOC",
    anchorId: "formal-v2-buyer-evidence",
    tabKey: "buyers",
    defaultState: "needs_action",
    allowedStates: new Set(["ready", "pending_review", "needs_action", "needs_user", "failed", "confirmed_no_reviews", "extraction_empty", "no_public_reviews", "running"]),
  },
  sourcing_1688: {
    title: "1688 供应链",
    anchorId: "formal-v2-sourcing-evidence",
    tabKey: "sourcing",
    defaultState: "pending_review",
    allowedStates: new Set(["ready", "pending_review", "needs_login", "needs_user", "ready_to_search", "failed", "running"]),
  },
};

const ORDERED_KEYS: OrchestratorSourceKey[] = [
  "amazon",
  "keywords_competitors",
  "voc",
  "sourcing_1688",
];

/* ── 脱敏与字段提取工具 ───────────────────────────────── */

/**
 * 敏感信息与堆栈脱敏清理
 * 过滤消除任何堆栈信息、本地绝对路径（如 C:\...）、token/cookie/auth 等敏感字样，
 * 若命中脏信息则安全降级为“采集未成功，请稍后重试”。
 */
export function sanitizeDetail(text?: string): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // 1. 堆栈信息检测（如 "at ...", "Error: ...", "Traceback"）
  const hasStack =
    /\b(?:at\s+[a-zA-Z0-9_$]+|\.js:\d+|\.ts:\d+|Traceback\s+\(most\s+recent\s+call\s+last\)|(?:Syntax|Type|Reference|Range|Internal)?Error:)/i.test(
      trimmed,
    ) || /^\s*at\s+/m.test(trimmed);

  // 2. 本地绝对路径检测（如 "C:\...", "D:/...", "/Users/...", "/home/..."）
  const hasAbsolutePath =
    /(?:[a-zA-Z]:[\\/]|(?:^|[^\w])\/(?:Users|home|var|tmp|etc|app|node_modules|root)[\\/])/i.test(
      trimmed,
    );

  // 3. 敏感凭证/鉴权信息检测（如 token, cookie, auth, bearer, password 等）
  const hasSecret =
    /\b(?:token|cookie|auth|authorization|bearer|password|passwd|secret|api[-_]?key)\b/i.test(
      trimmed,
    );

  if (hasStack || hasAbsolutePath || hasSecret) {
    return "采集未成功，请稍后重试";
  }

  return trimmed;
}

/**
 * 从后端响应载荷中按优先级提取明细信息
 * 优先级：
 * 1. detail (string && trim)
 * 2. message (string && trim)
 * 3. error.message (string && trim)
 */
export function extractDetailFromPayload(itemVal: unknown): string | undefined {
  if (typeof itemVal !== "object" || itemVal === null) return undefined;
  const iv = itemVal as Record<string, unknown>;

  if (typeof iv.detail === "string" && iv.detail.trim()) {
    return iv.detail.trim();
  }
  if (typeof iv.message === "string" && iv.message.trim()) {
    return iv.message.trim();
  }
  if (
    iv.error &&
    typeof iv.error === "object" &&
    iv.error !== null &&
    "message" in iv.error &&
    typeof (iv.error as { message: unknown }).message === "string" &&
    (iv.error as { message: string }).message.trim()
  ) {
    return (iv.error as { message: string }).message.trim();
  }
  return undefined;
}

/**
 * 将任意数据源载荷规范化为标准 ResearchOrchestratorSources
 */
export function normalizeSourcesToRaw(
  sourcesObj: unknown,
): ResearchOrchestratorSources | undefined {
  if (typeof sourcesObj !== "object" || sourcesObj === null || Array.isArray(sourcesObj)) {
    return undefined;
  }
  const s = sourcesObj as Record<string, unknown>;
  const amazon = (s.amazon ?? {}) as Record<string, unknown>;
  const keywordCompetitor = (s.keywordCompetitor ?? s.keywords_competitors ?? s.keywords ?? {}) as Record<string, unknown>;
  const voc = (s.voc ?? {}) as Record<string, unknown>;
  const sourcing1688 = (s.sourcing1688 ?? s.sourcing_1688 ?? s.sourcing ?? {}) as Record<string, unknown>;

  const normDetail = (obj: Record<string, unknown>, defaultSourceKey: string) => {
    const rawStatus = (obj.status ?? obj.state ?? "idle") as string;
    let status = rawStatus;
    if (
      rawStatus === "pending_review" ||
      rawStatus === "待确认" ||
      rawStatus === "to_confirm" ||
      rawStatus === "preview" ||
      rawStatus === "awaiting_confirmation"
    ) {
      status = "awaiting_confirmation";
    } else if (
      rawStatus === "needs_action" ||
      rawStatus === "needs_login" ||
      rawStatus === "needs_supplement" ||
      rawStatus === "需要处理" ||
      rawStatus === "需要登录" ||
      rawStatus === "需要补充" ||
      rawStatus === "needs_user"
    ) {
      status = "needs_user";
    }
    const ready = Boolean(
      obj.ready ||
        status === "ready" ||
        status === "completed" ||
        status === "confirmed" ||
        rawStatus === "ready" ||
        rawStatus === "已有",
    );
    return {
      source: (obj.source as string) || defaultSourceKey,
      status: status as any,
      ready,
      message:
        typeof obj.message === "string"
          ? obj.message
          : typeof obj.detail === "string"
            ? obj.detail
            : undefined,
      itemCount:
        typeof obj.itemCount === "number"
          ? obj.itemCount
          : typeof obj.count === "number"
            ? obj.count
            : undefined,
      previewId: (obj.previewId as string) || null,
      storageVersion: (obj.storageVersion as string) || null,
      error: (obj.error as any) || null,
    };
  };

  return {
    amazon: normDetail(amazon, "amazon"),
    keywordCompetitor: normDetail(keywordCompetitor, "keyword_competitor"),
    voc: normDetail(voc, "voc"),
    sourcing1688: normDetail(sourcing1688, "sourcing_1688"),
  };
}

/* ── 状态归一化工具 ───────────────────────────────────── */

export function normalizeState(
  key: OrchestratorSourceKey,
  rawState?: unknown,
  rawReady?: unknown,
): OrchestratorSourceState {
  if (typeof rawState === "string") {
    const s = rawState.trim().toLowerCase();
    if (s === "ready" || s === "existing" || s === "已有" || s === "completed" || s === "confirmed") {
      return "ready";
    }
    if (s === "ready_to_search" || s === "可找货") {
      return "ready_to_search";
    }
    if (s === "needs_supplement" || s === "missing" || s === "需要补充") {
      return "needs_supplement";
    }
    if (s === "pending_review" || s === "to_confirm" || s === "待确认" || s === "preview" || s === "awaiting_confirmation") {
      return "pending_review";
    }
    if (s === "running" || s === "执行中" || s === "采集正在执行中") {
      return "running";
    }
    if (s === "pending" || s === "待补齐" || s === "idle") {
      return "pending";
    }
    if (s === "failed" || s === "error" || s === "失败") {
      return "failed";
    }
    if (s === "needs_action" || s === "需要处理") {
      return "needs_action";
    }
    if (s === "needs_login" || s === "unauthorized" || s === "需要登录") {
      return "needs_login";
    }
    if (s === "no_public_reviews") {
      return "no_public_reviews";
    }
    if (s === "confirmed_no_reviews") {
      return "confirmed_no_reviews";
    }
    if (s === "extraction_empty" || s === "no_reviews_extracted") {
      return "extraction_empty";
    }
    if (s === "needs_user") {
      if (key === "amazon") return "needs_supplement";
      if (key === "voc") return "needs_action";
      if (key === "sourcing_1688") return "needs_supplement";
      return "needs_user";
    }
  }
  if (typeof rawReady === "boolean") {
    if (rawReady) return "ready";
    return SOURCE_META[key].defaultState;
  }
  return SOURCE_META[key].defaultState;
}

export function formatBadgeLabel(
  state: OrchestratorSourceState,
  key?: OrchestratorSourceKey,
): {
  icon: "check" | "alert" | "circle" | "x" | "loader";
  text: string;
  variant: "emerald" | "amber" | "slate" | "rose";
} {
  if (state === "running") {
    return { icon: "loader", text: "⚡ 执行中", variant: "amber" };
  }
  if (state === "failed" && key === "amazon") {
    return { icon: "circle", text: "○ 获取失败", variant: "amber" };
  }
  switch (state) {
    case "ready":
      return { icon: "check", text: "✓ 已有", variant: "emerald" };
    case "ready_to_search":
      return { icon: "circle", text: "⚡ 图搜已就绪", variant: "amber" };
    case "needs_supplement":
      return { icon: "alert", text: "⚠ 需要补充", variant: "amber" };
    case "pending_review":
      return { icon: "alert", text: "⚠ 待确认", variant: "amber" };
    case "needs_action":
    case "needs_user":
      return { icon: "alert", text: "⚠ 需要处理", variant: "amber" };
    case "needs_login":
      return { icon: "alert", text: "⚠ 需要登录", variant: "amber" };
    case "pending":
      return { icon: "circle", text: "○ 待补齐", variant: "slate" };
    case "confirmed_no_reviews":
      return { icon: "circle", text: "○ 确认无公开评论", variant: "slate" };
    case "extraction_empty":
      return { icon: "alert", text: "⚠ 评论提取未完成", variant: "amber" };
    case "no_public_reviews":
      return { icon: "alert", text: "⚠ 评论状态未确认", variant: "amber" };
    case "failed":
      return { icon: "x", text: "❌ 失败", variant: "rose" };
  }
}

export function computeSummary(
  items: OrchestratorSourceItem[],
  serverText?: string,
): OrchestratorSummary {
  const reusedCount = items.filter((i) => i.state === "ready").length;
  const pendingReviewCount = items.filter((i) => i.state === "pending_review").length;
  const manualActionCount = items.filter(
    (i) =>
      i.state === "needs_action" ||
      i.state === "needs_login" ||
      i.state === "needs_supplement" ||
      i.state === "failed" ||
      i.state === "pending" ||
      i.state === "ready_to_search" ||
      i.state === "needs_user" ||
      i.state === "running" ||
      i.state === "extraction_empty" ||
      i.state === "no_public_reviews",
  ).length;

  const allReady = reusedCount === items.length;

  let text = "";
  if (serverText && serverText.trim()) {
    text = serverText.trim();
  } else if (allReady) {
    text = "全部资料已就绪";
  } else {
    const parts: string[] = [];
    if (pendingReviewCount > 0) {
      parts.push(`${pendingReviewCount} 项待确认`);
    }
    if (manualActionCount > 0) {
      parts.push(`${manualActionCount} 项需要处理`);
    }
    if (parts.length > 0) {
      text = parts.join(" · ");
    } else {
      text = `已就绪 ${reusedCount} 项`;
    }
  }

  return {
    text,
    reusedCount,
    pendingReviewCount,
    manualActionCount,
    allReady,
  };
}

export function getAmazonFailureReason(detail?: string): string {
  if (!detail) return "页面无法识别";
  const lower = detail.toLowerCase();
  if (lower.includes("captcha") || lower.includes("login") || lower.includes("验证")) {
    return "Amazon验证阻断";
  }
  if (lower.includes("asin")) {
    return "ASIN异常";
  }
  if (
    lower.includes("无法识别") ||
    lower.includes("未识别") ||
    lower.includes("容器") ||
    lower.includes("标题") ||
    lower.includes("page_unknown")
  ) {
    return "页面无法识别";
  }
  return detail;
}

function getSourceDescription(
  item: OrchestratorSourceItem,
  isRetrying: boolean,
  pendingItem?: PendingQueueItem,
  needsUserItem?: NeedsUserQueueItem,
): string {
  if (isRetrying) {
    return item.key === "keywords_competitors" ? "正在重新采集关键词与竞品…" : "正在重新采集资料…";
  }
  if (item.state === "running") {
    return item.detail || "正在执行资料采集…";
  }
  if (item.state === "ready") {
    return item.detail || (item.key === "amazon" ? "Amazon 详情资料已就绪" : "资料已就绪");
  }
  if (item.state === "ready_to_search") {
    return item.detail || "已准备商品素材，可进入 1688 图片找货";
  }
  if (item.state === "pending_review") {
    return pendingItem?.countText || item.detail || "存在待确认条目";
  }
  if (
    item.state === "needs_action" ||
    item.state === "needs_user" ||
    item.state === "needs_supplement" ||
    item.state === "needs_login"
  ) {
    return (
      needsUserItem?.reasonText ||
      item.detail ||
      (item.key === "sourcing_1688" ? "需要登录" : "需要人工处理")
    );
  }
  if (item.state === "failed") {
    if (item.key === "amazon") {
      return getAmazonFailureReason(item.detail);
    }
    return item.detail || "上次采集未完成";
  }
  if (item.state === "pending") {
    return item.detail || "待补齐";
  }
  if (item.state === "confirmed_no_reviews") {
    return item.detail || "页面明确显示无公开评论";
  }
  if (item.state === "extraction_empty") {
    return item.detail || "评论提取未完成，请重试";
  }
  if (item.state === "no_public_reviews") {
    return item.detail || "评论状态未确认，请重试";
  }
  return item.detail || "待补充";
}

/* ── 主组件 ───────────────────────────────────────────── */

export function ResearchCollectionOrchestratorCard({
  taskId,
  onDataChanged,
  onNavigate,
  className = "",
  initialData,
  skipAutoInspect = false,
  dataRevision,
}: ResearchCollectionOrchestratorCardProps) {
  const [isInspecting, setIsInspecting] = useState(false);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [retryingSource, setRetryingSource] = useState<OrchestratorSourceKey | null>(null);
  const isOrchestratingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasNewPreviewAlert, setHasNewPreviewAlert] = useState(Boolean(initialData?.hasNewPreview));
  const lastFeedbackFingerprintRef = useRef<string | null>(null);
  const [customSummaryText, setCustomSummaryText] = useState<string | undefined>(
    initialData?.summary,
  );

  // 保存最新的 rawSources（用于派生待确认队列与需要处理队列统计）
  const [rawSources, setRawSources] = useState<ResearchOrchestratorSources | undefined>(() => {
    if (initialData?.rawSources) return initialData.rawSources;
    if (initialData?.items) {
      return normalizeSourcesToRaw(initialData.items);
    }
    return undefined;
  });

  // 派生待确认与需人工处理的队列数据项（用于说明文字和计数）
  const pendingItems = useMemo(() => derivePendingReviewQueue(rawSources), [rawSources]);
  const needsUserItems = useMemo(() => deriveNeedsUserQueue(rawSources), [rawSources]);

  // 初始化 4 项状态
  const [rawItemStates, setRawItemStates] = useState<
    Record<OrchestratorSourceKey, { state: OrchestratorSourceState; detail?: string }>
  >(() => {
    const rawSrc = initialData?.rawSources;
    const rawMap: Partial<Record<OrchestratorSourceKey, unknown>> = {
      amazon: rawSrc?.amazon,
      keywords_competitors: rawSrc?.keywordCompetitor,
      voc: rawSrc?.voc,
      sourcing_1688: rawSrc?.sourcing1688,
    };

    const getStateAndDetail = (key: OrchestratorSourceKey) => {
      const explicit = initialData?.items?.[key];
      if (explicit) {
        return {
          state: explicit.state,
          detail: sanitizeDetail(explicit.detail),
        };
      }
      const fromSrc = rawMap[key];
      if (fromSrc && typeof fromSrc === "object") {
        const iv = fromSrc as Record<string, unknown>;
        const errorCode =
          iv.error && typeof iv.error === "object" && iv.error !== null
            ? (iv.error as Record<string, unknown>).code
            : undefined;
        const effectiveState =
          errorCode === "confirmed_no_reviews" ? "confirmed_no_reviews" :
            errorCode === "extraction_empty" || errorCode === "no_public_reviews" ? "extraction_empty" : iv.status ?? iv.state;
        const state = normalizeState(key, effectiveState, iv.ready);
        const detail = sanitizeDetail(extractDetailFromPayload(iv));
        return { state, detail };
      }
      return {
        state: SOURCE_META[key].defaultState,
        detail: undefined,
      };
    };

    return {
      amazon: getStateAndDetail("amazon"),
      keywords_competitors: getStateAndDetail("keywords_competitors"),
      voc: getStateAndDetail("voc"),
      sourcing_1688: getStateAndDetail("sourcing_1688"),
    };
  });

  // 派生完整的 4 项列表
  const sourceItems = useMemo<OrchestratorSourceItem[]>(() => {
    return ORDERED_KEYS.map((k) => {
      const meta = SOURCE_META[k];
      const raw = rawItemStates[k];
      return {
        key: k,
        title: meta.title,
        state: raw?.state ?? meta.defaultState,
        detail: raw?.detail,
        anchorId: meta.anchorId,
        tabKey: meta.tabKey,
        canRetry:
          raw?.state === "failed" ||
          (k === "keywords_competitors" && raw?.state === "needs_user"),
      };
    });
  }, [rawItemStates]);

  const summary = useMemo(() => {
    return computeSummary(sourceItems, customSummaryText);
  }, [sourceItems, customSummaryText]);

  const handleNavigate = useCallback(
    (tabKey: "market" | "buyers" | "sourcing" | "cost-risk", anchorId: string) => {
      const cleanId = anchorId.replace(/^#+/, "").trim();
      if (onNavigate) {
        onNavigate(tabKey, cleanId);
      } else if (typeof window !== "undefined") {
        window.location.hash = cleanId;
        const el = document.getElementById(cleanId);
        if (el) {
          if (el.tagName === "DETAILS" || el.nodeName === "DETAILS") {
            (el as HTMLDetailsElement).open = true;
          }
          let parent = el.parentElement;
          while (parent) {
            if (parent.tagName === "DETAILS" || parent.nodeName === "DETAILS") {
              (parent as HTMLDetailsElement).open = true;
            }
            parent = parent.parentElement;
          }
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    },
    [onNavigate],
  );

  // 解析后端响应
  const applyApiResponse = useCallback(
    (data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      const d = data as Record<string, unknown>;

      let hasPreview = Boolean(d.hasNewPreview);
      let summaryStr: string | undefined = undefined;

      if (typeof d.summary === "string") {
        summaryStr = d.summary;
      } else if (
        typeof d.summary === "object" &&
        d.summary !== null &&
        "text" in d.summary &&
        typeof (d.summary as { text: unknown }).text === "string"
      ) {
        summaryStr = (d.summary as { text: string }).text;
      }

      setRawItemStates((prev) => {
        const nextRaw = { ...prev };

        // 兼容 sources 对象或 items 数组
        if (d.sources && typeof d.sources === "object" && !Array.isArray(d.sources)) {
          const rawNormalized = normalizeSourcesToRaw(d.sources);
          if (rawNormalized) {
            setRawSources(rawNormalized);
          }
          const s = d.sources as Record<string, unknown>;
          for (const k of ORDERED_KEYS) {
            const itemVal =
              s[k] ??
              (k === "keywords_competitors"
                ? (s.keywordCompetitor ?? s.keywords_competitors ?? s.keywords)
                : k === "sourcing_1688"
                  ? (s.sourcing1688 ?? s.sourcing_1688 ?? s.sourcing)
                  : s[k]);
            if (itemVal && typeof itemVal === "object") {
              const iv = itemVal as Record<string, unknown>;
              const errorCode =
                iv.error && typeof iv.error === "object" && iv.error !== null
                  ? (iv.error as Record<string, unknown>).code
                  : undefined;
              const effectiveState =
                errorCode === "confirmed_no_reviews" ? "confirmed_no_reviews" :
                  errorCode === "extraction_empty" || errorCode === "no_public_reviews" ? "extraction_empty" : iv.state ?? iv.status;
              const state = normalizeState(k, effectiveState, iv.ready);
              const extractedDetail = extractDetailFromPayload(iv);
              const prevState = prev[k]?.state;
              if (
                (prevState === "failed" || prevState === "ready_to_search") &&
                (state === "needs_user" || state === "needs_supplement" || state === "needs_login" || state === "pending") &&
                !extractedDetail
              ) {
                continue;
              }
              if (
                prevState === "running" &&
                (state === "needs_user" || state === "ready_to_search" || state === "pending") &&
                !iv.previewId && !iv.hasEvidence
              ) {
                continue;
              }
              if (
                (prevState === "ready" || prevState === "pending_review") &&
                (state === "needs_user" || state === "pending")
              ) {
                continue;
              }
              nextRaw[k] = {
                state,
                detail: sanitizeDetail(extractedDetail) ?? (prevState === "failed" && state === "failed" ? prev[k]?.detail : undefined),
              };
              if (state === "pending_review" && (iv.previewId || iv.hasPreview)) {
                hasPreview = true;
              }
            }
          }
        } else if (Array.isArray(d.items)) {
          const reconstructedSources: Record<string, unknown> = {};
          for (const item of d.items) {
            if (item && typeof item === "object" && "key" in item) {
              const it = item as Record<string, unknown>;
              const keyStr = String(it.key);
              reconstructedSources[keyStr] = it;
              const targetKey = ORDERED_KEYS.find(
                (k) =>
                  k === keyStr ||
                  (k === "sourcing_1688" && (keyStr === "sourcing" || keyStr === "sourcing1688")) ||
                  (k === "keywords_competitors" && keyStr === "keywordCompetitor"),
              );
              if (targetKey) {
                const errorCode =
                  it.error && typeof it.error === "object" && it.error !== null
                    ? (it.error as Record<string, unknown>).code
                    : undefined;
                const effectiveState =
                  errorCode === "confirmed_no_reviews" ? "confirmed_no_reviews" :
                    errorCode === "extraction_empty" || errorCode === "no_public_reviews" ? "extraction_empty" : it.state ?? it.status;
                const state = normalizeState(targetKey, effectiveState, it.ready);
                const extractedDetail = extractDetailFromPayload(it);
                const prevState = prev[targetKey]?.state;
                if (
                  (prevState === "failed" || prevState === "ready_to_search") &&
                  (state === "needs_user" || state === "needs_supplement" || state === "needs_login" || state === "pending") &&
                  !extractedDetail
                ) {
                  continue;
                }
                if (
                  prevState === "running" &&
                  (state === "needs_user" || state === "ready_to_search" || state === "pending") &&
                  !it.previewId && !it.hasPreview
                ) {
                  continue;
                }
                if (
                  (prevState === "ready" || prevState === "pending_review") &&
                  (state === "needs_user" || state === "pending")
                ) {
                  continue;
                }
                nextRaw[targetKey] = {
                  state,
                  detail: sanitizeDetail(extractedDetail) ?? (prevState === "failed" && state === "failed" ? prev[targetKey]?.detail : undefined),
                };
                if (state === "pending_review" && (it.previewId || it.hasPreview)) {
                  hasPreview = true;
                }
              }
            }
          }
          const rawNormalized = normalizeSourcesToRaw(reconstructedSources);
          if (rawNormalized) {
            setRawSources(rawNormalized);
          }
        }
        return nextRaw;
      });

      if (summaryStr) {
        setCustomSummaryText(summaryStr);
      }

      const sourceContainer =
        d.sources && typeof d.sources === "object" && !Array.isArray(d.sources)
          ? d.sources as Record<string, unknown>
          : Array.isArray(d.items)
            ? Object.fromEntries(
                d.items
                  .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && "key" in item)
                  .map((item) => [String(item.key), item]),
              )
            : {};
      const fingerprint = ORDERED_KEYS.map((key) => {
        const raw = sourceContainer[key] ??
          (key === "keywords_competitors" ? sourceContainer.keywordCompetitor ?? sourceContainer.keywords :
            key === "sourcing_1688" ? sourceContainer.sourcing1688 ?? sourceContainer.sourcing : undefined);
        if (!raw || typeof raw !== "object") return `${key}:missing`;
        const value = raw as Record<string, unknown>;
        return `${key}:${String(value.state ?? value.status ?? "")}:${String(value.previewId ?? "")}:${String(value.capturedAt ?? value.updatedAt ?? "")}:${String(value.ready ?? "")}`;
      }).join("|");
      const previousFingerprint = lastFeedbackFingerprintRef.current;
      lastFeedbackFingerprintRef.current = fingerprint;
      // 同一个 Pending Preview 的重复 inspect 只是观察，不应再次制造父级 dataRevision。
      // 首次发现 Preview 仍保留原有通知；后续任何来源状态实质变化（包括 pending→ready）才通知。
      if (hasPreview) {
        setHasNewPreviewAlert(true);
      }
      if (
        (hasPreview && previousFingerprint === null) ||
        (previousFingerprint !== null && previousFingerprint !== fingerprint)
      ) {
        onDataChanged?.();
      }
    },
    [onDataChanged],
  );

  // 执行 inspect
  const executeInspect = useCallback(async () => {
    setIsInspecting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/research-orchestrator`,
        {
          method: "POST",
          headers: {
            ...buildAccessHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "inspect" }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: unknown;
        error?: { message?: string };
      } | null;

      if (!res.ok || !json?.ok) {
        setErrorMessage(
          json?.error?.message ?? "资料状态检查未成功，请稍后重试。",
        );
        return;
      }
      applyApiResponse(json.data);
    } catch {
      setErrorMessage("网络异常，无法核对资料真实状态。");
    } finally {
      setIsInspecting(false);
    }
  }, [taskId, applyApiResponse]);

  // 默认加载时触发 inspect
  useEffect(() => {
    if (skipAutoInspect) return;
    void executeInspect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, skipAutoInspect]);

  // 监听外部 dataRevision 变化，自动重新触发 inspect 刷新状态
  const prevDataRevisionRef = useRef(dataRevision);
  useEffect(() => {
    if (
      typeof dataRevision === "number" &&
      dataRevision > 0 &&
      dataRevision !== prevDataRevisionRef.current
    ) {
      prevDataRevisionRef.current = dataRevision;
      void executeInspect();
    }
  }, [dataRevision, executeInspect]);

  // 检查是否有任何来源处于 running 状态，若有则自动轮询 inspect 直至全部完成
  const hasRunningSource = useMemo(() => {
    return Object.values(rawItemStates).some((item) => item?.state === "running");
  }, [rawItemStates]);

  useEffect(() => {
    if (!hasRunningSource) return;
    const timer = setInterval(() => {
      void executeInspect();
    }, 2500);
    return () => clearInterval(timer);
  }, [hasRunningSource, executeInspect]);

  // 点击「补齐研究资料」
  const handleOrchestrate = useCallback(async () => {
    if (isOrchestrating || isOrchestratingRef.current) return;
    isOrchestratingRef.current = true;
    setIsOrchestrating(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/research-orchestrator`,
        {
          method: "POST",
          headers: {
            ...buildAccessHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "orchestrate" }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: unknown;
        error?: { message?: string };
      } | null;

      if (!res.ok || !json?.ok) {
        setErrorMessage(
          json?.error?.message ?? "资料编排整理失败，请稍后重试。",
        );
        return;
      }
      applyApiResponse(json.data);
    } catch {
      setErrorMessage("网络异常，请求编排服务失败。");
    } finally {
      isOrchestratingRef.current = false;
      setIsOrchestrating(false);
      setRetryingSource(null);
    }
  }, [taskId, isOrchestrating, applyApiResponse]);

  // 点击关键词重试
  const handleRetryKeywords = useCallback(() => {
    if (isOrchestrating || retryingSource !== null || isOrchestratingRef.current) {
      return;
    }
    setRetryingSource("keywords_competitors");
    void handleOrchestrate();
  }, [isOrchestrating, retryingSource, handleOrchestrate]);

  return (
    <section
      data-testid="research-orchestrator-card"
      className={`w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all ${className}`}
    >
      {/* ── 顶部标题、状态徽章与一键补齐操作 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold text-slate-900">
              研究资料
            </h3>
            {/* 状态徽章 */}
            {isInspecting ? (
              <span
                data-testid="orchestrator-status-badge"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500"
              >
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                正在核对资料状态…
              </span>
            ) : (
              <span
                data-testid="orchestrator-status-badge"
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  summary.allReady
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : summary.pendingReviewCount > 0
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {summary.text}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            自动梳理 Amazon、关键词与竞品、买家 VOC 与 1688 货源线索；严格保证真实数据，绝不替用户自动确认。
          </p>
        </div>

        {/* 主操作按钮：补齐研究资料 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="btn-orchestrate"
            onClick={handleOrchestrate}
            disabled={isOrchestrating || retryingSource !== null}
            className="inline-flex h-9 w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-slate-800 active:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {isOrchestrating ? (
              <>
                <Loader2
                  className="h-4 w-4 animate-spin shrink-0 text-slate-300"
                  data-testid="orchestrate-spinner"
                />
                <span>正在整理研究资料…</span>
              </>
            ) : (
              <>
                <RotateCw className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <span>补齐研究资料</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 错误警示栏（支持重试） ── */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="orchestrator-error-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs sm:text-sm text-rose-700"
        >
          <div className="flex items-center gap-1.5">
            <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            data-testid="orchestrator-retry-btn"
            onClick={() => void executeInspect()}
            className="font-semibold underline hover:text-rose-900"
          >
            重试检查
          </button>
        </div>
      )}

      {/* ── 新预览待确认提示栏（绝不替用户自动确认） ── */}
      {hasNewPreviewAlert && (
        <div
          data-testid="orchestrator-new-preview-alert"
          className="mt-3 flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-xs sm:text-sm text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="font-medium">
            本轮已生成待确认资料预览，请在下方列表查看并确认（系统绝不替用户代做确认）。
          </span>
        </div>
      )}

      {/* ── 4 项来源状态紧凑列表展示 ── */}
      <div
        data-testid="orchestrator-sources-list"
        className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/50"
      >
        {sourceItems.map((item) => {
          const badge = formatBadgeLabel(item.state, item.key);
          const isRetryingThis = retryingSource === item.key;
          const pendingItem = pendingItems.find((p) => p.sourceKey === item.key);
          const needsUserItem = needsUserItems.find((n) => n.sourceKey === item.key);
          const descriptionText = getSourceDescription(
            item,
            isRetryingThis,
            pendingItem,
            needsUserItem,
          );

          return (
            <div
              key={item.key}
              data-testid={`source-row-${item.key}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 transition-colors hover:bg-slate-50/80"
            >
              {/* 左侧：来源名称 */}
              <div className="flex items-center gap-2 shrink-0 sm:w-36 md:w-44">
                <span className="text-sm font-semibold text-slate-800">
                  {item.title}
                </span>
                {/* 兼容可能查找 orchestrator-item-${item.key} 的测试 */}
                <span data-testid={`orchestrator-item-${item.key}`} className="hidden" />
              </div>

              {/* 中间：状态徽章与说明文案 */}
              <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                {/* 状态徽章 */}
                <span
                  data-testid={`badge-${item.key}`}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                    isRetryingThis
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : badge.variant === "emerald"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : badge.variant === "amber"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : badge.variant === "rose"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-slate-100 text-slate-600"
                  }`}
                >
                  {isRetryingThis ? (
                    <>
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-600" />
                      <span>正在重试</span>
                    </>
                  ) : (
                    <>
                      {badge.icon === "loader" && (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-600" />
                      )}
                      {badge.icon === "check" && <Check className="h-3 w-3 shrink-0" />}
                      {badge.icon === "alert" && (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                      )}
                      {badge.icon === "circle" && (
                        <Circle className="h-2.5 w-2.5 shrink-0 text-slate-400" />
                      )}
                      {badge.icon === "x" && <XCircle className="h-3 w-3 shrink-0 text-rose-600" />}
                      <span>{badge.text}</span>
                    </>
                  )}
                </span>

                {/* 说明文字 */}
                <span
                  className={`text-xs ${item.state === "failed" ? "text-rose-600 font-medium break-all" : "text-slate-500 truncate"}`}
                  title={descriptionText}
                >
                  {descriptionText}
                </span>
              </div>

              {/* 右侧：统一的单一操作按钮 */}
              <div className="flex items-center gap-2 shrink-0">
                {isRetryingThis ? (
                  <button
                    type="button"
                    disabled
                    data-testid={
                      item.key === "keywords_competitors"
                        ? "action-retry-keywords"
                        : `action-retry-${item.key}`
                    }
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-100 text-slate-400 px-3 py-1.5 text-xs font-semibold shadow-sm cursor-not-allowed"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>处理中…</span>
                  </button>
                ) : item.state === "running" ? (
                  <button
                    type="button"
                    disabled
                    data-testid={`action-running-${item.key}`}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-1.5 text-xs font-semibold shadow-sm cursor-not-allowed"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>执行中…</span>
                  </button>
                ) : item.state === "ready_to_search" && item.key !== "sourcing_1688" ? (
                  <button
                    type="button"
                    data-testid={`action-search-${item.key}`}
                    onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>去1688图片搜索</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : item.state === "pending_review" ? (
                  <button
                    type="button"
                    data-testid={`action-review-${item.key}`}
                    onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>查看并确认</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : item.state === "failed" && item.key === "amazon" ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="action-retry-amazon"
                      onClick={() => {
                        setRetryingSource("amazon");
                        void handleOrchestrate();
                      }}
                      disabled={isOrchestrating || retryingSource !== null}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>重新尝试</span>
                    </button>
                    <button
                      type="button"
                      data-testid="action-manual-amazon"
                      onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
                    >
                      <span>人工补充</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : item.state === "failed" ? (
                  <button
                    type="button"
                    data-testid={
                      item.key === "keywords_competitors"
                        ? "action-retry-keywords"
                        : `action-retry-${item.key}`
                    }
                    onClick={() => {
                      if (item.key === "keywords_competitors") {
                        handleRetryKeywords();
                      } else {
                        setRetryingSource(item.key);
                        void handleOrchestrate();
                      }
                    }}
                    disabled={isOrchestrating || retryingSource !== null}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    <span>重试</span>
                  </button>
                ) : item.state === "needs_user" ||
                  item.state === "needs_action" ||
                  item.state === "needs_login" ||
                  item.state === "needs_supplement" ? (
                  <button
                    type="button"
                    data-testid={`action-handle-${item.key}`}
                    onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>前往处理</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
