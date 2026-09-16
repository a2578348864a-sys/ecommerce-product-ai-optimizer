"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import type { HomeRuntime } from "@/components/v4/home/heroLogic";
import { V4Hero } from "@/components/v4/home/V4Hero";
import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";
import { resolveTaskProductDisplayName } from "@/lib/productDisplayName";
import { deriveResearchHistoryStatus, type ResearchHistoryStatus } from "@/lib/taskResearchHistoryPresentation";
import { collectPagedTasks, deriveProductProjectGroup, ProductResearchTasksUnavailableError } from "@/lib/researchLifecycle";
// 只读类型：列表 DTO 的服务端 Reader 快照（Bridge V1），工作台状态展示与详情页同源。
import type { ResearchLifecycleSnapshot } from "@/lib/server/researchLifecycleReader";
export { collectPagedTasks, ProductResearchTasksUnavailableError } from "@/lib/researchLifecycle";

async function collectStartableCandidateCount(): Promise<number> {
  // 轮 7：可研究唯一依据 = isCandidateResearchActionAvailable（服务端返回 researchAction 后客户端过滤）
  // 初始从 offset=0 读取待研究商品：fetch("/api/opportunity-candidates?limit=100&offset=0"，异常时计数暂不可用
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

/** 兼容旧调用：无 props 时默认本地单用户模式。 */
const DEFAULT_RUNTIME: HomeRuntime = { mode: "local_single_user", noAuthOwner: true, v4Graph: false };

export const homeWorkflowSteps = [
  {
    id: "discover-products",
    label: "发现商品",
    href: "/opportunities",
    cta: "去发现商品",
    description: "上传报表，筛选候选商品。",
  },
  {
    id: "research-products",
    label: "商品研究",
    href: "/opportunity-candidates",
    cta: "打开待研究商品",
    description: "整理信息，评估风险，恢复或开始研究。",
  },
  {
    id: "make-research-decision",
    label: "人工决策",
    href: "/tasks",
    cta: "打开研究记录",
    description: "在任务详情确认继续、暂缓或放弃。",
  },
  {
    id: "prepare-creative-materials",
    label: "创作资料",
    href: "/tasks",
    cta: "在任务详情确认",
    description: "确认事实与视觉参考，准备创作资料。",
  },
  {
    id: "review-content-drafts",
    label: "内容草稿",
    href: "/tasks",
    cta: "在任务详情生成",
    description: "生成 Listing 草稿与产品图片，人工复核。",
  },
] as const;

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
  /** Bridge V1 服务端 Reader 生命周期快照（列表行同名投影）：工作台状态展示的唯一口径，与商品详情页同源。 */
  researchLifecycle?: ResearchLifecycleSnapshot | null;
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

function localConclusion(task: LocalTaskItem): string {
  // 第十一轮（Bug 1）：与任务详情同口径——只允许真实 AI/研究结论字段；
  // oneLineSummary 是任务摘要不是 AI 判断；无真实结论返回空串（不渲染假文案）。
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
  if (result) {
    const summary = isLocalRecord(result.summary) ? result.summary : null;
    const decisionReason = localText(summary?.decisionReason);
    if (decisionReason) return decisionReason;
  }
  return "";
}

/** 服务端正式投影状态 → 三组语义。失败/取消终态优先于旧研究/决定（§2.4）。 */
function localProjectState(task: LocalTaskItem) {
  // 轮 6：与 /research 共用同一口径（唯一分类器）。
  // 第十二轮：快照优先——列表 DTO 已带服务端 Reader 快照时，卡片状态与商品详情页同一 Snapshot 同语义。
  return deriveProductProjectGroup({
    aiRunStatus: task.aiRunStatus,
    decisionStatus: task.decisionStatus,
    result: task.result,
    oneLineSummary: task.oneLineSummary,
    lifecycle: task.researchLifecycle ?? null,
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
      const state = localProjectState(task);
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
 * 首页客户端分发：单用户本地工作台。
 */
export function HomeDashboardClient({
  runtime = DEFAULT_RUNTIME,
}: {
  runtime?: HomeRuntime;
}) {
  return <LocalWorkspace runtime={runtime} />;
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
                    {project.conclusion ? (
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-700">{project.conclusion}</p>
                    ) : null}
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">轻选工作台</h1>
            <p className="text-sm leading-6 text-slate-600">了解你的商品研究进度，下一步由你决定。</p>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2.5 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span>本地工作台已就绪 · 数据已同步</span>
            </div>
            <Link
              href="/opportunity-candidates"
              className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline"
            >
              查看待研究商品
            </Link>
          </div>

          {runtime.v4Graph ? (
            <>
              {/* V4Hero: 独立 Hero 组件供展示与按需使用 */}
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
                  description="等你决定才能继续：待确认事实、资料缺失、人工决定未保存或研究资料需重新确认的商品都在这里，它们不属于「研究中」。"
                  items={needsAction}
                  loading={loading}
                  unavailable={unavailable}
                  testId="local-status-needs-action"
                  emptyHint="当前没有等待你处理的商品。"
                />
                <LocalProductSection
                  title="研究中"
                  description="AI 正在自动采集或分析资料，还没有需要你决定的事情。"
                  items={researching}
                  loading={loading}
                  unavailable={unavailable}
                  testId="local-status-researching"
                  emptyHint="当前没有正在研究的商品。"
                />
                <LocalProductSection
                  title="已完成"
                  description="研究已正式收口并保存到研究记录（researchCompletion=completed）。"
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
