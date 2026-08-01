import { ImageOff } from "lucide-react";

import type {
  SellerSpriteAcceptedPreviewRow,
  SellerSpritePreviewFieldStatus,
  SellerSpritePreviewResult,
} from "@/lib/upstream/sellersprite/preview";

type PreviewWithImportToken = SellerSpritePreviewResult & { importToken?: string };

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

function rowStatus(row: SellerSpriteAcceptedPreviewRow): {
  label: string;
  className: string;
} {
  if (row.warnings.length > 0) {
    return {
      label: "存在警告",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (row.missingFields.length > 0) {
    return {
      label: "缺少可选字段",
      className: "border-slate-200 bg-slate-50 text-slate-700",
    };
  }
  return {
    label: "可导入",
    className: "border-teal-200 bg-teal-50 text-teal-800",
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

      <section className="surface-card overflow-hidden" aria-label="合法商品行预览">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="text-sm text-slate-700">
            已选择 <span className="font-semibold text-slate-950">{selectedRowHashes.length}</span> 项
          </div>
          <div className="flex flex-wrap gap-2">
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
          <p role="alert" className="px-4 py-2 text-sm text-amber-800">
            合法行超过 {maxSelectedRows} 项，只允许最多选择 {maxSelectedRows} 项。
          </p>
        ) : null}
        {!canSelect ? (
          <p className="px-4 py-2 text-sm text-slate-500">
            {hasBlockingErrors
              ? "存在阻断冲突，无法选择商品。"
              : !hasImportToken
                ? "没有导入凭证，无法选择商品。"
                : isImporting
                  ? "导入进行中，选择已暂时禁用。"
                  : ""}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-[960px] divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="w-20 px-4 py-3">选择</th>
                <th className="min-w-80 px-4 py-3">商品信息</th>
                <th className="min-w-44 px-4 py-3">价格与口碑</th>
                <th className="min-w-52 px-4 py-3">第三方估算</th>
                <th className="min-w-36 px-4 py-3">字段状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.acceptedRows.map((row) => {
                const rowHash = row.rowHash ?? "";
                const isSelected = selectedRowHashes.includes(rowHash);
                const isProcessed = processedRowHashes.has(rowHash);
                const status = rowStatus(row);
                return (
                  <tr key={row.rowNumber} className={isProcessed ? "bg-slate-50/70" : "bg-white"}>
                    <td className="px-4 py-4 align-top">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`选择第 ${row.rowNumber} 行商品`}
                          checked={isSelected}
                          disabled={!canSelect || isProcessed || !rowHash}
                          onChange={() => onToggleRow(rowHash)}
                        />
                        <span className="text-xs text-slate-500">第 {row.rowNumber} 行</span>
                      </label>
                      {isProcessed ? <span className="mt-1 block text-xs text-teal-700">已处理</span> : null}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex gap-3">
                        <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400" role="img" aria-label="暂无图片">
                          <ImageOff aria-hidden="true" className="size-5" />
                          <span className="mt-1 text-[10px]">暂无图片</span>
                        </div>
                        <div className="min-w-0">
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
                              <p>缺失字段：{row.missingFields.length > 0 ? row.missingFields.join("、") : "无"}</p>
                              <p>
                                字段状态：价格 {FIELD_STATUS_LABELS[row.fieldStatus.priceUsd]}；排名 {FIELD_STATUS_LABELS[row.fieldStatus.searchRank]}
                              </p>
                              <p>第三方估算仅为时间点参考，不构成采购或商业结论。</p>
                            </div>
                          </details>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-slate-700">
                      <p className="font-semibold text-slate-950">{currency(row.facts.priceUsd)}</p>
                      <p className="mt-1">{row.facts.rating === undefined ? "评分暂无" : `评分 ${row.facts.rating}`}</p>
                      <p className="mt-1">{row.facts.reviewCount === undefined ? "评论暂无" : `评论 ${number(row.facts.reviewCount)}`}</p>
                    </td>
                    <td className="px-4 py-4 align-top text-slate-700">
                      <p>{row.estimates.estimatedMonthlySales === undefined ? "月销量暂无" : `月销量 ${number(row.estimates.estimatedMonthlySales)}`}</p>
                      <p className="mt-1">{row.estimates.estimatedMonthlyRevenueUsd === undefined ? "月销售额暂无" : `月销售额 ${currency(row.estimates.estimatedMonthlyRevenueUsd)}`}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.estimates.searchRank === undefined ? "排名暂无" : `搜索排名 ${number(row.estimates.searchRank)}`}</p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {preview.rejectedRows.length > 0 ? (
        <details data-testid="rejected-rows" className="surface-card p-4 text-sm text-slate-800">
          <summary className="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            异常隔离行（{preview.rejectedRowCount}）
          </summary>
          <p className="mt-2 text-xs leading-5 text-slate-500">这些行不会进入选择或导入流程。</p>
          <ul className="mt-3 space-y-2">
            {preview.rejectedRows.map((row) => (
              <li key={row.rowNumber} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                第 {row.rowNumber} 行：{row.reasons.map(reasonLabel).join("；")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
