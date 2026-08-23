"use client";

/**
 * Phase 3/4 — 关键词报表证据（Reverse ASIN / Keyword Mining）
 * 轮 12.5 合并：关键词证据仅由「采集关键词+竞品」自动产生（browser-use 关键词预览保存）；
 * 原「上传 SellerSprite 关键词报表」与「自动采集关键词」入口已下线，本组件只做展示。
 * 全部数值按真实样本语义展示：0–1 比例显示为百分比、需供比原值（不 ×100）、0 与缺失区分。
 */
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

const reportTypeLabel = (type: "reverse_asin" | "keyword_mining") => (
  type === "reverse_asin" ? "Reverse ASIN（竞品流量词）" : "Keyword Mining（关键词挖掘）"
);

export function KeywordReportEvidenceSection({
  evidence,
}: {
  evidence: KeywordEvidenceView | null;
}) {
  return (
    <div className="mt-3 space-y-3" data-testid="keyword-report-evidence">
      {evidence ? (
        <div>
          <p className="text-xs font-semibold text-slate-500">
            已保存：{reportTypeLabel(evidence.reportType)} · {evidence.rows.length} 个关键词 · 采集时间 {evidence.capturedAt.slice(0, 10)}
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
        <p className="text-sm text-slate-500">未获得关键词证据：请使用「采集关键词+竞品」采集后确认。</p>
      )}
    </div>
  );
}
