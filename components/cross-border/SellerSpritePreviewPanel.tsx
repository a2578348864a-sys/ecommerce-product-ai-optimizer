"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { SellerSpritePreviewResults } from "@/components/cross-border/SellerSpritePreviewResults";
import {
  buildCandidateResearchHref,
  buildImportFormData,
  canOpenImportConfirmation,
  importErrorToMessage,
  isImportConfirmationEnabled,
  isTokenExpiryCode,
  parseImportResponse,
  processedRowHashes,
  SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS,
  selectAllRows,
  serializeSelectedRowHashes,
  toggleRowSelection,
  type SellerSpriteImportResult,
} from "@/lib/client/sellerSpriteImportWorkflow";
import type { SellerSpritePreviewResult } from "@/lib/upstream/sellersprite/preview";

type PreviewResponse =
  | { ok: true; preview: SellerSpritePreviewResult & { importToken?: string } }
  | { ok: false; error?: { code?: string; message?: string } };

export function SellerSpritePreviewPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<(SellerSpritePreviewResult & { importToken?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRowHashes, setSelectedRowHashes] = useState<string[]>([]);
  const [selectAllOverLimit, setSelectAllOverLimit] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<SellerSpriteImportResult | null>(null);
  const [importError, setImportError] = useState<{ status: number; code: string; message: string } | null>(null);

  const acceptedRows = preview?.acceptedRows ?? [];
  const hasBlockingErrors = (preview?.blockingErrors.length ?? 0) > 0;
  const hasImportToken = Boolean(preview?.importToken);
  const hasWarnings = (preview?.warnings.length ?? 0) > 0;
  const canSelect = hasImportToken && !hasBlockingErrors && !isImporting;
  const processed = importResult ? processedRowHashes(importResult) : new Set<string>();

  function clearWorkflowState(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setError(null);
    setSelectedRowHashes([]);
    setSelectAllOverLimit(false);
    setConfirmOpen(false);
    setWarningsAcknowledged(false);
    setImportResult(null);
    setImportError(null);
  }

  async function runPreview(targetFile: File) {
    setError(null);
    setPreview(null);
    setSelectedRowHashes([]);
    setSelectAllOverLimit(false);
    setImportResult(null);
    setImportError(null);
    setIsSubmitting(true);
    try {
      const body = new FormData();
      body.set("file", targetFile);
      const response = await fetch("/api/opportunities/sellersprite-preview", {
        method: "POST",
        headers: buildAccessHeaders(),
        body,
      });
      const payload = await response.json() as PreviewResponse;
      if ("preview" in payload && payload.preview) {
        setPreview(payload.preview);
        return;
      }
      setError("error" in payload && payload.error?.message
        ? payload.error.message
        : "文件无法安全预览。");
    } catch {
      setError("预览请求失败，请检查网络后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("请选择一个 XLSX 文件。");
      return;
    }
    await runPreview(file);
  }

  function onFileChange(nextFile: File | null) {
    clearWorkflowState(nextFile);
  }

  function toggleRow(rowHash: string) {
    if (!canSelect) return;
    if (processed.has(rowHash)) return;
    if (selectedRowHashes.includes(rowHash)) {
      setSelectedRowHashes((current) => toggleRowSelection(current, rowHash));
      setSelectAllOverLimit(false);
      return;
    }
    if (selectedRowHashes.length >= SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS) {
      setSelectAllOverLimit(true);
      return;
    }
    setSelectedRowHashes((current) => toggleRowSelection(current, rowHash));
    setSelectAllOverLimit(false);
  }

  function handleSelectAll() {
    const allHashes = acceptedRows.map((row) => row.rowHash ?? "").filter(Boolean);
    const { selected, overLimit } = selectAllRows(allHashes);
    setSelectedRowHashes(selected);
    setSelectAllOverLimit(overLimit);
  }

  function openConfirmation() {
    if (!canOpenImportConfirmation({
      selectedCount: selectedRowHashes.length,
      hasImportToken,
      hasBlockingErrors,
      isImporting,
    })) return;
    setWarningsAcknowledged(false);
    setConfirmOpen(true);
  }

  async function confirmImport() {
    if (!file || !preview?.importToken) return;
    if (selectedRowHashes.length < 1) return;
    if (hasWarnings && !warningsAcknowledged) return;
    setIsImporting(true);
    setImportError(null);
    try {
      const body = buildImportFormData({
        file,
        previewToken: preview.importToken,
        selectedRowHashesJson: serializeSelectedRowHashes(selectedRowHashes),
        confirmed: "true",
        warningsAccepted: hasWarnings ? "true" : "false",
      });
      const response = await fetch("/api/opportunities/sellersprite-import", {
        method: "POST",
        headers: buildAccessHeaders(),
        body,
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (response.ok) {
        const result = parseImportResponse(payload);
        if (!result) {
          setImportError({ status: response.status, code: "invalid_import_response", message: "导入响应无法解析，请稍后重试。" });
          return;
        }
        setImportResult(result);
        const processedHashes = processedRowHashes(result);
        setSelectedRowHashes((current) => current.filter((hash) => !processedHashes.has(hash)));
        setConfirmOpen(false);
        return;
      }
      const errorPayload = payload as { error?: { code?: string; message?: string } } | null;
      const code = errorPayload?.error?.code ?? "unknown_error";
      setImportError({
        status: response.status,
        code,
        message: importErrorToMessage(response.status, code),
      });
    } catch {
      setImportError({ status: 0, code: "network_error", message: "导入请求失败，请检查网络后重试。" });
    } finally {
      setIsImporting(false);
    }
  }

  function regeneratePreview() {
    if (!file) return;
    setImportError(null);
    void runPreview(file);
  }

  const confirmEnabled = isImportConfirmationEnabled({
    selectedCount: selectedRowHashes.length,
    hasWarnings,
    warningsAcknowledged,
    isImporting,
  });

  return (
    <section className="space-y-5" aria-label="卖家精灵安全预览操作区">
      <p className="rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-sm text-teal-900" role="note">
        文件只在当前页面会话中保留，请重新上传后继续导入。
      </p>

      <form onSubmit={submit} className="surface-card p-5 sm:p-6">
        <h2 className="section-title text-lg">上传并安全解析</h2>
        <label className="block text-sm font-medium text-slate-900" htmlFor="sellersprite-xlsx">选择 XLSX 文件</label>
        <p className="mt-1 text-xs text-slate-600">只接受单个文件，最大 8 MB；文件不会保存，也不会进入商品研究池。</p>
        <input
          id="sellersprite-xlsx"
          className="mt-3 block w-full text-sm"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          disabled={isSubmitting || isImporting}
        />
        <button
          className="linear-button-primary mt-4 inline-flex min-h-10 items-center px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
          type="submit"
          disabled={isSubmitting || isImporting || !file}
        >
          {isSubmitting ? "正在安全解析…" : "解析并预览"}
        </button>
      </form>

      {error ? <p role="alert" className="surface-card border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

      {preview ? (
        <div className="space-y-5">
          <SellerSpritePreviewResults
            preview={preview}
            selectedRowHashes={selectedRowHashes}
            processedRowHashes={processed}
            canSelect={canSelect}
            isImporting={isImporting}
            selectAllOverLimit={selectAllOverLimit}
            maxSelectedRows={SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS}
            onSelectAll={handleSelectAll}
            onClearSelection={() => {
              setSelectedRowHashes([]);
              setSelectAllOverLimit(false);
            }}
            onToggleRow={toggleRow}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="linear-button-primary inline-flex min-h-10 items-center px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
              onClick={openConfirmation}
              disabled={!canOpenImportConfirmation({
                selectedCount: selectedRowHashes.length,
                hasImportToken,
                hasBlockingErrors,
                isImporting,
              })}
            >
              加入商品研究池
            </button>
            {selectedRowHashes.length >= SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS ? (
              <p className="text-sm text-amber-800">已选择 {selectedRowHashes.length} 项，达到最多 {SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS} 项上限。</p>
            ) : null}
          </div>

          {confirmOpen ? (
            <section className="surface-card border-teal-200 bg-teal-50/60 p-5" aria-label="导入确认">
              <h2 className="section-title text-base">确认加入商品研究池</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-800">
                <li>将导入的商品数量：{selectedRowHashes.length} 项</li>
                <li>数据来源为 SellerSprite 第三方报表（sellersprite_xlsx，Amazon US）</li>
                <li>导入后只创建商品研究候选，不自动运行 AI</li>
                <li>不自动创建 Task</li>
                <li>不代表采购建议或选品结论</li>
              </ul>
              {hasWarnings ? (
                <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={warningsAcknowledged}
                    onChange={(event) => setWarningsAcknowledged(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>我已了解上述警告（本次预览包含 {preview.warnings.length} 项警告）。</span>
                </label>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="linear-button-secondary inline-flex min-h-10 items-center px-4 py-2 text-sm font-semibold"
                  onClick={() => { setConfirmOpen(false); setWarningsAcknowledged(false); }}
                  disabled={isImporting}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="linear-button-primary inline-flex min-h-10 items-center px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
                  onClick={() => void confirmImport()}
                  disabled={!confirmEnabled}
                >
                  {isImporting ? "正在导入…" : "确认加入"}
                </button>
              </div>
            </section>
          ) : null}

          {isImporting ? (
            <p role="status" className="surface-card-soft p-3 text-sm text-slate-700">正在导入商品研究池，请稍候…</p>
          ) : null}

          {importResult ? (
            <section className="surface-card p-5" aria-label="导入结果">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title text-base">导入结果</h2>
                <Link href="/opportunity-candidates" className="linear-button inline-flex h-9 items-center px-3 text-sm font-semibold">
                  查看商品研究池
                </Link>
              </div>
              <p className="mt-1 text-sm text-slate-800">
                新增 {importResult.created.length} 项 · 已存在 {importResult.skipped.length} 项 · 冲突 {importResult.conflicts.length} 项
              </p>
              {importResult.warnings.length > 0 ? (
                <p className="mt-1 text-xs text-slate-600">服务端警告：{importResult.warnings.length} 项</p>
              ) : null}

              {importResult.created.length > 0 ? (
                <div className="mt-3" aria-label="已加入">
                  <h3 className="text-sm font-semibold text-teal-800">已加入商品研究池</h3>
                  <ul className="mt-1 space-y-1">
                    {importResult.created.map((row) => (
                      <li key={row.rowHash} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-slate-700">第 {rowHashLabel(row.rowHash)} 行</span>
                        <ContinueResearchLink candidateId={row.candidateId} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importResult.skipped.length > 0 ? (
                <div className="mt-3" aria-label="已存在">
                  <h3 className="text-sm font-semibold text-slate-700">已存在于商品研究池</h3>
                  <ul className="mt-1 space-y-1">
                    {importResult.skipped.map((row) => (
                      <li key={row.rowHash} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-slate-700">第 {rowHashLabel(row.rowHash)} 行</span>
                        <ContinueResearchLink candidateId={row.candidateId} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importResult.conflicts.length > 0 ? (
                <div className="mt-3" aria-label="快照冲突">
                  <h3 className="text-sm font-semibold text-amber-800">该商品已存在，但来源快照不同</h3>
                  <ul className="mt-1 space-y-1">
                    {importResult.conflicts.map((row) => (
                      <li key={row.rowHash} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-slate-700">第 {rowHashLabel(row.rowHash)} 行：已保留原有研究记录，不自动覆盖</span>
                        {row.candidateId ? <ContinueResearchLink candidateId={row.candidateId} /> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {importError ? (
            <section className="surface-card border-red-200 bg-red-50 p-4" role="alert" aria-label="导入错误">
              <h2 className="text-sm font-semibold text-red-800">导入未完成</h2>
              <p className="mt-1 text-sm text-red-800">{importError.message}</p>
              {isTokenExpiryCode(importError.code) && file ? (
                <button
                  type="button"
                  className="linear-button-primary mt-3 inline-flex min-h-9 items-center px-3 py-1 text-sm font-semibold"
                  onClick={regeneratePreview}
                >
                  重新生成预览
                </button>
              ) : null}
            </section>
          ) : null}

        </div>
      ) : null}
    </section>
  );
}

function rowHashLabel(rowHash: string): string {
  return rowHash.slice(0, 8);
}

function ContinueResearchLink({ candidateId }: { candidateId: string }) {
  const href = buildCandidateResearchHref(candidateId);
  if (!href) return null;
  return (
    <Link href={href} className="text-sm font-semibold text-teal-700 underline decoration-teal-300 hover:text-teal-800">
      继续调查
    </Link>
  );
}
