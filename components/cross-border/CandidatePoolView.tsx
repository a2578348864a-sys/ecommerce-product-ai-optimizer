"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  candidatePrimaryHref,
  mergeCandidatePages,
  parseCandidateListResponse,
  type CandidateResearchPoolItem,
  type CandidateResearchStatus,
} from "@/lib/candidateResearchPool";

const PAGE_SIZE = 100;

type PoolState = "loading" | "ready" | "error";
type StatusFilter = "all" | CandidateResearchStatus;

export type CandidatePoolViewProps = {
  state: PoolState;
  items: CandidateResearchPoolItem[];
  total: number;
  hasMore: boolean;
  statusFilter: StatusFilter;
  busy: boolean;
  manualOpen: boolean;
  manualName: string;
  manualUrl: string;
  message: string;
  onRefresh: () => void;
  onLoadMore: () => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onManualToggle: () => void;
  onManualNameChange: (value: string) => void;
  onManualUrlChange: (value: string) => void;
  onManualSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待查看" },
  { value: "worth_analyzing", label: "待研究" },
  { value: "analyzed", label: "研究中" },
  { value: "paused", label: "已暂缓" },
  { value: "rejected", label: "已放弃" },
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
            const converted = Boolean(item.convertedTaskId);
            return (
              <article key={item.id} className="surface-card p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">
                        {STATUS_LABEL[item.status]}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {SOURCE_LABEL[item.sourceKind]}
                      </span>
                      <span className="text-xs text-slate-500">{item.marketplace || "市场待确认"}</span>
                    </div>
                    <h3 className="mt-3 break-words text-base font-semibold text-slate-950">{item.name}</h3>
                    <p className="mt-2 text-xs text-slate-400">最近更新：{formatDate(item.updatedAt)}</p>
                  </div>
                  {href ? (
                    <Link href={href} className="linear-button-primary inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm font-semibold">
                      {converted ? "查看研究结果" : item.status === "pending" ? "开始研究" : "继续研究"}
                      <ArrowRight className="size-4" />
                    </Link>
                  ) : (
                    <span className="text-sm text-amber-700">记录身份异常，暂不能进入研究</span>
                  )}
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
          <span className="inline-flex items-center gap-2"><Plus className="size-4 text-teal-700" />手工添加（旧版兼容）</span>
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(manualMode);
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const load = useCallback(async (offset = 0, append = false, filter = statusFilter) => {
    if (!append) setState("loading");
    setBusy(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filter !== "all") params.set("status", filter);
      const response = await fetch(`/api/opportunity-candidates?${params.toString()}`, {
        method: "GET",
        headers: { ...buildAccessHeaders() },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseCandidateListResponse(payload) : null;
      if (!parsed) throw new Error("candidate_pool_response_invalid");
      setItems((current) => append ? mergeCandidatePages(current, parsed.items) : parsed.items);
      setTotal(parsed.total);
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
  }, [statusFilter]);

  useEffect(() => {
    void load(0, false, statusFilter);
  }, [load, statusFilter]);

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = manualName.trim();
    if (name.length < 2) return;
    setBusy(true);
    setMessage("");
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
      await load(0, false, statusFilter);
    } catch {
      setMessage("手工添加未完成，请检查输入和登录状态后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CandidatePoolView
      state={state}
      items={items}
      total={total}
      hasMore={hasMore}
      statusFilter={statusFilter}
      busy={busy}
      manualOpen={manualOpen}
      manualName={manualName}
      manualUrl={manualUrl}
      message={message}
      onRefresh={() => void load(0, false, statusFilter)}
      onLoadMore={() => { if (nextOffset !== null) void load(nextOffset, true, statusFilter); }}
      onStatusFilterChange={(filter) => {
        setStatusFilter(filter);
        setItems([]);
      }}
      onManualToggle={() => setManualOpen((current) => !current)}
      onManualNameChange={(value) => setManualName(value.slice(0, 120))}
      onManualUrlChange={(value) => setManualUrl(value.slice(0, 2048))}
      onManualSubmit={submitManual}
    />
  );
}
