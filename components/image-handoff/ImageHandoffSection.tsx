"use client";

import { useCallback, useEffect, useState } from "react";
import { buildAccessHeaders, updateDemoAccessSnapshot, type DemoAccessInfo } from "@/lib/client/accessToken";
import { createBrowserUuid } from "@/lib/browserUuid";
import { readJsonApiResponse } from "@/lib/client/safeApiResponse";
import { studioErrorMessage } from "@/lib/client/studioErrorMessage";

type ImageStatus =
  | "ready"
  | "active"
  | "stale"
  | "revoked"
  | "concept_only"
  | "legacy_unbound"
  | "invalid";

type ImageDraftSafeSummary = {
  id: string | null;
  mode: "composition_concept" | "product_visual_draft" | null;
  compositionSummary: string | null;
  approvedReferenceFingerprint: string | null;
  generatedAt: string | null;
  sourceHandoffRevision: number | null;
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
  candidates: ImageDraftSafeSummary[];
  selectedImageId: string | null;
  approvedVisualReferenceSummary: Array<{
    referenceFingerprint: string;
    summary: string;
    selectionId?: string;
  }>;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  expectedHandoffRevision: number | null;
  allowedModes: Array<"composition_concept" | "product_visual_draft">;
  creativeDescriptionContext: {
    productName: string;
    confirmedFacts: Array<{ field?: string; label: string; value: string }>;
    existingVisualRequirements?: string[];
    hasApprovedReference: boolean;
    suggestedCreativeIntent?: unknown;
  } | null;
};

type ImageGenerateResult = {
  imageStatus: ImageStatus;
  sourceHandoffRevision: number | null;
  idempotentReplay: boolean;
  draft: ImageDraftSafeSummary | null;
  candidates: ImageDraftSafeSummary[];
};

function formatTime(value: string | null) {
  if (!value) return "生成时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "生成时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status: ImageStatus) {
  const labels: Record<ImageStatus, string> = {
    ready: "可以生成",
    active: "已有图片草稿",
    stale: "需要重新生成",
    revoked: "创作资料已撤回",
    concept_only: "构图参考",
    legacy_unbound: "历史记录",
    invalid: "状态异常",
  };
  return labels[status];
}

function modeLabel(mode: ImageStateData["mode"]) {
  return mode === "product_visual_draft" ? "商品图片候选" : "构图参考候选";
}

function summaryText(summary: string | null) {
  if (!summary) return "图片候选，生成后仍需人工复核。";
  if (summary.startsWith("Product visual draft derived strictly from the approved visual reference")) {
    return "已基于确认的商品参考图生成，商品外观与关键事实仍需人工复核。";
  }
  if (summary.startsWith("Abstract composition concept")) {
    return "构图参考候选，不代表真实商品外观。";
  }
  return summary;
}

function DraftImagePreview({ taskId, draftId }: { taskId: string; draftId: string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSource("");
    setFailed(false);
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
    };
  }, [draftId, taskId]);

  if (failed) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 text-center text-xs text-rose-700">
        图片读取失败，请刷新后重试。
      </div>
    );
  }
  if (!source) {
    return (
      <div className="flex aspect-square w-full animate-pulse items-center justify-center rounded-xl bg-slate-100">
        <span className="text-xs text-slate-400">图片加载中…</span>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- 受保护 task-bound 图片 API 返回的 blob objectURL */}
      <img src={source} alt="图片候选，待人工复核" className="aspect-square w-full object-contain" />
    </div>
  );
}

function downloadDraftImage(taskId: string, draftId: string) {
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
      link.download = "product-image-draft.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    })
    .catch(() => undefined);
}

/**
 * 商品研究驱动的最小 Image Studio：
 * 商品信息 → 已确认参考图 → 创作描述 → 生成 → 图片候选。
 *
 * 服务端仍负责所有事实、参考图、创作交接、版本和存储门禁；本组件只提交
 * 用户描述与当前版本令牌，不在浏览器重建 Prompt、slot recipe 或视觉规划。
 */
export function ImageHandoffSection({ taskId, onCommitted, onProgressChange }: {
  taskId: string;
  onCommitted?: () => void;
  onProgressChange?: (state: {
    strategyReady: boolean;
    isGenerating: boolean;
    candidateCount: number;
    selectedImageId: string | null;
  }) => void;
}) {
  const [state, setState] = useState<ImageStateData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [creativeDescription, setCreativeDescription] = useState("");

  const loadState = useCallback(async () => {
    try {
      setLoadError("");
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        headers: buildAccessHeaders(),
        cache: "no-store",
      });
      const parsed = await readJsonApiResponse(response);
      if (!parsed.ok) {
        setState(null);
        setLoadError(studioErrorMessage({ error: parsed.error }, "图片创作资料暂时无法加载，请稍后重试。"));
        return;
      }
      const json = parsed.payload as { ok?: boolean; data?: ImageStateData; error?: { code?: string } };
      if (!response.ok || !json.ok || !json.data) {
        setState(null);
        setLoadError(studioErrorMessage(json, "图片创作资料暂时无法加载，请稍后重试。"));
        return;
      }
      setState(json.data);
    } catch {
      setState(null);
      setLoadError("网络异常，图片创作资料暂时无法加载。");
    }
  }, [taskId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    onProgressChange?.({
      strategyReady: Boolean(state?.mode),
      isGenerating: submitting,
      candidateCount: state?.candidates.length ?? 0,
      selectedImageId: state?.selectedImageId ?? null,
    });
  }, [onProgressChange, state, submitting]);

  async function handleGenerate() {
    if (!state || !state.canGenerate || submitting || state.expectedHandoffRevision == null || !state.storageVersion) return;
    setSubmitting(true);
    setNotice(null);
    const nextRequestId = requestId ?? createBrowserUuid();
    setRequestId(nextRequestId);
    const body = {
      requestId: nextRequestId,
      expectedStorageVersion: state.storageVersion,
      expectedHandoffRevision: state.expectedHandoffRevision,
      mode: state.mode,
      count: 1,
      // 仅用于让服务端把无参考图模式归类为构图参考；商品图片仍由服务端 Reference Gate 保护。
      primaryImagePurpose: state.mode === "product_visual_draft" ? "white_studio" : "custom",
      lifestyleScene: "none",
      customImagePurpose: state.mode === "composition_concept" ? "构图参考" : "",
      userCreativeDescription: creativeDescription,
      ...(state.mode === "product_visual_draft" && state.approvedVisualReferenceSummary[0]?.selectionId
        ? { approvedVisualReferenceSelectionIds: [state.approvedVisualReferenceSummary[0].selectionId] }
        : {}),
      confirmed: true,
    };
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(body),
      });
      const parsed = await readJsonApiResponse(response);
      const json = parsed.ok
        ? parsed.payload as { ok?: boolean; data?: ImageGenerateResult; error?: { code?: string } }
        : { ok: false, error: parsed.error };
      if (!response.ok || !json.ok || !json.data) {
        if (json && typeof json === "object" && "demoAccess" in json) {
          updateDemoAccessSnapshot((json as { demoAccess: DemoAccessInfo }).demoAccess);
        }
        if (json.error?.code === "image_idempotency_conflict"
          || json.error?.code === "handoff_stale"
          || json.error?.code === "handoff_revision_conflict"
          || json.error?.code === "task_result_conflict") {
          setRequestId(null);
          setNotice({ tone: "error", text: "创作资料或参考图已更新，请刷新后重新生成。" });
        } else {
          setNotice({ tone: "error", text: studioErrorMessage(json, "图片生成失败，请稍后重试。") });
        }
        return;
      }
      const data = json.data;
      setState((current) => current ? {
        ...current,
        imageStatus: data.imageStatus,
        sourceHandoffRevision: data.sourceHandoffRevision,
        draft: data.draft,
        candidates: data.candidates,
        selectedImageId: null,
        canGenerate: false,
      } : current);
      setNotice({ tone: "info", text: data.idempotentReplay ? "已恢复同一请求的已保存结果。" : "图片候选已生成，请人工复核后使用。" });
      if ("demoAccess" in json && json.demoAccess) {
        updateDemoAccessSnapshot((json as { demoAccess: DemoAccessInfo }).demoAccess);
      }
      setRequestId(null);
      await loadState();
      onCommitted?.();
    } catch {
      setNotice({ tone: "error", text: "网络异常，图片候选生成失败。" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelect(selectedImageId: string) {
    if (!state?.storageVersion || state.expectedHandoffRevision == null || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          selectedImageId,
          expectedStorageVersion: state.storageVersion,
          expectedHandoffRevision: state.expectedHandoffRevision,
          confirmed: true,
        }),
      });
      const parsed = await readJsonApiResponse(response);
      const json = parsed.ok
        ? parsed.payload as { ok?: boolean; error?: { code?: string } }
        : { ok: false, error: parsed.error };
      if (!response.ok || !json.ok) {
        setNotice({ tone: "error", text: studioErrorMessage(json, "图片选择保存失败，请刷新后重试。") });
        return;
      }
      setState((current) => current ? { ...current, selectedImageId } : current);
      setNotice({ tone: "info", text: "已保存当前选择；仍需人工复核后使用。" });
      await loadState();
      onCommitted?.();
    } catch {
      setNotice({ tone: "error", text: "网络异常，图片选择未保存。" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!state) {
    return (
      <section className="mt-4 rounded-2xl border border-cyan-200 bg-white p-4" data-testid="image-handoff-section">
        <p className={`text-sm font-semibold ${loadError ? "text-rose-600" : "text-slate-500"}`}>
          {loadError || "图片创作资料加载中…"}
        </p>
      </section>
    );
  }

  const context = state.creativeDescriptionContext;
  const facts = context?.confirmedFacts ?? [];
  const references = state.approvedVisualReferenceSummary;
  const isProductDraft = state.mode === "product_visual_draft";
  const generationBlocked = !state.canGenerate
    || state.imageStatus === "revoked"
    || state.imageStatus === "invalid"
    || state.expectedHandoffRevision == null
    || state.storageVersion == null;

  return (
    <section className="mt-4 space-y-4 rounded-2xl border border-cyan-200 bg-white p-4" data-testid="image-handoff-section">
      <header className="border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Image Studio · 研究结果驱动</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">生成商品图片候选</h2>
            <p className="mt-1 text-sm text-slate-600">商品信息与已确认事实由商品研究提供，图片生成结果仍需人工复核。</p>
          </div>
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">
            {statusLabel(state.imageStatus)}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" data-testid="image-product-information">
        <h3 className="text-sm font-bold text-slate-900">商品信息</h3>
        <p className="mt-2 text-base font-semibold text-slate-800">{context?.productName || "当前研究商品"}</p>
        <p className="mt-1 text-xs text-slate-500">图片生成只使用服务端重新核验后的研究资料，不接受浏览器自行提交的商品事实。</p>
        {facts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="image-confirmed-facts">
            {facts.map((fact, index) => (
              <span key={`${fact.field ?? fact.label}-${index}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                {fact.label}：{fact.value}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">当前没有可用于图片生成的已确认事实，请返回商品研究补充确认。</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="image-reference-information">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">参考图</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${references.length > 0 ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}>
            {references.length > 0 ? `已确认 ${references.length} 张` : "尚未确认"}
          </span>
        </div>
        {references.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {references.map((reference) => (
              <div key={reference.selectionId ?? reference.referenceFingerprint} className="rounded-xl border border-teal-100 bg-teal-50/50 p-3">
                <p className="text-sm font-semibold text-slate-800">商品参考图</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{reference.summary}</p>
                <p className="mt-2 text-xs font-semibold text-teal-700">✓ 已确认，可用于锁定商品外观</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
            当前没有已确认的商品参考图。你仍可生成构图参考；要生成真实商品外观图片，请先回到创作资料确认页批准参考图。
          </p>
        )}
      </section>

      <section className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-4" data-testid="image-creation-form">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">创作描述</h3>
          <span className="text-xs text-slate-500">最多 1200 字</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600">描述你希望图片呈现的画面。商品身份、已确认事实和参考图由系统保护，不需要在这里重复填写。</p>
        <textarea
          id="task-image-creative-description"
          name="userCreativeDescription"
          value={creativeDescription}
          maxLength={1200}
          rows={4}
          onChange={(event) => setCreativeDescription(event.target.value)}
          disabled={submitting}
          placeholder="例如：干净明亮的电商产品图，突出商品主体和材质细节。"
          className="mt-3 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:opacity-60"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generationBlocked || submitting}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan-600 px-5 text-sm font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="image-handoff-generate"
          >
            {submitting ? "正在生成图片…" : "生成图片"}
          </button>
          <span className="text-xs text-slate-500">{isProductDraft ? "参考图优先 · 商品身份锁定" : "构图参考 · 不代表真实商品外观"}</span>
        </div>
        {generationBlocked ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold leading-5 text-amber-800">
            {state.imageStatus === "revoked" ? "创作资料已撤回，请返回研究记录重新确认。" : state.imageStatus === "invalid" ? "当前图片创作状态异常，请刷新后重试。" : "创作资料尚未准备好，完成创作资料确认后才能生成图片。"}
          </p>
        ) : null}
      </section>

      {state.candidates.length > 0 ? (
        <section data-testid="task-image-candidates">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">图片候选</h3>
              <p className="mt-1 text-xs text-slate-500">候选已保存到当前研究任务，刷新页面后仍会保留。</p>
            </div>
            <span className="text-xs font-semibold text-slate-500">{state.candidates.length} 张</span>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {state.candidates.map((candidate, index) => candidate.id ? (
              <article
                key={candidate.id}
                className={`rounded-2xl border p-4 ${state.selectedImageId === candidate.id ? "border-teal-500 bg-teal-50/40" : "border-slate-200 bg-white"}`}
              >
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                  <span className="text-slate-900">候选图片 {index + 1} · {modeLabel(candidate.mode)}</span>
                  <span>{formatTime(candidate.generatedAt)}</span>
                </div>
                <DraftImagePreview taskId={taskId} draftId={candidate.id} />
                <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-700">{summaryText(candidate.compositionSummary)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadDraftImage(taskId, candidate.id!)}
                    className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    下载图片
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSelect(candidate.id!)}
                    disabled={submitting || state.selectedImageId === candidate.id || candidate.mode !== "product_visual_draft"}
                    title={candidate.mode !== "product_visual_draft" ? "构图参考不能作为正式商品图片选择" : undefined}
                    className="ml-auto inline-flex h-9 items-center rounded-lg bg-teal-600 px-3.5 text-xs font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {state.selectedImageId === candidate.id ? "已选择" : candidate.mode === "product_visual_draft" ? "选择此图" : "仅作构图参考"}
                  </button>
                </div>
              </article>
            ) : null)}
          </div>
        </section>
      ) : null}

      {notice ? (
        <p className={`rounded-xl p-3 text-sm font-semibold ${notice.tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-teal-200 bg-teal-50 text-teal-700"}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
