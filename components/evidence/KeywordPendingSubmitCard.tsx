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

export type KeywordPendingCardStatus = "ready" | "saving" | "expired" | "error";

export function KeywordPendingSubmitCard({
  taskId,
  preview,
  storageVersion,
  onSaved,
  onCancel,
  onRecollect,
  onExpired,
}: {
  taskId: string;
  preview: KeywordPendingPreview;
  storageVersion?: BrowserUseStorageVersion | null;
  onSaved: () => void;
  onCancel: () => void;
  onRecollect?: () => void;
  onExpired?: () => void;
}) {
  const [status, setStatus] = useState<KeywordPendingCardStatus>("ready");
  const [error, setError] = useState("");

  const save = useCallback(() => {
    const payload = buildSaveBrowserUsePayload(preview.previewId, storageVersion);
    if (!payload) {
      setError("版本信息尚未就绪，请刷新后重试。未发送保存请求。");
      return;
    }
    setStatus("saving");
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/keyword-evidence`, {
          method: "POST",
          headers: { ...buildAccessHeaders(), "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null) as { ok?: boolean; error?: { code?: string; message?: string } } | null;
        if (!response.ok) {
          if (body?.error?.code === "preview_not_found") {
            setStatus("expired");
            setError("本次关键词预览已失效，未保存任何关键词。");
            onExpired?.();
            return;
          }
          setStatus("error");
          setError(body?.error?.message ?? "保存失败，请稍后重试。");
          return;
        }
        onSaved();
      } catch {
        setStatus("error");
        setError("网络错误，请重试。");
      }
    })();
  }, [taskId, preview.previewId, storageVersion, onSaved, onExpired]);

  if (status === "expired") {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-sm" data-testid="keyword-pending-card">
        <p className="text-xs font-bold text-amber-900" data-testid="kw-expired-title">本次关键词预览已失效，未保存任何关键词。</p>
        <p className="mt-1 text-xs text-slate-600">请重新执行“采集关键词+竞品”获得新的预览。</p>
        <div className="mt-2 flex items-center gap-2">
          {onRecollect ? (
            <button
              type="button"
              data-testid="keyword-pending-recollect"
              onClick={onRecollect}
              className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
            >
              重新采集关键词+竞品
            </button>
          ) : null}
          <button
            type="button"
            data-testid="keyword-pending-cancel"
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            放弃本次预览
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm" data-testid="keyword-pending-card">
      <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">待确认：竞品采集得到的关键词</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        种子 ASIN：{preview.seedAsin} · 关键词 {preview.keywordCount} 条 · 来源：Amazon 搜索结果
      </p>
      {preview.sourceUrl ? (
        <details className="mt-1 text-xs text-slate-500" data-testid="kw-source-url-details">
          <summary className="cursor-pointer text-slate-500 hover:underline">查看采集来源</summary>
          <p className="mt-0.5 break-all font-mono text-[11px] text-slate-600 bg-white/70 p-1.5 rounded border border-amber-200/60">
            {preview.sourceUrl}
          </p>
        </details>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="keyword-pending-save"
          disabled={status === "saving" || !storageVersion}
          onClick={save}
          className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={storageVersion ? undefined : "版本信息尚未就绪，请刷新后重试"}
        >
          {status === "saving" ? "保存中…" : "保存关键词证据"}
        </button>
        <button
          type="button"
          data-testid="keyword-pending-cancel"
          disabled={status === "saving"}
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          放弃
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
