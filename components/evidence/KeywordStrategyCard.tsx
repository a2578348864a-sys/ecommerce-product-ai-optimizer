"use client";

import { useMemo, useState } from "react";
import { addSupportingToTags, buildKeywordBriefDraft, removeSupportingTag } from "./keywordBriefDraft";

export function KeywordStrategyCard({
  rows,
  productName,
  briefPrimary,
  briefSource,
  briefReportType,
  briefCapturedAt,
  briefEvidenceCount,
  inListing,
  needsReconfirm,
  onSave,
  onSaved,
  error,
  rawEvidence,
}: {
  rows: Array<{ keyword: string | null; rowNumber?: number }>;
  productName?: string | null;
  briefPrimary: string | null;
  briefSource?: string | null;
  briefReportType?: string | null;
  briefCapturedAt?: string | null;
  briefEvidenceCount: number;
  inListing: boolean;
  needsReconfirm: boolean;
  onSave: (input: { primaryKeyword: string; supportingKeywords: string[]; backendSearchTerms: string[] }) => Promise<string | null>;
  onSaved: () => void;
  error?: string | null;
  rawEvidence?: { reportType: string; capturedAt: string; rows: Array<{ rowNumber: number; keyword: string; fields: Record<string, unknown> }> } | null;
}) {
  const recommended = useMemo(() => buildKeywordBriefDraft(rows, productName), [rows, productName]);
  const [editing, setEditing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [supporting, setSupporting] = useState<string[]>([]);
  const [newSupporting, setNewSupporting] = useState("");
  const [backendTerms, setBackendTerms] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEditor = () => {
    setPrimaryKeyword(briefPrimary ?? recommended?.primaryKeyword ?? "");
    setSupporting((recommended?.supportingKeywords ?? []).slice(0, 5));
    setBackendTerms("");
    setEditing(true);
  };

  const addSupporting = () => {
    const word = newSupporting.trim();
    if (!word) return;
    setSupporting((prev) => addSupportingToTags(prev, word, 5));
    setNewSupporting("");
  };

  const removeSupporting = (word: string) => setSupporting((prev) => removeSupportingTag(prev, word));

  const submit = async () => {
    const backend = backendTerms.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    const err = await onSave({ primaryKeyword: primaryKeyword.trim(), supportingKeywords: supporting, backendSearchTerms: backend });
    if (err) { setSaveError(err); return; }
    setSaveError(null);
    setEditing(false);
    onSaved?.();
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="keyword-strategy-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">关键词策略</h4>
          <p className="mt-1 text-xs text-slate-500" data-testid="kw-status">
            状态：{briefPrimary ? (needsReconfirm ? "需重新确认" : "已采用") : "待确认"}
            {" · "}Listing：{inListing ? "已用于 Listing" : "尚未用于 Listing"}
          </p>
        </div>
        <button type="button" data-testid="kw-adjust" aria-expanded={editing} aria-controls="kw-strategy-editor" onClick={() => (editing ? setEditing(false) : openEditor())} className="inline-flex h-8 shrink-0 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700">
          调整关键词方案
        </button>
      </div>

      <div className="mt-3 space-y-2 text-sm text-slate-700" data-testid="kw-summary">
        <p>
          <span className="text-slate-500">推荐主关键词：</span>
          {briefPrimary ?? recommended?.primaryKeyword ?? <span className="text-slate-400">尚无相关度足够的主关键词</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="kw-supporting-tags">
          <span className="text-xs text-slate-500">辅助词：</span>
          {(recommended?.supportingKeywords ?? []).slice(0, 5).map((w) => (
            <span key={w} className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs text-teal-700">{w}</span>
          ))}
        </div>
        <p className="text-xs text-slate-500" data-testid="kw-counts">
          证据 {briefEvidenceCount} 条
          {briefReportType ? " · 报告 " + briefReportType : ""}
          {briefCapturedAt ? " · 采集 " + briefCapturedAt.slice(0, 10) : " · 数据期：尚未取得"}
        </p>
      </div>

      {editing ? (
        <div id="kw-strategy-editor" className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="kw-editor">
          <label className="block text-xs font-medium text-slate-700">
            主关键词
            <input value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm" data-testid="kw-primary-input" />
          </label>
          <div className="mt-3" data-testid="kw-editor-supporting">
            <p className="text-xs font-medium text-slate-700">辅助关键词（最多 5 个）</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {supporting.map((w) => (
                <span key={w} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700">
                  {w}
                  <button type="button" aria-label={"删除辅助词 " + w} data-testid={"kw-remove-" + w.replace(/\s+/g, "-")} onClick={() => removeSupporting(w)} className="text-slate-400 hover:text-rose-600">×</button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={newSupporting} onChange={(e) => setNewSupporting(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSupporting(); } }} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm" data-testid="kw-add-supporting-input" placeholder="输入辅助词后回车添加" />
              <button type="button" onClick={addSupporting} data-testid="kw-add-supporting" className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">添加</button>
            </div>
          </div>
          <details className="mt-3" data-testid="kw-advanced">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">高级设置（后台搜索词）</summary>
            <textarea value={backendTerms} onChange={(e) => setBackendTerms(e.target.value)} className="mt-2 min-h-[90px] w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm" data-testid="kw-backend-input" placeholder="每行一个后台搜索词" />
          </details>
          <details className="mt-3" data-testid="kw-raw-report">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">查看原始关键词资料</summary>
            {rawEvidence && rawEvidence.rows.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1.5 pr-2 font-medium">关键词</th>
                      {Object.keys((rawEvidence.rows[0]?.fields as Record<string, unknown>) ?? {}).slice(0, 4).map((k) => (
                        <th key={k} className="px-2 py-1.5 font-medium">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawEvidence.rows.slice(0, 20).map((row) => (
                      <tr key={row.rowNumber} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-medium text-slate-900">{row.keyword}</td>
                        {Object.keys((rawEvidence.rows[0]?.fields as Record<string, unknown>) ?? {}).slice(0, 4).map((k) => (
                          <td key={k} className="px-2 py-1.5 text-slate-700">{String((row.fields as Record<string, unknown>)[k as string] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">尚未获得原始关键词报表。</p>
            )}
          </details>

          <div className="mt-3 flex items-center gap-2">
            <button type="button" data-testid="kw-save" onClick={() => void submit()} className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700">保存关键词方案</button>
            <button type="button" data-testid="kw-cancel" onClick={() => setEditing(false)} className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">取消</button>
          </div>
          {(error ?? saveError) ? <p className="mt-2 text-xs text-rose-600" role="alert">{error ?? saveError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
