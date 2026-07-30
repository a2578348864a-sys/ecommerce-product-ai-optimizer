"use client";

import { useState, type FormEvent } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import type { SellerSpriteAcceptedPreviewRow, SellerSpritePreviewResult } from "@/lib/upstream/sellersprite/preview";

type PreviewResponse =
  | { ok: true; preview: SellerSpritePreviewResult }
  | { ok: false; error?: { code?: string; message?: string } };

function fieldStatusLabel(status: SellerSpriteAcceptedPreviewRow["fieldStatus"][keyof SellerSpriteAcceptedPreviewRow["fieldStatus"]]): string {
  const labels = {
    source_fact: "来源事实",
    third_party_estimate: "第三方估算",
    snapshot: "时间点快照",
    missing: "缺失",
    unknown: "无法确认",
  } as const;
  return labels[status];
}

function missingText(fields: readonly string[]): string {
  return fields.length > 0 ? `缺失或无法确认：${fields.join("、")}` : "字段完整";
}

export function SellerSpritePreviewPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SellerSpritePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("请选择一个 XLSX 文件。");
      return;
    }
    setError(null);
    setPreview(null);
    setIsSubmitting(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/opportunities/sellersprite-preview", {
        method: "POST",
        headers: buildAccessHeaders(),
        body,
      });
      const payload = await response.json() as PreviewResponse;
      if ("preview" in payload && payload.preview) setPreview(payload.preview);
      if (!("preview" in payload) || !payload.ok) {
        setError("error" in payload && payload.error?.message
          ? payload.error.message
          : "文件无法安全预览。");
      }
    } catch {
      setError("预览请求失败，请检查网络后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-5" aria-label="卖家精灵安全预览操作区">
      <form onSubmit={submit} className="surface-card p-5 sm:p-6">
        <h2 className="section-title text-lg">上传并安全解析</h2>
        <label className="block text-sm font-medium text-slate-900" htmlFor="sellersprite-xlsx">选择 XLSX 文件</label>
        <p className="mt-1 text-xs text-slate-600">只接受单个文件，最大 8 MB；文件不会保存，也不会进入商品研究池。</p>
        <input
          id="sellersprite-xlsx"
          className="mt-3 block w-full text-sm"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={isSubmitting}
        />
        <button
          className="linear-button-primary mt-4 inline-flex min-h-10 items-center px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "正在安全解析…" : "解析并预览"}
        </button>
      </form>

      {error ? <p role="alert" className="surface-card border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

      {preview ? (
        <div className="space-y-5">
          <section className="surface-card-soft p-4 text-sm text-slate-800" aria-label="预览摘要">
            <p>数据源：{preview.source.sourceProvider}；市场：{preview.source.marketplace}；报表：{preview.source.reportType}</p>
            <p>合法行：{preview.acceptedRowCount}；隔离异常行：{preview.rejectedRowCount}</p>
            <p>源文件 SHA-256：<code className="break-all">{preview.source.sourceFileSha256}</code></p>
            {preview.previewTruncated ? <p>为保护响应体积，列表只展示前若干行。</p> : null}
          </section>

          {preview.blockingErrors.length > 0 ? (
            <section className="surface-card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" aria-label="阻断冲突">
              <h2 className="font-semibold">阻断：重复 ASIN 的关键字段冲突</h2>
              <p>这些行没有被任选为唯一商品，请修正源报表后重新预览。</p>
              <ul className="mt-2 list-disc pl-5">
                {preview.blockingErrors.map((issue) => (
                  <li key={`${issue.asin}-${issue.rowNumbers.join("-")}`}>{issue.asin}：第 {issue.rowNumbers.join("、")} 行</li>
                ))}
              </ul>
            </section>
          ) : null}

          {preview.duplicates.length > 0 ? (
            <section className="surface-card p-4 text-sm text-slate-800" aria-label="重复 ASIN">
              <h2 className="font-semibold">重复 ASIN</h2>
              <ul className="mt-2 list-disc pl-5">
                {preview.duplicates.map((item) => (
                  <li key={item.asin}>{item.asin}：第 {item.rowNumbers.join("、")} 行{item.hasCriticalConflict ? "（关键字段冲突）" : ""}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="surface-card overflow-x-auto" aria-label="合法商品行预览">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2">行</th>
                  <th className="px-3 py-2">来源事实与快照</th>
                  <th className="px-3 py-2">第三方估算</th>
                  <th className="px-3 py-2">字段状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.acceptedRows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-3 py-3 align-top">{row.rowNumber}</td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium">{row.facts.title}</p>
                      <p>{row.facts.asin}{row.facts.parentAsin ? ` · Parent ${row.facts.parentAsin}` : ""}</p>
                      <p className="break-all">{row.facts.amazonUrl}</p>
                      <p>{row.facts.priceUsd === undefined ? "价格未知" : `$${row.facts.priceUsd}`} · {row.facts.rating === undefined ? "评分未知" : `评分 ${row.facts.rating}`} · {row.facts.reviewCount === undefined ? "评论数未知" : `评论数 ${row.facts.reviewCount}`}</p>
                      <p>{row.facts.brand ?? "品牌未知"} · {row.facts.category ?? "类目未知"}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p>{row.estimates.searchRank === undefined ? "排名未知" : `搜索排名 ${row.estimates.searchRank}`}</p>
                      <p>{row.estimates.estimatedMonthlySales === undefined ? "月销量估算未知" : `月销量估算 ${row.estimates.estimatedMonthlySales}`}</p>
                      <p>{row.estimates.estimatedMonthlyRevenueUsd === undefined ? "月销售额估算未知" : `月销售额估算 $${row.estimates.estimatedMonthlyRevenueUsd}`}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p>{missingText(row.missingFields)}</p>
                      <p className="mt-1 text-xs text-slate-600">价格：{fieldStatusLabel(row.fieldStatus.priceUsd)}；排名：{fieldStatusLabel(row.fieldStatus.searchRank)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {preview.rejectedRows.length > 0 ? (
            <section className="surface-card p-4 text-sm text-slate-800" aria-label="隔离异常行">
              <h2 className="font-semibold">隔离异常行</h2>
              <ul className="mt-2 list-disc pl-5">
                {preview.rejectedRows.map((row) => (
                  <li key={row.rowNumber}>第 {row.rowNumber} 行：{row.reasons.map((reason) => reason.field ? `${reason.field}：${reason.code}` : reason.code).join("；")}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
