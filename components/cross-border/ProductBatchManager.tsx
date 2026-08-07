"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  buildAccessHeaders,
  getAccessToken,
  updateDemoAccessInfo,
} from "@/lib/client/accessToken";
import { ResearchProductImage } from "@/components/ResearchProductImage";
import {
  AMAZON_US_TOP_LEVEL_CATEGORIES,
  productBatchReportTypeLabel,
  type ProductBatchImportInspection,
} from "@/lib/productBatchPresentation";
import { readProductBatchItemImageSnapshot } from "@/lib/productBatchImagePresentation";
import type {
  ProductBatchItemView,
  ProductBatchSelectionView,
  ProductBatchView,
} from "@/lib/productBatchStore";

type ViewState = "loading" | "ready" | "unauthenticated" | "error";
type ImportInspectionState = "idle" | "loading" | "ready" | "manual" | "error";
type ReportType = "search_results" | "category_current";

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
  manualReportTypeRequired?: boolean;
  importInspectionState?: ImportInspectionState;
  importInspection?: ProductBatchImportInspection | null;
  selectedReportType?: ReportType | "";
  selectedCategory?: string;
  onImport?: (event: FormEvent<HTMLFormElement>) => void;
  onImportFileChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onReportTypeChange?: (reportType: ReportType) => void;
  onCategoryChange?: (category: string) => void;
  onViewItems?: (batchId: string) => void;
  onActivate?: (batchId: string) => void;
  onArchive?: (batchId: string) => void;
  onActivateLegacy?: () => void;
  onResearchItem?: (productBatchItemId: string) => void;
  onDeleteBatch?: (batchId: string) => void;
  onRemoveItem?: (batchId: string, itemId: string) => void;
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
    if (metric?.status !== "resolved") return field === "price" ? "待确认" : "缺失";
    if (typeof metric.normalized === "string" || typeof metric.normalized === "number") {
      return String(metric.normalized);
    }
  } catch {
    // A corrupt item should remain visibly unavailable, never be guessed.
  }
  return field === "price" ? "待确认" : "缺失";
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
  manualReportTypeRequired = false,
  importInspectionState = "idle",
  importInspection = null,
  selectedReportType = "",
  selectedCategory = "",
  onImport,
  onImportFileChange,
  onReportTypeChange,
  onCategoryChange,
  onViewItems,
  onActivate,
  onArchive,
  onActivateLegacy,
  onResearchItem,
  onDeleteBatch,
  onRemoveItem,
  onRefresh,
}: ProductBatchManagerViewProps) {
  if (state === "loading") {
    return (
      <section className="surface-card mx-auto max-w-7xl p-5" aria-busy="true">
        <p className="eyebrow">商品批次</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">正在读取你的商品批次</h1>
      </section>
    );
  }
  if (state === "unauthenticated") {
    return (
      <section className="surface-card mx-auto max-w-7xl p-5">
        <p className="eyebrow">商品批次</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">登录后管理商品批次</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          未登录状态不会读取或展示管理员、访客的私有批次数据。
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

  const detectedReportType = importInspection?.reportTypeDetected
    && importInspection.reportType !== "unknown"
    ? importInspection.reportType
    : null;
  const effectiveReportType = detectedReportType ?? selectedReportType;
  const showManualReportType = manualReportTypeRequired
    || importInspectionState === "manual"
    || importInspectionState === "error";
  const categoryNeedsConfirmation = importInspection?.categoryDetection.status
    === "mixed_requires_confirmation";
  const importReady = Boolean(effectiveReportType && selectedCategory)
    && importInspectionState !== "loading";

  // 顶部概览派生：当前激活批次名 + 商品数（需批次详情已加载）
  const activeBatch = selection?.activeProductBatchId
    ? batches.find((candidate) => candidate.id === selection.activeProductBatchId)
    : null;
  const activeBatchName = selection?.activeProductBatchId
    ? (activeBatch?.batchName ?? "已选择（加载中）")
    : "尚未选择";
  const activeBatchItemCount = selectedBatch?.id === activeBatch?.id
    ? selectedItems.length
    : null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="product-batch-manager">
      <section className="workspace-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">商品批次</p>
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
            <p>批次数据保存在当前身份的独立访客沙盒；导入、解析、研究排序、切换和归档不消耗额度。</p>
          </div>
        ) : null}
        {state === "error" && errorMessage ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}
      </section>

      {/* 顶部概览：当前批次 / 当前商品数 / 历史批次数 / 主 CTA */}
      <section className="surface-card p-5" aria-label="运营概览">
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold text-slate-500">当前批次</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={activeBatchName}>
              {activeBatchName}
            </p>
            {activeBatchItemCount !== null ? (
              <p className="mt-0.5 text-xs text-slate-500">{activeBatchItemCount} 个商品</p>
            ) : null}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold text-slate-500">当前商品数</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {activeBatchItemCount ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold text-slate-500">历史批次数</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{batches.length}</p>
          </div>
          <div className="flex flex-col justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <p className="text-xs font-semibold text-teal-700">开始选品</p>
            <a
              href="/opportunities/sellersprite-preview"
              className="linear-button-primary inline-flex h-10 items-center justify-center px-4 text-sm font-semibold"
            >
              上传并预览报表
            </a>
          </div>
        </div>
      </section>

      {/* 上传报表统一入口：指向 sellersprite-preview（不再内嵌上传表单） */}
      <section className="surface-card p-5" aria-label="上传报表入口">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">上传报表</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">卖家精灵报表</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              上传 SellerSprite 美国站搜索结果 XLSX，先安全校验，再选择商品加入研究池。
            </p>
          </div>
          <a
            href="/opportunities/sellersprite-preview"
            className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
          >
            上传并预览报表
          </a>
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">当前批次</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              {selection?.activeProductBatchId
                ? batches.find((candidate) => candidate.id === selection.activeProductBatchId)
                  ?.batchName ?? "商品批次"
                : "尚未选择"}
            </h2>
          </div>
        </div>
      </section>

      <section className="surface-card p-5">
        <p className="eyebrow">批次历史</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">{batches.length} 个商品批次</h2>
        {batches.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
            <p className="text-sm text-slate-600">还没有商品批次。先上传报表开始选品。</p>
            <a
              href="/opportunities/sellersprite-preview"
              className="linear-button-primary mt-4 inline-flex h-10 items-center justify-center px-5 text-sm font-semibold"
            >
              上传并预览报表
            </a>
          </div>
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
                        {batch.acceptedCount ?? 0} 个商品 · {formatDate(batch.importedAt)}
                      </p>
                      <details className="mt-2 text-xs text-slate-500">
                        <summary className="cursor-pointer font-semibold">高级信息</summary>
                        <p className="mt-1">报表类型：{productBatchReportTypeLabel(batch.reportType)}</p>
                      </details>
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDeleteBatch?.(batch.id)}
                      className="h-9 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      删除
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
              const productImage = readProductBatchItemImageSnapshot(item.imageSnapshotJson);
              return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <ResearchProductImage
                    image={productImage}
                    alt={metricValue(item, "productTitle")}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-3 font-semibold leading-6 text-slate-950">
                      {metricValue(item, "productTitle")}
                    </h3>
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="cursor-pointer font-semibold">高级信息</summary>
                      <p className="mt-1">内部研究顺序：{item.researchPriority}</p>
                      <p>ASIN：{item.asin ?? "缺失"}</p>
                    </details>
                  </div>
                </div>
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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemoveItem?.(selectedBatch.id, item.id)}
                  className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                >
                  移出当前批次
                </button>
                {blockedReason ? (
                  <p className="mt-2 text-xs font-semibold leading-5 text-amber-700">
                    {blockedReason}
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    只会准备研究对象；不会自动调用 AI，也不会消耗额度。
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
  const [manualReportTypeRequired, setManualReportTypeRequired] = useState(false);
  const [importInspectionState, setImportInspectionState] =
    useState<ImportInspectionState>("idle");
  const [importInspection, setImportInspection] =
    useState<ProductBatchImportInspection | null>(null);
  const [selectedReportType, setSelectedReportType] = useState<ReportType | "">("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const inspectionSequence = useRef(0);

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

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    const sequence = inspectionSequence.current + 1;
    inspectionSequence.current = sequence;
    setImportInspection(null);
    setSelectedReportType("");
    setSelectedCategory("");
    setManualReportTypeRequired(false);
    setErrorMessage(null);
    if (!file) {
      setImportInspectionState("idle");
      return;
    }
    setImportInspectionState("loading");
    void (async () => {
      const formData = new FormData();
      formData.set("operation", "inspect");
      formData.set("file", file);
      try {
        const response = await fetch("/api/product-batches", {
          method: "POST",
          headers: buildAccessHeaders(),
          body: formData,
        });
        const body = await response.json() as {
          ok?: boolean;
          data?: ProductBatchImportInspection;
        };
        if (sequence !== inspectionSequence.current) return;
        if (!response.ok || !body.data) throw new Error(responseError(body));
        setImportInspection(body.data);
        if (!body.data.reportTypeDetected || body.data.reportType === "unknown") {
          setImportInspectionState("manual");
          setManualReportTypeRequired(true);
          return;
        }
        setSelectedReportType(body.data.reportType);
        setSelectedCategory(body.data.categoryDetection.category ?? "");
        setImportInspectionState("ready");
      } catch (error) {
        if (sequence !== inspectionSequence.current) return;
        setImportInspectionState("error");
        setManualReportTypeRequired(true);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "无法识别报表，请核对文件后手动选择。",
        );
      }
    })();
  };

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
    formData.set("operation", "import");
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
      if (!response.ok || !body.data) {
        const code = typeof body === "object"
          && body !== null
          && "error" in body
          && typeof (body as { error?: { code?: unknown } }).error?.code === "string"
          ? (body as { error: { code: string } }).error.code
          : "";
        if (code === "report_type_required") {
          setManualReportTypeRequired(true);
          setImportInspectionState("manual");
        }
        throw new Error(responseError(body));
      }
      setManualReportTypeRequired(false);
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

  const deleteBatch = (batchId: string) => {
    const batch = batches.find((candidate) => candidate.id === batchId);
    const name = batch?.batchName ?? "该批次";
    const isActive = selection?.activeProductBatchId === batchId;
    const confirmText = isActive
      ? `删除当前批次「${name}」后，该批次商品会从批次列表移除；已经加入商品研究池的商品不会删除。删除后当前批次将变为空。`
      : `确定删除「${name}」？删除后批次内商品将一并移除，已进入研究池的商品不受影响。`;
    if (!window.confirm(confirmText)) {
      return;
    }
    void runMutation(async () => {
      const response = await fetch(`/api/product-batches/${encodeURIComponent(batchId)}`, {
        method: "DELETE",
        headers: buildAccessHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(responseError(body));
      if (selectedBatch?.id === batchId) {
        setSelectedBatch(null);
        setSelectedItems([]);
      }
    });
  };

  const removeItem = (batchId: string, itemId: string) => {
    if (!window.confirm("确定把该商品移出当前批次？已进入研究池的商品不受影响。")) {
      return;
    }
    void runMutation(async () => {
      const response = await fetch(`/api/product-batches/${encodeURIComponent(batchId)}`, {
        method: "PATCH",
        headers: {
          ...buildAccessHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "removeItem", itemId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(responseError(body));
      await loadDetail(batchId);
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
      manualReportTypeRequired={manualReportTypeRequired}
      importInspectionState={importInspectionState}
      importInspection={importInspection}
      selectedReportType={selectedReportType}
      selectedCategory={selectedCategory}
      onImport={handleImport}
      onImportFileChange={handleImportFileChange}
      onReportTypeChange={setSelectedReportType}
      onCategoryChange={setSelectedCategory}
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
      onDeleteBatch={deleteBatch}
      onRemoveItem={removeItem}
      onRefresh={() => void refresh()}
    />
  );
}
