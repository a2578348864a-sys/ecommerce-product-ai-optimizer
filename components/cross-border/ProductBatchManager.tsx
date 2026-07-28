"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  buildAccessHeaders,
  getAccessToken,
  updateDemoAccessInfo,
} from "@/lib/client/accessToken";
import type {
  ProductBatchItemView,
  ProductBatchSelectionView,
  ProductBatchView,
} from "@/lib/productBatchStore";

type ViewState = "loading" | "ready" | "unauthenticated" | "error";

interface ProductBatchManagerViewProps {
  state: ViewState;
  accessMode: "owner" | "visitor" | null;
  remainingAiCalls: number | null;
  batches: ProductBatchView[];
  selection: ProductBatchSelectionView | null;
  legacyRegistrationId: string | null;
  selectedBatch: ProductBatchView | null;
  selectedItems: ProductBatchItemView[];
  busy: boolean;
  errorMessage?: string | null;
  onImport?: (event: FormEvent<HTMLFormElement>) => void;
  onViewItems?: (batchId: string) => void;
  onActivate?: (batchId: string) => void;
  onArchive?: (batchId: string) => void;
  onActivateLegacy?: () => void;
  onResearchItem?: (productBatchItemId: string) => void;
  onRefresh?: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return "未完成";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function batchStatus(value: ProductBatchView["batchStatus"]): string {
  if (value === "processing") return "处理中";
  if (value === "ready") return "可使用";
  if (value === "blocked") return "已阻断";
  return "已归档";
}

function metricValue(
  item: ProductBatchItemView,
  field: "productTitle" | "price" | "rating" | "reviews",
): string {
  try {
    const product = JSON.parse(item.normalizedProductJson) as {
      providerMetrics?: Record<string, { status?: string; normalized?: unknown }>;
    };
    const metric = product.providerMetrics?.[field];
    if (metric?.status !== "resolved") return "缺失";
    if (typeof metric.normalized === "string" || typeof metric.normalized === "number") {
      return String(metric.normalized);
    }
  } catch {
    // A corrupt item should remain visibly unavailable, never be guessed.
  }
  return "缺失";
}

function researchBlockedReason(input: {
  item: ProductBatchItemView;
  selectedBatch: ProductBatchView;
  selection: ProductBatchSelectionView | null;
}): string | null {
  if (input.selection?.activeProductBatchId !== input.selectedBatch.id) {
    return "请先把该批次设置为当前批次。";
  }
  if (input.selectedBatch.batchStatus !== "ready") {
    return "只有可使用的批次商品才能进入研究。";
  }
  if (input.selectedBatch.dataQualityStatus !== "passed"
    && input.selectedBatch.dataQualityStatus !== "passed_with_quarantine") {
    return "批次数据质量尚未通过，不能进入研究。";
  }
  if (input.item.promotionEligible !== false) {
    return "商品来源状态异常，不能进入研究。";
  }
  return null;
}

export function ProductBatchManagerView({
  state,
  accessMode,
  remainingAiCalls,
  batches,
  selection,
  legacyRegistrationId,
  selectedBatch,
  selectedItems,
  busy,
  errorMessage,
  onImport,
  onViewItems,
  onActivate,
  onArchive,
  onActivateLegacy,
  onResearchItem,
  onRefresh,
}: ProductBatchManagerViewProps) {
  if (state === "loading") {
    return (
      <section className="surface-card mx-auto max-w-7xl p-5" aria-busy="true">
        <p className="eyebrow">ProductBatch V1</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">正在读取你的商品批次</h1>
      </section>
    );
  }
  if (state === "unauthenticated") {
    return (
      <section className="surface-card mx-auto max-w-7xl p-5">
        <p className="eyebrow">ProductBatch V1</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">登录后管理商品批次</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          未登录状态不会读取或展示 Owner、Visitor 的私有批次数据。
        </p>
        <Link
          href="/"
          className="linear-button-primary mt-4 inline-flex h-10 items-center px-4 text-sm font-semibold"
        >
          返回登录
        </Link>
      </section>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="product-batch-manager">
      <section className="workspace-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">ProductBatch V1</p>
            <h1 className="section-title mt-1 text-2xl">SellerSprite 商品批次</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              上传 SellerSprite 官方 XLSX，创建批次并由你决定当前查看哪一批商品。
              排名只用于安排研究顺序，不是自动选品结论。
            </p>
          </div>
          <button
            type="button"
            className="linear-button h-10 px-4 text-sm font-semibold"
            disabled={busy}
            onClick={onRefresh}
          >
            刷新
          </button>
        </div>
        {accessMode === "visitor" ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
            <p className="font-semibold">访客体验 · 剩余真实 AI 额度 {remainingAiCalls ?? 0}/5</p>
            <p>批次数据保存在当前身份的独立访客沙盒；导入、解析、Ranking、切换和归档不消耗额度。</p>
          </div>
        ) : null}
        {state === "error" && errorMessage ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}
      </section>

      <section className="surface-card p-5">
        <p className="eyebrow">导入新批次</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">SellerSprite XLSX</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={onImport}>
          <label className="sm:col-span-2 lg:col-span-2">
            <span className="text-xs font-semibold text-slate-600">官方 XLSX</span>
            <input
              required
              type="file"
              name="file"
              accept=".xlsx"
              className="mt-1 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="text-xs font-semibold text-slate-600">报表类型</span>
            <select
              name="reportType"
              defaultValue="search_results"
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="search_results">Search Results</option>
              <option value="category_current">Category Current</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-semibold text-slate-600">查询词</span>
            <input
              name="query"
              defaultValue="organizer"
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
          </label>
          <label>
            <span className="text-xs font-semibold text-slate-600">类目</span>
            <input
              required
              name="category"
              defaultValue="Home"
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="text-xs font-semibold text-slate-600">最低价</span>
              <input
                required
                name="priceMin"
                inputMode="decimal"
                defaultValue="10"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
            <label>
              <span className="text-xs font-semibold text-slate-600">最高价</span>
              <input
                required
                name="priceMax"
                inputMode="decimal"
                defaultValue="40"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
          </div>
          <div className="sm:col-span-2 lg:col-span-6">
            <button
              type="submit"
              disabled={busy}
              className="linear-button-primary inline-flex h-11 w-full items-center justify-center px-5 text-sm font-semibold sm:w-auto"
            >
              {busy ? "处理中…" : "导入新批次"}
            </button>
          </div>
        </form>
      </section>

      <section className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">当前批次</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              {selection?.activeProductBatchId
                ? batches.find((candidate) => candidate.id === selection.activeProductBatchId)
                  ?.batchName ?? "ProductBatch"
                : selection?.activeLegacyRegistrationId
                  ? "Legacy 冻结批次"
                  : "尚未选择"}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy || !legacyRegistrationId}
            onClick={onActivateLegacy}
            className="linear-button h-10 px-4 text-sm font-semibold"
          >
            切回 Legacy
          </button>
        </div>
      </section>

      <section className="surface-card p-5">
        <p className="eyebrow">批次历史</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">{batches.length} 个商品批次</h2>
        {batches.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">尚未导入 ProductBatch。</p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {batches.map((batch) => {
              const active = selection?.activeProductBatchId === batch.id;
              return (
                <article key={batch.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-950">{batch.batchName}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {batch.reportType} · {batch.acceptedCount ?? 0} 个商品 · {formatDate(batch.importedAt)}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                      {active ? "当前 · " : ""}{batchStatus(batch.batchStatus)}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onViewItems?.(batch.id)}
                      className="linear-button-soft h-9 px-3 text-sm font-semibold"
                    >
                      查看商品
                    </button>
                    <button
                      type="button"
                      disabled={busy || active || batch.batchStatus !== "ready"}
                      onClick={() => onActivate?.(batch.id)}
                      className="linear-button-primary h-9 px-3 text-sm font-semibold"
                    >
                      设置为当前
                    </button>
                    <button
                      type="button"
                      disabled={busy || active || batch.batchStatus !== "ready"}
                      onClick={() => onArchive?.(batch.id)}
                      className="linear-button h-9 px-3 text-sm font-semibold"
                    >
                      归档
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedBatch ? (
        <section className="surface-card p-5">
          <p className="eyebrow">批次商品</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{selectedBatch.batchName}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {selectedItems.map((item) => {
              const blockedReason = researchBlockedReason({
                item,
                selectedBatch,
                selection,
              });
              return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                    {item.researchPriority}
                  </span>
                  <span className="text-xs text-slate-400">{item.asin ?? "ASIN 缺失"}</span>
                </div>
                <h3 className="mt-3 line-clamp-3 font-semibold leading-6 text-slate-950">
                  {metricValue(item, "productTitle")}
                </h3>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <p className="rounded-lg bg-slate-50 p-2">价格<br /><b>{metricValue(item, "price")}</b></p>
                  <p className="rounded-lg bg-slate-50 p-2">评分<br /><b>{metricValue(item, "rating")}</b></p>
                  <p className="rounded-lg bg-slate-50 p-2">评论<br /><b>{metricValue(item, "reviews")}</b></p>
                </div>
                <button
                  type="button"
                  data-testid={`product-batch-research-${item.id}`}
                  disabled={busy || Boolean(blockedReason)}
                  onClick={() => onResearchItem?.(item.id)}
                  className="linear-button-primary mt-4 h-10 w-full px-4 text-sm font-semibold disabled:opacity-50"
                >
                  研究此商品
                </button>
                {blockedReason ? (
                  <p className="mt-2 text-xs font-semibold leading-5 text-amber-700">
                    {blockedReason}
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    只创建或复用 Candidate；不会自动调用 AI，也不会消耗额度。
                  </p>
                )}
              </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface ListPayload {
  accessMode: "owner" | "visitor";
  remainingAiCalls: number | null;
  batches: ProductBatchView[];
  selection: ProductBatchSelectionView | null;
  legacyRegistrationId: string | null;
}

function responseError(value: unknown): string {
  if (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof (value as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (value as { error: { message: string } }).error.message;
  }
  return "商品批次操作失败，请稍后重试。";
}

export function ProductBatchManager() {
  const [state, setState] = useState<ViewState>("loading");
  const [accessMode, setAccessMode] = useState<"owner" | "visitor" | null>(null);
  const [remainingAiCalls, setRemainingAiCalls] = useState<number | null>(null);
  const [batches, setBatches] = useState<ProductBatchView[]>([]);
  const [selection, setSelection] = useState<ProductBatchSelectionView | null>(null);
  const [legacyRegistrationId, setLegacyRegistrationId] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ProductBatchView | null>(null);
  const [selectedItems, setSelectedItems] = useState<ProductBatchItemView[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const applyAccess = (data: Pick<ListPayload, "accessMode" | "remainingAiCalls">) => {
    setAccessMode(data.accessMode);
    setRemainingAiCalls(data.remainingAiCalls);
    if (data.accessMode === "visitor" && data.remainingAiCalls !== null) {
      updateDemoAccessInfo({ remainingAiCalls: data.remainingAiCalls });
    }
  };

  const loadDetail = useCallback(async (batchId: string) => {
    const response = await fetch(`/api/product-batches/${encodeURIComponent(batchId)}`, {
      headers: buildAccessHeaders(),
      cache: "no-store",
    });
    const body = await response.json() as {
      ok?: boolean;
      data?: { batch: ProductBatchView; items: ProductBatchItemView[] };
    };
    if (!response.ok || !body.data) throw new Error(responseError(body));
    setSelectedBatch(body.data.batch);
    setSelectedItems(body.data.items);
  }, []);

  const refresh = useCallback(async () => {
    if (!getAccessToken()) {
      setState("unauthenticated");
      setBatches([]);
      setSelectedBatch(null);
      setSelectedItems([]);
      return;
    }
    try {
      const response = await fetch("/api/product-batches", {
        headers: buildAccessHeaders(),
        cache: "no-store",
      });
      const body = await response.json() as { ok?: boolean; data?: ListPayload };
      if (response.status === 401) {
        setState("unauthenticated");
        return;
      }
      if (!response.ok || !body.data) throw new Error(responseError(body));
      applyAccess(body.data);
      setBatches(body.data.batches);
      setSelection(body.data.selection);
      setLegacyRegistrationId(body.data.legacyRegistrationId);
      setState("ready");
      setErrorMessage(null);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "读取商品批次失败。");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMutation = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "商品批次操作失败。");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (formData.get("reportType") === "category_current") formData.delete("query");
    void runMutation(async () => {
      const response = await fetch("/api/product-batches", {
        method: "POST",
        headers: buildAccessHeaders(),
        body: formData,
      });
      const body = await response.json() as {
        ok?: boolean;
        data?: {
          batch: ProductBatchView;
          accessMode: "owner" | "visitor";
          remainingAiCalls: number | null;
        };
      };
      if (!response.ok || !body.data) throw new Error(responseError(body));
      applyAccess(body.data);
      await loadDetail(body.data.batch.id);
    });
  };

  const patchBatch = (batchId: string, action: "activate" | "archive") => (
    runMutation(async () => {
      const response = await fetch(`/api/product-batches/${encodeURIComponent(batchId)}`, {
        method: "PATCH",
        headers: {
          ...buildAccessHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(responseError(body));
    })
  );

  const activateLegacy = () => {
    if (!legacyRegistrationId) return;
    void runMutation(async () => {
      const response = await fetch("/api/product-batches/selection", {
        method: "PATCH",
        headers: {
          ...buildAccessHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "activate_legacy",
          registrationId: legacyRegistrationId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(responseError(body));
    });
  };

  const researchItem = (productBatchItemId: string) => {
    void runMutation(async () => {
      const response = await fetch("/api/product-batches/candidates", {
        method: "POST",
        headers: {
          ...buildAccessHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ productBatchItemId }),
      });
      const body = await response.json() as {
        ok?: boolean;
        data?: { destinationUrl?: string };
      };
      if (!response.ok || !body.data?.destinationUrl) {
        throw new Error(responseError(body));
      }
      window.location.assign(body.data.destinationUrl);
    });
  };

  return (
    <ProductBatchManagerView
      state={state}
      accessMode={accessMode}
      remainingAiCalls={remainingAiCalls}
      batches={batches}
      selection={selection}
      legacyRegistrationId={legacyRegistrationId}
      selectedBatch={selectedBatch}
      selectedItems={selectedItems}
      busy={busy}
      errorMessage={errorMessage}
      onImport={handleImport}
      onViewItems={(batchId) => {
        setBusy(true);
        void loadDetail(batchId)
          .catch((error) => {
            setState("error");
            setErrorMessage(error instanceof Error ? error.message : "读取批次商品失败。");
          })
          .finally(() => setBusy(false));
      }}
      onActivate={(batchId) => void patchBatch(batchId, "activate")}
      onArchive={(batchId) => void patchBatch(batchId, "archive")}
      onActivateLegacy={activateLegacy}
      onResearchItem={researchItem}
      onRefresh={() => void refresh()}
    />
  );
}
