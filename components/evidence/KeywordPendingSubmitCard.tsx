"use client";

import { useCallback, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { buildSaveBrowserUsePayload, type BrowserUseStorageVersion } from "./BrowserUseCollectButton";

/**
 * 轮 10 合并：竞品采集同时产出的关键词预览——待确认卡片（关键词资料区）。
 * 保存走 keyword-evidence save_browser_use（previewId + 关键词区 storageVersion；CAS 不放宽）；
 * 取消不产生任何落库。
 */

export type KeywordPendingPreview = {
  previewId: string;
  seedAsin: string;
  sourceUrl: string;
  keywordCount: number;
  capturedAt: string | null;
};

export function KeywordPendingSubmitCard({
  taskId,
  preview,
  storageVersion,
  onSaved,
  onCancel,
}: {
  taskId: string;
  preview: KeywordPendingPreview;
  storageVersion?: BrowserUseStorageVersion | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(() => {
    const payload = buildSaveBrowserUsePayload(preview.previewId, storageVersion);
    if (!payload) {
      setError("版本信息尚未就绪，请刷新后重试。未发送保存请求。");
      return;
    }
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/keyword-evidence`, {
          method: "POST",
          headers: { ...buildAccessHeaders(), "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
        if (!response.ok) {
          setError(body?.error?.message ?? "保存失败，请稍后重试。");
          return;
        }
        onSaved();
      } catch {
        setError("网络错误，请重试。");
      } finally {
        setBusy(false);
      }
    })();
  }, [taskId, preview.previewId, storageVersion, onSaved]);

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm" data-testid="keyword-pending-card">
      <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">待确认：竞品采集得到的关键词</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        种子 ASIN：{preview.seedAsin} · 关键词 {preview.keywordCount} 条 · 来源：{preview.sourceUrl}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="keyword-pending-save"
          disabled={busy || !storageVersion}
          onClick={save}
          className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={storageVersion ? undefined : "版本信息尚未就绪，请刷新后重试"}
        >
          {busy ? "保存中…" : "保存关键词"}
        </button>
        <button
          type="button"
          data-testid="keyword-pending-cancel"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          取消
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
