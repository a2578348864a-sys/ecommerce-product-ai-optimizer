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
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import {
  decisionStatusOptions,
  getDecisionStatusOption,
  type DecisionStatus,
} from "@/lib/tasks/decisionStatus";
import {
  buildBatchDeleteConfirmationMessage,
  buildTaskDeleteConfirmationMessage,
  hasAiListingPack,
  LISTING_PACK_FILTER_PARAM,
  LISTING_PACK_FILTER_LABEL,
} from "@/lib/tasks/listingSnapshotUi";
import { deriveTaskWorkflowSummary } from "@/lib/taskWorkflowSummary";
import { deriveProductResearchPresentation } from "@/lib/productResearchPresentation";
import { ResearchProductImage } from "@/components/ResearchProductImage";
import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";
import {
  getProductResearchDecisionLabel,
  isProductResearchDecisionStatus,
} from "@/lib/productResearchDecisionContract";
import {
  deriveHistoricalArtifactSummary,
  deriveResearchHistoryStatus,
} from "@/lib/taskResearchHistoryPresentation";

const defaultType = "";
const defaultDecisionStatus = "";
const defaultAgentStatus = "";
const defaultLimit = 10;
const taskTypes = TASK_TYPE_FILTER_OPTIONS;
const mainlineTaskTypes = new Set(["workflow", "opportunities"]);

type TaskCenterItem = {
  id: string;
  createdAt: string;
  updatedAt?: string;
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
  productImage: ResearchProductImageDisplay | null;
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
  return source === "ai" ? "AI" : source ? source : "其他来源";
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
  opportunities: "机会雷达分析",
  viral: "海外爆款趋势分析",
  radar: "爆款雷达分析",
  product: "选品利润分析",
  risk: "风险排查",
  sourcing: "货源判断",
  material: "素材接收",
  summary: "小白结论",
};

function getTaskStatusLabel() {
  return "已完成";
}

function getTaskStatusClass() {
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function getAgentStatus(item: TaskCenterItem) {
  const summary = getLegacyListSummary(item.result);
  if (summary && isRecordValue(summary.agent) && isRecordValue(summary.agent.agentStatus)) {
    return summary.agent.agentStatus as ReturnType<typeof deriveAgentNextStepPanelState>["agentStatus"];
  }
  return deriveAgentNextStepPanelState({
    taskType: item.type,
    decisionStatus: item.decisionStatus,
    result: item.result,
  }).agentStatus;
}

function getStringArray(result: unknown, key: string) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const summary = getLegacyListSummary(result);
  if (summary && isRecordValue(summary.details)) {
    const summarized = summary.details[key];
    return Array.isArray(summarized)
      ? summarized.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [];
  }
  const value = Reflect.get(result, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLegacyListSummary(result: unknown) {
  if (!isRecordValue(result) || !isRecordValue(result.legacyListSummary)) return null;
  return result.legacyListSummary;
}

function getWorkflowSummary(item: TaskCenterItem) {
  const summary = getLegacyListSummary(item.result);
  if (summary && isRecordValue(summary.workflow)) {
    return summary.workflow as ReturnType<typeof deriveTaskWorkflowSummary>;
  }
  return deriveTaskWorkflowSummary({
    type: item.type,
    title: item.title,
    materialText: item.materialText,
    oneLineSummary: item.oneLineSummary,
    level: item.level,
    decisionStatus: item.decisionStatus,
    result: item.result,
  });
}

function getPresentation(item: TaskCenterItem, productName: string) {
  const summary = getLegacyListSummary(item.result);
  if (summary && isRecordValue(summary.presentation)) {
    return summary.presentation as ReturnType<typeof deriveProductResearchPresentation>;
  }
  return deriveProductResearchPresentation({
    id: item.id,
    title: productName,
    type: item.type,
    decisionStatus: item.decisionStatus,
    result: item.result,
  });
}

function taskHasListingPack(item: TaskCenterItem) {
  const summary = getLegacyListSummary(item.result);
  return summary && typeof summary.hasListingPack === "boolean"
    ? summary.hasListingPack
    : hasAiListingPack(item.result);
}

function listingPackResultForUi(item: TaskCenterItem) {
  if (!getLegacyListSummary(item.result)) return item.result;
  return taskHasListingPack(item)
    ? { aiListingPackSnapshot: { snapshotType: "ai_listing_pack" } }
    : {};
}

function getVersionedDecisionSummary(result: unknown) {
  if (!isRecordValue(result) || !isRecordValue(result.productResearchSummary)) return null;
  const summary = result.productResearchSummary;
  if (summary.schema !== "product-research-record.v1"
    || !Number.isSafeInteger(summary.revision)
    || !isProductResearchDecisionStatus(summary.status)
    || typeof summary.reasonSummary !== "string") {
    return null;
  }
  return {
    revision: summary.revision as number,
    status: summary.status,
    reason: summary.reasonSummary,
    nextAction: typeof summary.nextActionSummary === "string"
      ? summary.nextActionSummary
      : null,
  };
}

export function TaskDecisionControl({
  taskId,
  result,
  legacyDecisionStatus,
}: {
  taskId: string;
  result: unknown;
  legacyDecisionStatus: DecisionStatus;
}) {
  const versioned = getVersionedDecisionSummary(result);
  if (versioned) {
    return (
      <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 md:col-span-2" data-testid="versioned-research-decision-summary">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-950">正式研究决定 · 版本 {versioned.revision}</p>
            <p className="mt-1 text-sm font-semibold text-teal-800">
              {getProductResearchDecisionLabel(versioned.status)}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{versioned.reason}</p>
            {versioned.nextAction ? (
              <p className="mt-1 text-xs leading-5 text-teal-700">下一步：{versioned.nextAction}</p>
            ) : null}
          </div>
          <Link href={`/tasks/${taskId}#product-research-decision`} className="linear-button inline-flex h-9 items-center px-3 text-xs font-semibold">
            打开正式决定面板
          </Link>
        </div>
      </div>
    );
  }
  // F10：列表不再提供第二套决定修改入口（Decision authority 收敛到 Research Workbench）
  return (
    <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 md:col-span-2" data-testid="legacy-decision-control">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-950">人工决策状态</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {getDecisionStatusOption(legacyDecisionStatus).shortLabel}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {getDecisionStatusOption(legacyDecisionStatus).description}
            </span>
          </p>
        </div>
        <Link href={`/tasks/${taskId}#product-research-decision`} className="linear-button inline-flex h-9 items-center px-3 text-xs font-semibold">
          前往研究详情修改
        </Link>
      </div>
    </div>
  );
}

function getReviewDisplay(item: TaskCenterItem, agentState: ReturnType<typeof deriveAgentNextStepPanelState>) {
  if (item.type !== "workflow") return "普通记录";
  if (!agentState.reviewState.exists) return "缺少复核状态";
  return agentState.reviewState.allReviewed
    ? `已复核 ${agentState.reviewState.reviewedCount}/${agentState.reviewState.totalReviewSteps}`
    : `待复核 ${agentState.reviewState.reviewedCount}/${agentState.reviewState.totalReviewSteps}`;
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

function updateBrowserQuery(type: string, q: string, decisionStatus: string, agentStatus: string, hasListingPack: string, scope = "") {
  const params = new URLSearchParams();
  if (type && type !== defaultType) params.set("type", type);
  if (q) params.set("q", q);
  if (decisionStatus && decisionStatus !== defaultDecisionStatus) params.set("decisionStatus", decisionStatus);
  if (agentStatus && agentStatus !== defaultAgentStatus) params.set("agentStatus", agentStatus);
  if (hasListingPack === "1") params.set(LISTING_PACK_FILTER_PARAM, "1");
  if (scope) params.set("scope", scope);
  const query = params.toString();
  window.history.pushState(null, "", query ? `/tasks?${query}` : "/tasks");
}

export function TaskDetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  const uniqueItems = Array.from(new Set(items));

  return (
    <div className="surface-card-soft rounded-[22px] p-4">
      <p className="text-sm font-bold text-slate-950">{title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
        {uniqueItems.map((item) => (
          <li key={`${title}:${item}`}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function TaskRecordsList({ view = "records" }: { view?: "research" | "records" }) {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const [items, setItems] = useState<TaskCenterItem[]>([]);
  const [page, setPage] = useState<TaskPageInfo | null>(null);
  const [type, setType] = useState(defaultType);
  const [decisionStatus, setDecisionStatus] = useState(defaultDecisionStatus);
  const [agentStatus, setAgentStatus] = useState<"" | AgentStatusKey>(defaultAgentStatus);
  // OA1（Option B）：研究记录内部进度分组（进行中/待补信息/已完成/已放弃）
  const [scope, setScope] = useState<"" | "research" | "historical" | "active" | "need_info" | "completed" | "abandoned">(view === "research" ? "research" : "historical");

  function onScopeChange(nextScope: "" | "research" | "historical" | "active" | "need_info" | "completed" | "abandoned") {
    setScope(nextScope);
    void loadTasks({
      nextType: type,
      nextDecisionStatus: decisionStatus,
      nextAgentStatus: agentStatus,
      nextScope,
      q: activeQuery,
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }
  const [hasListingPackFilter, setHasListingPackFilter] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [highlightedTaskId, setHighlightedTaskId] = useState("");

  // Phase Action-Clean-M.1: batch selection + action menu
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [openMoreId, setOpenMoreId] = useState<string | null>(null);

  const loadTasks = useCallback(async ({
    nextType,
    nextDecisionStatus,
    nextAgentStatus,
    nextScope,
    q,
    offset,
    mode,
    syncUrl,
  }: {
    nextType: string;
    nextDecisionStatus: string;
    nextAgentStatus: "" | AgentStatusKey;
    nextScope: "" | "research" | "historical" | "active" | "need_info" | "completed" | "abandoned";
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
      if (nextScope) params.set("scope", nextScope);

      const response = await fetch(`/api/tasks?${params.toString()}`, {
        cache: "no-store",
        headers: { ...buildAccessHeaders() },
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok) {
        setError(!data.ok && data.error?.message ? data.error.message : "任务记录读取失败，请稍后重试。");
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
      if (syncUrl) updateBrowserQuery(nextType, q, nextDecisionStatus, nextAgentStatus, hasListingPackFilter ? "1" : "", nextScope);
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
    const initialHasListingPack = params.get(LISTING_PACK_FILTER_PARAM) === "1";
    const initialScope = params.get("scope") || "";
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
    // OA1：默认"进行中"；URL scope 显式指定时遵循
    // R5：默认按视图（research→active 全集 / records→历史）；URL scope 显式指定时遵循
    const safeScope = (["research", "historical", "active", "need_info", "completed", "abandoned"].includes(initialScope)
      ? initialScope
      : initialDecisionStatus
        ? ""
        : view === "research" ? "research" : "historical") as "" | "research" | "historical" | "active" | "need_info" | "completed" | "abandoned";
    setDecisionStatus(safeDecisionStatus);
    setAgentStatus(safeAgentStatus);
    setScope(safeScope);
    setHasListingPackFilter(initialHasListingPack);
    setHighlightedTaskId(initialHighlight);
    setQueryInput(initialQuery);
    setActiveQuery(initialQuery);
    void loadTasks({
      nextType: safeType,
      nextDecisionStatus: safeDecisionStatus,
      nextAgentStatus: safeAgentStatus,
      nextScope: safeScope,
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
      nextScope: scope,
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
      nextScope: scope,
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
      nextScope: scope,
      q: activeQuery,
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function onAgentStatusChange(nextAgentStatus: "" | AgentStatusKey) {
    setAgentStatus(nextAgentStatus);
    updateBrowserQuery(type, activeQuery, decisionStatus, nextAgentStatus, hasListingPackFilter ? "1" : "");
    setOpenId("");
  }

  function clearFilters() {
    setQueryInput("");
    setHasListingPackFilter(false);
    void loadTasks({
      nextType: defaultType,
      nextDecisionStatus: defaultDecisionStatus,
      nextAgentStatus: defaultAgentStatus,
      nextScope: scope,
      q: "",
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function toggleHasListingPackFilter() {
    setHasListingPackFilter((prev) => {
      const next = !prev;
      updateBrowserQuery(type, activeQuery, decisionStatus, agentStatus, next ? "1" : "");
      return next;
    });
  }

  function retryLoad() {
    void loadTasks({
      nextType: type,
      nextDecisionStatus: decisionStatus,
      nextAgentStatus: agentStatus,
      nextScope: scope,
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
      nextScope: scope,
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

    const confirmed = window.confirm(buildTaskDeleteConfirmationMessage({
      title: getTitle(item),
      result: listingPackResultForUi(item),
    }));
    if (!confirmed) return;

    setDeletingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { ...buildAccessHeaders() },
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

  // Phase Action-Clean-M.1: selection helpers
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllCurrent() {
    setSelectedIds(new Set(displayItems.map((item) => item.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function batchDeleteSelected() {
    if (selectedIds.size === 0 || batchDeleting) return;
    const ids = [...selectedIds];
    const hasListingPackSnapshot = items.some((item) => (
      selectedIds.has(item.id) && taskHasListingPack(item)
    ));
    const confirmed = window.confirm(
      buildBatchDeleteConfirmationMessage({
        count: ids.length,
        hasListingPackSnapshot,
      })
    );
    if (!confirmed) return;

    setBatchDeleting(true);
    setError("");
    const failed: string[] = [];

    for (const id of ids) {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { ...buildAccessHeaders() },
        });
        const data = await response.json() as
          | { ok: true; data: { id: string } }
          | { ok: false; error: { code: string; message: string } };
        if (!response.ok || !data.ok) {
          failed.push(id);
        }
      } catch {
        failed.push(id);
      }
    }

    // Remove successful deletions from list
    if (failed.length < ids.length) {
      const failedSet = new Set(failed);
      setItems((current) => current.filter((item) => !selectedIds.has(item.id) || failedSet.has(item.id)));
      setPage((current) => current
        ? { ...current, total: Math.max(0, current.total - (ids.length - failed.length)) }
        : current);
    }

    if (failed.length > 0) {
      setError(`${failed.length}/${ids.length} 条删除失败，请稍后重试。`);
    }

    setBatchDeleting(false);
    setSelectedIds(new Set());
  }

  const visibleItems = (() => {
    let result = items;
    if (agentStatus) result = result.filter((item) => getAgentStatus(item).key === agentStatus);
    if (hasListingPackFilter) result = result.filter(taskHasListingPack);
    return result;
  })();
  const hasActiveFilters = Boolean(activeQuery || type !== defaultType || decisionStatus !== defaultDecisionStatus || agentStatus !== defaultAgentStatus || hasListingPackFilter || scope !== "");
  // OA1：进度分组下的空态（区分"该分组没有"与"完全没有记录"）
  const isScopeEmpty = !loading && !error && visibleItems.length === 0 && scope !== "";
  const highlightedItemExists = Boolean(highlightedTaskId && visibleItems.some((item) => item.id === highlightedTaskId));
  const displayItems = useMemo(() => [...visibleItems].sort((a, b) => {
    const priorityDiff = getPriorityScore(b, highlightedTaskId, hasActiveFilters) - getPriorityScore(a, highlightedTaskId, hasActiveFilters);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  }), [hasActiveFilters, highlightedTaskId, visibleItems]);
  const isListingPackEmpty = !loading && !error && visibleItems.length === 0 && hasListingPackFilter && items.length > 0;
  const isSearchEmpty = !loading && !error && visibleItems.length === 0 && hasActiveFilters && !isListingPackEmpty;
  const isDefaultEmpty = !loading && !error && visibleItems.length === 0 && !hasActiveFilters;

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="研究记录" returnUrl="/tasks" />;
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{view === "research" ? "Active Research" : "Research History"}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{view === "research" ? "商品研究" : "研究记录"}</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {view === "research"
                  ? "继续正在进行或等待补充资料的商品研究，进入商品研究工作台。"
                  : "查看已经形成历史结果的研究：已完成、已放弃与旧版记录。"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/opportunities" className="linear-button inline-flex h-11 items-center justify-center px-4 text-sm font-semibold">
                  发现商品
                </Link>
                <Link href="/opportunity-candidates" className="linear-button inline-flex h-11 items-center justify-center px-4 text-sm font-semibold">
                  商品研究池
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
                <p className="text-sm font-bold text-teal-700">{view === "research" ? "商品研究" : "研究记录"}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{view === "research" ? "商品研究" : "研究记录"}</h2>
                <p className="muted-text mt-1 text-sm">{view === "research"
                  ? "继续正在进行或等待补充资料的商品研究。"
                  : "已经形成历史结果的研究：已完成、已放弃与旧版记录。"}</p>
              </div>
              <span className="status-pill px-3 py-1 text-sm">
                {page ? `${page.total} 条` : `${items.length} 条`}
              </span>
            </div>

            {/* OA1（Option B）：进度分组 Tab（进行中/待补信息/已完成/已放弃） */}
            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="研究进度分组">
              {((view === "research"
                ? [
                  { value: "research", label: "进行中" },
                  { value: "need_info", label: "待补信息" },
                  { value: "", label: "全部" },
                ]
                : [
                  { value: "completed", label: "已完成" },
                  { value: "abandoned", label: "已放弃" },
                  { value: "historical", label: "历史" },
                  { value: "", label: "全部" },
                ]
               ) as Array<{ value: "" | "research" | "historical" | "active" | "need_info" | "completed" | "abandoned"; label: string }>).map((tab) => (
                <button
                  key={tab.value || "all"}
                  type="button"
                  role="tab"
                  aria-selected={scope === tab.value}
                  onClick={() => onScopeChange(tab.value)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
                    scope === tab.value
                      ? "border-teal-300 bg-teal-50 text-teal-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
                筛选和搜索
                {hasActiveFilters ? <span className="ml-2 text-teal-700">已启用</span> : <span className="ml-2 text-slate-400">默认收起</span>}
              </summary>
              <form onSubmit={submitSearch} className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_200px_170px_210px_auto_auto]">
              <label className="min-w-0">
                <span className="text-xs font-bold text-slate-500">搜索关键词</span>
                <input
                  name="q"
                  autoComplete="off"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="例如：桌面收纳盒…"
                  className="input-soft mt-2 h-11 w-full px-4 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                />
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">类型筛选</span>
                <select
                  name="type"
                  value={type}
                  onChange={(event) => onTypeChange(event.target.value)}
                  className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                  {taskTypes.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">人工状态</span>
                <select
                  name="decisionStatus"
                  value={decisionStatus}
                  onChange={(event) => onDecisionStatusChange(event.target.value)}
                  className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                  {decisionStatusOptions.map((item) => (
                    <option key={item.value || "all"} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">技术状态（高级）</span>
                <select
                  name="agentStatus"
                  value={agentStatus}
                  onChange={(event) => onAgentStatusChange(event.target.value as "" | AgentStatusKey)}
                  className="input-soft mt-2 h-11 w-full px-4 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                  {agentStatusFilterOptions.map((item) => (
                    <option key={item.value || "all"} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end">
                <input
                  type="checkbox"
                  checked={hasListingPackFilter}
                  onChange={toggleHasListingPackFilter}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-xs font-bold text-slate-700">{LISTING_PACK_FILTER_LABEL}</span>
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
            </details>

            {activeQuery ? (
              <p className="mt-3 text-sm text-slate-500">
                当前搜索：<span className="font-bold text-slate-800">{activeQuery}</span>
              </p>
            ) : null}
            {agentStatus ? (
              <p className="mt-2 text-sm text-slate-500">
                当前任务状态筛选：
                <span className="font-bold text-slate-800">
                  {agentStatusFilterOptions.find((item) => item.value === agentStatus)?.label || "未知状态"}
                </span>
                <span className="ml-2 text-xs text-slate-400">基于当前已加载任务前端筛选。</span>
              </p>
            ) : null}
            {hasListingPackFilter ? (
              <p className="mt-2 text-sm text-slate-500">
                当前显示：
                <span className="font-bold text-violet-700">{LISTING_PACK_FILTER_LABEL}</span>
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
                正在读取研究记录…
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
            ) : isScopeEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-teal-200 bg-teal-50/50 p-8">
                {scope === "research" || scope === "active" ? (
                  <>
                    <p className="text-lg font-semibold text-slate-950">当前没有正在研究的商品</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      在「待研究商品」中选择商品开始研究后，会显示在这里。
                    </p>
                    <Link
                      href="/opportunity-candidates"
                      className="linear-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                    >
                      去待研究商品
                    </Link>
                  </>
                ) : scope === "need_info" ? (
                  <>
                    <p className="text-lg font-semibold text-slate-950">没有待补资料的研究</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      这类研究仍需要补充资料后再做决定；当前没有需要补资料的商品。
                    </p>
                  </>
                ) : scope === "historical" ? (
                  <>
                    <p className="text-lg font-semibold text-slate-950">还没有历史研究记录</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      完成研究并做人工决定，或放弃研究后，记录会显示在这里。
                    </p>
                  </>
                ) : scope === "completed" ? (
                  <>
                    <p className="text-lg font-semibold text-slate-950">还没有完成的研究</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      完成研究并做人工决定后，记录会显示在这里。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-slate-950">没有已放弃的研究</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">暂无放弃的研究记录。</p>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onScopeChange("")}
                  className="linear-button mt-4 inline-flex h-10 items-center justify-center px-4 text-sm font-semibold"
                >
                  查看全部研究
                </button>
              </div>
            ) : isDefaultEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-teal-200 bg-teal-50/50 p-8">
                <p className="text-lg font-semibold text-slate-950">还没有商品研究记录</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  从「发现商品」选择候选，完成商品研究并保存结果后，这里会按商品保留研究结论和人工决定。
                </p>
                <Link
                  href="/"
                  className="linear-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  返回工作台开始
                </Link>
              </div>
            ) : isListingPackEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-violet-200 bg-violet-50/60 p-8">
                <p className="text-lg font-semibold text-slate-950">暂无已保存 Listing 包的任务</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  当前已加载的任务中没有包含已保存 Listing 包的记录。请加载更多任务，或关闭筛选查看全部任务。
                </p>
                <button
                  type="button"
                  onClick={toggleHasListingPackFilter}
                  className="linear-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  关闭筛选
                </button>
              </div>
            ) : isSearchEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-white/70 p-8">
                <p className="text-lg font-semibold text-slate-950">没有匹配的任务</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  换个关键词，调整类型、人工状态或任务状态筛选；也可以加载更多后继续筛选当前已加载任务。
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
                {/* Phase Action-Clean-M.1: Batch selection toolbar */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!selectMode ? (
                    <button
                      type="button"
                      onClick={() => setSelectMode(true)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      选择记录
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                      <span className="text-xs font-semibold text-blue-700">
                        已选择 {selectedIds.size} 条
                      </span>
                      <button type="button" onClick={selectAllCurrent}
                        className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-100">
                        全选当前页
                      </button>
                      <button type="button" onClick={clearSelection}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
                        取消选择
                      </button>
                      <button type="button" onClick={() => void batchDeleteSelected()} disabled={selectedIds.size === 0 || batchDeleting}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                        {batchDeleting ? "删除中…" : `删除选中 (${selectedIds.size})`}
                      </button>
                      <button type="button" onClick={exitSelectMode}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
                        退出选择模式
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-6 space-y-4">
                  {displayItems.map((item) => {
                    const open = openId === item.id;
                    const agentState = (getLegacyListSummary(item.result)?.agent as ReturnType<typeof deriveAgentNextStepPanelState>
                      | undefined) ?? deriveAgentNextStepPanelState({
                        taskType: item.type,
                        decisionStatus: item.decisionStatus,
                        result: item.result,
                      });
                    const itemAgentStatus = agentState.agentStatus;
                    const highlighted = item.id === highlightedTaskId;
                    const summary = getWorkflowSummary(item);
                    const presentation = getPresentation(item, summary.productName);
                    const researchStatus = deriveResearchHistoryStatus({
                      result: item.result,
                      decisionStatus: item.decisionStatus,
                      oneLineSummary: item.oneLineSummary,
                    });
                    const artifacts = deriveHistoricalArtifactSummary(item.result);
                    const versionedDecision = getVersionedDecisionSummary(item.result);
                    const decisionLabel = versionedDecision
                      ? getProductResearchDecisionLabel(versionedDecision.status)
                      : getDecisionStatusOption(item.decisionStatus).shortLabel;
                    const artifactLabel = [
                      artifacts.hasListing ? "Listing 有" : "Listing 无",
                      artifacts.hasImages ? `图片 ${artifacts.imageCount} 张` : "图片无",
                    ].join(" · ");
                    return (
                      <article
                        key={item.id}
                        className={`linear-panel p-5 ${highlighted ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-200" : ""}`}
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-3">
                              <ResearchProductImage
                                image={item.productImage}
                                alt={summary.productName}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                                  <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                                    {sourceLabel(item.source)}
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                                    {researchStatus.label}
                                  </span>
                                  {highlighted ? <span className="text-emerald-700">刚保存</span> : null}
                                  <span>最后更新 {formatDate(item.updatedAt || item.createdAt)}</span>
                                </div>
                                <h3 className="mt-2 truncate text-lg font-semibold tracking-tight text-slate-950">
                                  {summary.productName}
                                </h3>
                                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-700">
                                  {presentation.researchConclusions[0] || summary.verdictLabel}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              {[
                                ["来源", sourceLabel(item.source)],
                                ["研究状态", researchStatus.label],
                                ["当前决定", decisionLabel],
                                ["风险", summary.riskLabel],
                              ].map(([label, value]) => (
                                <div key={label} className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                                  <p className="text-xs font-bold text-slate-400">{label}</p>
                                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-800">{value}</p>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                                历史成果：{artifactLabel}
                              </span>
                              <span className="text-xs text-slate-500">研究时间：{formatDate(item.createdAt)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[300px] lg:justify-end">
                            {/* Checkbox in select mode */}
                            {selectMode ? (
                              <input
                                type="checkbox"
                                aria-label={`选择 ${summary.productName}`}
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelect(item.id)}
                                className="size-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            ) : null}
                            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                              {researchStatus.label}
                            </span>
                            {/* Primary actions（OA3：新任务不误导为"结果"） */}
                            <Link
                              href={view === "research" ? `/tasks/${item.id}?from=research` : `/tasks/${item.id}`}
                              className="linear-button-primary inline-flex h-8 items-center px-3 text-xs font-semibold"
                            >
                              {view === "research" ? "继续研究" : (researchStatus.key === "completed" ? "查看研究记录" : "打开研究")}
                            </Link>
                            <button
                              type="button"
                              onClick={() => setOpenId(open ? "" : item.id)}
                              className="linear-button inline-flex h-8 items-center px-3 text-xs font-semibold"
                            >
                              {open ? "收起更多" : "查看更多"}
                            </button>
                            {/* More actions dropdown */}
                            <div className="relative">
                              <button
                                type="button"
                                aria-label={`更多操作：${summary.productName}`}
                                aria-expanded={openMoreId === item.id}
                                aria-haspopup="menu"
                                onClick={() => setOpenMoreId(openMoreId === item.id ? null : item.id)}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                              >
                                ···
                              </button>
                              {openMoreId === item.id ? (
                                <>
                                  <button
                                    type="button"
                                    aria-label="关闭更多操作"
                                    className="fixed inset-0 z-10 cursor-default"
                                    onClick={() => setOpenMoreId(null)}
                                  />
                                  <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { void deleteRecord(item); setOpenMoreId(null); }}
                                      disabled={deletingId === item.id}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                    >
                                      {deletingId === item.id ? "删除中…" : "删除"}
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {open ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4 md:col-span-2">
                              <p className="text-sm font-bold text-slate-950">研究摘要</p>
                              <p className="mt-2 text-sm leading-6 text-slate-700">
                                {presentation.researchConclusions[0] || summary.verdictLabel}
                              </p>
                              <p className="mt-3 text-xs leading-5 text-teal-700">AI 结果只用于辅助判断，采购、上架、投广告等真实动作必须人工确认。</p>
                            </div>
                            <TaskDecisionControl
                              taskId={item.id}
                              result={item.result}
                              legacyDecisionStatus={item.decisionStatus}
                            />
                            <TaskDetailList title="核心卖点" items={getStringArray(item.result, "sellingPoints")} />
                            <TaskDetailList title="用户痛点" items={getStringArray(item.result, "painPoints")} />
                            <TaskDetailList title="开头钩子" items={getStringArray(item.result, "hooks")} />
                            <TaskDetailList title="风险提醒" items={getStringArray(item.result, "risks")} />
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
                      {loadingMore ? "加载中…" : "加载更多"}
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
