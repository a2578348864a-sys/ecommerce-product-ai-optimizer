"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAccessHeaders, updateDemoAccessSnapshot, type DemoAccessInfo } from "@/lib/client/accessToken";
import { createBrowserUuid } from "@/lib/browserUuid";
import { useRouter } from "next/navigation";
import { ImageScenePresetPicker } from "@/components/image-studio/ImageScenePresetPicker";
import { ImageStylePresetPicker } from "@/components/image-studio/ImageStylePresetPicker";
import {
  DEFAULT_IMAGE_STYLE_PRESET_ID,
  imageStylePresetLabel,
  isImageStylePresetId,
  recommendedImageStylePreset,
  type ImageStylePresetId,
} from "@/lib/imageStyleLibrary";
import {
  buildTaskImageCreativeDescription,
  type TaskImageCreativeDescriptionContext,
} from "@/lib/imageCreativeDescription";
import { readJsonApiResponse } from "@/lib/client/safeApiResponse";
import { studioErrorMessage } from "@/lib/client/studioErrorMessage";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import {
  DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  lifestyleSceneLabel,
  primaryPurposeLabel,
  type StudioImageCreativeIntent,
} from "@/lib/studioImageCreativeIntent";
import { evaluatePurposeRequirements } from "@/lib/imageHandoff/purposeRequirements";
import { resolveSlotRecipe } from "@/lib/imageHandoff/slotPromptRecipes";
import { VisualAssetPlanCard } from "@/components/image-handoff/VisualAssetPlanCard";
import {
  VisualGenerationBriefCard,
  factKindLabel,
  factSatisfiesRequiredKind,
  selectPreviewFacts,
  type VisualGenerationPreview,
} from "@/components/image-handoff/VisualGenerationBriefCard";
import {
  buildVisualAssetPlan,
  type VisualAssetSlot,
  type VisualAssetSlotType,
} from "@/lib/imageHandoff/visualAssetPlan";

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
  /**
   * V2.1 候选级生成依据（服务端安全投影；hash 只给前缀）。
   * 历史草稿缺这些字段 → 显示「历史生成记录」，不伪造版本。
   */
  slotRecipeId?: string | null;
  recipeVersion?: string | null;
  stylePresetId?: string | null;
  planVersion?: string | null;
  promptHashPrefix?: string | null;
  referenceImageContentHashPrefix?: string | null;
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
  /** Image Style Library V1：主链视觉方向（与独立工具共享同一注册表）。 */
  stylePresetId?: ImageStylePresetId;
  /**
   * V2.1.4 状态持久化补齐：视觉主题卡（槽位）的选中态。
   * 此前只保存 purpose/style，未保存槽位 id/type —— 点「应用此槽位」后刷新，高亮会消失
   * （功能效果仍在，因为 purpose 已被持久化，但用户看到的是"我选的主题没了"）。
   */
  activeSlotId?: string | null;
  activeSlotType?: string | null;
};

const EMPTY_TASK_IMAGE_CREATIVE_DRAFT: TaskImageCreativeDraft = {
  ...DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  // 主链默认视觉方向：共享注册表的默认预设（用户可改，且永不改变已确认事实）。
  stylePresetId: DEFAULT_IMAGE_STYLE_PRESET_ID,
  userCreativeDescription: "",
  descriptionDirty: false,
  activeSlotId: null,
  activeSlotType: null,
};

/**
 * 生成前预览所需的事实投影（canonical 字段名与服务端事实门禁同源）。
 * `field` 缺失（历史 DTO）时保留空串，由 UI 按「资料不足」显示缺口，绝不用 label 猜测放行。
 */
type HandoffFactForGate = { field: string; label: string; value: string };

/**
 * Recipe 生成前预览字段（并行契约，字段名已冻结）：
 * `buyerQuestion` / `textAllowed` / `backgroundPolicy` / `requiredFactKinds`。
 * 这些字段由另一个 Agent 落地；这里用窄类型读取 + 兜底，保证字段尚未出现时 UI 不崩、
 * 不显示 undefined，也不因对方实现进度而编译失败。
 */
type RecipePreviewFields = {
  buyerQuestion?: string;
  textAllowed?: boolean;
  backgroundPolicy?: string;
  requiredFactKinds?: readonly string[];
};

/** 商品身份可见性：只按 canonical field 取已确认事实；缺失即「未确认」，绝不猜测填充。 */
const BRIEF_IDENTITY_FACT_KEYS = [
  { key: "brand", label: "品牌" },
  { key: "series_or_model", label: "系列或型号" },
  { key: "color_or_variant", label: "颜色或款式" },
  { key: "quantity_or_pack_size", label: "数量或包装" },
] as const;

/**
 * 槽位类型解析：生成请求与生成前预览共用同一份判据，保持既有 POST 请求体取值不变。
 */
function resolveRequestSlotType(intent: StudioImageCreativeIntent): VisualAssetSlotType {
  if (intent.primaryImagePurpose === "white_studio") return "main_white_studio";
  if (intent.primaryImagePurpose === "dimension_specification") return "dimension_specs";
  if (intent.primaryImagePurpose === "detail_closeup") return "detail_closeup";
  if (intent.primaryImagePurpose === "packaging_bundle") return "packaging_bundle";
  if (intent.primaryImagePurpose === "usage_steps") return "usage_steps";
  if (intent.lifestyleScene && intent.lifestyleScene !== "none") return "lifestyle_in_use";
  return "selling_points";
}

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

function formatCompositionSummary(summary?: string | null): string {
  if (!summary) return "";
  const s = summary.trim();
  if (s.startsWith("Product visual draft derived strictly from the approved visual reference")) {
    return "已基于批准的视觉参考生成，严格锁定商品真实外观与关键特征。";
  }
  if (s.startsWith("Abstract composition concept")) {
    return "构图概念草稿：用于探索画面背景方向、场景氛围与留白布局。";
  }
  if (s.startsWith("Real product photo with exact colour")) {
    return "商品真实照片：严格展示真实颜色与材质细节。";
  }
  return s;
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
  const [stylePresetId, setStylePresetId] = useState<ImageStylePresetId>(DEFAULT_IMAGE_STYLE_PRESET_ID);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [activeSlotType, setActiveSlotType] = useState<VisualAssetSlotType | null>(null);
  const [userCreativeDescription, setUserCreativeDescription] = useState("");
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const seededDescriptionKeyRef = useRef("");
  const handledRevisionRef = useRef<string | null>(null);
  const sessionDraft = useSessionDraft<TaskImageCreativeDraft>({
    pageKind: "image-studio-task",
    entityId: taskId,
    revision: state?.expectedHandoffRevision == null
      ? null
      : String(state.expectedHandoffRevision),
    initial: EMPTY_TASK_IMAGE_CREATIVE_DRAFT,
  });

  // handoff revision 变化时重置播种守卫。恢复是否完成由 useSessionDraft.ready
  // 决定，避免异步 loadState 返回时把用户草稿重新覆盖成默认值。
  useEffect(() => {
    const revision = state?.expectedHandoffRevision == null
      ? null
      : String(state.expectedHandoffRevision);
    if (revision === null || handledRevisionRef.current === revision) return;
    handledRevisionRef.current = revision;
    seededDescriptionKeyRef.current = "";
  }, [state?.expectedHandoffRevision]);

  useEffect(() => {
    if (!sessionDraft.ready || !sessionDraft.draft) return;
    setCreativeIntent({
      primaryImagePurpose: sessionDraft.draft.primaryImagePurpose,
      lifestyleScene: sessionDraft.draft.lifestyleScene,
      customImagePurpose: sessionDraft.draft.customImagePurpose,
    });
    if (isImageStylePresetId(sessionDraft.draft.stylePresetId)) {
      setStylePresetId(sessionDraft.draft.stylePresetId);
    }
    // V2.1.4：恢复槽位选中态（主题卡高亮）
    setActiveSlotId(typeof sessionDraft.draft.activeSlotId === "string" ? sessionDraft.draft.activeSlotId : null);
    setActiveSlotType(
      typeof sessionDraft.draft.activeSlotType === "string"
        ? (sessionDraft.draft.activeSlotType as VisualAssetSlotType)
        : null,
    );
    setUserCreativeDescription(sessionDraft.draft.userCreativeDescription);
    setDescriptionDirty(sessionDraft.draft.descriptionDirty === true);
  }, [sessionDraft.draft, sessionDraft.ready]);

  useEffect(() => {
    const context = state?.creativeDescriptionContext;
    if (!context || !sessionDraft.ready || sessionDraft.restored) return;
    const suggestedIntent = context.suggestedCreativeIntent ?? DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT;
    const seedKey = JSON.stringify({
      revision: state.expectedHandoffRevision,
      context,
    });
    if (seededDescriptionKeyRef.current === seedKey) return;
    seededDescriptionKeyRef.current = seedKey;
    setCreativeIntent(suggestedIntent);
    setDescriptionDirty(false);
    setUserCreativeDescription(buildTaskImageCreativeDescription(
      context,
      suggestedIntent.primaryImagePurpose,
      suggestedIntent.lifestyleScene,
      suggestedIntent.customImagePurpose,
    ));
  }, [sessionDraft.ready, sessionDraft.restored, state]);

  useEffect(() => {
    if (state?.expectedHandoffRevision == null) return;
    sessionDraft.save({
      ...creativeIntent,
      stylePresetId,
      userCreativeDescription,
      descriptionDirty,
      // V2.1.4：槽位选中态一并持久化
      activeSlotId,
      activeSlotType,
    });
  }, [
    activeSlotId,
    activeSlotType,
    creativeIntent,
    descriptionDirty,
    sessionDraft,
    state?.expectedHandoffRevision,
    stylePresetId,
    userCreativeDescription,
  ]);

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
    const resolvedSlotType = activeSlotType ?? resolveRequestSlotType(creativeIntent);
    const body = {
      requestId: requestKey,
      expectedStorageVersion: state.storageVersion,
      expectedHandoffRevision: state.expectedHandoffRevision,
      mode: state.mode,
      count: candidateCount,
      slotType: resolvedSlotType,
      // 该 Route 用严格字段白名单校验请求体：这里逐字段列举，绝不整体展开共享意图对象，
      // 否则 Studio 专属维度（如 stylePresetId）会以 unknown_field 被拒。
      primaryImagePurpose: creativeIntent.primaryImagePurpose,
      lifestyleScene: creativeIntent.lifestyleScene,
      customImagePurpose: creativeIntent.customImagePurpose,
      // 共享风格注册表的预设 id（服务端会再次校验；缺失时保持旧请求形状）。
      stylePresetId,
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
        if (json && typeof json === "object" && "demoAccess" in json) {
          updateDemoAccessSnapshot((json as { demoAccess: DemoAccessInfo }).demoAccess);
        }
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
      if ("demoAccess" in json && json.demoAccess) {
        updateDemoAccessSnapshot((json as { demoAccess: DemoAccessInfo }).demoAccess);
      }
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
  // V3.5 canonical 事实投影（前后端事实门禁同源）：DTO 已带 canonical `field`，
  // 直接透传，绝不再伪造空字段；历史数据缺 `field` 时保留空串，由门禁按「资料不足」处理。
  // 下面的 Purpose 门禁与视觉资产规划共用同一份投影，避免两处判定漂移。
  const handoffFacts: HandoffFactForGate[] = (state.creativeDescriptionContext?.confirmedFacts ?? [])
    .map((fact) => ({
      field: typeof fact.field === "string" ? fact.field : "",
      label: fact.label,
      value: String(fact.value ?? ""),
    }));

  // V3 Creative Intent Propagation：Purpose 要求证据 gate（前端与服务端共享同一规则；不静默降级）
  const purposeGate = evaluatePurposeRequirements(
    creativeIntent.primaryImagePurpose,
    handoffFacts,
  );

  const visualAssetPlan = state
    ? buildVisualAssetPlan({
        facts: handoffFacts,
        hasApprovedVisualReference: state.approvedVisualReferenceSummary.length > 0,
        productName: state.creativeDescriptionContext?.productName,
      })
    : null;

  const handleSelectSlot = (slot: VisualAssetSlot) => {
    setActiveSlotId(slot.slotId);
    setActiveSlotType(slot.slotType);
    setCreativeIntent({
      primaryImagePurpose: slot.suggestedPurpose,
      lifestyleScene: slot.suggestedScene,
      customImagePurpose: "",
    });
    setStylePresetId(slot.suggestedStylePresetId);
    if (!state?.creativeDescriptionContext) return;
    // V2.1.1 修复：用户已编辑过创作描述时**绝不静默替换**。
    // 旧行为：点主题会无条件用系统生成的描述覆盖用户输入，并清掉 dirty 标记 ——
    // 用户会以为"我改了却没生效"。现在保留用户内容，并给出可见提示（不静默）。
    if (descriptionDirty) {
      setNotice({ tone: "info", text: "已切换视觉主题；你编辑过的创作描述已保留。" });
      return;
    }
    setUserCreativeDescription(
      buildTaskImageCreativeDescription(
        state.creativeDescriptionContext,
        slot.suggestedPurpose,
        slot.suggestedScene,
        "",
      ),
    );
    setDescriptionDirty(false);
  };

  const currentSlot = activeSlotId
    ? visualAssetPlan?.slots.find((s) => s.slotId === activeSlotId)
    : visualAssetPlan?.slots.find((s) => s.suggestedPurpose === creativeIntent.primaryImagePurpose) ?? visualAssetPlan?.slots[0];

  // 槽位就绪度校正（与服务端同源，收口成同一个对外结论）：
  // 规划层把「真实生活使用场景图」等槽位标记为 ready，但其 suggestedPurpose 在缺少对应事实时
  // 会被服务端 Purpose 门禁阻断（前端此前显示「就绪」→ 点下去生成按钮是灰的且看不到原因）。
  // 这里用与上方 purposeGate 完全相同的 `handoffFacts` 逐槽位复算，UI 只有在两者都通过时才说「就绪」。
  const slotGates: Record<string, { ok: boolean; message?: string }> = {};
  for (const slot of visualAssetPlan?.slots ?? []) {
    const slotGate = evaluatePurposeRequirements(slot.suggestedPurpose, handoffFacts);
    slotGates[slot.slotId] = slotGate.ok ? { ok: true } : { ok: false, message: slotGate.message };
  }

  const allFacts = handoffFacts;
  // 槽位事实筛选：canonical field 优先匹配（与服务端门禁同源），label 匹配保留为历史兼容。
  const briefFacts = currentSlot && currentSlot.factRefs && currentSlot.factRefs.length > 0
    ? allFacts.filter((f) => currentSlot.factRefs.some((ref) => (
        (f.field !== "" && f.field === ref) || f.label.includes(ref) || ref.includes(f.label)
      )))
    : allFacts;
  const displayBriefFacts = briefFacts.length > 0 ? briefFacts : allFacts;

  const briefConstraints = [
    "保持商品真实物理外观，禁止篡改外形轮廓与核心部件",
    "严格依据已确认事实，禁止虚构未证实的功能或性能参数",
    creativeIntent.primaryImagePurpose === "white_studio"
      ? "Amazon 白底主图规范：纯白背景 (RGB 255,255,255)，无阴影杂物，无嵌入文字"
      : "生活场景搭配需符合日常真实使用情境，主体突出，不喧宾夺主",
  ];

  const briefReferenceNotice = {
    title: isComposition ? "概念创作模式" : "参考图创作模式",
    description: isComposition
      ? "当前没有已确认商品参考图。生成结果用于构图、场景和视觉方向参考，不代表真实商品外观。"
      : "将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。",
    isComposition,
  };

  const briefStrategy = {
    purposeLabel: primaryPurposeLabel(creativeIntent.primaryImagePurpose),
    sceneLabel: creativeIntent.primaryImagePurpose === "white_studio"
      ? "纯白背景无杂质"
      : lifestyleSceneLabel(creativeIntent.lifestyleScene),
    styleLabel: imageStylePresetLabel(stylePresetId),
    rationale: currentSlot?.rationale ?? "突出商品核心特征与真实质感",
  };

  const briefAssetTitle = currentSlot?.title ?? `${primaryPurposeLabel(creativeIntent.primaryImagePurpose)}素材`;
  const briefGoal = currentSlot
    ? `${currentSlot.purposeSummary} · ${currentSlot.rationale}`
    : "生成符合电商上架与转化规范的高质感视觉素材";

  // ── 生成前方案预览（8 项）──────────────────────────────────────────────
  // 数据全部来自已有 state 与共享 Recipe 解析：不新增 API、不新增请求。
  // Recipe 新字段（buyerQuestion / textAllowed / backgroundPolicy / requiredFactKinds）用窄类型读取并兜底，
  // 另一个 Agent 尚未落地时同样不崩、不显示 undefined。
  const requestSlotType = activeSlotType ?? resolveRequestSlotType(creativeIntent);
  const previewRecipe = resolveSlotRecipe({
    slotType: requestSlotType,
    primaryPurpose: creativeIntent.primaryImagePurpose,
    lifestyleScene: creativeIntent.lifestyleScene,
    stylePresetId,
  }) as ReturnType<typeof resolveSlotRecipe> & RecipePreviewFields;
  const requiredFactKinds = Array.isArray(previewRecipe.requiredFactKinds)
    ? previewRecipe.requiredFactKinds.filter((kind): kind is string => (
        typeof kind === "string" && kind.trim().length > 0
      ))
    : [];
  const buyerQuestion = typeof previewRecipe.buyerQuestion === "string"
    ? previewRecipe.buyerQuestion.trim()
    : "";
  const backgroundPolicy = typeof previewRecipe.backgroundPolicy === "string"
    ? previewRecipe.backgroundPolicy
    : "";
  const recipeTextPolicy = typeof previewRecipe.textPolicy === "string" ? previewRecipe.textPolicy : "";
  const textAllowed = typeof previewRecipe.textAllowed === "boolean" ? previewRecipe.textAllowed : null;
  // 事实使用范围：优先按 Recipe 的 canonical requiredFactKinds 筛选（与服务端门禁同源）；
  // 配方字段未就绪时回退到既有槽位 label 筛选，绝不显示 undefined。
  const factsUsed = requiredFactKinds.length > 0
    ? selectPreviewFacts(allFacts, requiredFactKinds)
    : displayBriefFacts;

  // 尚缺资料与可执行下一步：判据来自已有门禁结果、canonical 事实缺口与自定义用途校验。
  const previewGaps: VisualGenerationPreview["gaps"] = [];
  if (referenceGateBlocked) {
    previewGaps.push({
      label: "缺少已批准的商品参考图",
      nextStep: "请先在研究记录中确认商品参考图后再生成，或改用构图概念方向",
    });
  }
  if (!purposeGate.ok) {
    previewGaps.push({
      label: `${primaryPurposeLabel(creativeIntent.primaryImagePurpose)}所需事实尚未确认`,
      nextStep: `${purposeGate.message}请先在研究页确认相关事实后再生成，或改用其他图片用途。`,
    });
  } else {
    for (const kind of requiredFactKinds) {
      const confirmed = allFacts.some((fact) => factSatisfiesRequiredKind(fact, kind));
      if (confirmed) continue;
      const kindLabel = factKindLabel(kind);
      previewGaps.push({
        label: `缺少已确认${kindLabel}事实`,
        nextStep: `请先在研究页确认${kindLabel}后再生成`,
      });
    }
  }
  if (creativeIntent.primaryImagePurpose === "custom" && !creativeIntent.customImagePurpose.trim()) {
    previewGaps.push({
      label: "自定义图片用途尚未填写",
      nextStep: "请先填写自定义图片用途后再生成",
    });
  }

  const generationPreview: VisualGenerationPreview = {
    generationType: state.mode,
    productName: state.creativeDescriptionContext?.productName ?? "",
    approvedReferenceCount: state.approvedVisualReferenceSummary?.length ?? 0,
    identity: BRIEF_IDENTITY_FACT_KEYS.map(({ key, label }) => {
      const match = allFacts.find((fact) => fact.field === key && fact.value.trim().length > 0);
      return { key, label, value: match ? match.value.trim() : null };
    }),
    buyerQuestion,
    factsUsed,
    requiredFactKinds,
    composition: typeof previewRecipe.composition === "string" ? previewRecipe.composition : "",
    // 中文界面收口：构图方向直接显示槽位的中文规划说明（已有真源），
    // 英文配方原文仍在 preview.composition 里，收进折叠区仅供核对，不作为主展示。
    compositionLabel: (currentSlot?.purposeSummary ?? "").trim(),
    backgroundPolicy,
    styleLabel: briefStrategy.styleLabel,
    textAllowed,
    textPolicy: recipeTextPolicy,
    negativeConstraints: briefConstraints,
    gaps: previewGaps,
  };

  const generateDisabled = !state.canGenerate
    || submitting
    || state.imageStatus === "revoked"
    || state.imageStatus === "invalid"
    || referenceGateBlocked
    || !purposeGate.ok
    || (creativeIntent.primaryImagePurpose === "custom" && !creativeIntent.customImagePurpose.trim());

  // 展示收口：本页不再重复「商品创作流程」五步（研究页与文案工作台已展示同一流程，
  // 重复会让用户分不清主流程）。这里只陈述本页生成图片所依据的三项前提，
  // 判据全部来自服务端既有快照字段，不新增任何状态判断。
  const confirmedFactCount = state?.creativeDescriptionContext?.confirmedFacts.length ?? 0;
  const basisItems = [
    {
      key: "facts",
      label: "商品事实已确认",
      pendingLabel: "商品事实待确认",
      ready: confirmedFactCount > 0,
      detail: confirmedFactCount > 0 ? `${confirmedFactCount} 项` : "请先在研究页完成事实确认",
    },
    {
      key: "reference",
      label: "商品参考图已确认",
      pendingLabel: "商品参考图待确认",
      ready: (state?.approvedVisualReferenceSummary?.length ?? 0) > 0,
      detail: (state?.approvedVisualReferenceSummary?.length ?? 0) > 0
        ? "生成真实商品外观已解锁"
        : "未确认前只生成构图概念稿",
    },
    {
      key: "creative",
      label: "创作资料已准备",
      pendingLabel: "创作资料待准备",
      ready: state?.expectedHandoffRevision != null,
      detail: state?.expectedHandoffRevision != null ? "可生成图片候选" : "请先确认创作资料",
    },
  ];

  return (
    <section className="mt-4 rounded-2xl border border-cyan-200 bg-white p-4" data-testid="image-handoff-section">
      <div
        className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-3"
        data-testid="image-creation-basis"
      >
        <p className="text-xs font-bold text-slate-800">创作依据（来自研究结果）</p>
        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-700">
          {basisItems.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5" data-basis={item.key} data-ready={item.ready ? "true" : "false"}>
              <span className={item.ready ? "text-teal-600" : "text-slate-400"} aria-hidden="true">
                {item.ready ? "✓" : "○"}
              </span>
              <span className="font-semibold text-slate-800">{item.ready ? item.label : item.pendingLabel}</span>
              <span className="text-slate-500">· {item.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
          图片候选基于上述研究结果生成，不会改写商品事实；生成结果仍需人工复核。
        </p>
      </div>
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-950">图片创作设置</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="image-creation-compact-summary">
            <span>当前模式：<strong className="text-slate-800">{isComposition ? "构图概念" : "真实商品外观"}</strong></span>
            <span>·</span>
            <span>当前主题：<strong className="text-slate-800">{primaryPurposeLabel(creativeIntent.primaryImagePurpose)}</strong></span>
            <span>·</span>
            <span>人工审核：<strong className="text-slate-800">必须</strong></span>
          </div>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
          state.imageStatus === "active" || state.imageStatus === "concept_only"
            ? "border-teal-200 bg-teal-50 text-teal-700"
            : state.imageStatus === "stale" || state.imageStatus === "revoked" || state.imageStatus === "legacy_unbound"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
          {statusBadge(state.imageStatus)}
        </span>
      </div>

      {referenceGateBlocked ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="visual-reference-gate-blocked">
          <span>⚠ 生成真实商品外观前，请先确认商品参考图。</span>
          <button
            type="button"
            className="text-xs font-semibold text-teal-700 hover:underline"
            onClick={() => {
              document.getElementById("task-visual-reference-fieldset")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            确认商品参考图 ↑
          </button>
        </div>
      ) : !purposeGate.ok ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="purpose-gate-blocked">
          <p className="font-semibold">当前图片用途暂时无法生成。</p>
          <p className="mt-0.5">{purposeGate.message}</p>
        </div>
      ) : state.imageStatus === "stale" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="image-stale-notice">
          <span className="font-semibold">⚠ 当前草稿基于旧版资料</span>
          <span className="text-amber-700">请基于最新资料重新生成</span>
        </div>
      ) : state.imageStatus === "revoked" ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800" data-testid="image-revoked-notice">
          对应创作资料已撤回。生成按钮已禁用，历史草稿保留。
        </div>
      ) : state.imageStatus === "legacy_unbound" ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          历史图片草稿未绑定已确认的创作资料。草稿只读保留，请基于当前资料重新生成。
        </div>
      ) : state.canGenerate ? (
        <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50/50 p-2 text-xs text-teal-800">
          ✓ 创作资料已准备，可选择主题后生成。
        </div>
      ) : null}

      {state.canGenerate ? (
        <div className="mt-4 space-y-4">
          {visualAssetPlan ? (
            <VisualAssetPlanCard
              plan={visualAssetPlan}
              selectedSlotId={activeSlotId}
              onSelectSlot={handleSelectSlot}
              slotGates={slotGates}
            />
          ) : null}

          <div className="[&_fieldset>p]:hidden [&>div>p]:hidden">
            <ImageScenePresetPicker
              name="task-image-creative-intent"
              value={creativeIntent}
              onChange={(nextCreativeIntent) => {
                setActiveSlotId(null);
                setActiveSlotType(null);
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

          {/* Image Style Library V1：与独立工具共享同一份风格注册表；只改变视觉表达，
              不改变上方来自研究确认的商品身份、事实与参考图。 */}
          <div className="[&_fieldset>p]:hidden [&>div>p]:hidden">
            <ImageStylePresetPicker
              name="task-image-style-preset"
              value={stylePresetId}
              recommendedId={recommendedImageStylePreset(creativeIntent.primaryImagePurpose)}
              onChange={(nextStylePresetId) => setStylePresetId(nextStylePresetId)}
            />
          </div>

          {/* AI 视觉方案 (Visual Generation Brief) */}
          <VisualGenerationBriefCard
            mode="task"
            assetTitle={briefAssetTitle}
            categoryLabel={currentSlot?.categoryLabel}
            goal={briefGoal}
            facts={displayBriefFacts}
            strategy={briefStrategy}
            constraints={briefConstraints}
            referenceNotice={briefReferenceNotice}
            preview={generationPreview}
            customPromptSummary={
              descriptionDirty && userCreativeDescription
                ? userCreativeDescription.slice(0, 120) + (userCreativeDescription.length > 120 ? "..." : "")
                : undefined
            }
          />

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center text-sm font-semibold text-slate-700">
              候选数量
              <select
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                value={candidateCount}
                onChange={(event) => setCandidateCount(event.target.value === "1" ? 1 : 2)}
                disabled={submitting}
              >
                <option value={1}>1 张</option>
                <option value={2}>2 张</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generateDisabled}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-teal-600 px-5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="image-handoff-generate"
            >
              {submitting ? "正在生成图片..." : "生成图片"}
            </button>
          </div>
        </div>
      ) : null}

      {/* 创作描述与生成约束（默认折叠） */}
      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs" data-testid="image-creative-details">
        <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-700 hover:text-slate-900">
          <div className="flex items-center gap-2">
            <span>查看 / 调整创作描述与生成约束</span>
            <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-normal text-slate-600">提示词 · 模式 · 安全说明</span>
          </div>
          <span className="text-xs font-normal text-teal-700">展开详情 ↓</span>
        </summary>
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
          <div>
            <label htmlFor="task-image-creative-description" className="block text-xs font-bold text-slate-800">
              创作描述
            </label>
            <p className="mt-1 text-xs text-slate-500">
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
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1.5" data-testid="image-composition-notice">
            <p className="font-bold text-slate-800">
              {isComposition ? "概念创作模式" : "参考图创作模式"}
            </p>
            <p>
              {isComposition
                ? "当前没有已确认商品参考图。生成结果用于构图、场景和视觉方向参考，不代表真实商品外观。"
                : "将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。"}
            </p>
            <p className="text-slate-500">
              这是 AI 辅助图片草稿，不是最终上架图片。请人工复核构图、商品外观、认证标识和平台规则。系统不会自动上架，也不会承诺收益或销量表现。
            </p>
            <p className="text-slate-500">
              白底主图要求干净背景，因此不使用生活方式场景。切换到其他图片用途后即可选择。
            </p>
            <p className="text-slate-500">
              未批准商品参考图时，图片用途与场景只表示构图方向，不代表真实商品外观。
            </p>
            {isComposition && state.approvedVisualReferenceSummary.length === 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => router.push(`/tasks/${encodeURIComponent(taskId)}#creative-materials`)}
                >
                  补充参考图
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
          </div>
        </div>
      </details>

      {state.candidates.length > 0 ? (
        <div
          className={`mt-5 ${
            state.candidates.length === 1
              ? "mx-auto max-w-2xl w-full"
              : state.candidates.length === 2
                ? "grid gap-5 md:grid-cols-2"
                : "grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          }`}
          data-testid="task-image-candidates"
        >
          {state.candidates.map((candidate, index) => candidate.id ? (
            <article
              key={candidate.id}
              className={`flex flex-col justify-between space-y-3.5 rounded-2xl border p-4 shadow-sm transition ${
                state.selectedImageId === candidate.id
                  ? "border-teal-500 bg-teal-50/40 ring-1 ring-teal-500"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-700">
                      0{index + 1}
                    </span>
                    <span className="text-slate-900 font-bold">候选方案 {index + 1}</span>
                    <span className="text-slate-400">·</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                      {modeLabel(candidate.mode)}
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-400">{formatTime(candidate.generatedAt)}</span>
                </div>

                <DraftImagePreview taskId={taskId} draftId={candidate.id} />

                {candidate.compositionSummary ? (
                  <p className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-700">
                    {formatCompositionSummary(candidate.compositionSummary)}
                  </p>
                ) : null}

                {candidate.approvedReferenceFingerprint ? (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-teal-700">
                    <span className="inline-block h-2 w-2 rounded-full bg-teal-500" />
                    <span>已基于批准的视觉参考生成</span>
                  </div>
                ) : null}

                {/* V2.1 生成依据（只展示安全投影：槽位/配方版本/风格/计划版本 + hash 前缀；绝不展示原始 Prompt） */}
                <div
                  className="rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-500"
                  data-testid="candidate-trace"
                  data-has-trace={candidate.slotRecipeId || candidate.recipeVersion ? "true" : "false"}
                >
                  {candidate.slotRecipeId || candidate.recipeVersion ? (
                    <div className="space-y-0.5">
                      <div>
                        生成依据：槽位 <span className="text-slate-700">{candidate.slotRecipeId ?? "—"}</span>
                        {candidate.recipeVersion ? <> · 配方版本 <span className="text-slate-700">{candidate.recipeVersion}</span></> : null}
                        {candidate.stylePresetId ? <> · 风格 <span className="text-slate-700">{candidate.stylePresetId}</span></> : null}
                      </div>
                      {candidate.planVersion ? <div>计划版本：{candidate.planVersion}</div> : null}
                      {candidate.promptHashPrefix ? <div>实发提示词指纹：{candidate.promptHashPrefix}…</div> : null}
                      {candidate.referenceImageContentHashPrefix ? <div>参考图内容指纹：{candidate.referenceImageContentHashPrefix}…</div> : null}
                    </div>
                  ) : (
                    <div>历史生成记录（该版本尚未记录生成依据）</div>
                  )}
                </div>

                {/* 候选方案三要素：推荐用途 · 适用原因 · 必要限制 */}
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 text-xs space-y-1.5 shadow-2xs">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
                      推荐用途
                    </span>
                    <span className="text-slate-700 font-medium leading-relaxed">
                      {candidate.mode === "product_visual_draft"
                        ? "Amazon Listing 场景副图 / A+ 详情页重点展示"
                        : "视觉构图、光影背景与留白布局探索"}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                      适用原因
                    </span>
                    <span className="text-slate-600 leading-relaxed">
                      {candidate.mode === "product_visual_draft"
                        ? "严格锁定已批准参考图的外观特征与物理材质，杜绝模型幻觉"
                        : "在无参考图时快速预演生活场景与构图搭配，指导后续拍摄"}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      必要限制
                    </span>
                    <span className="text-slate-600 leading-relaxed">
                      {candidate.mode === "product_visual_draft"
                        ? "上线前必须人工复核关键文字、Logo 与细节一致性"
                        : "构图概念不代表真实商品外观，不可直接用于正式主图上架"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
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
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  查看大图
                </button>
                <button
                  type="button"
                  onClick={() => downloadDraftImage(taskId, candidate.id!, candidate.mode === "composition_concept" ? `composition-${index + 1}` : `product-visual-${index + 1}`)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
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
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-teal-600 px-3.5 text-xs font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60 shadow-2xs ml-auto"
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
