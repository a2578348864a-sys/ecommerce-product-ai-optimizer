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
  isAuthenticated,
  updateDemoAccessInfo,
} from "@/lib/client/accessToken";
import { ResearchProductImage } from "@/components/ResearchProductImage";
import {
  AMAZON_US_TOP_LEVEL_CATEGORIES,
  productBatchReportTypeLabel,
  readProductBatchItemPresentation,
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
  maxProducts: number | null;
  usedProducts: number | null;
  remainingProducts: number | null;
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
  selectedFileName?: string;
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

function categoryValueLabel(value: string): string {
  return AMAZON_US_TOP_LEVEL_CATEGORIES.find((category) => category.value === value)?.label
    ?? value;
}

function batchStatus(value: ProductBatchView["batchStatus"]): string {
  if (value === "processing") return "处理中";
  if (value === "ready") return "可使用";
  if (value === "blocked") return "已阻断";
  return "已归档";
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
  maxProducts,
  usedProducts,
  remainingProducts,
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
  selectedFileName = "",
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
        <p className="eyebrow">发现商品</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">正在读取你的商品导入记录</h1>
      </section>
    );
  }
  if (state === "unauthenticated") {
    return (
      <section className="surface-card mx-auto max-w-7xl p-5">
        <p className="eyebrow">发现商品</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">登录后查看和选择商品</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          未登录状态不会读取或展示管理员、访客的私有商品数据。
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

  // 批次导入只支持商品报表（PS/CC）；关键词报表（reverse_asin / keyword_mining）
  // 走关键词管线（Phase 3/4），此处收窄类型并忽略。
  const detectedReportType = importInspection?.reportTypeDetected
    && (importInspection.reportType === "search_results" || importInspection.reportType === "category_current")
    ? importInspection.reportType
    : null;
  const effectiveReportType = detectedReportType ?? selectedReportType;
  const showManualReportType = manualReportTypeRequired
    || importInspectionState === "manual"
    || importInspectionState === "error";
  const categoryNeedsConfirmation = importInspection?.categoryDetection.status
    === "mixed_requires_confirmation";
  const importReady = Boolean(selectedFileName && effectiveReportType && selectedCategory)
    && importInspectionState !== "loading";

  const activeBatch = selection?.activeProductBatchId
    ? batches.find((candidate) => candidate.id === selection.activeProductBatchId)
    : null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="product-batch-manager">
      <section className="workspace-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">发现商品</p>
            <h1 className="section-title mt-1 text-2xl">发现与选择商品</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              上传 SellerSprite 官方 XLSX 导入商品，查看最近一次导入的商品，选择要研究的目标。
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
            <p className="font-semibold">
              访客体验
              {maxProducts !== null && usedProducts !== null && remainingProducts !== null
                ? ` · 已使用商品 ${usedProducts} / ${maxProducts} · 剩余 ${remainingProducts} 个商品`
                : ""}
            </p>
            <p>上传、解析、排序和归档不占用商品体验名额；首次开始一个新的商品研究链时才占用名额。</p>
          </div>
        ) : null}
        {state === "error" && errorMessage ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}
      </section>

      {/* 第一步：上传 SellerSprite XLSX */}
      <section className="surface-card p-5" aria-label="上传报表入口">
        <div>
          <p className="eyebrow">第一步 · 导入商品</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">上传 SellerSprite 报表</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            支持 SellerSprite Amazon 美国站 XLSX，最大 10 MiB。系统先检查文件结构，
            再建立 ProductBatch 商品候选池并计算研究优先级。
          </p>
        </div>
        <form className="mt-4 grid gap-4" onSubmit={onImport}>
          <div className="grid gap-2 text-sm font-semibold text-slate-700">
            <span>SellerSprite XLSX</span>
            <input
              id="product-batch-file"
              name="file"
              type="file"
              accept=".xlsx"
              disabled={busy}
              aria-label="选择 SellerSprite XLSX 文件"
              aria-describedby="product-batch-file-status"
              onClick={(event) => {
                // 允许用户重新选择同一文件；真正导入使用已保留在组件状态中的 File。
                event.currentTarget.value = "";
              }}
              onChange={onImportFileChange}
              className="sr-only"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="product-batch-file"
                aria-disabled={busy}
                className={`inline-flex h-11 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-4 font-semibold text-teal-700 ${
                  busy ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-teal-100"
                }`}
              >
                选择文件
              </label>
              <span id="product-batch-file-status" className="min-w-0 break-all font-normal text-slate-600" aria-live="polite">
                {selectedFileName ? `已选择：${selectedFileName}` : "尚未选择文件"}
              </span>
            </div>
          </div>

          {importInspectionState === "loading" ? (
            <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
              正在安全解析文件并识别报表类型…
            </p>
          ) : null}
          {importInspectionState === "error" && errorMessage ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {errorMessage}
            </p>
          ) : null}
          {detectedReportType ? (
            <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800" data-testid="report-type-auto-detected">
              已自动识别报表类型：{productBatchReportTypeLabel(detectedReportType)}。
              {importInspection?.categoryDetection.status === "detected" && selectedCategory ? (
                <> 已自动识别一级类目：{categoryValueLabel(selectedCategory)}。请确认查询词和价格范围后导入。</>
              ) : (
                <> 请确认类目、查询词和价格范围后导入。</>
              )}
            </p>
          ) : null}

          {showManualReportType ? (
            <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-slate-700" data-testid="report-type-manual-required">
              <p className="font-semibold text-amber-800">无法可靠识别报表类型，请手动选择。</p>
              {importInspection?.reportTypeHints && (
                <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-normal leading-5 text-slate-600" data-testid="report-type-hints">
                  {importInspection.reportTypeHints.suggestion ? (
                    <p className="font-semibold text-teal-800">
                      检测建议：
                      {importInspection.reportTypeHints.suggestion === "category_current"
                        ? "更像「类目商品报表」"
                        : "更像「搜索结果报表」"}
                      （{importInspection.reportTypeHints.reasons.join("、") || "行级特征不足"}）
                    </p>
                  ) : (
                    <p>行级特征不足（{importInspection.reportTypeHints.reasons.join("、") || "无明显榜单或搜索结果特征"}），无法给出建议。</p>
                  )}
                  <p className="mt-1">建议仅供参考，请以报表实际内容为准。</p>
                </div>
              )}
              <label className="grid gap-2">
                手动选择报表类型
                <select
                  name="reportType"
                  value={selectedReportType}
                  required
                  disabled={busy}
                  onChange={(event) => onReportTypeChange?.(event.currentTarget.value as ReportType)}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-normal"
                >
                  <option value="">请选择</option>
                  <option value="search_results">搜索结果报表</option>
                  <option value="category_current">类目商品报表</option>
                </select>
              </label>
            </div>
          ) : effectiveReportType ? (
            <input type="hidden" name="reportType" value={effectiveReportType} />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              Amazon 美国站一级类目
              <select
                name="category"
                value={selectedCategory}
                required
                disabled={busy}
                onChange={(event) => onCategoryChange?.(event.currentTarget.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-normal"
              >
                <option value="">请选择类目</option>
                {AMAZON_US_TOP_LEVEL_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
              {categoryNeedsConfirmation ? (
                <span className="font-normal text-amber-700">文件包含多个类目，请人工确认本次研究类目。</span>
              ) : null}
            </label>
            {effectiveReportType === "search_results" ? (
              <label className="grid gap-2 text-sm font-semibold text-slate-700">
                查询词
                <input
                  name="query"
                  type="text"
                  required
                  maxLength={200}
                  disabled={busy}
                  placeholder="例如：water bottle"
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-normal"
                />
              </label>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              最低价格（美元）
              <input
                name="priceMin"
                type="number"
                min="0"
                step="0.01"
                disabled={busy}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              最高价格（美元）
              <input
                name="priceMax"
                type="number"
                min="0"
                step="0.01"
                disabled={busy}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-normal"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !importReady}
              className="linear-button-primary h-11 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "正在导入…" : "导入并查看优先级"}
            </button>
            <p className="text-xs leading-5 text-slate-500">
              导入不会创建研究 Task，也不会自动调用 Agent、生成 Listing 或图片。
            </p>
          </div>
        </form>
      </section>

      {/* 第二步：最近一次导入（用户当前关注点） */}
      <section className="surface-card p-5" aria-label="最近一次导入">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">第二步 · 最近一次导入</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              {selection?.activeProductBatchId
                ? batches.find((candidate) => candidate.id === selection.activeProductBatchId)
                  ?.batchName ?? "尚未导入商品"
                : "尚未导入商品"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {selection?.activeProductBatchId ? "这是当前查看的商品列表。选择商品即可进入研究。" : "上传报表后，导入的商品会显示在这里。"}
            </p>
          </div>
          {selection?.activeProductBatchId && activeBatch ? (
            <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
              已导入 {activeBatch.acceptedCount ?? 0} 个商品 · {formatDate(activeBatch.importedAt)}
            </span>
          ) : null}
        </div>
        {selection?.activeProductBatchId && activeBatch ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-xs font-semibold text-slate-500">导入商品</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{activeBatch.acceptedCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-xs font-semibold text-slate-500">本次查看</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {selectedBatch?.id === activeBatch.id ? selectedItems.length : 0}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">已加载商品数</p>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs font-semibold text-amber-700">下一步</p>
              <p className="mt-1 text-sm font-semibold text-amber-800">查看商品并选择进入研究</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => onViewItems?.(activeBatch.id)}
                className="linear-button-primary mt-2 inline-flex h-9 items-center justify-center px-4 text-sm font-semibold"
              >
                查看商品
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
            <p className="text-sm text-slate-600">
              还没有导入商品。使用上方上传区导入 SellerSprite XLSX。
            </p>
          </div>
        )}
      </section>

      {/* 历史导入 */}
      <section className="surface-card p-5">
        <p className="eyebrow">历史导入</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">{batches.length} 次导入</h2>
        {batches.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
            <p className="text-sm text-slate-600">
              还没有导入记录。使用上方上传区导入 SellerSprite XLSX。
            </p>
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
                        <summary className="cursor-pointer font-semibold">报表信息</summary>
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
                      设为当前
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
        <section className="surface-card p-5" aria-label="商品选择">
          <p className="eyebrow">第三步 · 选择商品</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{selectedBatch.batchName}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            选择要研究的商品。只会准备研究对象，不会自动调用 AI，也不会消耗额度。
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {selectedItems.map((item) => {
              const blockedReason = researchBlockedReason({
                item,
                selectedBatch,
                selection,
              });
              const presentation = readProductBatchItemPresentation(item);
              const productImage = readProductBatchItemImageSnapshot(item.imageSnapshotJson);
              return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <ResearchProductImage
                    image={productImage}
                    alt={presentation.title}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-3 font-semibold leading-6 text-slate-950">
                      {presentation.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">ASIN：{presentation.asin ?? "缺失"}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                  <p className="rounded-lg bg-slate-50 p-2">价格<br /><b>{presentation.price}</b></p>
                  <p className="rounded-lg bg-slate-50 p-2">评分<br /><b>{presentation.rating}</b></p>
                  <p className="rounded-lg bg-slate-50 p-2">评论数<br /><b>{presentation.reviews}</b></p>
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                    第三方估算月销量<br /><b>{presentation.estimatedMonthlySales}</b>
                  </p>
                </div>
                <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50/60 p-3">
                  <p className="text-xs font-semibold text-teal-800">智能研究优先级</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">{presentation.researchPriority}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{presentation.evidenceStatus}</p>
                </div>
                <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-800">查看排序依据</summary>
                  <div className="mt-3 grid gap-3">
                    <div>
                      <p className="font-semibold text-teal-700">有利信号</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {(presentation.positiveReasons.length > 0
                          ? presentation.positiveReasons
                          : ["暂无可展示的有利信号"]
                        ).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-amber-700">反向信号</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {(presentation.counterSignals.length > 0
                          ? presentation.counterSignals
                          : ["暂无已识别的反向信号"]
                        ).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">缺失信号</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {(presentation.missingSignals.length > 0
                          ? presentation.missingSignals
                          : ["暂无已识别的缺失信号"]
                        ).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    </div>
                  </div>
                </details>
                <button
                  type="button"
                  data-testid={`product-batch-research-${item.id}`}
                  disabled={busy || Boolean(blockedReason)}
                  onClick={() => onResearchItem?.(item.id)}
                  className="linear-button-primary mt-4 h-10 w-full px-4 text-sm font-semibold disabled:opacity-50"
                >
                  加入研究
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemoveItem?.(selectedBatch.id, item.id)}
                  className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                >
                  移出列表
                </button>
                {blockedReason ? (
                  <p className="mt-2 text-xs font-semibold leading-5 text-amber-700">
                    {blockedReason}
                  </p>
                ) : null}
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
  maxProducts: number | null;
  usedProducts: number | null;
  remainingProducts: number | null;
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
  const [maxProducts, setMaxProducts] = useState<number | null>(null);
  const [usedProducts, setUsedProducts] = useState<number | null>(null);
  const [remainingProducts, setRemainingProducts] = useState<number | null>(null);
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inspectionSequence = useRef(0);

  const applyAccess = (data: Pick<ListPayload, "accessMode" | "maxProducts" | "usedProducts" | "remainingProducts">) => {
    setAccessMode(data.accessMode);
    setMaxProducts(data.maxProducts);
    setUsedProducts(data.usedProducts);
    setRemainingProducts(data.remainingProducts);
    if (data.accessMode === "visitor"
      && data.maxProducts !== null
      && data.usedProducts !== null
      && data.remainingProducts !== null) {
      updateDemoAccessInfo({
        maxProducts: data.maxProducts,
        usedProducts: data.usedProducts,
        remainingProducts: data.remainingProducts,
      });
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
    if (!isAuthenticated()) {
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
    // 取消原生文件选择时保留上一次已经 inspect 的文件与筛选状态。
    if (!file) return;
    const sequence = inspectionSequence.current + 1;
    inspectionSequence.current = sequence;
    setImportInspection(null);
    setSelectedReportType("");
    setSelectedCategory("");
    setManualReportTypeRequired(false);
    setErrorMessage(null);
    setSelectedFile(file);
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
        if (body.data.reportType !== "search_results" && body.data.reportType !== "category_current") {
          // 关键词报表走关键词管线（Phase 3/4），批次导入要求人工选择商品报表类型
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
    if (!selectedFile) {
      setErrorMessage("请先选择 SellerSprite XLSX 文件。");
      return;
    }
    const formData = new FormData(event.currentTarget);
    formData.set("file", selectedFile);
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
          maxProducts: number | null;
          usedProducts: number | null;
          remainingProducts: number | null;
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
    const name = batch?.batchName ?? "该次导入";
    const isActive = selection?.activeProductBatchId === batchId;
    const confirmText = isActive
      ? `删除当前导入「${name}」后，该批商品会从列表移除；已经加入商品研究池的商品不会删除。删除后当前导入将变为空。`
      : `确定删除「${name}」？删除后这批商品将一并移除，已进入研究池的商品不受影响。`;
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
    if (!window.confirm("确定把该商品移出列表？已进入研究池的商品不受影响。")) {
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
      maxProducts={maxProducts}
      usedProducts={usedProducts}
      remainingProducts={remainingProducts}
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
      selectedFileName={selectedFile?.name ?? ""}
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
