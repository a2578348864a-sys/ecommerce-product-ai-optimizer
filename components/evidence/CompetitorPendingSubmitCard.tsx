"use client";

import { useCallback, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { buildSaveBrowserUsePayload, type BrowserUseStorageVersion } from "./BrowserUseCollectButton";

export type CompetitorPendingPreviewItem = {
  asin: string;
  title: string;
  imageUrl?: string;
  price?: number;
  rating?: number;
  reviews?: number;
  bsr?: string;
  sourceUrl?: string;
};

export type CompetitorPendingPreview = {
  previewId: string;
  seedAsin: string;
  sourceUrl: string;
  competitorCount: number;
  capturedAt: string | null;
  items?: CompetitorPendingPreviewItem[];
};

export type CompetitorPendingCardStatus = "ready" | "saving" | "expired" | "error";

export function CompetitorPendingSubmitCard({
  taskId,
  preview,
  storageVersion,
  onSaved,
  onCancel,
  onRecollect,
  onExpired,
}: {
  taskId: string;
  preview: CompetitorPendingPreview;
  storageVersion?: BrowserUseStorageVersion | null;
  onSaved: () => void;
  onCancel: () => void;
  onRecollect?: () => void;
  onExpired?: () => void;
}) {
  const [status, setStatus] = useState<CompetitorPendingCardStatus>("ready");
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
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/competitor-evidence`, {
          method: "POST",
          headers: { ...buildAccessHeaders(), "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => null)) as
          | { ok?: boolean; error?: { code?: string; message?: string } }
          | null;
        if (!response.ok) {
          if (body?.error?.code === "preview_not_found") {
            setStatus("expired");
            setError("本次竞品预览已失效，未保存任何竞品。");
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
      <div
        className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-sm"
        data-testid="competitor-pending-card"
      >
        <p className="text-xs font-bold text-amber-900" data-testid="cp-expired-title">
          本次竞品预览已失效，未保存任何竞品。
        </p>
        <p className="mt-1 text-xs text-slate-600">
          请重新执行“采集关键词+竞品”获得新的预览。
        </p>
        <div className="mt-2 flex items-center gap-2">
          {onRecollect ? (
            <button
              type="button"
              data-testid="competitor-pending-recollect"
              onClick={onRecollect}
              className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
            >
              重新采集关键词+竞品
            </button>
          ) : null}
          <button
            type="button"
            data-testid="competitor-pending-cancel"
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            放弃本次预览
          </button>
        </div>
      </div>
    );
  }

  const items = Array.isArray(preview.items) ? preview.items : [];

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm"
      data-testid="competitor-pending-card"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
          待确认：自动采集发现的候选竞品
        </p>
        <span className="text-[11px] font-medium text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md">
          {items.length || preview.competitorCount} 个候选
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        种子 ASIN：{preview.seedAsin} · 来源：Amazon 搜索结果
      </p>

      {preview.sourceUrl ? (
        <details className="mt-1 text-xs text-slate-500" data-testid="cp-source-url-details">
          <summary className="cursor-pointer text-slate-500 hover:underline">查看采集来源</summary>
          <p className="mt-0.5 break-all font-mono text-[11px] text-slate-600 bg-white/70 p-1.5 rounded border border-amber-200/60">
            {preview.sourceUrl}
          </p>
        </details>
      ) : null}

      {items.length > 0 ? (
        <div
          className="mt-2.5 max-h-60 overflow-y-auto space-y-2 pr-1"
          data-testid="competitor-pending-list"
        >
          {items.map((item, idx) => (
            <div
              key={`${item.asin}-${idx}`}
              className="flex items-start gap-3 rounded-lg border border-amber-200/80 bg-white p-2.5 shadow-2xs"
              data-testid={`competitor-pending-item-${item.asin}`}
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="h-12 w-12 shrink-0 rounded object-contain border border-slate-100 bg-slate-50"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-100 text-[10px] text-slate-400">
                  无图
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs font-semibold text-slate-900" title={item.title}>
                  {item.title || item.asin}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                  <span className="font-mono font-medium text-slate-700">{item.asin}</span>
                  {typeof item.price === "number" ? (
                    <span className="font-semibold text-slate-900">${item.price.toFixed(2)}</span>
                  ) : null}
                  {typeof item.rating === "number" ? (
                    <span className="text-amber-600">
                      ★ {item.rating.toFixed(1)}
                      {typeof item.reviews === "number" ? ` (${item.reviews.toLocaleString()})` : ""}
                    </span>
                  ) : null}
                  {item.bsr ? (
                    <span className="text-slate-400">BSR: #{item.bsr}</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          data-testid="competitor-pending-save"
          disabled={status === "saving" || !storageVersion}
          onClick={save}
          className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={storageVersion ? undefined : "版本信息尚未就绪，请刷新后重试"}
        >
          {status === "saving" ? "保存中…" : "先保存竞品证据"}
        </button>
        <button
          type="button"
          data-testid="competitor-pending-cancel"
          disabled={status === "saving"}
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          放弃本次预览
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-xs text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
