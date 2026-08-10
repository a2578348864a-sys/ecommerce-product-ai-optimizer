"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { useSessionDraft, clearSessionDraftsForEntity } from "@/lib/client/useSessionDraft";
import {
  candidatePrimaryHref,
  mergeCandidatePages,
  parseCandidateListResponse,
  type CandidateResearchPoolItem,
  type CandidateResearchStatus,
} from "@/lib/candidateResearchPool";

const PAGE_SIZE = 100;

type PoolState = "loading" | "ready" | "error";
type StatusFilter = "all" | CandidateResearchStatus | "converted";

export type CandidatePoolViewProps = {
  state: PoolState;
  items: CandidateResearchPoolItem[];
  total: number;
  hasMore: boolean;
  statusFilter: StatusFilter;
  query: string;
  selectedIds: readonly string[];
  busy: boolean;
  manualOpen: boolean;
  manualName: string;
  manualUrl: string;
  message: string;
  onRefresh: () => void;
  onLoadMore: () => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onQueryChange: (value: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteItem: (id: string) => void;
  onDeleteSelected: () => void;
  onStartSelected: () => void;
  onManualToggle: () => void;
  onManualNameChange: (value: string) => void;
  onManualUrlChange: (value: string) => void;
  onManualSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "研究池" },
  { value: "pending", label: "待查看" },
  { value: "worth_analyzing", label: "待研究" },
  { value: "analyzed", label: "研究中" },
  { value: "paused", label: "已暂缓" },
  { value: "rejected", label: "已放弃" },
  { value: "converted", label: "已转任务" },
];

const STATUS_LABEL: Record<CandidateResearchStatus, string> = {
  pending: "待查看",
  worth_analyzing: "待研究",
  analyzed: "研究中",
  paused: "已暂缓",
  rejected: "已放弃",
};

const SOURCE_LABEL = {
  sellersprite_direct: "卖家精灵直接导入",
  product_batch: "历史批次",
  manual: "手工添加",
  other: "其他来源",
} as const;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function researchActionLabel(item: CandidateResearchPoolItem): string {
  if (item.researchAction === "converted") return "查看研究结果";
  return "开始／继续研究";
}

export function CandidatePoolView(props: CandidatePoolViewProps) {
  return (
    <div className="space-y-4" data-testid="candidate-pool-view">
      <section className="surface-card-strong p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="linear-kicker">服务端权威记录</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">商品研究池</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              已加入的商品会保存在当前身份的数据域中。刷新页面、关闭浏览器或重新登录后，仍可从这里继续研究。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/opportunities" className="linear-button inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold">
              发现更多商品
            </Link>
            <button
              type="button"
              onClick={props.onRefresh}
              disabled={props.busy}
              className="linear-button-soft inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${props.busy ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">
            服务端共有 <strong className="text-xl text-slate-950">{props.total}</strong> 项
          </p>
          <div className="flex flex-wrap gap-2" aria-label="研究池状态筛选">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={props.statusFilter === option.value}
                onClick={() => props.onStatusFilterChange(option.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  props.statusFilter === option.value
                    ? "border-teal-300 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {/* C：搜索 + 批量工具条 */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="min-w-52 flex-1">
            <span className="sr-only">搜索商品名称</span>
            <input
              type="search"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value.slice(0, 80))}
              placeholder="搜索商品名称…"
              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">已选 <strong className="text-slate-950">{props.selectedIds.length}</strong> 项</span>
            <button
              type="button"
              onClick={props.onSelectAll}
              disabled={props.busy || props.items.length === 0}
              className="linear-button-soft h-9 px-3 text-sm font-semibold disabled:opacity-50"
            >
              全选
            </button>
            <button
              type="button"
              onClick={props.onClearSelection}
              disabled={props.busy || props.selectedIds.length === 0}
              className="linear-button-soft h-9 px-3 text-sm font-semibold disabled:opacity-50"
            >
              取消选择
            </button>
            <button
              type="button"
              onClick={props.onStartSelected}
              disabled={props.busy || props.selectedIds.length === 0}
              className="linear-button-primary h-9 px-3 text-sm font-semibold disabled:opacity-50"
            >
              开始研究
            </button>
            <button
              type="button"
              onClick={props.onDeleteSelected}
              disabled={props.busy || props.selectedIds.length === 0}
              className="h-9 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              删除/移出所选
            </button>
          </div>
        </div>
      </section>

      {props.state === "loading" ? (
        <section className="surface-card flex min-h-44 items-center justify-center p-6" role="status">
          <Loader2 className="mr-2 size-5 animate-spin text-teal-600" />
          <span className="text-sm text-slate-600">正在读取商品研究池…</span>
        </section>
      ) : null}

      {props.state === "error" ? (
        <section className="surface-card border-rose-200 bg-rose-50/70 p-5" role="alert">
          <p className="font-semibold text-rose-800">商品研究池暂时无法读取</p>
          <p className="mt-1 text-sm text-rose-700">{props.message || "请稍后重试。"}</p>
          <button type="button" onClick={props.onRefresh} className="linear-button mt-3 inline-flex h-10 items-center px-4 text-sm font-semibold">
            重试
          </button>
        </section>
      ) : null}

      {props.state === "ready" && props.message ? (
        <p className="surface-card border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
          {props.message}
        </p>
      ) : null}

      {props.state === "ready" && props.items.length === 0 ? (
        <section className="surface-card p-6 text-center">
          <p className="text-lg font-semibold text-slate-900">研究池还没有商品</p>
          <p className="mt-2 text-sm text-slate-500">先从卖家精灵导入并人工选择，或展开下方旧版手工添加。</p>
          <Link href="/opportunities" className="linear-button-primary mt-4 inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold">
            去发现商品 <ArrowRight className="size-4" />
          </Link>
        </section>
      ) : null}

      {props.state === "ready" && props.items.length > 0 ? (
        <section className="grid gap-3" aria-label="Candidate 列表">
          {props.items.map((item) => {
            const href = candidatePrimaryHref(item);
            const selected = props.selectedIds.includes(item.id);
            const converted = item.researchAction === "converted";
            return (
              <article key={item.id} className={`surface-card p-4 sm:p-5 ${selected ? "border-teal-300 ring-1 ring-teal-200" : ""}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <label className="mt-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.name}`}
                        checked={selected}
                        onChange={() => props.onToggleSelect(item.id)}
                        className="h-4 w-4 accent-teal-600"
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          converted
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-teal-200 bg-teal-50 text-teal-800"
                        }`}>
                          {converted ? "已转任务" : STATUS_LABEL[item.status]}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {SOURCE_LABEL[item.sourceKind]}
                        </span>
                        <span className="text-xs text-slate-500">{item.marketplace || "市场待确认"}</span>
                      </div>
                      <h3 className="mt-3 break-words text-base font-semibold text-slate-950">{item.name}</h3>
                      {item.researchAction === "converted" && item.researchDecision ? (
                        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm text-slate-700">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-emerald-800">{item.researchDecision.label}</span>
                            {!item.researchDecision.legacy ? (
                              <span className="text-xs text-slate-500">第 {item.researchDecision.revision} 版</span>
                            ) : null}
                          </div>
                          {!item.researchDecision.legacy && item.researchDecision.reasonSummary ? (
                            <p className="mt-1 leading-6">{item.researchDecision.reasonSummary}</p>
                          ) : null}
                          {!item.researchDecision.legacy && item.researchDecision.nextActionSummary ? (
                            <p className="mt-1 text-xs leading-5 text-slate-500">下一步：{item.researchDecision.nextActionSummary}</p>
                          ) : null}
                        </div>
                      ) : item.researchAction === "converted" ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          <p className="font-semibold text-slate-700">尚无正式决定</p>
                          <p className="mt-1 text-xs leading-5">可查看关联研究记录；系统不会从旧状态推测新版正式决定。</p>
                        </div>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-400">最近更新：{formatDate(item.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                    {href ? (
                      <Link href={href} className="linear-button-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold">
                        {researchActionLabel(item)}
                        <ArrowRight className="size-4" />
                      </Link>
                    ) : (
                      <span className="max-w-xs text-sm leading-6 text-amber-700">
                        {item.researchActionMessage || "当前不能进入研究。"}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={props.busy}
                      onClick={() => props.onDeleteItem(item.id)}
                      className="h-9 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    >
                      {converted ? "移出研究池" : "删除"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {props.hasMore ? (
            <button
              type="button"
              onClick={props.onLoadMore}
              disabled={props.busy}
              className="linear-button mx-auto inline-flex h-10 items-center px-5 text-sm font-semibold disabled:opacity-50"
            >
              {props.busy ? "加载中…" : "加载更多"}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="surface-card p-4 sm:p-5">
        <button
          type="button"
          aria-expanded={props.manualOpen}
          onClick={props.onManualToggle}
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-slate-800"
        >
          <span className="inline-flex items-center gap-2"><Plus className="size-4 text-teal-700" />手工添加商品</span>
          <span className="text-xs text-slate-400">{props.manualOpen ? "收起" : "展开"}</span>
        </button>
        {props.manualOpen ? (
          <form className="mt-4 grid gap-3 border-t border-slate-100 pt-4" onSubmit={props.onManualSubmit}>
            <p className="text-sm leading-6 text-amber-800">
              手工名称不等于已验证商品事实；保存后仍需人工核对商品身份和来源。
            </p>
            <label className="text-sm font-semibold text-slate-700">
              商品名称
              <input
                name="name"
                value={props.manualName}
                onChange={(event) => props.onManualNameChange(event.target.value)}
                maxLength={120}
                required
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              商品链接（可选）
              <input
                name="url"
                type="url"
                value={props.manualUrl}
                onChange={(event) => props.onManualUrlChange(event.target.value)}
                maxLength={2048}
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <button type="submit" disabled={props.busy || props.manualName.trim().length < 2} className="linear-button-primary inline-flex h-10 w-fit items-center px-4 text-sm font-semibold disabled:opacity-50">
              保存到商品研究池
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

export function CandidatePoolPanel({ manualMode = false }: { manualMode?: boolean }) {
  const [state, setState] = useState<PoolState>("loading");
  const [items, setItems] = useState<CandidateResearchPoolItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 候选池轻量状态草稿：搜索词 / 状态筛选 / 多选（刷新恢复，sessionStorage）
  const poolDraft = useSessionDraft<{ statusFilter: StatusFilter; query: string; selectedIds: string[] }>({
    pageKind: "candidate-pool",
    entityId: "pool",
    revision: "v1",
    initial: { statusFilter: "all", query: "", selectedIds: [] },
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(manualMode);
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const load = useCallback(async (offset = 0, append = false, filter = statusFilter, search = query) => {
    if (!append) setState("loading");
    setBusy(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filter === "converted") {
        // 已转任务是派生状态（convertedTaskId 非空），由服务端 status 参数无法表达，
        // 改为拉全量后前端过滤；此处只限制数量以控制体积。
        params.set("limit", "200");
      } else if (filter !== "all") {
        params.set("status", filter);
      }
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`/api/opportunity-candidates?${params.toString()}`, {
        method: "GET",
        headers: { ...buildAccessHeaders() },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseCandidateListResponse(payload) : null;
      if (!parsed) throw new Error("candidate_pool_response_invalid");
      let pageItems = parsed.items;
      if (filter === "converted") {
        pageItems = pageItems.filter((item) => item.researchAction === "converted");
        const kept = new Set(pageItems.map((item) => item.id));
        setSelectedIds((current) => current.filter((id) => kept.has(id)));
      }
      setItems((current) => append ? mergeCandidatePages(current, pageItems) : pageItems);
      setTotal(filter === "converted" ? pageItems.length : parsed.total);
      setHasMore(parsed.hasMore);
      setNextOffset(parsed.nextOffset);
      setState("ready");
    } catch {
      if (!append) setItems([]);
      setState("error");
      setMessage("读取失败，请确认当前登录会话仍然有效后重试。");
    } finally {
      setBusy(false);
    }
  }, [statusFilter, query]);

  useEffect(() => {
    void load(0, false, statusFilter, query);
  }, [load, statusFilter, query]);

  // 候选池草稿恢复（校验通过才应用，避免默认值覆盖草稿）
  useEffect(() => {
    if (poolDraft.draft && poolDraft.restored) {
      const d = poolDraft.draft;
      if (d.statusFilter) setStatusFilter(d.statusFilter);
      if (typeof d.query === "string") setQuery(d.query);
      if (Array.isArray(d.selectedIds)) setSelectedIds(d.selectedIds);
    }
  }, [poolDraft.draft, poolDraft.restored]);

  // 状态变化 → 防抖保存草稿
  useEffect(() => {
    poolDraft.save({ statusFilter, query, selectedIds });
  }, [statusFilter, query, selectedIds, poolDraft]);

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = manualName.trim();
    if (name.length < 2) return;
    setBusy(true);
    setMessage("");
    void (async () => {
      try {
        const response = await fetch("/api/opportunity-candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
          body: JSON.stringify({
            name,
            rawInput: name,
            link: manualUrl.trim() || null,
            source: "人工录入",
            status: "pending",
          }),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true) {
          throw new Error("candidate_manual_save_failed");
        }
        setManualName("");
        setManualUrl("");
        setSelectedIds([]);
        await load(0, false, statusFilter, query);
      } catch {
        setMessage("手工添加未完成，请检查输入和登录状态后重试。");
      } finally {
        setBusy(false);
      }
    })();
  }

  /** 未转任务真正删除；已转任务只退出研究池，保留 Task 与研究历史。 */
  function deleteItem(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    const label = item?.name ?? "该商品";
    const linkedTask = Boolean(item?.convertedTaskId);
    const confirmation = linkedTask
      ? `确定将「${label}」移出研究池？关联 Task 和研究历史会继续保留。`
      : `确定从研究池删除「${label}」？`;
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setMessage("");
    void (async () => {
      try {
        const response = await fetch(`/api/opportunity-candidates/${encodeURIComponent(id)}`, {
          method: linkedTask ? "PATCH" : "DELETE",
          headers: linkedTask
            ? { "Content-Type": "application/json", ...buildAccessHeaders() }
            : buildAccessHeaders(),
          ...(linkedTask
            ? { body: JSON.stringify({ action: "remove_from_research_pool" }) }
            : {}),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const code = payload && typeof payload === "object" && "error" in payload
            && payload.error && typeof payload.error === "object" && "code" in payload.error
            ? String(payload.error.code)
            : "";
          if (code === "candidate_has_linked_task") {
            setMessage("该商品已形成研究历史，请使用“移出研究池”。");
            return;
          }
          setMessage(linkedTask
            ? "移出研究池未完成，请刷新后重试。"
            : "删除未完成，请检查登录状态后重试。");
          return;
        }
        setSelectedIds((current) => current.filter((selected) => selected !== id));
        if (!linkedTask) {
          // 候选真正删除成功 → 清除该候选的研究决策草稿
          clearSessionDraftsForEntity("research-decision", id);
        }
        await load(0, false, statusFilter, query);
        if (linkedTask) setMessage("已移出研究池，研究历史仍保留。");
      } catch {
        setMessage(linkedTask
          ? "移出研究池未完成，请检查网络后重试。"
          : "删除未完成，请检查网络后重试。");
      } finally {
        setBusy(false);
      }
    })();
  }

  /** 批量处理：未转任务删除；已转任务移出研究池并保留历史。 */
  function deleteSelected() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确定处理已选 ${selectedIds.length} 项？已转任务商品只会移出研究池，研究历史仍保留。`)) return;
    setBusy(true);
    setMessage("");
    void (async () => {
      let removed = 0;
      let deleted = 0;
      for (const id of selectedIds) {
        const linkedTask = Boolean(items.find((item) => item.id === id)?.convertedTaskId);
        try {
          const response = await fetch(`/api/opportunity-candidates/${encodeURIComponent(id)}`, {
            method: linkedTask ? "PATCH" : "DELETE",
            headers: linkedTask
              ? { "Content-Type": "application/json", ...buildAccessHeaders() }
              : buildAccessHeaders(),
            ...(linkedTask
              ? { body: JSON.stringify({ action: "remove_from_research_pool" }) }
              : {}),
          });
          if (response.ok) {
            if (linkedTask) removed += 1;
            else {
              deleted += 1;
              clearSessionDraftsForEntity("research-decision", id);
            }
          }
        } catch {
          // 单条失败不中断批量，继续下一条
        }
      }
      setSelectedIds([]);
      const results = [
        deleted > 0 ? `已删除 ${deleted} 项` : "",
        removed > 0 ? `已移出研究池 ${removed} 项，研究历史仍保留` : "",
      ].filter(Boolean);
      await load(0, false, statusFilter, query);
      setMessage(results.length > 0 ? `${results.join("；")}。` : "没有可处理的候选，请刷新后重试。");
    })();
  }

  /** 批量开始研究：跳转第一个可研究候选的研究页 */
  function startSelected() {
    const first = items.find(
      (item) => selectedIds.includes(item.id) && item.researchAction === "research_available",
    );
    if (!first) {
      setMessage("已选项中无待研究商品，请先选择状态为「待研究」的商品。");
      return;
    }
    const href = candidatePrimaryHref(first);
    if (href) window.location.assign(href);
  }

  return (
    <CandidatePoolView
      state={state}
      items={items}
      total={total}
      hasMore={hasMore}
      statusFilter={statusFilter}
      query={query}
      selectedIds={selectedIds}
      busy={busy}
      manualOpen={manualOpen}
      manualName={manualName}
      manualUrl={manualUrl}
      message={message}
      onRefresh={() => void load(0, false, statusFilter, query)}
      onLoadMore={() => { if (nextOffset !== null) void load(nextOffset, true, statusFilter, query); }}
      onStatusFilterChange={(filter) => {
        setStatusFilter(filter);
        setSelectedIds([]);
        setItems([]);
      }}
      onQueryChange={(value) => {
        setQuery(value);
        setSelectedIds([]);
        setItems([]);
      }}
      onToggleSelect={(id) => {
        setSelectedIds((current) =>
          current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id],
        );
      }}
      onSelectAll={() => {
        setSelectedIds(items.filter((item) => item.researchAction !== "converted").map((item) => item.id));
      }}
      onClearSelection={() => setSelectedIds([])}
      onDeleteItem={deleteItem}
      onDeleteSelected={deleteSelected}
      onStartSelected={startSelected}
      onManualToggle={() => setManualOpen((current) => !current)}
      onManualNameChange={(value) => setManualName(value.slice(0, 120))}
      onManualUrlChange={(value) => setManualUrl(value.slice(0, 2048))}
      onManualSubmit={submitManual}
    />
  );
}
