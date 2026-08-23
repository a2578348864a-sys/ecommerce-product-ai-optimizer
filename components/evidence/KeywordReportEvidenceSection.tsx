"use client";

/**
 * Phase 3/4 — 关键词报表证据（Reverse ASIN / Keyword Mining）
 * 流程：上传 XLSX → Preview（服务端解析，不保存）→ 人工确认（Human bind）→ Save → 展示。
 * 全部数值按真实样本语义展示：0–1 比例显示为百分比、需供比原值（不 ×100）、0 与缺失区分。
 */
import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { ratioToPercent } from "@/lib/upstream/sellersprite/keywordReports";

export type KeywordReportRowView = {
  rowNumber: number;
  keyword: string;
  keywordTranslation: string | null;
  fields: Record<string, {
    raw: string | number | boolean | string[] | { min: number; max: number } | { page: number; position: number; total: number } | null;
    normalized: string | number | boolean | string[] | { min: number; max: number } | { page: number; position: number; total: number } | null;
    metricNature: string;
    applicability: string;
  }>;
};

export type KeywordEvidenceView = {
  reportType: "reverse_asin" | "keyword_mining";
  capturedAt: string;
  rows: KeywordReportRowView[];
};

function fieldValue(row: KeywordReportRowView, field: string): string {
  const fv = row.fields[field];
  if (!fv) return "—";
  if (fv.applicability === "missing" || fv.normalized === null) return "尚未取得";
  const value = fv.normalized;
  if (typeof value === "number") {
    if (field === "trafficShare" || field === "naturalTrafficShare" || field === "purchaseRate"
      || field === "clickShare" || field === "conversionShare") {
      return ratioToPercent(value);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return `${value.length} 个`;
  if (typeof value === "object") {
    if ("position" in value) return `第${value.page}页 ${value.position}/${value.total}`;
    if ("min" in value) return `$${value.min}–$${value.max}`;
    return JSON.stringify(value);
  }
  return String(value);
}

function displayColumns(reportType: "reverse_asin" | "keyword_mining"): Array<{ field: string; label: string }> {
  if (reportType === "reverse_asin") {
    return [
      { field: "trafficShare", label: "流量占比" },
      { field: "naturalRank", label: "自然排名" },
      { field: "naturalRankPage", label: "排名位置" },
      { field: "monthlySearches", label: "月搜索量" },
      { field: "purchaseRate", label: "购买率" },
      { field: "supplyDemandRatio", label: "需供比" },
      { field: "ppcBid", label: "PPC价格" },
    ];
  }
  return [
    { field: "relevance", label: "相关度" },
    { field: "abaMonthlyRank", label: "ABA月排名" },
    { field: "monthlySearches", label: "月搜索量" },
    { field: "purchaseRate", label: "购买率" },
    { field: "supplyDemandRatio", label: "需供比" },
    { field: "ppcBid", label: "PPC价格" },
  ];
}

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}

export function KeywordReportEvidenceSection({
  taskId,
  evidence,
  storageVersion,
  onChanged,
}: {
  taskId: string;
  evidence: KeywordEvidenceView | null;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<KeywordEvidenceView | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ rowCount: number; headerColumnCount: number } | null>(null);

  async function handlePreview(file: File) {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/keyword-evidence`, {
        method: "POST",
        headers: buildFetchHeaders(),
        body: formData,
      });
      const json = await res.json() as
        | { ok: true; data: { preview: KeywordEvidenceView & { headerColumnCount: number } } }
        | { ok: false; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "解析失败。");
        return;
      }
      setPreview({ reportType: json.data.preview.reportType, capturedAt: json.data.preview.capturedAt, rows: json.data.preview.rows });
      setPreviewMeta({ rowCount: json.data.preview.rows.length, headerColumnCount: json.data.preview.headerColumnCount });
    } catch {
      setError("解析失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/keyword-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "save",
          report: {
            schema: "sellersprite-keyword-report.v1",
            reportType: preview.reportType,
            capturedAt: preview.capturedAt,
            dataPeriod: null,
            headerColumnCount: previewMeta?.headerColumnCount ?? 0,
            rows: preview.rows,
          },
          expectedStorageVersion: storageVersion,
        }),
      });
      const json = await res.json() as
        | { ok: true }
        | { ok: false; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "保存失败。");
        return;
      }
      setPreview(null);
      setPreviewMeta(null);
      onChanged();
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  const reportTypeLabel = (type: "reverse_asin" | "keyword_mining") => (
    type === "reverse_asin" ? "Reverse ASIN（竞品流量词）" : "Keyword Mining（关键词挖掘）"
  );

  return (
    <div className="mt-3 space-y-3" data-testid="keyword-report-evidence">
      {/* 已保存证据 */}
      {evidence ? (
        <div>
          <p className="text-xs font-semibold text-slate-500">
            已保存：{reportTypeLabel(evidence.reportType)} · {evidence.rows.length} 个关键词 · 采集时间 {evidence.capturedAt.slice(0, 10)}
            {evidence.rows.length === 0 ? "" : ""}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">关键词</th>
                  {displayColumns(evidence.reportType).map((col) => (
                    <th key={col.field} className="px-2 py-1.5 font-medium">{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.rows.slice(0, 20).map((row) => (
                  <tr key={row.rowNumber} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 font-medium text-slate-900">{row.keyword}</td>
                    {displayColumns(evidence.reportType).map((col) => (
                      <td key={col.field} className="px-2 py-1.5 text-slate-700">{fieldValue(row, col.field)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">未导入关键词报表证据（Reverse ASIN / Keyword Mining）。</p>
      )}

      {/* 上传与预览 */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-teal-700">
          <Upload className="size-4" />
          上传 SellerSprite 关键词报表（Reverse ASIN 或 Keyword Mining）
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handlePreview(file);
              event.target.value = "";
            }}
          />
        </label>
        {busy && <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />处理中…</p>}
        {preview && (
          <div className="mt-3 rounded-lg border border-teal-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">
              预览：{reportTypeLabel(preview.reportType)} · {previewMeta?.rowCount ?? preview.rows.length} 行 · {previewMeta?.headerColumnCount ?? "?"} 列
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1 pr-2 font-medium">关键词</th>
                    {displayColumns(preview.reportType).map((col) => (
                      <th key={col.field} className="px-2 py-1 font-medium">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((row) => (
                    <tr key={row.rowNumber} className="border-b border-slate-100">
                      <td className="py-1 pr-2 font-medium text-slate-900">{row.keyword}</td>
                      {displayColumns(preview.reportType).map((col) => (
                        <td key={col.field} className="px-2 py-1 text-slate-700">{fieldValue(row, col.field)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">请人工确认报表类型与归属正确后保存；保存会覆盖此前关键词报表证据。</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
            >
              确认并保存（人工确认）
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
