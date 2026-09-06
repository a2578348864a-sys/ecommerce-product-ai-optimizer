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
  ExternalLink,
} from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

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
  | "failed" // ❌ 失败 (关键词与竞品)
  | "needs_action" // ⚠ 需要处理 (VOC)
  | "needs_login" // ⚠ 需要登录 (1688)
  | "needs_user"; // ⚠ 需要人工处理

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
  };
  /** 测试时跳过自动 inspect */
  skipAutoInspect?: boolean;
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
    anchorId: "workbench-browser-evidence",
    tabKey: "market",
    defaultState: "needs_supplement",
    allowedStates: new Set(["ready", "needs_supplement", "needs_user"]),
  },
  keywords_competitors: {
    title: "关键词与竞品",
    anchorId: "#formal-v2-market-evidence",
    tabKey: "market",
    defaultState: "pending",
    allowedStates: new Set(["ready", "pending_review", "pending", "failed", "needs_user"]),
  },
  voc: {
    title: "买家评论 / VOC",
    anchorId: "formal-v2-buyer-evidence",
    tabKey: "buyers",
    defaultState: "needs_action",
    allowedStates: new Set(["ready", "pending_review", "needs_action", "needs_user", "failed"]),
  },
  sourcing_1688: {
    title: "1688 供应链",
    anchorId: "formal-v2-sourcing-evidence",
    tabKey: "sourcing",
    defaultState: "pending_review",
    allowedStates: new Set(["ready", "pending_review", "needs_login", "needs_user"]),
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
    if (s === "needs_supplement" || s === "missing" || s === "需要补充") {
      return "needs_supplement";
    }
    if (s === "pending_review" || s === "to_confirm" || s === "待确认" || s === "preview" || s === "awaiting_confirmation") {
      return "pending_review";
    }
    if (s === "pending" || s === "待补齐" || s === "idle" || s === "running") {
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
    if (s === "needs_user") {
      if (key === "amazon") return "needs_supplement";
      if (key === "voc") return "needs_action";
      if (key === "sourcing_1688") return "needs_login";
      return "needs_user";
    }
  }
  if (typeof rawReady === "boolean") {
    if (rawReady) return "ready";
    return SOURCE_META[key].defaultState;
  }
  return SOURCE_META[key].defaultState;
}

export function formatBadgeLabel(state: OrchestratorSourceState): {
  icon: "check" | "alert" | "circle" | "x";
  text: string;
  variant: "emerald" | "amber" | "slate" | "rose";
} {
  switch (state) {
    case "ready":
      return { icon: "check", text: "✓ 已有", variant: "emerald" };
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
      i.state === "needs_user",
  ).length;

  const allReady = reusedCount === items.length;

  let text = "";
  if (serverText && serverText.trim()) {
    text = serverText.trim();
  } else if (allReady) {
    text = "本轮资料整理完成";
  } else {
    text = `已复用 ${reusedCount} 项，待确认 ${pendingReviewCount} 项，${manualActionCount} 项需人工处理`;
  }

  return {
    text,
    reusedCount,
    pendingReviewCount,
    manualActionCount,
    allReady,
  };
}

/* ── 主组件 ───────────────────────────────────────────── */

export function ResearchCollectionOrchestratorCard({
  taskId,
  onDataChanged,
  onNavigate,
  className = "",
  initialData,
  skipAutoInspect = false,
}: ResearchCollectionOrchestratorCardProps) {
  const [isInspecting, setIsInspecting] = useState(false);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [retryingSource, setRetryingSource] = useState<OrchestratorSourceKey | null>(null);
  const isOrchestratingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasNewPreviewAlert, setHasNewPreviewAlert] = useState(Boolean(initialData?.hasNewPreview));
  const [customSummaryText, setCustomSummaryText] = useState<string | undefined>(
    initialData?.summary,
  );

  // 初始化 4 项状态
  const [rawItemStates, setRawItemStates] = useState<
    Record<OrchestratorSourceKey, { state: OrchestratorSourceState; detail?: string }>
  >(() => {
    const init: Record<
      OrchestratorSourceKey,
      { state: OrchestratorSourceState; detail?: string }
    > = {
      amazon: {
        state: initialData?.items?.amazon?.state ?? SOURCE_META.amazon.defaultState,
        detail: sanitizeDetail(initialData?.items?.amazon?.detail),
      },
      keywords_competitors: {
        state:
          initialData?.items?.keywords_competitors?.state ??
          SOURCE_META.keywords_competitors.defaultState,
        detail: sanitizeDetail(initialData?.items?.keywords_competitors?.detail),
      },
      voc: {
        state: initialData?.items?.voc?.state ?? SOURCE_META.voc.defaultState,
        detail: sanitizeDetail(initialData?.items?.voc?.detail),
      },
      sourcing_1688: {
        state:
          initialData?.items?.sourcing_1688?.state ??
          SOURCE_META.sourcing_1688.defaultState,
        detail: sanitizeDetail(initialData?.items?.sourcing_1688?.detail),
      },
    };
    return init;
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
          k === "keywords_competitors" &&
          (raw?.state === "failed" || raw?.state === "needs_user"),
      };
    });
  }, [rawItemStates]);

  const summary = useMemo(() => {
    return computeSummary(sourceItems, customSummaryText);
  }, [sourceItems, customSummaryText]);

  // 第一个待确认或需处理的项，供快捷直达引导
  const firstPendingItem = useMemo(() => {
    return (
      sourceItems.find((i) => i.state === "pending_review") ||
      sourceItems.find((i) => i.state !== "ready")
    );
  }, [sourceItems]);

  const handleNavigate = useCallback(
    (tabKey: "market" | "buyers" | "sourcing" | "cost-risk", anchorId: string) => {
      if (onNavigate) {
        onNavigate(tabKey, anchorId);
      } else if (typeof window !== "undefined") {
        window.location.hash = anchorId;
        const targetId = anchorId.replace(/^#/, "");
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
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
              const state = normalizeState(k, iv.state ?? iv.status, iv.ready);
              const extractedDetail = extractDetailFromPayload(iv);
              nextRaw[k] = {
                state,
                detail: sanitizeDetail(extractedDetail),
              };
              if (state === "pending_review" && (iv.previewId || iv.hasPreview)) {
                hasPreview = true;
              }
            }
          }
        } else if (Array.isArray(d.items)) {
          for (const item of d.items) {
            if (item && typeof item === "object" && "key" in item) {
              const it = item as Record<string, unknown>;
              const keyStr = String(it.key);
              const targetKey = ORDERED_KEYS.find(
                (k) =>
                  k === keyStr ||
                  (k === "sourcing_1688" && (keyStr === "sourcing" || keyStr === "sourcing1688")) ||
                  (k === "keywords_competitors" && keyStr === "keywordCompetitor"),
              );
              if (targetKey) {
                const state = normalizeState(targetKey, it.state ?? it.status, it.ready);
                const extractedDetail = extractDetailFromPayload(it);
                nextRaw[targetKey] = {
                  state,
                  detail: sanitizeDetail(extractedDetail),
                };
                if (state === "pending_review" && (it.previewId || it.hasPreview)) {
                  hasPreview = true;
                }
              }
            }
          }
        }
        return nextRaw;
      });

      if (summaryStr) {
        setCustomSummaryText(summaryStr);
      }

      if (hasPreview) {
        setHasNewPreviewAlert(true);
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
      className={`w-full max-w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-50/70 p-3 sm:p-4 shadow-sm transition-all ${className}`}
    >
      {/* ── 顶部标题、状态徽章与一键补齐操作 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold text-slate-900">
              研究资料编排
            </h3>
            {/* 状态徽章 */}
            {isInspecting ? (
              <span
                data-testid="orchestrator-status-badge"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500"
              >
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                正在核对四项资料状态…
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
            disabled={isOrchestrating || isInspecting || retryingSource !== null}
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
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-xs sm:text-sm text-amber-900"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="font-medium">
                本轮已生成待确认资料预览，请前往下方对应区域人工复核（系统绝不替用户代做确认）。
              </span>
            </div>
            {firstPendingItem && (
              <button
                type="button"
                data-testid="orchestrator-goto-pending-btn"
                onClick={() =>
                  handleNavigate(firstPendingItem.tabKey, firstPendingItem.anchorId)
                }
                className="inline-flex items-center gap-1 self-start sm:self-auto rounded-lg bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 transition-colors shrink-0 shadow-sm"
              >
                前往待确认区域
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 4 项来源状态列表展示 ── */}
      <div
        data-testid="orchestrator-sources-grid"
        className="mt-2.5 grid grid-cols-2 lg:grid-cols-4 gap-2"
      >
        {sourceItems.map((item) => {
          const badge = formatBadgeLabel(item.state);
          const isRetryingThis = retryingSource === item.key;
          return (
            <div
              key={item.key}
              data-testid={`orchestrator-item-${item.key}`}
              className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-2.5 sm:p-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-colors hover:border-slate-300/80"
            >
              {/* 顶部行：名称 + 徽章 */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-semibold text-slate-800">
                  {item.title}
                </span>

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
              </div>

              {/* 底部行：描述/明细 + 对应操作（直达锚点/重试） */}
              <div className="mt-1.5 flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100 text-[11px] sm:text-xs">
                <span
                  className="text-slate-500 truncate"
                  title={isRetryingThis ? "正在重新采集关键词与竞品…" : item.detail}
                >
                  {isRetryingThis
                    ? "正在重新采集关键词与竞品…"
                    : item.detail || (
                        item.state === "ready"
                          ? "资料已就绪"
                          : item.state === "pending_review"
                            ? "存在待确认条目"
                            : item.state === "needs_login"
                              ? "需要 1688 授权"
                              : item.state === "needs_supplement"
                                ? "信息尚不完整"
                                : item.state === "failed"
                                  ? "上次采集未完成"
                                  : item.state === "needs_user"
                                    ? "需要人工处理"
                                    : "待补充"
                      )}
                </span>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {item.state === "pending_review" && (
                    <button
                      type="button"
                      data-testid={`action-anchor-${item.key}`}
                      onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                      className="inline-flex items-center gap-0.5 rounded-lg border border-amber-300 bg-amber-50/80 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                    >
                      直达待确认
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}

                  {item.key === "keywords_competitors" &&
                    (item.state === "failed" || item.state === "needs_user" || isRetryingThis) && (
                      <button
                        type="button"
                        data-testid="action-retry-keywords"
                        onClick={handleRetryKeywords}
                        disabled={isOrchestrating || retryingSource !== null}
                        className={`inline-flex items-center gap-0.5 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                          isRetryingThis
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                        }`}
                      >
                        {isRetryingThis ? (
                          <>
                            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                            重试中…
                          </>
                        ) : (
                          <>
                            <RotateCw className="h-3 w-3 shrink-0" />
                            重试
                          </>
                        )}
                      </button>
                    )}

                  {item.key === "voc" &&
                    (item.state === "needs_action" || item.state === "needs_user") && (
                      <button
                        type="button"
                        data-testid="action-anchor-voc"
                        onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                        className="inline-flex items-center gap-0.5 rounded-lg border border-amber-300 bg-amber-50/80 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                      >
                        前往处理
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}

                  {item.key === "sourcing_1688" &&
                    (item.state === "needs_login" || item.state === "needs_user") && (
                      <button
                        type="button"
                        data-testid="action-login-sourcing"
                        onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                        className="inline-flex items-center gap-0.5 rounded-lg border border-amber-300 bg-amber-50/80 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                      >
                        前往登录
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}

                  {item.key === "amazon" &&
                    (item.state === "needs_supplement" || item.state === "needs_user") && (
                      <button
                        type="button"
                        data-testid="action-anchor-amazon"
                        onClick={() => handleNavigate(item.tabKey, item.anchorId)}
                        className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        前往补充
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
