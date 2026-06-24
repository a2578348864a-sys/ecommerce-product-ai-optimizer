"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  agentStatusFilterOptions,
  deriveAgentNextStepPanelState,
  type AgentStatusKey,
} from "@/components/agentNextStepPanelModel";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { TASK_TYPE_FILTER_OPTIONS } from "@/lib/taskConcepts";
import { platformLabels } from "@/lib/types";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import {
  decisionStatusOptions,
  getDecisionStatusOption,
  type DecisionStatus,
} from "@/lib/tasks/decisionStatus";
import { deriveTaskWorkflowSummary, getTaskSourceMeta, toneClass } from "@/lib/taskWorkflowSummary";

const defaultType = "";
const defaultDecisionStatus = "";
const defaultAgentStatus = "";
const defaultLimit = 10;
const taskTypes = TASK_TYPE_FILTER_OPTIONS;
const mainlineTaskTypes = new Set(["workflow", "opportunities"]);

const extendedPlatformLabels: Record<string, string> = {
  ...platformLabels,
  tiktok: "TikTok",
  "1688": "1688",
  alibaba: "阿里国际站",
};

type TaskCenterItem = {
  id: string;
  createdAt: string;
  decisionStatus: DecisionStatus;
  title: string | null;
  type?: string;
  platform: string;
  productUrl: string | null;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  result: unknown;
};

type TaskPageInfo = {
  type: string;
  q: string;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  decisionStatus?: string;
};

type ApiResponse =
  | {
    ok: true;
    records?: TaskCenterItem[];
    data?: { items: TaskCenterItem[] };
    page?: TaskPageInfo;
  }
  | { ok: false; error: { code: string; message: string } };

type LoadMode = "replace" | "append";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getTitle(item: TaskCenterItem) {
  return item.title?.trim() || item.materialText.trim().slice(0, 20) || "未命名记录";
}

function sourceLabel(source: string) {
  return source === "ai" ? "AI" : "mock";
}

const typeLabelMap: Record<string, string> = {
  workflow: "一键分析",
  opportunities: "机会雷达",
  viral: "海外爆款趋势分析",
  radar: "爆款雷达分析",
  product: "选品利润分析",
  risk: "风险排查",
  sourcing: "货源判断",
  material: "素材接收",
  summary: "小白结论",
};

const agentLabelMap: Record<string, string> = {
  workflow: "一键选品工作流",
  opportunities: "机会雷达 Agent",
  viral: "海外爆款趋势 Agent",
  radar: "爆款雷达 Agent",
  product: "选品分析 Agent",
  risk: "风险检查 Agent",
  sourcing: "货源判断 Agent",
  material: "素材接收 Agent",
  summary: "小白结论 Agent",
};

function getTaskTypeLabel(item: TaskCenterItem) {
  return typeLabelMap[item.type || ""] || item.type || "未知任务";
}

function getAgentTypeLabel(item: TaskCenterItem) {
  return agentLabelMap[item.type || ""] || "规划 Agent";
}

function getTaskStatusLabel() {
  return "已完成";
}

function getTaskStatusClass() {
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function getAgentStatus(item: TaskCenterItem) {
  return deriveAgentNextStepPanelState({
    taskType: item.type,
    decisionStatus: item.decisionStatus,
    result: item.result,
  }).agentStatus;
}

function getStringArray(result: unknown, key: string) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const value = Reflect.get(result, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
}

function getReviewDisplay(item: TaskCenterItem, agentState: ReturnType<typeof deriveAgentNextStepPanelState>) {
  if (item.type !== "workflow") return "普通记录";
  if (!agentState.reviewState.exists) return "缺少复核状态";
  return agentState.reviewState.allReviewed
    ? `已复核 ${agentState.reviewState.reviewedCount}/${agentState.reviewState.totalReviewSteps}`
    : `待复核 ${agentState.reviewState.reviewedCount}/${agentState.reviewState.totalReviewSteps}`;
}

function getNextActionDisplay(item: TaskCenterItem, agentState: ReturnType<typeof deriveAgentNextStepPanelState>) {
  if (item.decisionStatus === "rejected") return "暂缓";
  if (item.decisionStatus === "need_info") return "补资料";
  if (agentState.agentStatus.key === "needs_review") return "人工复核";
  if (agentState.agentStatus.key === "can_continue") return "可人工推进";
  if (agentState.agentStatus.key === "needs_decision") return "人工决策";
  if (item.type === "opportunities") return "继续判断机会";
  return "查看结果";
}

function getPriorityScore(item: TaskCenterItem, highlightedTaskId: string, hasActiveFilters: boolean) {
  let score = 0;
  if (item.id === highlightedTaskId) score += 1000;
  if (!hasActiveFilters) {
    if (item.type === "workflow") score += 160;
    if (item.type === "opportunities") score += 120;
    if (item.decisionStatus === "pending") score += 45;
    if (item.decisionStatus === "need_info") score += 30;
    if (mainlineTaskTypes.has(item.type || "")) score += 25;
  }
  return score;
}

function updateBrowserQuery(type: string, q: string, decisionStatus: string, agentStatus: string) {
  const params = new URLSearchParams();
  if (type && type !== defaultType) params.set("type", type);
  if (q) params.set("q", q);
  if (decisionStatus && decisionStatus !== defaultDecisionStatus) params.set("decisionStatus", decisionStatus);
  if (agentStatus && agentStatus !== defaultAgentStatus) params.set("agentStatus", agentStatus);
  const query = params.toString();
  window.history.pushState(null, "", query ? `/tasks?${query}` : "/tasks");
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <div className="surface-card-soft rounded-[22px] p-4">
      <p className="text-sm font-bold text-slate-950">{title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function TaskRecordsList() {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const [items, setItems] = useState<TaskCenterItem[]>([]);
  const [page, setPage] = useState<TaskPageInfo | null>(null);
  const [type, setType] = useState(defaultType);
  const [decisionStatus, setDecisionStatus] = useState(defaultDecisionStatus);
  const [agentStatus, setAgentStatus] = useState<"" | AgentStatusKey>(defaultAgentStatus);
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [updatingDecisionId, setUpdatingDecisionId] = useState("");
  const [highlightedTaskId, setHighlightedTaskId] = useState("");

  const loadTasks = useCallback(async ({
    nextType,
    nextDecisionStatus,
    nextAgentStatus,
    q,
    offset,
    mode,
    syncUrl,
  }: {
    nextType: string;
    nextDecisionStatus: string;
    nextAgentStatus: "" | AgentStatusKey;
    q: string;
    offset: number;
    mode: LoadMode;
    syncUrl: boolean;
  }) => {
    if (!isAccessPasswordReady) {
      if (mode === "append") {
        setLoadingMore(false);
      } else {
        setLoading(true);
      }
      return;
    }

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      if (mode === "append") {
        setLoadingMore(false);
      } else {
        setItems([]);
        setPage(null);
        setLoading(false);
      }
      setError("请先输入访问密码后查看任务记录。");
      return;
    }

    if (mode === "append") {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const params = new URLSearchParams({
        type: nextType,
        limit: String(defaultLimit),
        offset: String(offset),
      });
      if (q) params.set("q", q);
      if (nextDecisionStatus) params.set("decisionStatus", nextDecisionStatus);

      const response = await fetch(`/api/tasks?${params.toString()}`, {
        cache: "no-store",
        headers: { "x-access-password": accessPassword },
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok) {
        setError(data.ok ? "任务记录读取失败。" : data.error.message);
        return;
      }

      const records = data.records ?? data.data?.items ?? [];
      const nextPage = data.page ?? {
        type: nextType,
        q,
        limit: defaultLimit,
        offset,
        total: records.length,
        hasMore: false,
        nextOffset: null,
      };

      setItems((current) => (mode === "append" ? [...current, ...records] : records));
      setPage(nextPage);
      setType(nextType);
      setDecisionStatus(nextDecisionStatus);
      setAgentStatus(nextAgentStatus);
      setActiveQuery(q);
      if (mode === "replace") setOpenId("");
      if (syncUrl) updateBrowserQuery(nextType, q, nextDecisionStatus, nextAgentStatus);
    } catch {
      setError("任务记录暂时无法读取，请稍后刷新。");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [accessPassword, isAccessPasswordReady]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialType = params.get("type") || defaultType;
    const initialDecisionStatus = params.get("decisionStatus") || defaultDecisionStatus;
    const initialAgentStatus = params.get("agentStatus") || defaultAgentStatus;
    const initialHighlight = (params.get("highlight") || params.get("recent") || "").trim();
    const initialQuery = (params.get("q") || "").trim();
    // 确保 initialType 在合法值范围内，否则回退到 defaultType
    const validTypes = taskTypes.map((t) => t.value);
    const safeType = validTypes.includes(initialType) ? initialType : defaultType;
    const validDecisionStatuses = decisionStatusOptions.map((item) => item.value);
    const safeDecisionStatus = validDecisionStatuses.includes(initialDecisionStatus as DecisionStatus)
      ? initialDecisionStatus
      : defaultDecisionStatus;
    const validAgentStatuses = agentStatusFilterOptions.map((item) => item.value);
    const safeAgentStatus = validAgentStatuses.includes(initialAgentStatus as AgentStatusKey)
      ? initialAgentStatus as "" | AgentStatusKey
      : defaultAgentStatus;
    setType(safeType);
    setDecisionStatus(safeDecisionStatus);
    setAgentStatus(safeAgentStatus);
    setHighlightedTaskId(initialHighlight);
    setQueryInput(initialQuery);
    setActiveQuery(initialQuery);
    void loadTasks({
      nextType: safeType,
      nextDecisionStatus: safeDecisionStatus,
      nextAgentStatus: safeAgentStatus,
      q: initialQuery,
      offset: 0,
      mode: "replace",
      syncUrl: false,
    });
  }, [loadTasks]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = queryInput.trim();
    void loadTasks({
      nextType: type,
      nextDecisionStatus: decisionStatus,
      nextAgentStatus: agentStatus,
      q,
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function onTypeChange(nextType: string) {
    setType(nextType);
    void loadTasks({
      nextType,
      nextDecisionStatus: decisionStatus,
      nextAgentStatus: agentStatus,
      q: activeQuery,
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function onDecisionStatusChange(nextDecisionStatus: string) {
    setDecisionStatus(nextDecisionStatus);
    void loadTasks({
      nextType: type,
      nextDecisionStatus,
      nextAgentStatus: agentStatus,
      q: activeQuery,
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function onAgentStatusChange(nextAgentStatus: "" | AgentStatusKey) {
    setAgentStatus(nextAgentStatus);
    updateBrowserQuery(type, activeQuery, decisionStatus, nextAgentStatus);
    setOpenId("");
  }

  function clearFilters() {
    setQueryInput("");
    void loadTasks({
      nextType: defaultType,
      nextDecisionStatus: defaultDecisionStatus,
      nextAgentStatus: defaultAgentStatus,
      q: "",
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function retryLoad() {
    void loadTasks({
      nextType: type,
      nextDecisionStatus: decisionStatus,
      nextAgentStatus: agentStatus,
      q: activeQuery,
      offset: 0,
      mode: "replace",
      syncUrl: false,
    });
  }

  function loadMore() {
    if (!page?.hasMore || page.nextOffset === null) return;
    void loadTasks({
      nextType: page.type,
      nextDecisionStatus: page.decisionStatus || decisionStatus,
      nextAgentStatus: agentStatus,
      q: page.q,
      offset: page.nextOffset,
      mode: "append",
      syncUrl: false,
    });
  }

  async function deleteRecord(item: TaskCenterItem) {
    if (deletingId) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setError("请先输入访问密码后删除任务。");
      return;
    }

    const confirmed = window.confirm(`确定删除「${getTitle(item)}」这条任务记录吗？删除后无法恢复。`);
    if (!confirmed) return;

    setDeletingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { "x-access-password": accessPassword },
      });
      const data = await response.json() as
        | { ok: true; data: { id: string } }
        | { ok: false; error: { code: string; message: string } };

      if (!response.ok || !data.ok) {
        setError(data.ok ? "删除失败，请稍后再试。" : data.error.message);
        return;
      }

      setItems((current) => current.filter((record) => record.id !== item.id));
      setOpenId((current) => (current === item.id ? "" : current));
      setPage((current) => current
        ? {
          ...current,
          total: Math.max(0, current.total - 1),
          hasMore: current.offset + current.limit < Math.max(0, current.total - 1),
        }
        : current);
    } catch {
      setError("删除失败，请检查本地服务后重试。");
    } finally {
      setDeletingId("");
    }
  }

  async function updateDecisionStatus(item: TaskCenterItem, nextDecisionStatus: DecisionStatus) {
    if (updatingDecisionId) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setError("请先输入访问密码后更新人工状态。");
      return;
    }

    const previousStatus = item.decisionStatus;
    setUpdatingDecisionId(item.id);
    setError("");
    setItems((current) => current.map((record) => (
      record.id === item.id ? { ...record, decisionStatus: nextDecisionStatus } : record
    )));

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-password": accessPassword,
        },
        body: JSON.stringify({ decisionStatus: nextDecisionStatus }),
      });
      const data = await response.json() as
        | { ok: true; data: { id: string; decisionStatus: DecisionStatus } }
        | { ok: false; error: { code: string; message: string } };

      if (!response.ok || !data.ok) {
        setItems((current) => current.map((record) => (
          record.id === item.id ? { ...record, decisionStatus: previousStatus } : record
        )));
        setError(data.ok ? "人工状态更新失败，请稍后再试。" : data.error.message);
        return;
      }

      setItems((current) => current.map((record) => (
        record.id === item.id ? { ...record, decisionStatus: data.data.decisionStatus } : record
      )));
    } catch {
      setItems((current) => current.map((record) => (
        record.id === item.id ? { ...record, decisionStatus: previousStatus } : record
      )));
      setError("人工状态更新失败，请检查本地服务后重试。");
    } finally {
      setUpdatingDecisionId("");
    }
  }

  const visibleItems = agentStatus
    ? items.filter((item) => getAgentStatus(item).key === agentStatus)
    : items;
  const hasActiveFilters = Boolean(activeQuery || type !== defaultType || decisionStatus !== defaultDecisionStatus || agentStatus !== defaultAgentStatus);
  const highlightedItemExists = Boolean(highlightedTaskId && visibleItems.some((item) => item.id === highlightedTaskId));
  const displayItems = useMemo(() => [...visibleItems].sort((a, b) => {
    const priorityDiff = getPriorityScore(b, highlightedTaskId, hasActiveFilters) - getPriorityScore(a, highlightedTaskId, hasActiveFilters);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [hasActiveFilters, highlightedTaskId, visibleItems]);
  const operationStats = useMemo(() => {
    const batchGroups = new Map<string, { total: number; loaded: number; followable: number; cautious: number }>();
    let needsReview = 0;
    let followable = 0;
    let cautious = 0;
    let decided = 0;

    for (const item of visibleItems) {
      const summary = deriveTaskWorkflowSummary({
        type: item.type,
        title: item.title,
        materialText: item.materialText,
        oneLineSummary: item.oneLineSummary,
        level: item.level,
        decisionStatus: item.decisionStatus,
        result: item.result,
      });
      const agentState = deriveAgentNextStepPanelState({
        taskType: item.type,
        decisionStatus: item.decisionStatus,
        result: item.result,
      });
      if (agentState.agentStatus.key === "needs_review") needsReview += 1;
      if (summary.priorityTone === "emerald") followable += 1;
      if (summary.priorityTone === "rose" || summary.riskTone === "rose") cautious += 1;
      if (item.decisionStatus !== "pending") decided += 1;
      if (summary.batchMeta) {
        const current = batchGroups.get(summary.batchMeta.batchId) ?? {
          total: summary.batchMeta.batchTotal,
          loaded: 0,
          followable: 0,
          cautious: 0,
        };
        current.loaded += 1;
        if (summary.priorityTone === "emerald") current.followable += 1;
        if (summary.priorityTone === "rose" || summary.riskTone === "rose") current.cautious += 1;
        batchGroups.set(summary.batchMeta.batchId, current);
      }
    }

    return {
      total: visibleItems.length,
      needsReview,
      followable,
      cautious,
      decided,
      batchGroups,
    };
  }, [visibleItems]);
  const isSearchEmpty = !loading && !error && visibleItems.length === 0 && hasActiveFilters;
  const isDefaultEmpty = !loading && !error && visibleItems.length === 0 && !hasActiveFilters;

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="任务中心" returnUrl="/tasks" />;
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Qingxuan Workspace</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">任务中心 / 运营跟进台</h1>
                <p className="mt-1 text-sm text-slate-500">
                  保存后的分析会沉淀为可跟进任务。这里优先看哪些值得继续、风险是什么、下一步做什么，关键动作仍由你人工确认。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/opportunities" className="linear-button inline-flex h-11 items-center justify-center px-4 text-sm font-semibold">
                  机会雷达
                </Link>
                <Link href="/workflow/batch" className="linear-button inline-flex h-11 items-center justify-center px-4 text-sm font-semibold">
                  批量分析
                </Link>
                <Link
                  href="/"
                  className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  返回工作台
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-teal-700">运营跟进台</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">先看优先级，再决定下一步</h2>
                <p className="muted-text mt-1 text-sm">保存后的分析会沉淀为可跟进事项。AI 负责整理结论、风险和动作建议，采购、上架、投广告等真实动作必须人工确认。</p>
              </div>
              <span className="status-pill px-3 py-1 text-sm">
                {agentStatus
                  ? `已筛选 ${visibleItems.length}/${items.length} 条`
                : page ? `${items.length}/${page.total} 条` : `${items.length} 条记录`}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["全部任务", operationStats.total, "当前已加载任务"],
                ["待复核", operationStats.needsReview, "需要人工看完再判断"],
                ["可跟进", operationStats.followable, "适合继续核供应链/成本"],
                ["高风险/需谨慎", operationStats.cautious, "先查风险，不急着推进"],
                ["已决策", operationStats.decided, "人工状态已变更"],
              ].map(([label, value, hint]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white/85 p-3">
                  <p className="text-xs font-bold text-slate-400">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50/70 p-4">
              <p className="text-sm font-bold text-teal-800">💡 当前阶段说明</p>
              <p className="mt-1 text-sm leading-6 text-teal-700">
                这里是跨境电商运营全流程 Agent 的任务沉淀中心。AI 负责分析、整理和提示风险，帮你把运营动作拆成可执行任务。采购、上架、广告投放等关键动作必须由你人工确认后手动执行，当前不会自动操作任何平台。
              </p>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="linear-panel p-4">
                <p className="text-sm font-semibold text-slate-950">工作流阶段</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {["输入素材", "Agent 分析", "查看结论", "人工确认"].map((step, index) => (
                    <div key={step} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <span className="text-[11px] font-semibold text-slate-400">0{index + 1}</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{step}</p>
                    </div>
                  ))}
                </div>
                <p className="muted-text mt-3 text-xs leading-5">自动执行、失败重试、多 Agent 串联等为后续能力，当前版本不会在本页触发。</p>
              </div>
              <div className="linear-panel p-4">
                <p className="text-sm font-semibold text-slate-950">人工决策状态</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {decisionStatusOptions.filter((item) => item.value).map((status) => (
                    <span key={status.value} className={"rounded-full border px-2 py-0.5 text-[11px] " + status.className}>{status.shortLabel}</span>
                  ))}
                </div>
                <p className="muted-text mt-3 text-xs leading-5">每条任务支持标记：待判断 / 可继续 / 需补资料 / 已淘汰。</p>
              </div>
            </div>

            <form onSubmit={submitSearch} className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 xl:grid-cols-[minmax(0,1fr)_200px_170px_210px_auto_auto]">
              <label className="min-w-0">
                <span className="text-xs font-bold text-slate-500">搜索关键词</span>
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="搜索标题、素材、摘要或结果内容"
                  className="input-soft mt-2 h-11 w-full px-4 text-sm text-slate-800 outline-none"
                />
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">类型筛选</span>
                <select
                  value={type}
                  onChange={(event) => onTypeChange(event.target.value)}
                  className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none"
                >
                  {taskTypes.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">人工状态</span>
                <select
                  value={decisionStatus}
                  onChange={(event) => onDecisionStatusChange(event.target.value)}
                  className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none"
                >
                  {decisionStatusOptions.map((item) => (
                    <option key={item.value || "all"} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">Agent 状态</span>
                <select
                  value={agentStatus}
                  onChange={(event) => onAgentStatusChange(event.target.value as "" | AgentStatusKey)}
                  className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none"
                >
                  {agentStatusFilterOptions.map((item) => (
                    <option key={item.value || "all"} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="linear-button-primary inline-flex h-11 items-center justify-center self-end px-5 text-sm font-semibold"
              >
                搜索
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="linear-button inline-flex h-11 items-center justify-center self-end px-5 text-sm font-semibold"
              >
                清空
              </button>
            </form>

            {activeQuery ? (
              <p className="mt-3 text-sm text-slate-500">
                当前搜索：<span className="font-bold text-slate-800">{activeQuery}</span>
              </p>
            ) : null}
            {agentStatus ? (
              <p className="mt-2 text-sm text-slate-500">
                当前 Agent 状态筛选：
                <span className="font-bold text-slate-800">
                  {agentStatusFilterOptions.find((item) => item.value === agentStatus)?.label || "未知状态"}
                </span>
                <span className="ml-2 text-xs text-slate-400">基于当前已加载任务前端筛选。</span>
              </p>
            ) : null}
            {highlightedItemExists ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm font-semibold text-emerald-800">
                已定位到刚刚保存的分析结果。它会优先显示在列表顶部，方便继续查看和人工复核。
              </div>
            ) : null}

            {loading ? (
              <div className="mt-6 rounded-3xl border border-dashed border-teal-200 bg-teal-50/50 p-8 text-sm text-teal-800">
                正在读取本地任务记录...
              </div>
            ) : error ? (
              <div className="mt-6 rounded-3xl border border-rose-100 bg-rose-50 p-8 text-sm text-rose-700">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={retryLoad}
                  className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-bold text-rose-700"
                >
                  重试
                </button>
              </div>
            ) : isDefaultEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-teal-200 bg-teal-50/50 p-8">
                <p className="text-lg font-semibold text-slate-950">还没有保存的任务记录</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  从首页「找机会」发现候选商品，或完成单品分析 / 批量分析后保存结果，这里就会出现运营任务记录，供你复盘和确认下一步动作。
                </p>
                <Link
                  href="/"
                  className="linear-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  返回工作台开始
                </Link>
              </div>
            ) : isSearchEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-white/70 p-8">
                <p className="text-lg font-semibold text-slate-950">没有匹配的任务</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  换个关键词，调整类型、人工状态或 Agent 状态筛选；也可以加载更多后继续筛选当前已加载任务。
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="linear-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  清空筛选
                </button>
              </div>
            ) : (
              <>
                <div className="mt-6 space-y-4">
                  {displayItems.map((item) => {
                    const open = openId === item.id;
                    const agentState = deriveAgentNextStepPanelState({
                      taskType: item.type,
                      decisionStatus: item.decisionStatus,
                      result: item.result,
                    });
                    const itemAgentStatus = agentState.agentStatus;
                    const highlighted = item.id === highlightedTaskId;
                    const summary = deriveTaskWorkflowSummary({
                      type: item.type,
                      title: item.title,
                      materialText: item.materialText,
                      oneLineSummary: item.oneLineSummary,
                      level: item.level,
                      decisionStatus: item.decisionStatus,
                      result: item.result,
                    });
                    const batchMeta = summary.batchMeta;
                    const sourceMeta = getTaskSourceMeta(item.result);
                    const batchGroup = batchMeta ? operationStats.batchGroups.get(batchMeta.batchId) : null;
                    return (
                      <article
                        key={item.id}
                        className={`linear-panel p-5 ${highlighted ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-200" : ""}`}
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                              <span className={mainlineTaskTypes.has(item.type || "") ? "text-teal-700" : "text-slate-400"}>
                                {mainlineTaskTypes.has(item.type || "") ? "主链路任务" : "旧版记录"}
                              </span>
                              {highlighted ? <span className="text-emerald-700">刚保存</span> : null}
                              <span>{formatDate(item.createdAt)}</span>
                            </div>
                            <h3 className="mt-2 truncate text-lg font-semibold tracking-tight text-slate-950">
                              {summary.productName}
                            </h3>
                            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-700">
                              {summary.verdictLabel}
                            </p>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              {[
                                ["优先级", summary.priorityLabel],
                                ["风险", summary.riskLabel],
                                ["新手适配", summary.beginnerLabel],
                                ["下一步", summary.primaryNextAction || getNextActionDisplay(item, agentState)],
                              ].map(([label, value]) => (
                                <div key={label} className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                                  <p className="text-xs font-bold text-slate-400">{label}</p>
                                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-800">{value}</p>
                                </div>
                              ))}
                            </div>
                            {batchMeta && batchGroup ? (
                              <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3">
                                <p className="text-sm font-bold text-indigo-800">批量摘要</p>
                                <p className="mt-1 text-xs leading-5 text-indigo-700">
                                  清单商品 {batchMeta.batchIndex}/{batchMeta.batchTotal} · 当前已加载 {batchGroup.loaded}/{batchGroup.total} 个 · 可跟进 {batchGroup.followable} 个 · 高风险/谨慎 {batchGroup.cautious} 个
                                </p>
                              </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                              <span>{getTaskTypeLabel(item)}</span>
                              <span>{getAgentTypeLabel(item)}</span>
                              <span>{extendedPlatformLabels[item.platform] || item.platform}</span>
                              <span>{sourceLabel(item.source)}</span>
                              {sourceMeta ? <span>来源：机会雷达</span> : null}
                              {batchMeta ? <span>清单商品 {batchMeta.batchIndex}/{batchMeta.batchTotal}</span> : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[360px] lg:justify-end">
                            <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + toneClass(summary.priorityTone)}>
                              {summary.priorityLabel}
                            </span>
                            <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + getTaskStatusClass()}>
                              {getTaskStatusLabel()}
                            </span>
                            <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + toneClass(summary.riskTone)}>
                              {summary.riskLabel}
                            </span>
                            <span className={"rounded-full border px-3 py-1 text-sm font-semibold " + getDecisionStatusOption(item.decisionStatus).className}>
                              {getDecisionStatusOption(item.decisionStatus).shortLabel}
                            </span>
                            <span
                              className={"rounded-full border px-3 py-1 text-sm font-semibold " + itemAgentStatus.className}
                              title={itemAgentStatus.description}
                            >
                              Agent：{itemAgentStatus.label}
                            </span>
                            {sourceMeta ? (
                              <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                                来源：机会雷达
                              </span>
                            ) : null}
                            <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
                              {item.score}/100
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-700">
                              {item.level}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenId(open ? "" : item.id)}
                              className="linear-button px-4 py-2 text-sm font-semibold"
                            >
                              {open ? "收起" : "展开详情"}
                            </button>
                            <Link
                              href={`/tasks/${item.id}`}
                              className="linear-button-primary px-4 py-2 text-sm font-semibold"
                            >
                              查看跟进面板
                            </Link>
                            <Link
                              href="/workflow/batch"
                              className="linear-button px-4 py-2 text-sm font-semibold"
                            >
                              继续批量分析
                            </Link>
                            <button
                              type="button"
                              onClick={() => void deleteRecord(item)}
                              disabled={deletingId === item.id}
                              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingId === item.id ? "删除中" : "删除"}
                            </button>
                          </div>
                        </div>

                        {open ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4 md:col-span-2">
                              <p className="text-sm font-bold text-slate-950">下一步动作</p>
                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                {summary.nextActions.slice(0, 4).map((action) => (
                                  <div key={action} className="rounded-xl border border-white/80 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                                    {action}
                                  </div>
                                ))}
                              </div>
                              <p className="mt-3 text-xs leading-5 text-teal-700">
                                {summary.reason} AI 结果只用于辅助判断，采购、上架、投广告等真实动作必须人工确认。
                              </p>
                            </div>
                            <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 md:col-span-2">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                  <p className="text-sm font-bold text-slate-950">人工决策状态</p>
                                  <p className="mt-1 text-sm leading-6 text-slate-600">
                                    {getDecisionStatusOption(item.decisionStatus).description} AI 结果仅供初筛，关键动作需人工确认。
                                  </p>
                                </div>
                                <select
                                  value={item.decisionStatus}
                                  onChange={(event) => void updateDecisionStatus(item, event.target.value as DecisionStatus)}
                                  disabled={updatingDecisionId === item.id}
                                  className="input-soft h-11 min-w-[160px] px-4 text-sm font-semibold text-slate-700 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {decisionStatusOptions.filter((option) => option.value).map((option) => (
                                    <option key={option.value} value={option.value}>{option.shortLabel}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4 md:col-span-2">
                              <p className="text-sm font-bold text-slate-950">执行步骤预留</p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                                {["已保存", "等待人工复核", "后续可重试", "后续可串联"].map((step) => (
                                  <span key={step} className="linear-pill px-2 py-1 text-xs text-slate-500">{step}</span>
                                ))}
                              </div>
                            </div>
                            <DetailList title="核心卖点" items={getStringArray(item.result, "sellingPoints")} />
                            <DetailList title="用户痛点" items={getStringArray(item.result, "painPoints")} />
                            <DetailList title="开头钩子" items={getStringArray(item.result, "hooks")} />
                            <DetailList title="风险提醒" items={getStringArray(item.result, "risks")} />
                            <div className="rounded-2xl border border-white/80 bg-slate-50 p-4 md:col-span-2">
                              <p className="text-sm font-bold text-slate-950">素材摘要</p>
                              <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-600">{item.materialText}</p>
                              {item.productUrl ? (
                                <p className="mt-2 break-all text-xs text-slate-500">链接：{item.productUrl}</p>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>

                {page?.hasMore ? (
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="linear-button inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingMore ? "加载中..." : "加载更多"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
