"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Image,
  Loader2,
  Lock,
  Search,
  Sparkles,
  Unlock,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders, getAccessMode } from "@/lib/client/accessToken";
import { serverCandidateToPoolItem, type OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";
import {
  getRecommendedNextAction,
  parseRecentSingleRun,
  summarizeCandidatePool,
  summarizeTaskFollowUp,
  WORKFLOW_SINGLE_RUN_STORAGE_KEY,
  type HomeDashboardTaskItem,
  type TaskFollowUpSummary,
} from "@/lib/homeDashboardSummary";
import { V4Hero } from "@/components/v4/home/V4Hero";
import { V4Workflow } from "@/components/v4/home/V4Workflow";
import { V4ValueCards } from "@/components/v4/home/V4ValueCards";
import { V4FeaturedReplayCard } from "@/components/v4/home/V4FeaturedReplayCard";
import { V4BoundaryNotice } from "@/components/v4/home/V4BoundaryNotice";
import type { FeaturedReplay, HomeRuntime } from "@/components/v4/home/heroLogic";
import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";
import { resolveTaskProductDisplayName } from "@/lib/productDisplayName";
import { deriveResearchHistoryStatus, type ResearchHistoryStatus } from "@/lib/taskResearchHistoryPresentation";
import { collectPagedTasks, deriveProductProjectGroup, ProductResearchTasksUnavailableError } from "@/lib/researchLifecycle";
export { collectPagedTasks, ProductResearchTasksUnavailableError } from "@/lib/researchLifecycle";

async function collectStartableCandidateCount(): Promise<number> {
  // 轮 7：可研究唯一依据 = isCandidateResearchActionAvailable（服务端返回 researchAction 后客户端过滤）
  const all = await collectPagedTasks<{ id: string; researchAction?: string }>(async (offset) => {
    const response = await fetch("/api/opportunity-candidates?limit=100&offset=" + offset, {
      headers: { ...buildAccessHeaders() },
      cache: "no-store",
    });
    const json = await response.json().catch(() => null) as { ok?: boolean; items?: Array<{ id: string; researchAction?: string }>; hasMore?: boolean } | null;
    if (!response.ok || !json?.ok || !Array.isArray(json.items)) return null;
    return { items: json.items, hasMore: json.hasMore === true };
  });
  return all.filter((item) => item.researchAction === "research_available" || item.researchAction === "runtime_validation_required").length;
}

/** 轮 7：首页研究入口唯一路由（可研究计数未知 → 不可用 + 重试；0 → 发现商品；>0 → startable）。 */
export function resolveStartResearchHref(availableCount: number | null | undefined): { href: string | null; unavailable: boolean } {
  if (availableCount === null || availableCount === undefined) return { href: null, unavailable: true };
  if (availableCount > 0) return { href: "/opportunity-candidates?view=startable", unavailable: false };
  return { href: "/opportunities", unavailable: false };
}
import { ResearchProductImage } from "@/components/ResearchProductImage";
import type { DecisionStatus } from "@/lib/tasks/decisionStatus";

type TasksApiResponse =
  | { ok: true; records?: HomeDashboardTaskItem[]; data?: { items?: HomeDashboardTaskItem[] } }
  | { ok: false; error?: { message?: string } };

type TaskLoadState =
  | { status: "loading"; summary: null; message: string }
  | { status: "ready"; summary: TaskFollowUpSummary; message: string }
  | { status: "unavailable"; summary: null; message: string };

type CandidateLoadState =
  | { status: "loading"; items: OpportunityCandidatePoolItem[]; total: number; message: string }
  | { status: "ready"; items: OpportunityCandidatePoolItem[]; total: number; message: string }
  | { status: "unavailable"; items: OpportunityCandidatePoolItem[]; total: number; message: string };

const taskFallbackMessage = "输入访问密码后显示真实研究记录统计。";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatRecentTime(value: number | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StatCard({
  title,
  value,
  description,
  href,
  cta,
  tone = "teal",
}: {
  title: string;
  value: string;
  description: string;
  href: string;
  cta: string;
  tone?: "teal" | "amber" | "indigo" | "slate";
}) {
  const toneClass = tone === "amber"
    ? "border-amber-200 bg-amber-50/65 text-amber-700"
    : tone === "indigo"
      ? "border-indigo-200 bg-indigo-50/65 text-indigo-700"
      : tone === "slate"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-teal-200 bg-teal-50/70 text-teal-700";

  return (
    <article className="surface-card-strong flex min-h-[190px] min-w-0 flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">{title}</p>
        <span className={"rounded-full border px-2 py-1 text-xs font-semibold " + toneClass}>{cta}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{description}</p>
      <Link href={href} className="linear-button mt-4 inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold">
        {cta}
        <ArrowRight className="size-4" />
      </Link>
    </article>
  );
}

export const homeWorkflowSteps = [
  {
    id: "discover-products",
    label: "发现商品",
    href: "/opportunities",
    cta: "去发现商品",
    description: "上传报表，筛选候选商品。",
    icon: Search,
  },
  {
    id: "research-products",
    label: "商品研究",
    href: "/opportunity-candidates",
    cta: "打开待研究商品",
    description: "整理信息，评估风险，恢复或开始研究。",
    icon: Sparkles,
  },
  {
    id: "make-research-decision",
    label: "人工决策",
    href: "/tasks",
    cta: "打开研究记录",
    description: "在任务详情确认继续、暂缓或放弃。",
    icon: ClipboardCheck,
  },
  {
    id: "prepare-creative-materials",
    label: "创作资料",
    href: "/tasks",
    cta: "在任务详情确认",
    description: "确认事实与视觉参考，准备创作资料。",
    icon: FileText,
  },
  {
    id: "review-content-drafts",
    label: "内容草稿",
    href: "/tasks",
    cta: "在任务详情生成",
    description: "生成 Listing 草稿与产品图片，人工复核。",
    icon: Image,
  },
] as const;

function productLanguage(value: string) {
  return value
    .replaceAll("机会雷达", "发现商品")
    .replaceAll("候选池", "候选商品")
    .replaceAll("单品分析", "商品研究")
    .replaceAll("任务中心", "研究记录");
}

/** 兼容旧调用：无 props 时默认本地语义（flag OFF、非无认证回环），保证既有渲染/测试不回归。 */
const DEFAULT_RUNTIME: HomeRuntime = { mode: "local_owner", noAuthOwner: false, v4Graph: false };

// ─────────────────────────────────────────────────────────────
// V4.1 C 端本地工作台（local_owner）：商品研究进度 + 下一步由你决定。
// 普通页面只出现中文用户语言；内部状态码只在分组逻辑中使用，
// 展示统一走 userLanguage（userStatus / NEXT_ACTION_USER_LABELS）。
// ─────────────────────────────────────────────────────────────

export type LocalTaskItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  decisionStatus: DecisionStatus;
  title: string | null;
  materialText: string;
  oneLineSummary: string;
  result: unknown;
  productImage: ResearchProductImageDisplay | null;
  productProjectKey: string;
  /** 服务端正式安全投影的 AI 运行状态（research_stale/running/waiting/failed_recoverable/failed_terminal/cancelled/completed/not_started）。 */
  aiRunStatus?: string;
  /** 服务端从该候选最新 V4ResearchRun 给出的 run.updatedAt（研究尝试真正时间源）；无 run 时不下发。 */
  runUpdatedAt?: string;
};

type LocalTasksResponse =
  | { ok: true; records?: LocalTaskItem[]; data?: { items?: LocalTaskItem[] }; page?: { hasMore?: boolean } }
  | { ok: false; error?: { message?: string } };

export type LocalProductProject = {
  key: string;
  task: LocalTaskItem;
  taskCount: number;
  productName: string;
  category: string;
  market: string;
  conclusion: string;
  researchStatus: ResearchHistoryStatus;
  group: "needs_action" | "researching" | "completed";
  statusLabel: string;
  nextLabel: string;
};

function isLocalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** 市场代码 → 用户可读站点名（C 端不暴露内部主机/代码；未映射 → 诚实「市场待补充」）。 */
const LOCAL_MARKET_LABELS: Record<string, string> = {
  "amazon.com": "Amazon 美国站",
  "amazon.ca": "Amazon 加拿大站",
  "amazon.co.uk": "Amazon 英国站",
  "amazon.de": "Amazon 德国站",
  "amazon.fr": "Amazon 法国站",
  "amazon.it": "Amazon 意大利站",
  "amazon.es": "Amazon 西班牙站",
  "amazon_us": "Amazon 美国站",
  us: "美国站",
  uk: "英国站",
  "1688.com": "1688 供应",
  "1688": "1688 供应",
};

function localMarketLabel(marketplace: string | null): string {
  if (!marketplace) return "市场待补充";
  const trimmed = marketplace.trim();
  return LOCAL_MARKET_LABELS[trimmed.toLowerCase()] ?? LOCAL_MARKET_LABELS[trimmed] ?? "市场待补充";
}

function isLocalTaskItem(value: unknown): value is LocalTaskItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && typeof v.type === "string"
    && typeof v.decisionStatus === "string"
    && typeof v.updatedAt === "string"
    && typeof v.productProjectKey === "string"
    && v.productProjectKey.startsWith("ppk_");
}

function localProductMeta(result: unknown) {
  if (!isLocalRecord(result)) return { category: "类目尚未取得", market: "市场尚未取得" };
  const context = isLocalRecord(result.candidateAnalysisContext) ? result.candidateAnalysisContext : null;
  const facts = context && isLocalRecord(context.facts) ? context.facts : null;
  return {
    category: localText(facts?.category) || localText(facts?.rootCategory) || "类目尚未取得",
    market: localMarketLabel(localText(facts?.marketplace) || null),
  };
}

function localConclusion(task: LocalTaskItem) {
  const result = isLocalRecord(task.result) ? task.result : null;
  const legacy = result && isLocalRecord(result.legacyListSummary) ? result.legacyListSummary : null;
  const presentation = legacy && isLocalRecord(legacy.presentation) ? legacy.presentation : null;
  const conclusions = Array.isArray(presentation?.researchConclusions)
    ? presentation.researchConclusions.map(localText).filter(Boolean)
    : [];
  if (conclusions[0]) return conclusions[0];
  const workflow = legacy && isLocalRecord(legacy.workflow) ? legacy.workflow : null;
  const verdict = localText(workflow?.verdictLabel);
  if (verdict && !["暂无", "未知", "待确认"].includes(verdict)) return verdict;
  const storedSummary = localText(task.oneLineSummary);
  return storedSummary || "AI 研究结论尚未取得。";
}

/** 服务端正式投影状态 → 三组语义。失败/取消终态优先于旧研究/决定（§2.4）。 */
function localProjectState(task: LocalTaskItem, researchStatus: ResearchHistoryStatus) {
  // 轮 6：与 /research 共用同一口径（唯一分类器）
  return deriveProductProjectGroup({
    aiRunStatus: task.aiRunStatus,
    decisionStatus: task.decisionStatus,
    result: task.result,
    oneLineSummary: task.oneLineSummary,
  });
}

/** §2.1 正式工作台数据域读取（完整分页 + 只保留正式商品研究任务）；任何失败 → unavailable。 */
export type WorkbenchTasksLoadResult =
  | { status: "ready"; tasks: LocalTaskItem[] }
  | { status: "unavailable" };

export async function loadWorkbenchTasks(
  fetchPage: (offset: number) => Promise<{ items: LocalTaskItem[]; hasMore: boolean } | null>,
): Promise<WorkbenchTasksLoadResult> {
  let all: LocalTaskItem[] | null = null;
  try {
    all = await collectPagedTasks(fetchPage);
  } catch {
    all = null;
  }
  if (!all) return { status: "unavailable" };
  return { status: "ready", tasks: all.filter((task) => task.type === "workflow") };
}

function taskTime(task: LocalTaskItem) {
  const value = Date.parse(task.updatedAt || task.createdAt);
  return Number.isFinite(value) ? value : 0;
}

/**
 * §6 项目时间戳：max(最新 run 更新, 任务更新时间)。
 * 研究尝试的最新性以服务端 runUpdatedAt 为准（V4ResearchRun.updatedAt），
 * 不能只依赖可能未随 run 更新的任务 updatedAt。
 */
function taskRecency(task: LocalTaskItem) {
  const runValue = Date.parse(task.runUpdatedAt ?? "");
  const runTime = Number.isFinite(runValue) ? runValue : Number.MIN_SAFE_INTEGER;
  return Math.max(runTime, taskTime(task));
}

/**
 * 最终确定性排序契约（与 Formal v2 文档一致）：
 * 1) max(runUpdatedAt, task.updatedAt) 降序（项目新鲜度）
 * 2) task.updatedAt 降序
 * 3) task.id 字典序升序
 * 结果与 API 输入顺序无关。
 */
function compareTaskFreshness(left: LocalTaskItem, right: LocalTaskItem): number {
  const recencyDiff = taskRecency(right) - taskRecency(left);
  if (recencyDiff !== 0) return recencyDiff;
  const timeDiff = taskTime(right) - taskTime(left);
  if (timeDiff !== 0) return timeDiff;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareProjectFreshness(left: LocalProductProject, right: LocalProductProject): number {
  return compareTaskFreshness(left.task, right.task);
}

export function buildLocalProductProjects(tasks: LocalTaskItem[]): LocalProductProject[] {
  const groups = new Map<string, LocalTaskItem[]>();
  for (const task of tasks) {
    const key = localText(task.productProjectKey) || `task:${task.id}`;
    const existing = groups.get(key);
    if (existing) existing.push(task);
    else groups.set(key, [task]);
  }

  return Array.from(groups.entries())
    .map(([key, groupedTasks]) => {
      const sorted = groupedTasks.toSorted(compareTaskFreshness);
      // 规则（§6/最终冻结）：项目代表 = max(max(runUpdatedAt, updatedAt)) 降序 → updatedAt 降序 → id 字典序升序
      const task = sorted[0];
      const meta = localProductMeta(task.result);
      const researchStatus = deriveResearchHistoryStatus({
        result: task.result,
        decisionStatus: task.decisionStatus,
        oneLineSummary: task.oneLineSummary,
      });
      const state = localProjectState(task, researchStatus);
      return {
        key,
        task,
        taskCount: sorted.length,
        productName: resolveTaskProductDisplayName({
          resultProductName: isLocalRecord(task.result) ? task.result.productName : "",
          taskTitle: task.title,
          materialText: task.materialText,
          fallback: "商品名称尚未取得",
        }),
        category: meta.category,
        market: meta.market,
        conclusion: localConclusion(task),
        researchStatus,
        ...state,
      };
    })
    .toSorted(compareProjectFreshness);
}

/**
 * 首页客户端分发：local_owner（或默认）→ C 端本地工作台；Public/guest 分支保持现状。
 * 上游 page.tsx / HomeGate 无需改动：仅在此按 runtime.mode 切换渲染。
 */
export function HomeDashboardClient({
  runtime = DEFAULT_RUNTIME,
  featured = null,
}: {
  runtime?: HomeRuntime;
  featured?: FeaturedReplay | null;
}) {
  if (runtime.mode === "local_owner") {
    return <LocalWorkspace runtime={runtime} />;
  }
  return <PublicDashboard runtime={runtime} featured={featured} />;
}

function PublicDashboard({
  runtime,
  featured,
}: {
  runtime: HomeRuntime;
  featured: FeaturedReplay | null;
}) {
  const [accessPassword, setAccessPassword, isAccessPasswordReady, , noAuthOwner] = useAccessPassword();
  const [candidateLoad, setCandidateLoad] = useState<CandidateLoadState>({
    status: "loading",
    items: [],
    total: 0,
    message: "正在读取待研究商品。",
  });
  const [recentSingleRun, setRecentSingleRun] = useState(() => parseRecentSingleRun(null));
  const [taskLoad, setTaskLoad] = useState<TaskLoadState>({
    status: "loading",
    summary: null,
    message: "正在读取研究记录统计。",
  });

  // ── Password input & unlock state ──
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [validating, setValidating] = useState(false);
  const [apiProbeStatus, setApiProbeStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  const unlocked = isAccessPasswordReady && (accessPassword.trim().length > 0 || noAuthOwner);

  // ── Password submit: validate against server BEFORE saving ──
  async function handlePasswordSubmit() {
    const trimmed = passwordInput.trim();
    if (!trimmed) {
      setPasswordError("请输入访问密码。");
      return;
    }

    setPasswordError("");
    setPasswordInput("");
    setValidating(true);
    setApiProbeStatus("checking");

    try {
      const res = await fetch("/api/tasks?limit=1", {
        headers: { ...buildAccessHeaders() },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setPasswordError("访问密码错误，请重新输入。");
        } else if (res.status === 502 || res.status === 503 || res.status === 504) {
          setPasswordError("服务正在重启或暂时不可用，请稍后再试。");
        } else if (res.status >= 500) {
          setPasswordError("服务异常，请稍后再试。");
        } else {
          setPasswordError("验证失败，请稍后重试。");
        }
        setApiProbeStatus("fail");
        setValidating(false);
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setPasswordError("服务返回异常，请稍后重试。");
        setApiProbeStatus("fail");
        setValidating(false);
        return;
      }

      // Server validated — now save to in-memory state
      setAccessPassword(trimmed);
      setApiProbeStatus("ok");
    } catch (err) {
      console.error("密码验证 API 请求异常", err);
      setPasswordError("请求失败，请检查网络连接后重试。");
      setApiProbeStatus("fail");
    } finally {
      setValidating(false);
    }
  }

  useEffect(() => {
    try {
      setRecentSingleRun(parseRecentSingleRun(window.localStorage.getItem(WORKFLOW_SINGLE_RUN_STORAGE_KEY)));
    } catch {
      setRecentSingleRun(null);
    }
  }, []);

  // V3 UX Closure：访客推荐体验（Golden Demo Lazy Seed；仅 demo 模式）
  const demoMode = getAccessMode() === "demo";
  const [demoGolden, setDemoGolden] = useState<{ taskId: string } | null | undefined>(undefined);
  useEffect(() => {
    if (!demoMode) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/demo/golden", {
          method: "GET",
          headers: { ...buildAccessHeaders() },
          signal: controller.signal,
          cache: "no-store",
        });
        const json = await response.json() as
          | { ok: true; data: { taskId: string } | null }
          | { ok: false };
        setDemoGolden(json.ok && json.data ? { taskId: json.data.taskId } : null);
      } catch {
        setDemoGolden(null);
      }
    })();
    return () => controller.abort();
  }, [demoMode]);

  useEffect(() => {
    if (!isAccessPasswordReady) return;

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setCandidateLoad({ status: "unavailable", items: [], total: 0, message: "待研究商品暂不可用。" });
      setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
      return;
    }

    const controller = new AbortController();

    async function loadTasks() {
      setTaskLoad({ status: "loading", summary: null, message: "正在读取研究记录统计。" });
      try {
        const response = await fetch("/api/tasks?limit=50", {
          method: "GET",
          headers: { ...buildAccessHeaders() },
          signal: controller.signal,
        });
        if (!response.ok) {
          setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
          return;
        }

        const payload = await response.json() as TasksApiResponse;
        if (!payload.ok) {
          setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
          return;
        }

        const items = payload.records ?? payload.data?.items ?? [];
        setTaskLoad({
          status: "ready",
          summary: summarizeTaskFollowUp(items),
          message: "已读取本地研究记录统计。",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
      }
    }

    async function loadCandidates() {
      setCandidateLoad({ status: "loading", items: [], total: 0, message: "正在读取待研究商品。" });
      try {
        const response = await fetch("/api/opportunity-candidates?limit=100&offset=0", {
          method: "GET",
          headers: { ...buildAccessHeaders() },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true
          || !("items" in payload) || !Array.isArray(payload.items)
          || !("total" in payload) || !Number.isInteger(payload.total)) {
          throw new Error("candidate_count_unavailable");
        }
        setCandidateLoad({
          status: "ready",
          items: payload.items.map((item) => serverCandidateToPoolItem(item as Record<string, unknown>)),
          total: payload.total as number,
          message: "已读取待研究商品。",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCandidateLoad({ status: "unavailable", items: [], total: 0, message: "待研究商品暂不可用。" });
      }
    }

    void loadCandidates();
    void loadTasks();

    return () => controller.abort();
  }, [accessPassword, isAccessPasswordReady]);

  const candidateSummary = useMemo(() => ({
    ...summarizeCandidatePool(candidateLoad.items),
    total: candidateLoad.status === "ready" ? candidateLoad.total : 0,
  }), [candidateLoad]);
  const taskSummary = taskLoad.summary;
  const workspaceConnectionStatus = candidateLoad.status === "ready" && taskLoad.status === "ready"
    ? "数据已同步"
    : candidateLoad.status === "loading" || taskLoad.status === "loading" || apiProbeStatus === "checking"
      ? "数据同步中…"
      : "部分数据待恢复";
  const recommendation = useMemo(() => getRecommendedNextAction({
    candidatePool: candidateSummary,
    tasks: taskSummary,
    recentSingleRun,
  }), [candidateSummary, taskSummary, recentSingleRun]);

  const workflowStateByHref: Record<(typeof homeWorkflowSteps)[number]["href"], string> = {
    "/opportunities": "导入或手工选择商品",
    "/opportunity-candidates": candidateLoad.status === "ready" && candidateSummary.total > 0
      ? "已有 " + formatNumber(candidateSummary.total) + " 个候选"
      : candidateLoad.status === "unavailable" ? "暂不可用" : "等待选择商品",
    "/tasks": taskSummary?.pendingReview
      ? formatNumber(taskSummary.pendingReview) + " 项等待确认"
      : "由你完成最终确认",
  };

  const isNewUser = candidateLoad.status === "ready" && candidateSummary.total === 0 && !recentSingleRun && (!taskSummary || taskSummary.total === 0);

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8" data-testid="home-dashboard">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <WorkspaceMobileNav />

          {/* 顶部品牌条（契约 §1.A-1）：轻选工作台 + V4 Badge；模式 Badge 由 Hero 派生 */}
          <header className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-teal-600" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-700">轻选工作台</p>
              <span className="rounded border border-teal-200 bg-teal-50 px-1 py-0.5 text-[10px] font-bold text-teal-700">V4</span>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
              辅助研究 · 人工决定
            </span>
          </header>

          {/* V4.1 — 首页主叙事：Hero / Workflow / 价值卡 / Featured Replay / 产品边界（契约 §1.A） */}
          <V4Hero runtime={runtime} />
          <V4Workflow />
          <V4ValueCards />
          <V4FeaturedReplayCard featured={featured} />
          <V4BoundaryNotice runtime={runtime} />

          {/* 现有内容工具（降级区，非首屏主叙事）：金标演示 + 五步研究入口 */}
          <section
            data-testid="home-legacy-tools"
            className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
            aria-labelledby="home-legacy-tools-title"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="linear-kicker">现有内容工具</p>
                <h2 id="home-legacy-tools-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  从既有工具继续
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  保留研究记录、创作工具与金标演示入口；以上内容为既有能力，不属于 V4 主叙事。
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {/* V3 Golden Demo 推荐体验（访客入口，演示回放不消耗额度） */}
              {demoMode && demoGolden ? (
                <section
                  className="surface-card-strong overflow-hidden p-5"
                  data-testid="home-recommended-demo"
                  aria-labelledby="home-recommended-demo-title"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="linear-kicker">推荐体验</p>
                      <h3 id="home-recommended-demo-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                        THERMOS FUNTAINER 儿童保温杯（演示商品）
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                        含 Amazon 页面采集、VOC 评论分析、1688 供应线索的全套真实采集样本回放；可体验
                        「采集 → 确认商品事实 → 研究结论 → Listing / Image」完整流程。演示回放不消耗额度。
                      </p>
                    </div>
                    <Link
                      href={"/tasks/" + demoGolden.taskId}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-100"
                      data-testid="home-recommended-demo-cta"
                    >
                      开始体验
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </div>
                </section>
              ) : null}

              {/* 五步完成一次商品研究（现有研究入口） */}
              <section
                className="surface-card-strong overflow-hidden p-5"
                data-testid="home-workflow"
                aria-labelledby="home-workflow-title"
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="linear-kicker">现有研究入口</p>
                    <h3 id="home-workflow-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                      五步完成一次商品研究
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      从发现商品开始，研究、创作，最后由你人工确认是否继续。
                    </p>
                  </div>
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                    AI 辅助 · 人工确认
                  </span>
                </div>

                <ol className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {homeWorkflowSteps.map((step, index) => {
                    const Icon = step.icon;
                    const isRecommended = recommendation.href === step.href;
                    return (
                      <li key={step.id} className="min-w-0">
                        <Link
                          href={step.href}
                          aria-current={isRecommended ? "step" : undefined}
                          className={"group flex h-full min-h-[222px] flex-col rounded-2xl border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 " + (isRecommended
                            ? "border-teal-300 bg-teal-50/80 shadow-sm"
                            : "border-slate-200 bg-white hover:border-teal-200 hover:bg-teal-50/40")}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="linear-icon size-9 rounded-xl">
                              <Icon className="size-5" aria-hidden="true" />
                            </div>
                            <span className="text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                          </div>
                          <h4 className="mt-4 text-base font-semibold text-slate-950">{step.label}</h4>
                          <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{step.description}</p>
                          <div className="mt-4 border-t border-slate-100 pt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">当前状态</p>
                            <p className="mt-1 text-sm font-semibold text-slate-700">{workflowStateByHref[step.href]}</p>
                            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-700">
                              下一步入口
                              <ArrowRight className="size-4 group-hover:translate-x-0.5" aria-hidden="true" />
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          </section>

          {/* ── Access password entry (only on home page) ── */}
          {!unlocked ? (
            <section className="surface-card border-amber-200 bg-amber-50/60 p-5 sm:p-6" data-testid="home-password-entry">
              <div className="flex items-start gap-3">
                <div className="linear-icon size-10 shrink-0 rounded-xl bg-amber-100 text-amber-700">
                  <Lock className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-slate-900">输入访问密码解锁工作台</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    全站只需要在这里输入一次访问密码。输入后本会话内所有功能可用，无需在其他页面重复输入。
                  </p>
                  <form
                    className="mt-4 flex flex-wrap items-center gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handlePasswordSubmit();
                    }}
                  >
                    <input
                      type="password"
                      name="accessPassword"
                      aria-label="访问密码"
                      autoComplete="current-password"
                      value={passwordInput}
                      onChange={(e) => {
                        setPasswordInput(e.target.value);
                        setPasswordError("");
                      }}
                      placeholder="输入访问密码"
                      disabled={validating}
                      className="h-11 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                      data-testid="home-password-input"
                    />
                    <button
                      type="submit"
                      disabled={validating}
                      className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="home-password-submit"
                    >
                      {validating ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          验证中…
                        </>
                      ) : (
                        <>
                          解锁工作台
                          <Unlock className="size-4" />
                        </>
                      )}
                    </button>
                  </form>
                  {passwordError ? (
                    <p
                      className="mt-3 text-sm font-semibold text-rose-600"
                      data-testid="home-password-error"
                      role="alert"
                    >
                      {passwordError}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-slate-400">
                    访问保护 · 密码仅保存在当前会话中 · 关闭网页后需重新输入 · 不收集个人信息
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {/* ── Session status (compact) ── */}
          {unlocked ? (
            <section className="surface-card border-emerald-200 bg-emerald-50/60 p-3 sm:p-4" data-testid="home-unlock-status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  工作台已解锁 · 会话有效
                </div>
                <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <div className="size-1.5 rounded-full bg-emerald-400" />
                  {workspaceConnectionStatus}
                </div>
              </div>
              {(candidateLoad.status === "unavailable" || taskLoad.status === "unavailable") && (
                <p className="mt-2 text-xs text-amber-700">部分工作台数据暂不可用，请刷新页面或稍后重试。</p>
              )}
            </section>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <StatCard
                title="待研究商品"
                value={candidateLoad.status === "ready" ? formatNumber(candidateSummary.total) : "暂不可用"}
                description={candidateLoad.status === "ready"
                  ? "当前身份下等待继续研究的商品数量。"
                  : candidateLoad.message}
                href="/opportunity-candidates"
                cta="查看待研究商品"
                tone={candidateLoad.status === "ready" ? "teal" : "slate"}
              />
              <StatCard
                title="研究记录"
                value={taskSummary ? formatNumber(taskSummary.total) : "—"}
                description={taskSummary
                  ? "待复核 " + formatNumber(taskSummary.pendingReview) + " 个，可跟进 " + formatNumber(taskSummary.followable) + " 个。"
                  : taskLoad.message}
                href="/tasks"
                cta="查看研究记录"
                tone={taskSummary ? "indigo" : "slate"}
              />
              <StatCard
                title="最近研究"
                value={recentSingleRun?.productName || "暂无"}
                description={recentSingleRun
                  ? formatRecentTime(recentSingleRun.completedAt) + " · " + (recentSingleRun.savedTaskId ? "已保存到研究记录" : "尚未保存")
                  : "还没有可恢复的商品研究结果。"}
                href="/opportunity-candidates"
                cta="前往待研究商品"
                tone={recentSingleRun?.savedTaskId ? "teal" : "amber"}
              />
            </div>

            <aside className="surface-card-strong min-w-0 p-5" data-testid="dashboard-recommendation">
              <div className="flex items-center gap-2">
                <div className="linear-icon size-9 rounded-xl">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-teal-700">推荐下一步</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">{productLanguage(recommendation.title)}</h2>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-500">{productLanguage(recommendation.description)}</p>
              <Link href={recommendation.href} className="linear-button-primary mt-5 inline-flex h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold">
                {productLanguage(recommendation.cta)}
                <ArrowRight className="size-4" />
              </Link>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                本页只读取浏览器本地状态和研究记录，不自动采购、不自动上架、不自动投广告。
              </p>
            </aside>
          </section>

          {isNewUser ? (
            <section className="surface-card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="max-w-2xl">
                  <p className="linear-kicker">新手起点</p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">没有现成商品，就先从发现商品开始</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    先收集候选和市场信号，再选择一个商品进入研究；系统只整理证据，不替你做商业决定。
                  </p>
                </div>
                <Link href="/opportunities" className="linear-button-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold">
                  去发现商品
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-500">
            <div className="flex gap-2">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-teal-700" />
              <p>
                当前为人工复核版：采购、上架、联系供应商、投广告等动作都需要你人工确认后手动执行。
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
function LocalProductSection({
  title,
  items,
  loading,
  unavailable,
  testId,
  description,
  emptyHint,
}: {
  title: string;
  items: LocalProductProject[];
  loading: boolean;
  unavailable: boolean;
  testId: string;
  description: string;
  emptyHint: string;
}) {
  return (
    <section className="surface-card min-w-0 p-4 sm:p-5" data-testid={testId} aria-labelledby={testId + "-title"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={testId + "-title"} className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {!loading && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
            {items.length} 件
          </span>
        )}
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-slate-400">正在读取商品项目…</p>
      ) : unavailable ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          商品项目暂时无法读取，请稍后刷新；页面不会用模拟数据代替。
        </p>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm text-slate-400">{emptyHint}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((project) => {
            return (
            <li key={project.key}>
              <article className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <ResearchProductImage image={project.task.productImage} alt={project.productName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="break-words text-base font-semibold leading-6 text-slate-950">{project.productName}</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{project.category} · {project.market}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                        {project.statusLabel}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-700">{project.conclusion}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {project.taskCount > 1 ? (
                        <span className="text-xs text-slate-400">同一商品的 {project.taskCount} 次研究已合并</span>
                      ) : <span />}
                      <Link
                        href={`/tasks/${encodeURIComponent(project.task.id)}`}
                        className="linear-button inline-flex h-9 items-center justify-center gap-1.5 px-3 text-sm font-semibold"
                      >
                        {project.nextLabel}
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            </li>
          );})}
        </ul>
      )}
    </section>
  );
}

function LocalWorkspace({ runtime }: { runtime: HomeRuntime }) {
  const [tasksState, setTasksState] = useState<{
    status: "loading" | "ready" | "unavailable";
    tasks: LocalTaskItem[];
  }>({
    status: "loading",
    tasks: [],
  });
  // 轮 7：可研究商品计数（fail-closed；失败 → 不可用 + 重试）
  const [startableState, setStartableState] = useState<{ status: "loading" | "ready" | "unavailable"; count: number | null }>({ status: "loading", count: null });
  const loadStartable = useCallback(async () => {
    setStartableState({ status: "loading", count: null });
    try {
      const count = await collectStartableCandidateCount();
      setStartableState({ status: "ready", count });
    } catch {
      setStartableState({ status: "unavailable", count: null });
    }
  }, []);

  useEffect(() => {
    if (!runtime.v4Graph) {
      setTasksState({ status: "ready", tasks: [] });
      return;
    }
    const controller = new AbortController();
    void loadStartable();
    (async () => {
      try {
        // §2.1/§2.5：正式数据域 + 完整分页（hasMore=false 为止）；任意页失败 fail-closed → unavailable。
        const result = await loadWorkbenchTasks(async (offset) => {
          const response = await fetch("/api/tasks?scope=product-research&limit=50&offset=" + offset, {
            method: "GET",
            headers: { ...buildAccessHeaders() },
            cache: "no-store",
            signal: controller.signal,
          });
          const json = await response.json().catch(() => null) as LocalTasksResponse | null;
          if (!response.ok || !json?.ok) return null;
          const items = (json.records ?? json.data?.items ?? []);
          return {
            items: items.filter(isLocalTaskItem),
            hasMore: json.page?.hasMore === true,
          };
        });
        setTasksState(
          result.status === "ready"
            ? { status: "ready", tasks: result.tasks }
            : { status: "unavailable", tasks: [] },
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTasksState({ status: "unavailable", tasks: [] });
      }
    })();
    return () => controller.abort();
  }, [runtime.v4Graph, loadStartable]);

  const projects = useMemo(() => buildLocalProductProjects(tasksState.tasks), [tasksState.tasks]);
  const needsAction = projects.filter((project) => project.group === "needs_action");
  const researching = projects.filter((project) => project.group === "researching");
  const completed = projects.filter((project) => project.group === "completed");
  const loading = tasksState.status === "loading";
  const unavailable = tasksState.status === "unavailable";

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8" data-testid="home-dashboard">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="flex min-w-0 flex-col gap-5">
          <WorkspaceMobileNav />

          <header className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">工作台</h1>
            <p className="text-sm leading-6 text-slate-600">了解你的商品研究进度，下一步由你决定。</p>
          </header>

          {runtime.v4Graph ? (
            <>
              <section
                className="surface-card-strong min-w-0 p-5"
                data-testid="local-start-research"
                aria-labelledby="local-start-research-title"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm leading-6 text-slate-600">从一个真实候选商品开始，AI 整理证据，关键决定由你确认。</p>
                  </div>
                  {startableState.status === "unavailable" ? (
                    <div className="flex flex-wrap items-center gap-3" data-testid="local-start-research-unavailable">
                      <span className="text-sm text-amber-700">研究入口暂时无法读取。</span>
                      <button type="button" onClick={() => void loadStartable()} className="linear-button-soft inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                        重试
                      </button>
                    </div>
                  ) : startableState.status === "loading" ? (
                    <span className="inline-flex h-11 items-center px-2 text-sm text-slate-500" data-testid="local-start-research-loading">正在确认可研究商品…</span>
                  ) : resolveStartResearchHref(startableState.count).href ? (
                    <Link
                      href={resolveStartResearchHref(startableState.count).href as string}
                      className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
                      data-testid="local-start-research-cta"
                    >
                      {startableState.count === 0 ? "去发现商品" : "开始研究一个商品"}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </section>

              <div className="grid min-w-0 gap-4 xl:grid-cols-3">
                <LocalProductSection
                  title="需要我处理"
                  description="等你的决定，研究才能进入下一步。"
                  items={needsAction}
                  loading={loading}
                  unavailable={unavailable}
                  testId="local-status-needs-action"
                  emptyHint="当前没有等待你处理的商品。"
                />
                <LocalProductSection
                  title="AI 研究中"
                  description="资料仍在整理，结论尚未完成。"
                  items={researching}
                  loading={loading}
                  unavailable={unavailable}
                  testId="local-status-researching"
                  emptyHint="当前没有正在研究的商品。"
                />
                <LocalProductSection
                  title="已完成"
                  description="研究和人工决定都已保存。"
                  items={completed}
                  loading={loading}
                  unavailable={unavailable}
                  testId="local-status-completed"
                  emptyHint="当前还没有已完成的商品。"
                />
              </div>
            </>
          ) : (
            <section
              className="surface-card min-w-0 p-5"
              data-testid="local-v4-off-guide"
              aria-labelledby="local-v4-off-guide-title"
            >
              <p className="linear-kicker">商品研究</p>
              <h2 id="local-v4-off-guide-title" className="mt-1 text-lg font-semibold text-slate-950">
                研究能力未开启
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">本地研究能力未开启，请联系管理员开启后使用。</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
