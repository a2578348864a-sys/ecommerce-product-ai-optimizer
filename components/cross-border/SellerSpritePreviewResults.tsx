import { useState } from "react";
import { ImageOff } from "lucide-react";

import type {
  SellerSpriteAcceptedPreviewRow,
  SellerSpritePreviewFieldStatus,
  SellerSpritePreviewResult,
} from "@/lib/upstream/sellersprite/preview";

type PreviewWithImportToken = SellerSpritePreviewResult & { importToken?: string };

/** 预览行状态筛选（三层：可导入 / 数据不完整 / 异常隔离） */
export type PreviewStatusFilter = "all" | "importable" | "warning" | "rejected";

export type SellerSpritePreviewResultsProps = {
  preview: PreviewWithImportToken;
  selectedRowHashes: readonly string[];
  processedRowHashes: ReadonlySet<string>;
  canSelect: boolean;
  isImporting: boolean;
  selectAllOverLimit: boolean;
  maxSelectedRows: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleRow: (rowHash: string) => void;
};

/**
 * 三层导入状态：
 * - "complete"：核心身份字段满足 + 无缺失 → 可导入
 * - "partial"：核心身份字段满足，但缺值得知道的可选字段 → 数据不完整（仍可导入）
 * - "warning"：保留给未来真正影响导入的警告；当前业务中 accepted 行只要
 *   核心身份合法即可导入，缺失可选字段统一归为 partial。
 */
function classifyRow(row: SellerSpriteAcceptedPreviewRow): "complete" | "partial" | "warning" {
  if (row.missingFields.length > 0) return "partial";
  return "complete";
}

function matchFilter(row: SellerSpriteAcceptedPreviewRow, filter: PreviewStatusFilter): boolean {
  if (filter === "all") return true;
  const cls = classifyRow(row);
  if (filter === "warning") return cls === "partial";
  if (filter === "importable") return cls === "complete" || cls === "partial";
  return false;
}

const FIELD_STATUS_LABELS: Record<SellerSpritePreviewFieldStatus, string> = {
  source_fact: "来源事实",
  third_party_estimate: "第三方估算",
  snapshot: "时间点快照",
  missing: "缺失",
  unknown: "无法确认",
};

function currency(value: number | undefined): string {
  if (value === undefined) return "暂无";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function number(value: number | undefined): string {
  return value === undefined
    ? "暂无"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function shortCategory(value: string | undefined): string {
  if (!value) return "类目暂无";
  return value.split(/\s*[>›]\s*/u)[0]?.trim() || "类目暂无";
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  parentAsin: "父 ASIN",
  imageUrl: "图片",
  priceUsd: "价格",
  rating: "评分",
  reviewCount: "评论数",
  brand: "品牌",
  category: "类目",
  searchRank: "排名",
  estimatedMonthlySales: "月销量",
  estimatedMonthlyRevenueUsd: "月销售额",
};

function missingFieldReason(fields: readonly string[]): string {
  if (fields.length === 0) return "";
  return `缺：${fields.map((field) => MISSING_FIELD_LABELS[field] ?? field).join("、")}`;
}

function rowStatus(row: SellerSpriteAcceptedPreviewRow): {
  label: string;
  className: string;
  missingDetail: string;
} {
  if (row.missingFields.length > 0) {
    return {
      label: "缺少部分数据",
      className: "border-amber-200 bg-amber-50 text-amber-800",
      missingDetail: missingFieldReason(row.missingFields),
    };
  }
  return {
    label: "可导入",
    className: "border-teal-200 bg-teal-50 text-teal-800",
    missingDetail: "",
  };
}

function reasonLabel(reason: { code: string; field?: string }): string {
  const labels: Record<string, string> = {
    invalid_asin: "ASIN 格式无效",
    asin_url_mismatch: "ASIN 与商品链接不一致",
    invalid_parent_asin: "Parent ASIN 格式无效",
    invalid_amazon_url: "Amazon 商品链接无效",
    invalid_image_url: "图片链接无效",
    invalid_price: "价格格式无效",
    invalid_rating: "评分格式无效",
    invalid_review_count: "评论数格式无效",
    invalid_estimate: "估算字段格式无效",
    field_too_long: "字段内容过长",
  };
  return labels[reason.code] ?? (reason.field ? `${reason.field} 字段无效` : "该行不符合导入要求");
}

const FILTER_OPTIONS: Array<{ value: PreviewStatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "importable", label: "数据完整" },
  { value: "warning", label: "数据不完整" },
];

export function SellerSpritePreviewResults({
  preview,
  selectedRowHashes,
  processedRowHashes,
  canSelect,
  isImporting,
  selectAllOverLimit,
  maxSelectedRows,
  onSelectAll,
  onClearSelection,
  onToggleRow,
}: SellerSpritePreviewResultsProps) {
  const hasBlockingErrors = preview.blockingErrors.length > 0;
  const hasImportToken = Boolean(preview.importToken);
  const [filter, setFilter] = useState<PreviewStatusFilter>("all");
  const visibleRows = preview.acceptedRows.filter((row) => matchFilter(row, filter));

  return (
    <div className="space-y-5">
      <section className="surface-card-soft p-4 sm:p-5" aria-label="预览摘要">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["可加入研究池", preview.acceptedRowCount],
            ["异常隔离", preview.rejectedRowCount],
            ["警告", preview.warnings.length],
            ["已选择", selectedRowHashes.length],
            ["最多选择", maxSelectedRows],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <strong className="mt-1 block text-xl font-semibold text-slate-950">{value}</strong>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          结构合格仅表示数据可安全导入，不代表商品值得采购或属于选品结论。最多 {maxSelectedRows} 项。
        </p>
        {preview.previewTruncated ? (
          <p className="mt-1 text-xs text-amber-800">为保护响应体积，当前只展示部分合法行。</p>
        ) : null}
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            文件技术详情
          </summary>
          <div className="mt-2 space-y-1 rounded-lg bg-slate-100 p-3">
            <p>数据源：{preview.source.sourceProvider}</p>
            <p>市场：{preview.source.marketplace}</p>
            <p>报表：{preview.source.reportType}</p>
            <p>源文件 SHA-256：<code className="break-all">{preview.source.sourceFileSha256}</code></p>
          </div>
        </details>
      </section>

      {hasBlockingErrors ? (
        <section className="surface-card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" aria-label="阻断冲突">
          <h2 className="font-semibold">阻断：重复 ASIN 的关键字段冲突</h2>
          <p className="mt-1">这些行不会被任选为唯一商品。请修正源报表后重新预览。</p>
          <ul className="mt-2 list-disc pl-5">
            {preview.blockingErrors.map((issue) => (
              <li key={`${issue.asin}-${issue.rowNumbers.join("-")}`}>{issue.asin}：第 {issue.rowNumbers.join("、")} 行</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hasImportToken && !hasBlockingErrors ? (
        <p role="alert" className="surface-card border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          本次预览未生成导入凭证（Token），无法加入商品研究池。请重新预览。
        </p>
      ) : null}

      {preview.duplicates.length > 0 ? (
        <details className="surface-card p-4 text-sm text-slate-800">
          <summary className="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            重复 ASIN（{preview.duplicates.length}）
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {preview.duplicates.map((item) => (
              <li key={item.asin}>{item.asin}：第 {item.rowNumbers.join("、")} 行{item.hasCriticalConflict ? "（关键字段冲突）" : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* 批量工具条：已选数量 + 全选/取消 + 状态筛选 */}
      <section className="surface-card p-4" aria-label="预览工具条">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" aria-label="状态筛选">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  filter === option.value
                    ? "border-teal-300 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                }`}
              >
                {option.label}
                {option.value === "importable" ? `（${preview.acceptedRows.filter((r) => classifyRow(r) === "complete").length}）` : ""}
                {option.value === "warning" ? `（${preview.acceptedRows.filter((r) => classifyRow(r) === "partial").length}）` : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-700">
              已选择 <span className="font-semibold text-slate-950">{selectedRowHashes.length}</span> 项
            </span>
            <button
              type="button"
              className="linear-button-secondary inline-flex min-h-9 items-center px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed"
              onClick={onSelectAll}
              disabled={!canSelect}
            >
              全选
            </button>
            <button
              type="button"
              className="linear-button-secondary inline-flex min-h-9 items-center px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed"
              onClick={onClearSelection}
              disabled={!canSelect || selectedRowHashes.length === 0}
            >
              取消全选
            </button>
          </div>
        </div>
        {selectAllOverLimit ? (
          <p role="alert" className="mt-2 text-sm text-amber-800">
            合法行超过 {maxSelectedRows} 项，只允许最多选择 {maxSelectedRows} 项。
          </p>
        ) : null}
        {!canSelect ? (
          <p className="mt-2 text-sm text-slate-500">
            {hasBlockingErrors
              ? "存在阻断冲突，无法选择商品。"
              : !hasImportToken
                ? "没有导入凭证，无法选择商品。"
                : isImporting
                  ? "导入进行中，选择已暂时禁用。"
                  : ""}
          </p>
        ) : null}
      </section>

      {/* 可导入区：卡片列表 */}
      <section className="surface-card overflow-hidden" aria-label="可导入商品">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="text-sm text-slate-700">
            {filter === "all" ? "全部可导入商品" : filter === "importable" ? "数据完整" : "数据不完整"}
            <span className="ml-1 text-slate-500">（{visibleRows.length}）</span>
          </div>
        </div>
        {visibleRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">该筛选下没有可展示的商品。</p>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleRows.map((row) => {
              const rowHash = row.rowHash ?? "";
              const isSelected = selectedRowHashes.includes(rowHash);
              const isProcessed = processedRowHashes.has(rowHash);
              const status = rowStatus(row);
              const cls = classifyRow(row);
              return (
                <article
                  key={row.rowNumber}
                  className={`rounded-2xl border p-4 ${
                    isProcessed
                      ? "border-slate-200 bg-slate-50/70"
                      : cls === "partial"
                        ? "border-amber-200 bg-amber-50/30"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <label className="mt-0.5 flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`选择第 ${row.rowNumber} 行商品`}
                        checked={isSelected}
                        disabled={!canSelect || isProcessed || !rowHash}
                        onChange={() => onToggleRow(rowHash)}
                        className="h-4 w-4 accent-teal-600"
                      />
                      <span className="text-xs text-slate-500">第 {row.rowNumber} 行</span>
                    </label>
                    {isProcessed ? <span className="text-xs text-teal-700">已处理</span> : null}
                    <span className={`ml-auto inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  {status.missingDetail ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                      {status.missingDetail}
                    </p>
                  ) : null}
                  <div className="mt-3 flex gap-3">
                    {row.facts.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 外部商品图，浏览器直连 + 路由层 SSRF 校验
                      <img
                        src={row.facts.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-contain"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400" role="img" aria-label="暂无图片">
                        <ImageOff aria-hidden="true" className="size-5" />
                        <span className="mt-1 text-[10px]">暂无图片</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-medium leading-5 text-slate-950">{row.facts.title}</p>
                      <p className="mt-1 text-xs text-slate-500">ASIN {row.facts.asin}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.facts.brand ?? "品牌暂无"} · {shortCategory(row.facts.category)}</p>
                      <details className="mt-2 text-xs text-slate-600">
                        <summary className="cursor-pointer font-semibold text-teal-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                          查看详情
                        </summary>
                        <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="break-all">Amazon URL：{row.facts.amazonUrl}</p>
                          <p>Parent ASIN：{row.facts.parentAsin ?? "暂无"}</p>
                          <p>完整类目：{row.facts.category ?? "暂无"}</p>
                          <p>缺失字段：{row.missingFields.length > 0
                            ? row.missingFields.map((field) => MISSING_FIELD_LABELS[field] ?? field).join("、")
                            : "无"}</p>
                          <p>
                            字段状态：价格 {FIELD_STATUS_LABELS[row.fieldStatus.priceUsd]}；排名 {FIELD_STATUS_LABELS[row.fieldStatus.searchRank]}
                          </p>
                          <p>第三方估算仅为时间点参考，不构成采购或商业结论。</p>
                        </div>
                      </details>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <p className="rounded-lg bg-slate-50 p-2">价格<br /><b>{currency(row.facts.priceUsd)}</b></p>
                    <p className="rounded-lg bg-slate-50 p-2">评分<br /><b>{row.facts.rating === undefined ? "暂无" : row.facts.rating}</b></p>
                    <p className="rounded-lg bg-slate-50 p-2">评论<br /><b>{row.facts.reviewCount === undefined ? "暂无" : number(row.facts.reviewCount)}</b></p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                    <p className="rounded-lg bg-slate-50 p-2">月销量<br /><b>{row.estimates.estimatedMonthlySales === undefined ? "暂无" : number(row.estimates.estimatedMonthlySales)}</b></p>
                    <p className="rounded-lg bg-slate-50 p-2">月销售额<br /><b>{row.estimates.estimatedMonthlyRevenueUsd === undefined ? "暂无" : currency(row.estimates.estimatedMonthlyRevenueUsd)}</b></p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 异常隔离区：视觉分离（独立色块 + 明确标题） */}
      {preview.rejectedRows.length > 0 ? (
        <section data-testid="rejected-rows" className="surface-card border-rose-200 bg-rose-50/40 p-4" aria-label="异常隔离区">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-rose-900">异常隔离区（{preview.rejectedRowCount}）</h2>
            <span className="rounded-full border border-rose-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-rose-700">不会进入选择或导入</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">以下行数据不合规，已从可导入区隔离，不会进入商品研究池。</p>
          <ul className="mt-3 space-y-2">
            {preview.rejectedRows.map((row) => (
              <li key={row.rowNumber} className="rounded-lg border border-rose-200 bg-white px-3 py-2">
                第 {row.rowNumber} 行：{row.reasons.map(reasonLabel).join("；")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
