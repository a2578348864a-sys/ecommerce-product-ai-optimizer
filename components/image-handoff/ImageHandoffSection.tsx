"use client";

import { useCallback, useEffect, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

type ImageStatus =
  | "ready" | "active" | "stale" | "revoked" | "concept_only" | "legacy_unbound" | "invalid";

type ImageDraftSafeSummary = {
  id: string | null;
  mode: "composition_concept" | "product_visual_draft" | null;
  compositionSummary: string | null;
  approvedReferenceFingerprint: string | null;
  generatedAt: string | null;
  humanReviewRequired: boolean;
};

type ImageStateData = {
  canGenerate: boolean;
  imageStatus: ImageStatus;
  mode: "composition_concept" | "product_visual_draft" | null;
  currentHandoffRevision: number | null;
  sourceHandoffRevision: number | null;
  staleReasonCode: string | null;
  humanReviewRequired: boolean;
  draft: ImageDraftSafeSummary | null;
  approvedVisualReferenceSummary: Array<{ referenceFingerprint: string; summary: string; selectionId?: string }>;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  expectedHandoffRevision: number | null;
  allowedModes: Array<"composition_concept" | "product_visual_draft">;
};

type ImageGenerateResult = {
  imageStatus: ImageStatus;
  currentHandoffRevision: number | null;
  sourceHandoffRevision: number | null;
  idempotentReplay: boolean;
  humanReviewRequired: boolean;
  draft: ImageDraftSafeSummary | null;
};

function formatTime(value: string | null) {
  if (!value) return "生成时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "生成时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusBadge(status: ImageStatus | null) {
  const labels: Record<string, string> = {
    ready: "可生成",
    active: "当前草稿有效",
    concept_only: "构图概念草稿",
    stale: "基于旧交接版本",
    revoked: "创作交接已撤回",
    legacy_unbound: "历史草稿未绑定交接",
    invalid: "状态异常",
  };
  return status ? labels[status] ?? status : "未生成";
}

function modeLabel(mode: "composition_concept" | "product_visual_draft" | null) {
  if (mode === "product_visual_draft") return "产品视觉草稿";
  if (mode === "composition_concept") return "构图概念";
  return "未确定";
}

/**
 * 草稿图片预览：通过受保护 task-bound 图片 API（/image-draft/{id}）读取 blob。
 * - 不暴露 raw URL / storageKey / base64 / 内部路径；
 * - objectURL 在卸载 / id 变化时 revoke，避免内存泄漏；
 * - 生成失败时保留已有预览（组件只在 draft.id 变化时重新加载）。
 */
function DraftImagePreview({ taskId, draftId }: { taskId: string; draftId: string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setFailed(false);
    setSource("");
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft/${encodeURIComponent(draftId)}`, {
      headers: buildAccessHeaders(),
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("IMAGE_LOAD_FAILED");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSource("");
    };
  }, [taskId, draftId]);

  if (failed) {
    return (
      <div className="flex aspect-square w-full max-w-sm items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-xs text-slate-500">
        图片读取失败，请刷新后重试。
      </div>
    );
  }
  if (!source) {
    return (
      <div className="flex aspect-square w-full max-w-sm animate-pulse items-center justify-center rounded-xl bg-slate-100">
        <span className="text-xs text-slate-400">图片加载中…</span>
      </div>
    );
  }
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- 受保护 task-bound 图片，blob objectURL，非外部资源 */}
      <img
        src={source}
        alt="产品图片草稿，待人工复核"
        className="aspect-square w-full object-contain"
      />
    </div>
  );
}

/** 下载草稿图片（受保护 task-bound API → blob → 本地下载） */
function downloadDraftImage(taskId: string, draftId: string, fallbackName: string) {
  void fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft/${encodeURIComponent(draftId)}`, {
    headers: buildAccessHeaders(),
    cache: "no-store",
  })
    .then((response) => {
      if (!response.ok) throw new Error("IMAGE_DOWNLOAD_FAILED");
      return response.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fallbackName || "product-image-draft"}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    })
    .catch(() => {
      // 下载失败静默：用户可刷新重试
    });
}

/** PR2-3: Image 消费 Creative Handoff 最小状态接入 */
export function ImageHandoffSection({ taskId }: { taskId: string }) {
  const [state, setState] = useState<ImageStateData | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [retryBody, setRetryBody] = useState<Record<string, unknown> | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        headers: buildAccessHeaders(),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState(null);
        return;
      }
      setState(json.data as ImageStateData);
    } catch {
      setState(null);
    }
  }, [taskId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function handleGenerate() {
    if (!state || !state.canGenerate || submitting) return;
    setSubmitting(true);
    setNotice(null);
    const requestKey = requestId ?? crypto.randomUUID();
    setRequestId(requestKey);
    const body = {
      requestId: requestKey,
      expectedStorageVersion: state.storageVersion,
      expectedHandoffRevision: state.expectedHandoffRevision,
      mode: state.mode,
      // Final Capability: product_visual_draft 提交服务端批准参考的 selectionId（首个批准参考）
      ...(state.mode === "product_visual_draft" && state.approvedVisualReferenceSummary?.[0]
        ? { approvedVisualReferenceSelectionIds: [(state.approvedVisualReferenceSummary[0] as { selectionId?: string }).selectionId].filter(Boolean) }
        : {}),
      confirmed: true,
    };
    setRetryBody(body);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.error?.code === "image_idempotency_conflict" || json.error?.code === "handoff_stale"
          || json.error?.code === "handoff_revision_conflict" || json.error?.code === "task_result_conflict") {
          setRequestId(null);
          setRetryBody(null);
          setNotice({ tone: "error", text: "交接或视觉参考已更新，请重新生成。" });
        } else {
          setNotice({ tone: "error", text: json.error?.message ?? "图片草稿生成失败。" });
        }
        return;
      }
      const data = json.data as ImageGenerateResult;
      setState((current) => current ? {
        ...current,
        imageStatus: data.imageStatus,
        sourceHandoffRevision: data.sourceHandoffRevision,
        draft: data.draft,
        canGenerate: false,
      } : current);
      setNotice({ tone: "info", text: data.idempotentReplay ? "已恢复同一请求的已保存结果。" : "图片草稿已生成，需人工复核后使用。" });
      setRequestId(null);
      setRetryBody(null);
      void loadState();
    } catch {
      setNotice({ tone: "error", text: "网络异常，图片草稿生成失败。" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!state) {
    return (
      <section className="mt-4 rounded-2xl border border-cyan-200 bg-white p-4" data-testid="image-handoff-section">
        <p className="text-sm font-semibold text-slate-500">图片草稿状态加载中...</p>
      </section>
    );
  }

  const isComposition = state.mode === "composition_concept";
  const generateDisabled = !state.canGenerate || submitting || state.imageStatus === "revoked" || state.imageStatus === "invalid";

  return (
    <section className="mt-4 rounded-2xl border border-cyan-200 bg-white p-4" data-testid="image-handoff-section">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-cyan-600">AI 图片素材草稿</p>
          <h3 className="mt-1 text-base font-bold text-slate-950">AI 生成图片草稿</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            仍需人工审核，不得直接发布。
          </p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-sm font-semibold ${
          state.imageStatus === "active" || state.imageStatus === "concept_only"
            ? "border-teal-200 bg-teal-50 text-teal-700"
            : state.imageStatus === "stale" || state.imageStatus === "revoked" || state.imageStatus === "legacy_unbound"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
          {statusBadge(state.imageStatus)}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-sm leading-6 text-amber-800">
        这是 AI 辅助图片草稿，不是最终上架图片。请人工复核构图、商品外观、认证标识和平台规则。
        系统不会自动上架，也不会承诺收益或销量表现。
      </div>

      {isComposition ? (
        <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm leading-6 text-sky-800" data-testid="image-composition-notice">
          当前仅生成构图概念，不代表真实商品外观。
        </div>
      ) : null}

      {/* 无 Handoff / legacy */}
      {state.imageStatus === "legacy_unbound" ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          历史图片草稿未绑定可信创作交接。草稿只读保留，请基于当前交接重新生成。
        </div>
      ) : null}

      {state.imageStatus === "revoked" ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800" data-testid="image-revoked-notice">
          对应创作交接已撤回。生成按钮已禁用，历史草稿保留。
        </div>
      ) : null}

      {state.imageStatus === "stale" ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800" data-testid="image-stale-notice">
          该图片草稿基于旧版创作交接。草稿只读保留，请基于最新交接重新生成。
        </div>
      ) : null}

      {state.canGenerate ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700">
              创作交接版本：{state.currentHandoffRevision ?? "-"}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              模式：{modeLabel(state.mode)}
              {isComposition ? "（不生成真实商品外观）" : "（基于批准视觉参考）"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generateDisabled}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-cyan-600 px-4 text-sm font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="image-handoff-generate"
          >
            {submitting ? "正在生成..." : isComposition ? "生成构图概念" : "生成产品视觉草稿"}
          </button>
        </div>
      ) : null}

      {state.draft ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span>模式：{modeLabel(state.draft.mode)}</span>
            <span>{formatTime(state.draft.generatedAt)}</span>
            <span>人工审核：必须</span>
          </div>
          {state.draft.id ? (
            <div className="space-y-3">
              <DraftImagePreview taskId={taskId} draftId={state.draft.id} />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const win = window.open("", "_blank");
                    if (!win) return;
                    win.document.write("<p>正在加载图片…</p>");
                    void fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft/${encodeURIComponent(state.draft!.id!)}`, {
                      headers: buildAccessHeaders(),
                      cache: "no-store",
                    })
                      .then((response) => {
                        if (!response.ok) throw new Error("IMAGE_LOAD_FAILED");
                        return response.blob();
                      })
                      .then((blob) => {
                        const url = URL.createObjectURL(blob);
                        win.location.href = url;
                        setTimeout(() => URL.revokeObjectURL(url), 60_000);
                      })
                      .catch(() => {
                        win.document.body.innerHTML = "<p>图片加载失败，请刷新后重试。</p>";
                      });
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  查看大图
                </button>
                <button
                  type="button"
                  onClick={() => downloadDraftImage(taskId, state.draft!.id!, state.draft?.mode === "composition_concept" ? "composition-concept" : "product-visual-draft")}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  下载
                </button>
                {state.canGenerate ? (
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={generateDisabled}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-cyan-600 px-3 text-sm font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "正在生成…" : "重新生成"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {state.draft.compositionSummary ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-sm leading-6 text-slate-700">
              {state.draft.compositionSummary}
            </div>
          ) : null}
          {state.draft.approvedReferenceFingerprint ? (
            <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3 text-sm leading-6 text-teal-800">
              已基于你批准的视觉参考生成。
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className={`mt-3 text-sm font-semibold ${notice.tone === "error" ? "text-rose-600" : "text-teal-700"}`}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
