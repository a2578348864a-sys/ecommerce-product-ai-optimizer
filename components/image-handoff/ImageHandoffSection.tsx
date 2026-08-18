"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { createBrowserUuid } from "@/lib/browserUuid";
import { useRouter } from "next/navigation";
import { ImageScenePresetPicker } from "@/components/image-studio/ImageScenePresetPicker";
import {
  buildTaskImageCreativeDescription,
  type TaskImageCreativeDescriptionContext,
} from "@/lib/imageCreativeDescription";
import { readJsonApiResponse } from "@/lib/client/safeApiResponse";
import { studioErrorMessage } from "@/lib/client/studioErrorMessage";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import {
  DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  type StudioImageCreativeIntent,
} from "@/lib/studioImageCreativeIntent";

type ImageStatus =
  | "ready" | "active" | "stale" | "revoked" | "concept_only" | "legacy_unbound" | "invalid";

type ImageDraftSafeSummary = {
  id: string | null;
  mode: "composition_concept" | "product_visual_draft" | null;
  compositionSummary: string | null;
  approvedReferenceFingerprint: string | null;
  generatedAt: string | null;
  sourceHandoffRevision: number | null;
  humanReviewRequired: boolean;
};

type ImageDraftHistoryEntry = {
  id: string;
  classification: "product_visual_draft" | "composition_concept" | "invalid_product_identity" | "legacy_unclassified";
  generatedAt: string | null;
  sourceHandoffRevision: number | null;
  approvedReferenceFingerprint: string | null;
  inCurrentCandidates: boolean;
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
  approvedVisualReferenceSummary: Array<{ referenceFingerprint: string; summary: string; selectionId?: string }>;
  /** Visual Reference Closure：任务自有图片候选（服务端安全投影，不含哈希/dataUrl） */
  visualReferenceCandidates?: Array<{ selectionId: string; sourceKind: string; approvable: boolean; summary: string }>;
  /** V3 Final Freeze：历史草稿分类投影（含当前候选与历史；UI 分组展示，历史不可正式选择） */
  draftHistory?: ImageDraftHistoryEntry[];
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  expectedHandoffRevision: number | null;
  allowedModes: Array<"composition_concept" | "product_visual_draft">;
  creativeDescriptionContext: TaskImageCreativeDescriptionContext | null;
};

type ImageGenerateResult = {
  imageStatus: ImageStatus;
  currentHandoffRevision: number | null;
  sourceHandoffRevision: number | null;
  idempotentReplay: boolean;
  humanReviewRequired: boolean;
  draft: ImageDraftSafeSummary | null;
  candidates: ImageDraftSafeSummary[];
};

type TaskImageCreativeDraft = StudioImageCreativeIntent & {
  userCreativeDescription: string;
  descriptionDirty: boolean;
};

const EMPTY_TASK_IMAGE_CREATIVE_DRAFT: TaskImageCreativeDraft = {
  ...DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  userCreativeDescription: "",
  descriptionDirty: false,
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
    revoked: "创作资料已撤回",
    legacy_unbound: "历史草稿未绑定资料",
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
export function ImageHandoffSection({ taskId, onCommitted, onProgressChange }: {
  taskId: string;
  /** 图片草稿生成成功后通知父级（父级重读服务端真实任务状态，进度摘要随之刷新） */
  onCommitted?: () => void;
  onProgressChange?: (state: {
    strategyReady: boolean;
    isGenerating: boolean;
    candidateCount: number;
    selectedImageId: string | null;
  }) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<ImageStateData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [candidateCount, setCandidateCount] = useState<1 | 2>(2);
  const [creativeIntent, setCreativeIntent] = useState<StudioImageCreativeIntent>(
    DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  );
  const [userCreativeDescription, setUserCreativeDescription] = useState("");
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const seededDescriptionKeyRef = useRef("");
  const restoredDraftRef = useRef(false);
  const sessionDraft = useSessionDraft<TaskImageCreativeDraft>({
    pageKind: "image-studio-task",
    entityId: taskId,
    revision: state?.expectedHandoffRevision == null
      ? null
      : String(state.expectedHandoffRevision),
    initial: EMPTY_TASK_IMAGE_CREATIVE_DRAFT,
  });

  useEffect(() => {
    if (!sessionDraft.draft || restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    setCreativeIntent({
      primaryImagePurpose: sessionDraft.draft.primaryImagePurpose,
      lifestyleScene: sessionDraft.draft.lifestyleScene,
      customImagePurpose: sessionDraft.draft.customImagePurpose,
    });
    setUserCreativeDescription(sessionDraft.draft.userCreativeDescription);
    setDescriptionDirty(sessionDraft.draft.descriptionDirty === true);
  }, [sessionDraft.draft]);

  useEffect(() => {
    if (state?.expectedHandoffRevision == null) return;
    sessionDraft.save({
      ...creativeIntent,
      userCreativeDescription,
      descriptionDirty,
    });
  }, [creativeIntent, descriptionDirty, sessionDraft, state?.expectedHandoffRevision, userCreativeDescription]);

  const loadState = useCallback(async () => {
    try {
      setLoadError("");
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        headers: buildAccessHeaders(),
        cache: "no-store",
      });
      const parsed = await readJsonApiResponse(res);
      if (!parsed.ok) {
        setState(null);
        setLoadError(studioErrorMessage({ error: parsed.error }, "图片创作资料暂时无法加载，请稍后重试。"));
        return;
      }
      const json = parsed.payload as { ok?: boolean; data?: ImageStateData; error?: { code?: string } };
      if (!res.ok || !json.ok) {
        setState(null);
        setLoadError(studioErrorMessage(json, "图片创作资料暂时无法加载，请稍后重试。"));
        return;
      }
      const nextState = json.data as ImageStateData;
      setState(nextState);
      if (nextState.creativeDescriptionContext) {
        const suggestedIntent = nextState.creativeDescriptionContext.suggestedCreativeIntent
          ?? DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT;
        const seedKey = JSON.stringify({
          revision: nextState.expectedHandoffRevision,
          context: nextState.creativeDescriptionContext,
        });
        if (seededDescriptionKeyRef.current !== seedKey) {
          seededDescriptionKeyRef.current = seedKey;
          setCreativeIntent(suggestedIntent);
          setDescriptionDirty(false);
          setUserCreativeDescription(buildTaskImageCreativeDescription(
            nextState.creativeDescriptionContext,
            suggestedIntent.primaryImagePurpose,
            suggestedIntent.lifestyleScene,
            suggestedIntent.customImagePurpose,
          ));
        }
      }
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
    if (!state || !state.canGenerate || submitting) return;
    setSubmitting(true);
    setNotice(null);
    const requestKey = requestId ?? createBrowserUuid();
    setRequestId(requestKey);
    const body = {
      requestId: requestKey,
      expectedStorageVersion: state.storageVersion,
      expectedHandoffRevision: state.expectedHandoffRevision,
      mode: state.mode,
      count: candidateCount,
      ...creativeIntent,
      userCreativeDescription,
      // Final Capability: product_visual_draft 提交服务端批准参考的 selectionId（首个批准参考）
      ...(state.mode === "product_visual_draft" && state.approvedVisualReferenceSummary?.[0]
        ? { approvedVisualReferenceSelectionIds: [(state.approvedVisualReferenceSummary[0] as { selectionId?: string }).selectionId].filter(Boolean) }
        : {}),
      confirmed: true,
    };
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(body),
      });
      const parsed = await readJsonApiResponse(res);
      const json = parsed.ok
        ? parsed.payload as { ok?: boolean; data?: ImageGenerateResult; error?: { code?: string } }
        : { ok: false, error: parsed.error };
      if (!res.ok || !json.ok) {
        if (json.error?.code === "image_idempotency_conflict" || json.error?.code === "handoff_stale"
          || json.error?.code === "handoff_revision_conflict" || json.error?.code === "task_result_conflict") {
          setRequestId(null);
          setNotice({ tone: "error", text: "交接或视觉参考已更新，请重新生成。" });
        } else {
          setNotice({ tone: "error", text: studioErrorMessage(json, "图片生成失败，请稍后重试。") });
        }
        return;
      }
      const data = json.data as ImageGenerateResult;
      setState((current) => current ? {
        ...current,
        imageStatus: data.imageStatus,
        sourceHandoffRevision: data.sourceHandoffRevision,
        draft: data.draft,
        candidates: data.candidates,
        selectedImageId: null,
        canGenerate: false,
      } : current);
      setNotice({ tone: "info", text: data.idempotentReplay ? "已恢复同一请求的已保存结果。" : "图片草稿已生成，需人工复核后使用。" });
      setRequestId(null);
      await loadState();
      onCommitted?.();
    } catch {
      setNotice({ tone: "error", text: "网络异常，图片草稿生成失败。" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelect(selectedImageId: string) {
    if (!state?.storageVersion || !state.expectedHandoffRevision || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-handoff`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          selectedImageId,
          expectedStorageVersion: state.storageVersion,
          expectedHandoffRevision: state.expectedHandoffRevision,
          confirmed: true,
        }),
      });
      const parsed = await readJsonApiResponse(res);
      const json = parsed.ok
        ? parsed.payload as { ok?: boolean; error?: { code?: string } }
        : { ok: false, error: parsed.error };
      if (!res.ok || !json.ok) {
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
          {loadError || "图片草稿状态加载中..."}
        </p>
      </section>
    );
  }

  const isComposition = state.mode === "composition_concept";
  // Visual Reference Gate（§32-35）：白底主图/产品细节特写/包装套装要求已确认商品参考图
  const REQUIRES_REFERENCE_PURPOSES = new Set(["white_studio", "detail_closeup", "packaging_bundle"]);
  const purposeRequiresReference = REQUIRES_REFERENCE_PURPOSES.has(creativeIntent.primaryImagePurpose);
  const hasApprovedReference = state.approvedVisualReferenceSummary.length > 0;
  const referenceGateBlocked = purposeRequiresReference && !hasApprovedReference;
  const generateDisabled = !state.canGenerate
    || submitting
    || state.imageStatus === "revoked"
    || state.imageStatus === "invalid"
    || referenceGateBlocked
    || (creativeIntent.primaryImagePurpose === "custom" && !creativeIntent.customImagePurpose.trim());

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

      <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm leading-6 text-sky-800" data-testid="image-composition-notice">
        <p className="font-bold">{isComposition ? "概念创作模式" : "参考图创作模式"}</p>
        <p className="mt-1">
          {isComposition
            ? "当前没有已确认商品参考图。生成结果用于构图、场景和视觉方向参考，不代表真实商品外观。"
            : "将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。"}
        </p>
        {isComposition && state.approvedVisualReferenceSummary.length === 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-800"
                onClick={() => router.push(`/tasks/${encodeURIComponent(taskId)}#creative-materials`)}
              >
                补充参考图
              </button>
              <button
                type="button"
                className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-800"
                onClick={() => {
                  if (window.confirm("切换到独立创作后，不再使用当前研究记录作为权威资料，并需要重新确认手动输入。是否继续？")) {
                    router.push("/image-studio");
                  }
                }}
              >
                转为独立创作
              </button>
            </div>
        ) : null}

        {/* Visual Reference Gate（§32-35）：无已确认参考图时，白底主图/细节特写/包装套装不可生成 */}
        {referenceGateBlocked ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800" data-testid="visual-reference-gate-blocked">
            <p className="font-bold">
              {creativeIntent.primaryImagePurpose === "white_studio"
                ? "白底商品图需要先确认商品参考图。"
                : creativeIntent.primaryImagePurpose === "detail_closeup"
                  ? "产品细节特写需要已确认的商品参考图。"
                  : "包装/套装展示需要已确认的商品参考图或包装事实。"}
            </p>
            <p className="mt-1">
              确认后，生图会以这张图片作为当前商品的外观参考，尽量保持商品主体，仅改变背景、场景和构图（不代表像素级完全一致）。
              请先在「创作资料 → 商品参考图」中批准参考图；未确认前不执行真实生图。
            </p>
            <button
              type="button"
              className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800"
              onClick={() => {
                document.getElementById("task-visual-reference-fieldset")?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              确认商品参考图
            </button>
          </div>
        ) : null}
      </div>

      {/* 无 Handoff / legacy */}
      {state.imageStatus === "legacy_unbound" ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          历史图片草稿未绑定已确认的创作资料。草稿只读保留，请基于当前资料重新生成。
        </div>
      ) : null}

      {state.imageStatus === "revoked" ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800" data-testid="image-revoked-notice">
          对应创作资料已撤回。生成按钮已禁用，历史草稿保留。
        </div>
      ) : null}

      {state.imageStatus === "stale" ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800" data-testid="image-stale-notice">
          该图片草稿基于旧版创作资料。草稿只读保留，请基于最新资料重新生成。
        </div>
      ) : null}

      {state.canGenerate ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700">
              创作资料已确认
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              模式：{modeLabel(state.mode)}
              {isComposition ? "（不生成真实商品外观）" : "（基于批准视觉参考）"}
            </p>
          </div>
          <div>
            <label htmlFor="task-image-creative-description" className="text-sm font-bold text-slate-800">
              创作描述
            </label>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              系统已根据本次研究资料整理了一版图片创作描述，你可以修改后再生成。
            </p>
            <textarea
              id="task-image-creative-description"
              name="userCreativeDescription"
              value={userCreativeDescription}
              maxLength={1200}
              rows={5}
              onChange={(event) => {
                setUserCreativeDescription(event.target.value);
                setDescriptionDirty(true);
              }}
              disabled={submitting}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:opacity-60"
            />
          </div>
          <div>
            <ImageScenePresetPicker
              name="task-image-creative-intent"
              value={creativeIntent}
              onChange={(nextCreativeIntent) => {
                setCreativeIntent(nextCreativeIntent);
                if (state.creativeDescriptionContext && !descriptionDirty) {
                  setUserCreativeDescription(buildTaskImageCreativeDescription(
                    state.creativeDescriptionContext,
                    nextCreativeIntent.primaryImagePurpose,
                    nextCreativeIntent.lifestyleScene,
                    nextCreativeIntent.customImagePurpose,
                  ));
                }
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generateDisabled}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-cyan-600 px-4 text-sm font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="image-handoff-generate"
          >
            {submitting ? "正在生成图片..." : "生成图片"}
          </button>
          <label className="text-sm font-semibold text-slate-700">
            候选数量
            <select
              className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-2"
              value={candidateCount}
              onChange={(event) => setCandidateCount(event.target.value === "1" ? 1 : 2)}
              disabled={submitting}
            >
              <option value={1}>1 张</option>
              <option value={2}>2 张</option>
            </select>
          </label>
          </div>
        </div>
      ) : null}

      {state.candidates.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2" data-testid="task-image-candidates">
          {state.candidates.map((candidate, index) => candidate.id ? (
            <article
              key={candidate.id}
              className={`space-y-3 rounded-2xl border p-3 ${
                state.selectedImageId === candidate.id
                  ? "border-teal-400 bg-teal-50/40"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>候选图 {index + 1} · {modeLabel(candidate.mode)}</span>
                <span>{formatTime(candidate.generatedAt)}</span>
              </div>
              <DraftImagePreview taskId={taskId} draftId={candidate.id} />
              {candidate.compositionSummary ? (
                <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                  {candidate.compositionSummary}
                </p>
              ) : null}
              {candidate.approvedReferenceFingerprint ? (
                <p className="text-sm font-semibold text-teal-700">已基于你批准的视觉参考生成。</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const win = window.open("", "_blank");
                    if (!win) return;
                    win.document.write("<p>正在加载图片…</p>");
                    void fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft/${encodeURIComponent(candidate.id!)}`, {
                      headers: buildAccessHeaders(), cache: "no-store",
                    }).then((response) => {
                      if (!response.ok) throw new Error("IMAGE_LOAD_FAILED");
                      return response.blob();
                    }).then((blob) => {
                      const url = URL.createObjectURL(blob);
                      win.location.href = url;
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    }).catch(() => { win.document.body.innerHTML = "<p>图片加载失败，请刷新后重试。</p>"; });
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  查看大图
                </button>
                <button
                  type="button"
                  onClick={() => downloadDraftImage(taskId, candidate.id!, candidate.mode === "composition_concept" ? `composition-${index + 1}` : `product-visual-${index + 1}`)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (candidate.mode === "composition_concept") {
                      // V3 Final Freeze：构图概念不进入正式选择（服务端 PATCH gate 同样拒绝）；
                      // 按钮保留仅为提示构图/场景/视觉方向参考语义。
                      setNotice({ tone: "info", text: "构图概念仅用于构图/场景/视觉方向参考，不代表真实商品外观，不能作为正式商品图。" });
                      return;
                    }
                    void handleSelect(candidate.id!);
                  }}
                  disabled={submitting || state.selectedImageId === candidate.id}
                  title={candidate.mode === "composition_concept"
                    ? "构图概念仅用于构图/场景/视觉方向参考，不代表真实商品外观，不能作为正式商品图。"
                    : "已基于批准的商品参考图生成，仍需人工核对商品外观。"}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-teal-600 px-3 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {candidate.mode === "composition_concept" ? "作为构图参考" : (state.selectedImageId === candidate.id ? "已选择" : "选择此图")}
                </button>
              </div>
            </article>
          ) : null)}
        </div>
      ) : null}

      {/* V3 Final Freeze：历史草稿区（旧版创作资料/历史异常/旧构图概念）——折叠弱化、不可正式选择 */}
      {state.draftHistory && state.draftHistory.some((entry) => !entry.inCurrentCandidates) ? (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-3" data-testid="task-image-history-drafts">
          <summary className="cursor-pointer text-sm font-bold text-slate-600">
            历史草稿（{state.draftHistory.filter((entry) => !entry.inCurrentCandidates).length} 项 · 旧版创作资料，仅保留用于问题追踪）
          </summary>
          <div className="mt-3 space-y-3">
            {state.draftHistory
              .filter((entry) => !entry.inCurrentCandidates)
              .map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-3 rounded-xl border p-3 ${
                    entry.classification === "invalid_product_identity"
                      ? "border-rose-200 bg-rose-50/40"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="w-24 shrink-0">
                    <DraftImagePreview taskId={taskId} draftId={entry.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      <span className={`rounded-full px-2 py-0.5 ${
                        entry.classification === "invalid_product_identity"
                          ? "bg-rose-100 text-rose-700"
                          : entry.classification === "composition_concept"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-500"
                      }`}>
                        {entry.classification === "invalid_product_identity"
                          ? "历史异常 · 商品身份错误"
                          : entry.classification === "composition_concept"
                            ? "构图概念"
                            : "历史草稿"}
                      </span>
                      <span className="text-slate-400">{formatTime(entry.generatedAt)}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      {entry.classification === "invalid_product_identity"
                        ? "历史异常结果（商品身份错误），仅保留用于问题追踪，不能作为正式商品图。"
                        : entry.classification === "composition_concept"
                          ? "构图概念，仅用于构图参考，不代表真实商品外观，不能作为正式商品图。"
                          : "旧版创作资料生成的历史草稿，不能作为正式商品图。"}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </details>
      ) : null}

      {notice ? (
        <p className={`mt-3 text-sm font-semibold ${notice.tone === "error" ? "text-rose-600" : "text-teal-700"}`}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
