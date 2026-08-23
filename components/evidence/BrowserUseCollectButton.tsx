"use client";

import { useCallback, useReducer } from "react";
import { Loader2 } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

/**
 * 轮 9：Browser Use 自动采集按钮（竞品/关键词）——只读采集 → 服务端 Preview → 人工确认保存。
 * 确认保存走既有竞品/关键词证据写入器；取消不产生任何数据。
 */

export type BrowserUseCollectPhase =
  | "idle" | "collecting" | "preview" | "saving" | "login_required" | "captcha_required" | "permission_insufficient" | "collect_failed" | "error";

export type BrowserUseCollectState = {
  phase: BrowserUseCollectPhase;
  preview: { schema: string; kind: string; seedAsin: string; marketplace: string; sourceUrl: string; capturedAt: string; results: { asin?: string; title?: string; keyword?: string; price?: number | null; rating?: number | null; reviews?: number | null; bsr?: number | null; searchVolume?: number | null; relevance?: number | null; competition?: number | null }[]; missing: string[]; failureReason: string | null } | null;
  previewId: string | null;
  message: string | null;
  savedCount: number | null;
};

export type BrowserUseStorageVersion = { resultJsonHash: string; updatedAt: string };

/**
 * 轮 11：确认保存请求契约——必须原样携带当前证据区服务端版本；
 * 版本未就绪 → null（调用方禁用确认，不得发送 undefined）。
 */

/** 轮 11：确认保存契约（版本未就绪 → null，禁止 undefined）。 */
export function buildSaveBrowserUsePayload(
  previewId: string | null,
  storageVersion: BrowserUseStorageVersion | null | undefined,
): { action: "save_browser_use"; previewId: string; expectedStorageVersion: BrowserUseStorageVersion } | null {
  if (!previewId) return null;
  if (!storageVersion || typeof storageVersion.resultJsonHash !== "string" || typeof storageVersion.updatedAt !== "string" || !storageVersion.resultJsonHash || !storageVersion.updatedAt) return null;
  return { action: "save_browser_use", previewId, expectedStorageVersion: storageVersion };
}
export const INITIAL_BROWSER_USE_COLLECT_STATE: BrowserUseCollectState = {
  phase: "idle", preview: null, previewId: null, message: null, savedCount: null,
};

export type BrowserUseCollectAction =
  | { type: "START" }
  | { type: "COLLECT_SUCCEEDED"; preview: BrowserUseCollectState["preview"]; previewId: string }
  | { type: "COLLECT_FAILED"; code: string; message: string }
  | { type: "SAVING" }
  | { type: "SAVED"; count: number }
  | { type: "SAVE_FAILED"; message: string }
  | { type: "CANCEL" };

export function browserUseCollectStateReducer(
  state: BrowserUseCollectState,
  action: BrowserUseCollectAction,
): BrowserUseCollectState {
  switch (action.type) {
    case "START":
      return { ...INITIAL_BROWSER_USE_COLLECT_STATE, phase: "collecting" };
    case "COLLECT_SUCCEEDED":
      if (action.preview === null) return { ...state, phase: "collect_failed", message: "采集成功但预览为空（不冒充无数据）。" };
      return { ...state, phase: "preview", preview: action.preview, previewId: action.previewId, message: null };
    case "COLLECT_FAILED": {
      const phase = action.code === "login_required" ? "login_required"
        : action.code === "captcha_required" ? "captcha_required"
          : action.code === "permission_insufficient" ? "permission_insufficient"
            : "collect_failed";
      return { ...INITIAL_BROWSER_USE_COLLECT_STATE, phase, message: action.message };
    }
    case "SAVING":
      return { ...state, phase: "saving" };
    case "SAVED":
      return { ...state, phase: "idle", preview: null, previewId: null, savedCount: action.count, message: `已保存 ${action.count} 条自动采集证据。` };
    case "SAVE_FAILED":
      return { ...state, phase: "error", message: action.message };
    case "CANCEL":
      return { ...INITIAL_BROWSER_USE_COLLECT_STATE, message: "已取消，未保存任何数据。" };
  }
}

function collectFailureLabel(phase: BrowserUseCollectPhase): string | null {
  if (phase === "login_required") return "需要登录 SellerSprite 后重试（未保存任何数据）。";
  if (phase === "captcha_required") return "遇到验证码/人机校验，已停止（未保存任何数据，请人工完成后重试）。";
  if (phase === "permission_insufficient") return "权限/套餐不足，无法采集（未保存任何数据）。";
  return null;
}

export function BrowserUseCollectButton({
  taskId,
  kind,
  storageVersion,
  onSaved,
  onCollected,
}: {
  taskId: string;
  kind: "competitor" | "keyword";
  storageVersion?: BrowserUseStorageVersion | null;
  onSaved?: (count: number) => void;
  /** 轮 10 合并：采集成功后额外产物（竞品采集同时产出的关键词预览） */
  onCollected?: (extra: { keywordPreviewId?: string | null; keywordCount?: number | null; seedAsin?: string | null; sourceUrl?: string | null }) => void;
}) {
  const [state, dispatch] = useReducer(browserUseCollectStateReducer, INITIAL_BROWSER_USE_COLLECT_STATE);
  const busy = state.phase === "collecting" || state.phase === "saving";

  const collect = useCallback(() => {
    dispatch({ type: "START" });
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${kind === "competitor" ? "competitor-evidence" : "keyword-evidence"}`, {
          method: "POST",
          headers: { ...buildAccessHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ action: "collect_browser_use" }),
        });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          const code = body?.error?.code ?? "collect_failed";
          const message = body?.error?.message ?? "浏览器采集失败。";
          dispatch({ type: "COLLECT_FAILED", code, message });
          return;
        }
        dispatch({ type: "COLLECT_SUCCEEDED", preview: body.data.preview ?? null, previewId: body.data.previewId ?? "" });
        onCollected?.({ keywordPreviewId: body.data?.keywordPreviewId ?? null, keywordCount: body.data?.keywordCount ?? null, seedAsin: body.data?.preview?.seedAsin ?? null, sourceUrl: body.data?.preview?.sourceUrl ?? null });
      } catch {
        if (!cancelled) dispatch({ type: "COLLECT_FAILED", code: "collect_failed", message: "网络错误，请重试。" });
      }
    })();
    return () => { cancelled = true; };
  }, [taskId, kind, onCollected]);

  const confirmSave = useCallback(() => {
    const payload = buildSaveBrowserUsePayload(state.previewId, storageVersion);
    if (!payload) {
      dispatch({ type: "SAVE_FAILED", message: "版本信息尚未就绪，请刷新后重试。未发送保存请求。" });
      return;
    }
    dispatch({ type: "SAVING" });
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${kind === "competitor" ? "competitor-evidence" : "keyword-evidence"}`, {
          method: "POST",
          headers: { ...buildAccessHeaders(), "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) {
          dispatch({ type: "SAVE_FAILED", message: body?.error?.message ?? "保存失败，请刷新后重试。" });
          return;
        }
        const saved = body?.data?.saved;
        const count = Array.isArray(saved) ? saved.length : 0;
        dispatch({ type: "SAVED", count });
        onSaved?.(count);
      } catch {
        dispatch({ type: "SAVE_FAILED", message: "网络错误，请重试。" });
      }
    })();
  }, [taskId, kind, state.previewId, storageVersion, onSaved]);

  const failureLabel = collectFailureLabel(state.phase);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={kind === "competitor" ? "browser-use-collect-competitors" : "browser-use-collect-keywords"}
        disabled={busy}
        onClick={collect}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {kind === "competitor" ? "采集关键词+竞品" : "自动采集关键词"}
      </button>
      {(state.phase === "collecting" || state.phase === "saving") && (
        <span className="text-sm text-slate-500">{state.phase === "collecting" ? "正在启动浏览器采集…" : "正在确认保存…"}</span>
      )}
      {failureLabel && <p className="text-sm text-amber-700" role="status">{failureLabel}</p>}
      {state.phase === "collect_failed" && state.message && <p className="text-sm text-rose-700" role="alert">{state.message}</p>}
      {state.phase === "error" && state.message && <p className="text-sm text-rose-700" role="alert">{state.message}</p>}
      {state.message && (state.phase === "idle") && <p className="text-sm text-emerald-700" role="status">{state.message}</p>}
      {state.phase === "preview" && state.preview && (
        <div className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" data-testid="browser-use-preview">
          <p className="font-semibold text-slate-900">采集预览（{state.preview.kind === "competitor" ? `竞品 ${state.preview.results.length} 条` : `关键词 ${state.preview.results.length} 条`}）</p>
          <p className="text-xs text-slate-500">种子 ASIN：{state.preview.seedAsin} · 来源：{state.preview.sourceUrl}</p>
          <ul className="mt-2 max-h-40 overflow-auto space-y-1">
            {state.preview.results.slice(0, 10).map((item, index) => (
              <li key={index} className="truncate text-slate-700">
                {state.preview?.kind === "competitor" ? `${item.asin ?? "?"} · ${item.title ?? ""}${item.price !== null && item.price !== undefined ? ` · $${item.price}` : ""}` : `${item.keyword ?? ""}${item.searchVolume !== null && item.searchVolume !== undefined ? ` · ${item.searchVolume}` : ""}`}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" data-testid="browser-use-preview-save" onClick={confirmSave} disabled={!storageVersion} className="inline-flex h-9 items-center rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50" title={storageVersion ? undefined : "版本信息尚未就绪，请刷新后重试"}>确认保存</button>
            <button type="button" data-testid="browser-use-preview-cancel" onClick={() => dispatch({ type: "CANCEL" })} className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
          </div>
        </div>
      )}
    </div>
  );
}