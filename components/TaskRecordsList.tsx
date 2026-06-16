"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { platformLabels } from "@/lib/types";

const defaultType = "viral";
const defaultLimit = 10;
const taskTypes = [
  { value: "viral", label: "爆款素材分析" },
];

const extendedPlatformLabels: Record<string, string> = {
  ...platformLabels,
  tiktok: "TikTok",
  "1688": "1688",
  alibaba: "阿里国际站",
};

type ViralTaskItem = {
  id: string;
  createdAt: string;
  title: string | null;
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
};

type ApiResponse =
  | {
    ok: true;
    records?: ViralTaskItem[];
    data?: { items: ViralTaskItem[] };
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

function getTitle(item: ViralTaskItem) {
  return item.title?.trim() || item.materialText.trim().slice(0, 20) || "未命名记录";
}

function sourceLabel(source: string) {
  return source === "ai" ? "AI" : "mock";
}

function getStringArray(result: unknown, key: string) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const value = Reflect.get(result, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
}

function updateBrowserQuery(type: string, q: string) {
  const params = new URLSearchParams();
  if (type && type !== defaultType) params.set("type", type);
  if (q) params.set("q", q);
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
  const [items, setItems] = useState<ViralTaskItem[]>([]);
  const [page, setPage] = useState<TaskPageInfo | null>(null);
  const [type, setType] = useState(defaultType);
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const loadTasks = useCallback(async ({
    nextType,
    q,
    offset,
    mode,
    syncUrl,
  }: {
    nextType: string;
    q: string;
    offset: number;
    mode: LoadMode;
    syncUrl: boolean;
  }) => {
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

      const response = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" });
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
      setActiveQuery(q);
      if (mode === "replace") setOpenId("");
      if (syncUrl) updateBrowserQuery(nextType, q);
    } catch {
      setError("任务记录暂时无法读取，请稍后刷新。");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialType = params.get("type") || defaultType;
    const initialQuery = (params.get("q") || "").trim();
    const safeType = initialType === defaultType ? initialType : defaultType;
    setType(safeType);
    setQueryInput(initialQuery);
    setActiveQuery(initialQuery);
    void loadTasks({
      nextType: safeType,
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
      q,
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function clearFilters() {
    setQueryInput("");
    void loadTasks({
      nextType: defaultType,
      q: "",
      offset: 0,
      mode: "replace",
      syncUrl: true,
    });
  }

  function retryLoad() {
    void loadTasks({
      nextType: type,
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
      q: page.q,
      offset: page.nextOffset,
      mode: "append",
      syncUrl: false,
    });
  }

  async function deleteRecord(item: ViralTaskItem) {
    if (deletingId) return;
    const confirmed = window.confirm(`确定删除「${getTitle(item)}」这条任务记录吗？删除后无法恢复。`);
    if (!confirmed) return;

    setDeletingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
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
          hasMore: current.nextOffset !== null ? current.nextOffset < Math.max(0, current.total - 1) : false,
        }
        : current);
    } catch {
      setError("删除失败，请检查本地服务后重试。");
    } finally {
      setDeletingId("");
    }
  }

  const hasActiveFilters = Boolean(activeQuery || type !== defaultType);
  const isSearchEmpty = !loading && !error && items.length === 0 && hasActiveFilters;
  const isDefaultEmpty = !loading && !error && items.length === 0 && !hasActiveFilters;

  return (
    <main className="app-surface px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="premium-card rounded-[34px] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Qingxuan Workspace</p>
                <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950">任务记录</h1>
                <p className="mt-1 text-sm text-slate-500">
                  搜索、筛选和管理已经保存的爆款拆解记录。
                </p>
              </div>
              <Link
                href="/viral"
                className="glass-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
              >
                去爆款拆解
              </Link>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="premium-card rounded-[38px] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-teal-700">Task Center</p>
                <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950">任务中心</h2>
              </div>
              <span className="status-pill px-3 py-1 text-sm">
                {page ? `${items.length}/${page.total} 条` : `${items.length} 条记录`}
              </span>
            </div>

            <form onSubmit={submitSearch} className="mt-5 grid gap-3 rounded-[28px] border border-white/80 bg-white/75 p-4 lg:grid-cols-[minmax(0,1fr)_220px_auto_auto]">
              <label className="min-w-0">
                <span className="text-xs font-bold text-slate-500">搜索关键词</span>
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="搜索标题、素材、摘要或结果内容"
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-100"
                />
              </label>
              <label>
                <span className="text-xs font-bold text-slate-500">类型筛选</span>
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-100"
                >
                  {taskTypes.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="glass-button-primary inline-flex h-11 items-center justify-center self-end px-5 text-sm font-bold"
              >
                搜索
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="glass-button inline-flex h-11 items-center justify-center self-end px-5 text-sm font-bold"
              >
                清空
              </button>
            </form>

            {activeQuery ? (
              <p className="mt-3 text-sm text-slate-500">
                当前搜索：<span className="font-bold text-slate-800">{activeQuery}</span>
              </p>
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
                <p className="text-lg font-black text-slate-950">还没有保存的爆款拆解记录</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  先去 /viral 做一次 mock 分析，生成结果后点击“保存到任务记录”，这里就会出现历史记录。
                </p>
                <Link
                  href="/viral"
                  className="glass-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
                >
                  去生成第一条记录
                </Link>
              </div>
            ) : isSearchEmpty ? (
              <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-white/70 p-8">
                <p className="text-lg font-black text-slate-950">没有匹配任务</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  换个关键词试试，或者清空筛选后查看全部爆款素材分析记录。
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="glass-button-primary mt-5 inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
                >
                  清空筛选
                </button>
              </div>
            ) : (
              <>
                <div className="mt-6 space-y-4">
                  {items.map((item) => {
                    const open = openId === item.id;
                    return (
                      <article key={item.id} className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-sm">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                              <span>{formatDate(item.createdAt)}</span>
                              <span>{extendedPlatformLabels[item.platform] || item.platform}</span>
                              <span>{sourceLabel(item.source)}</span>
                            </div>
                            <h3 className="mt-2 truncate text-xl font-black tracking-tight text-slate-950">
                              {getTitle(item)}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{item.oneLineSummary}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
                              {item.score}/100
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-700">
                              {item.level}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenId(open ? "" : item.id)}
                              className="glass-button px-4 py-2 text-sm font-bold"
                            >
                              {open ? "收起" : "展开详情"}
                            </button>
                            <Link
                              href={`/tasks/${item.id}`}
                              className="rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-bold text-teal-800 transition hover:border-teal-300 hover:bg-teal-100"
                            >
                              查看详情
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
                      className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-bold text-teal-800 shadow-sm transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
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
