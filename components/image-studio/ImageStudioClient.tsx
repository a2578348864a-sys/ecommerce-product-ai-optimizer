"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  buildAccessHeaders,
  isAuthenticated,
  updateDemoAccessSnapshot,
  type DemoAccessInfo,
} from "@/lib/client/accessToken";
import {
  getOrCreateStudioAttempt,
  shouldRetainStudioAttempt,
  type StudioAttempt,
} from "@/lib/client/studioIdempotency";
import {
  buildStudioImageRequestCore,
  EMPTY_IMAGE_INTENT,
  EMPTY_PROMPT_IMAGE_INTENT,
  STUDIO_IMAGE_PROMPT_TEMPLATES,
  type ImageFormIntent,
  type PromptImageFormIntent,
} from "@/lib/client/studioImageRequest";
import {
  ImageResultWorkspace,
  type ImageStudioData,
} from "@/components/image-studio/ImageResultWorkspace";
import styles from "./ImageStudioPolish.module.css";
import { createBrowserUuid } from "@/lib/browserUuid";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import { TaskStudioPreparation } from "@/components/studio/TaskStudioPreparation";
import { ImageHandoffSection } from "@/components/image-handoff/ImageHandoffSection";
import { studioApiErrorCode, studioErrorMessage } from "@/lib/client/studioErrorMessage";
import { ImageScenePresetPicker } from "@/components/image-studio/ImageScenePresetPicker";
import { StudioProgressRail } from "@/components/studio/StudioProgressRail";
import { deriveImageStudioProgress } from "@/lib/client/studioProgress";
import { readJsonApiResponse } from "@/lib/client/safeApiResponse";

type StudioMode = "mock" | "real";

function apiErrorCode(json: unknown): string | null {
  return studioApiErrorCode(json);
}

function errorMessage(json: unknown, fallback: string): string {
  return studioErrorMessage(json, fallback);
}

type ManualImageDraft = {
  productName: string;
  description: string;
  creationMode: "guided" | "prompt";
  intent: ImageFormIntent;
  promptIntent: PromptImageFormIntent;
  selectedIndices: number[];
  factsConfirmed: boolean;
};

const EMPTY_MANUAL_IMAGE_DRAFT: ManualImageDraft = {
  productName: "",
  description: "",
  creationMode: "guided",
  intent: EMPTY_IMAGE_INTENT,
  promptIntent: EMPTY_PROMPT_IMAGE_INTENT,
  selectedIndices: [],
  factsConfirmed: false,
};

export function ImageStudioClient({ taskId = "" }: { taskId?: string }) {
  const [progressInput, setProgressInput] = useState({
    briefReady: false,
    strategyReady: false,
    isGenerating: false,
    candidateCount: 0,
    selectedImageId: null as string | null,
  });
  const handleTaskReady = useCallback((briefReady: boolean) => {
    setProgressInput((current) => ({ ...current, briefReady }));
  }, []);
  const handleTaskProgress = useCallback((state: {
    strategyReady: boolean;
    isGenerating: boolean;
    candidateCount: number;
    selectedImageId: string | null;
  }) => setProgressInput((current) => ({ ...current, ...state })), []);
  const handleManualProgress = useCallback((state: {
    briefReady: boolean;
    strategyReady: boolean;
    isGenerating: boolean;
    candidateCount: number;
    selectedImageId: string | null;
  }) => setProgressInput(state), []);
  const progressRail = (
    <StudioProgressRail
      label="图片制作进度"
      steps={deriveImageStudioProgress(progressInput)}
    />
  );

  if (taskId) {
    return (
      <>
        {progressRail}
        <TaskStudioPreparation taskId={taskId} kind="image" onReadyChange={handleTaskReady}>
          <div className="surface-card p-4" data-testid="image-studio-task-mode">
            <ImageHandoffSection taskId={taskId} onProgressChange={handleTaskProgress} />
          </div>
        </TaskStudioPreparation>
      </>
    );
  }
  return <>{progressRail}<ManualImageStudioClient onProgressChange={handleManualProgress} /></>;
}

function ManualImageStudioClient({ onProgressChange }: {
  onProgressChange: (state: {
    briefReady: boolean;
    strategyReady: boolean;
    isGenerating: boolean;
    candidateCount: number;
    selectedImageId: string | null;
  }) => void;
}) {
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [creationMode, setCreationMode] = useState<"guided" | "prompt">("guided");
  const [intent, setIntent] = useState<ImageFormIntent>(EMPTY_IMAGE_INTENT);
  const [promptIntent, setPromptIntent] = useState<PromptImageFormIntent>(EMPTY_PROMPT_IMAGE_INTENT);
  const [mode, setMode] = useState<StudioMode>("mock");
  const [realConfirmed, setRealConfirmed] = useState(false);
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState("");
  const [referenceImageName, setReferenceImageName] = useState("");
  const [referenceImageApproved, setReferenceImageApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImageStudioData | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const realAttemptRef = useRef<StudioAttempt | null>(null);
  const restoredDraftRef = useRef(false);
  const sessionDraft = useSessionDraft<ManualImageDraft>({
    pageKind: "image-studio-manual",
    entityId: "manual",
    revision: "studio-creative-brief.v1",
    initial: EMPTY_MANUAL_IMAGE_DRAFT,
  });

  useEffect(() => setAuthenticated(isAuthenticated()), []);
  useEffect(() => {
    if (!sessionDraft.draft || restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    setProductName(sessionDraft.draft.productName);
    setDescription(sessionDraft.draft.description);
    setCreationMode(sessionDraft.draft.creationMode);
    setIntent({ ...EMPTY_IMAGE_INTENT, ...sessionDraft.draft.intent });
    setPromptIntent({ ...EMPTY_PROMPT_IMAGE_INTENT, ...sessionDraft.draft.promptIntent });
    setSelectedIndices(sessionDraft.draft.selectedIndices ?? []);
    setFactsConfirmed(sessionDraft.draft.factsConfirmed === true);
  }, [sessionDraft.draft]);

  useEffect(() => {
    sessionDraft.save({
      productName,
      description,
      creationMode,
      intent,
      promptIntent,
      selectedIndices,
      factsConfirmed,
    });
  }, [productName, description, creationMode, intent, promptIntent, selectedIndices, factsConfirmed, sessionDraft]);

  const activeIntent = creationMode === "guided" ? intent : promptIntent;
  const hasRequiredCreativeInput = creationMode === "guided"
    ? productName.trim().length > 0
      && (intent.primaryImagePurpose !== "custom" || intent.customImagePurpose.trim().length > 0)
    : promptIntent.creativePrompt.trim().length > 0;
  const canGenerate = authenticated
    && hasRequiredCreativeInput
    && factsConfirmed
    && (!referenceImageDataUrl || referenceImageApproved)
    && (mode === "mock" || realConfirmed);

  useEffect(() => {
    onProgressChange({
      briefReady: canGenerate,
      strategyReady: Boolean(intent.primaryImagePurpose),
      isGenerating: loading,
      candidateCount: result?.images.length ?? 0,
      selectedImageId: selectedIndices[0] === undefined ? null : String(selectedIndices[0]),
    });
  }, [canGenerate, intent.primaryImagePurpose, loading, onProgressChange, result, selectedIndices]);

  const updateIntent = useCallback(<Key extends keyof ImageFormIntent>(
    key: Key,
    value: ImageFormIntent[Key],
  ) => {
    setIntent((current) => ({ ...current, [key]: value }));
    setFactsConfirmed(false);
    realAttemptRef.current = null;
  }, []);

  const updatePromptIntent = useCallback(<Key extends keyof PromptImageFormIntent>(
    key: Key,
    value: PromptImageFormIntent[Key],
  ) => {
    setPromptIntent((current) => ({ ...current, [key]: value }));
    setFactsConfirmed(false);
    realAttemptRef.current = null;
  }, []);

  const selectCreativeIntent = useCallback((creativeIntent: Pick<
    ImageFormIntent,
    "primaryImagePurpose" | "lifestyleScene" | "customImagePurpose"
  >) => {
    setIntent((current) => ({ ...current, ...creativeIntent }));
    setFactsConfirmed(false);
    realAttemptRef.current = null;
  }, []);

  const handleGenerate = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!canGenerate || loading) return;
    setLoading(true);
    setError("");
    setSelectedIndices([]);
    try {
      const requestCore = buildStudioImageRequestCore({
        productName,
        description,
        intent: activeIntent,
        mode,
        ...(referenceImageDataUrl
          ? { referenceImageDataUrl, referenceImageApproved }
          : {}),
      });
      const attempt = mode === "real"
        ? getOrCreateStudioAttempt(
            realAttemptRef.current,
            JSON.stringify(requestCore),
            () => createBrowserUuid(),
          )
        : null;
      if (attempt) realAttemptRef.current = attempt;
      const requestBody = {
        ...requestCore,
        ...(attempt ? { confirmRealAi: true, idempotencyKey: attempt.idempotencyKey } : {}),
      };
      const response = await fetch("/api/image-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(requestBody),
      });
      const parsedResponse = await readJsonApiResponse(response);
      const json: unknown = parsedResponse.ok
        ? parsedResponse.payload
        : { error: parsedResponse.error };
      if (!response.ok || !json || typeof json !== "object" || !("ok" in json) || json.ok !== true || !("data" in json)) {
        if (mode === "real" && !shouldRetainStudioAttempt(apiErrorCode(json))) {
          realAttemptRef.current = null;
        }
        setError(errorMessage(json, "图片生成失败，请稍后重试。"));
        return;
      }
      if (mode === "real") realAttemptRef.current = null;
      if ("demoAccess" in json && json.demoAccess) {
        updateDemoAccessSnapshot(json.demoAccess as DemoAccessInfo);
      }
      setResult((json as { data: ImageStudioData }).data);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [activeIntent, canGenerate, loading, productName, description, mode, referenceImageDataUrl, referenceImageApproved]);

  const handleReset = useCallback(() => {
    setProductName("");
    setDescription("");
    setCreationMode("guided");
    setIntent(EMPTY_IMAGE_INTENT);
    setPromptIntent(EMPTY_PROMPT_IMAGE_INTENT);
    setMode("mock");
    setRealConfirmed(false);
    setFactsConfirmed(false);
    setReferenceImageDataUrl("");
    setReferenceImageName("");
    setReferenceImageApproved(false);
    setResult(null);
    setSelectedIndices([]);
    setError("");
    realAttemptRef.current = null;
    sessionDraft.clear();
  }, [sessionDraft]);

  const handleClearResult = useCallback(() => {
    setResult(null);
    setSelectedIndices([]);
    setError("");
  }, []);

  const handleToggleSelected = useCallback((index: number) => {
    setSelectedIndices((current) => (
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index]
    ));
  }, []);

  return (
    <div className={`image-studio-workbench ${styles.workbench}`} data-testid="image-studio-workbench">
      <form className={styles.inputPanel} onSubmit={handleGenerate}>
        <div className={styles.panelIntro}>
          <div>
            <p className={styles.sectionEyebrow}>Production brief</p>
            <h2>图片生产任务</h2>
            <p>把商品事实与画面策略整理成可选择、可复核的素材方案。</p>
          </div>
          <button
            type="button"
            className={`${styles.resetButton} ${styles.dangerAction}`}
            onClick={handleReset}
            disabled={loading}
            title="清空输入与当前结果"
          >
            <RotateCcw aria-hidden="true" />
            重置
          </button>
        </div>

        <fieldset className={styles.modeFieldset} data-testid="image-creation-mode">
          <legend>创作方式</legend>
          <div className={styles.modeGrid}>
            {([
              { value: "guided", title: "引导生成", copy: "按商品事实、类型和风格组织画面" },
              { value: "prompt", title: "自由提示词", copy: "把提示词作为创意需求，由服务端整理安全上下文" },
            ] as const).map((option) => (
              <label key={option.value} className={styles.modeOption} data-selected={creationMode === option.value}>
                <input
                  type="radio"
                  name="creationMode"
                  value={option.value}
                  checked={creationMode === option.value}
                  onChange={() => {
                    setCreationMode(option.value);
                    setFactsConfirmed(false);
                    realAttemptRef.current = null;
                    setError("");
                  }}
                />
                <strong>{option.title}</strong>
                <span>{option.copy}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className={styles.formSection} aria-labelledby="image-product-section">
          <div className={styles.formSectionHeader}>
            <h3 id="image-product-section">01 商品信息</h3>
            <span>只填写已确认事实</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="image-product-name">
              商品名称 {creationMode === "guided"
                ? <span className={styles.required}>*</span>
                : <span className={styles.optionalLabel}>可选电商上下文</span>}
            </label>
            <input
              id="image-product-name"
              name="productName"
              autoComplete="off"
              required={creationMode === "guided"}
              maxLength={200}
              className={styles.control}
              placeholder="例如：Foldable Laptop Stand"
              value={productName}
              onChange={(event) => {
                setProductName(event.target.value);
                setFactsConfirmed(false);
                realAttemptRef.current = null;
              }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="image-description">创作描述</label>
            <textarea
              id="image-description"
              name="description"
              autoComplete="off"
              maxLength={1000}
              className={styles.control}
              rows={3}
              placeholder="描述已确认的商品信息，以及希望呈现的场景、构图和留白；不要填写未核实参数"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setFactsConfirmed(false);
                realAttemptRef.current = null;
              }}
            />
            <p className={styles.fieldHint}>独立创作没有 Task 研究事实，只使用你明确填写并确认的信息。</p>
          </div>
        </section>

        {creationMode === "guided" ? (
        <section className={styles.formSection} aria-labelledby="image-strategy-section">
          <div className={styles.formSectionHeader}>
            <h3 id="image-strategy-section">02 图片策略</h3>
            <span>决定素材用途与视觉语气</span>
          </div>
          <ImageScenePresetPicker value={intent} onChange={selectCreativeIntent} />
        </section>
        ) : (
          <section className={styles.formSection} aria-labelledby="image-prompt-section">
            <div className={styles.formSectionHeader}>
              <h3 id="image-prompt-section">02 自由提示词</h3>
              <span>创意需求，不是系统指令</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>提示词模板</span>
              <div className={styles.templateGrid} role="group" aria-label="提示词模板">
                {STUDIO_IMAGE_PROMPT_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={styles.templateButton}
                    onClick={() => updatePromptIntent("creativePrompt", template.prompt)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
              <p className={styles.fieldHint}>模板只填充起始内容，不会自动提交，也不会触发真实 AI。</p>
            </div>
            <div className={styles.field}>
              <label htmlFor="image-creative-prompt">
                创意提示词 <span className={styles.required}>*</span>
              </label>
              <textarea
                id="image-creative-prompt"
                name="creativePrompt"
                required
                maxLength={1200}
                className={styles.control}
                rows={6}
                placeholder="描述主体、场景、构图、光线和视觉情绪；不要填写模型路径、Provider URL 或系统指令"
                value={promptIntent.creativePrompt}
                onChange={(event) => updatePromptIntent("creativePrompt", event.target.value)}
              />
              <p className={styles.fieldHint}>{promptIntent.creativePrompt.length}/1200 · 服务端会构造最终权威 Prompt，结果区只展示整理摘要。</p>
            </div>
            <div className={styles.field}>
              <label htmlFor="image-avoid-elements">避免元素</label>
              <textarea
                id="image-avoid-elements"
                name="avoidElements"
                maxLength={400}
                className={styles.control}
                rows={3}
                placeholder="例如：Logo、水印、嵌入文字、夸张反光"
                value={promptIntent.avoidElements}
                onChange={(event) => updatePromptIntent("avoidElements", event.target.value)}
              />
            </div>
          </section>
        )}

        <section className={styles.formSection} aria-labelledby="image-settings-section">
          <div className={styles.formSectionHeader}>
            <h3 id="image-settings-section">生成设置</h3>
            <span>Mock 最多 2 张</span>
          </div>
          <div className={styles.inlineGrid}>
            <div className={styles.field}>
              <label htmlFor="image-count">图片数量</label>
              <select
                id="image-count"
                name="count"
                className={styles.control}
                value={activeIntent.count}
                onChange={(event) => {
                  const value = event.target.value === "2" ? 2 : 1;
                  if (creationMode === "guided") updateIntent("count", value);
                  else updatePromptIntent("count", value);
                }}
              >
                <option value={1}>1 张</option>
                <option value={2}>2 张</option>
              </select>
              <p className={styles.fieldHint}>访客独立生图按实际张数扣减额度；Mock 不扣额度。</p>
            </div>
            <div className={styles.field}>
              <label htmlFor="image-aspect-ratio">宽高比例</label>
              <select
                id="image-aspect-ratio"
                name="aspectRatio"
                className={styles.control}
                value={activeIntent.aspectRatio}
                onChange={(event) => {
                  const value = event.target.value as ImageFormIntent["aspectRatio"];
                  if (creationMode === "guided") updateIntent("aspectRatio", value);
                  else updatePromptIntent("aspectRatio", value);
                }}
              >
                <option value="square_1_1">1:1 方图</option>
                <option value="portrait_4_5">4:5 竖图</option>
                <option value="landscape_16_9">16:9 横图</option>
              </select>
            </div>
          </div>
        </section>

        {creationMode === "guided" ? (
        <section className={styles.formSection} aria-labelledby="image-constraints-section">
          <div className={styles.formSectionHeader}>
            <h3 id="image-constraints-section">补充要求</h3>
            <span>作为独立 Image 上下文</span>
          </div>
          <div className={styles.inlineGrid}>
            <div className={styles.field}>
              <label htmlFor="image-prohibited-elements">禁止元素</label>
              <textarea
                id="image-prohibited-elements"
                name="prohibitedElements"
                maxLength={240}
                className={styles.control}
                rows={3}
                placeholder="例如：Logo、水印、认证标识"
                value={intent.prohibitedElements}
                onChange={(event) => updateIntent("prohibitedElements", event.target.value)}
              />
            </div>
          </div>
        </section>
        ) : null}

        <section className={styles.formSection} aria-labelledby="image-reference-section">
          <div className={styles.formSectionHeader}>
            <h3 id="image-reference-section">商品参考图</h3>
            <span>可选，不保存到会话草稿</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="image-reference-file">上传 PNG、JPEG 或 WebP（最大 10MB）</label>
            <input
              id="image-reference-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={styles.control}
              onChange={(event) => {
                const file = event.target.files?.[0];
                setReferenceImageApproved(false);
                setFactsConfirmed(false);
                realAttemptRef.current = null;
                if (!file) {
                  setReferenceImageDataUrl("");
                  setReferenceImageName("");
                  return;
                }
                if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > 10 * 1024 * 1024) {
                  setReferenceImageDataUrl("");
                  setReferenceImageName("");
                  setError("参考图需为 10MB 以内的 PNG、JPEG 或 WebP 图片。");
                  event.currentTarget.value = "";
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result !== "string") {
                    setError("参考图读取失败，请重新上传。");
                    return;
                  }
                  setReferenceImageDataUrl(reader.result);
                  setReferenceImageName(file.name);
                  setError("");
                };
                reader.onerror = () => setError("参考图读取失败，请重新上传。");
                reader.readAsDataURL(file);
              }}
            />
          </div>
          {referenceImageDataUrl ? (
            <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="manual-image-reference-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- 本地 FileReader data URL，不访问外部资源 */}
              <img src={referenceImageDataUrl} alt="待批准的商品参考图" className="max-h-64 w-full rounded-lg object-contain" />
              <p className="text-sm text-slate-600">{referenceImageName}</p>
              <label className={styles.warning}>
                <input
                  type="checkbox"
                  checked={referenceImageApproved}
                  onChange={(event) => setReferenceImageApproved(event.target.checked)}
                />
                <span>我有权使用这张图片，并批准它只用于本次商品视觉草稿；生成结果仍需人工核对商品外观。</span>
              </label>
              <button
                type="button"
                className={`${styles.toolbarButton} ${styles.dangerAction}`}
                onClick={() => {
                  setReferenceImageDataUrl("");
                  setReferenceImageName("");
                  setReferenceImageApproved(false);
                  setFactsConfirmed(false);
                  realAttemptRef.current = null;
                }}
              >
                移除参考图
              </button>
            </div>
          ) : (
            null
          )}
          <div className={styles.prefillNotice} data-testid="manual-image-authority-mode">
            <strong>{referenceImageDataUrl && referenceImageApproved ? "参考图创作模式" : "概念创作模式"}</strong>
            <p>
              {referenceImageDataUrl && referenceImageApproved
                ? "将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。"
                : "当前没有已确认商品参考图。生成结果用于构图、场景和视觉方向参考，不代表真实商品外观。"}
            </p>
          </div>
        </section>

        <label className={styles.warning}>
          <input
            type="checkbox"
            checked={factsConfirmed}
            onChange={(event) => setFactsConfirmed(event.target.checked)}
          />
          <span>我确认商品资料由我提供或核实，未确认内容不会被当作商品事实；所有图片均需人工复核后使用。</span>
        </label>

        <fieldset className={styles.modeFieldset}>
          <legend>生成模式</legend>
          <div className={styles.modeGrid}>
            {(["mock", "real"] as const).map((value) => (
              <label key={value} className={styles.modeOption} data-selected={mode === value}>
                <input
                  type="radio"
                  name="imageMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    realAttemptRef.current = null;
                    setRealConfirmed(false);
                    setError("");
                  }}
                />
                <strong>{value === "mock" ? "Mock 预览" : "Real AI"}</strong>
                <span>
                  {value === "mock"
                    ? "本地确定性预览，不调用 Provider"
                    : "可能消耗额度，并进入现有安全链路"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "real" ? (
          <label className={styles.warning}>
            <input
              type="checkbox"
              checked={realConfirmed}
              onChange={(event) => setRealConfirmed(event.target.checked)}
            />
            <span>我确认本次会调用真实图片 AI，可能消耗额度；结果仍是需要人工复核的概念草稿。</span>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={!canGenerate || loading}
          className={styles.primaryButton}
        >
          {loading ? (
            <>
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              正在生成图片
            </>
          ) : (
            <>
              <Sparkles aria-hidden="true" />
              生成图片
            </>
          )}
        </button>
        {!authenticated ? <p className={styles.authNotice}>请先登录后再使用 Image Studio。</p> : null}
      </form>

      <section
        className={styles.resultPanel}
        aria-live="polite"
        aria-busy={loading}
        data-has-result={Boolean(result)}
      >
        <div className={styles.resultHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Selection board</p>
            <h2>图片工作区</h2>
            <p>比较方案、选择候选图，并完成发布前人工检查。</p>
          </div>
          <div className={styles.toolbar} aria-label="图片结果工具栏">
            {result ? (
              <span className={styles.statusBadge}>
                {result.meta.mode === "mock"
                  ? "Mock · 未调用 AI"
                  : result.meta.duplicate
                    ? "Real AI · 幂等重放"
                    : "Real AI · 新结果"}
              </span>
            ) : null}
            <button
              type="button"
              className={styles.toolbarButton}
              onClick={() => void handleGenerate()}
              disabled={!result || !canGenerate || loading}
              title={result ? "使用当前输入重新生成" : "生成首批结果后可重新生成"}
            >
              <RefreshCw aria-hidden="true" />
              重新生成
            </button>
            <button
              type="button"
              className={`${styles.toolbarButton} ${styles.dangerAction}`}
              onClick={handleClearResult}
              disabled={!result && !error}
              title={result || error ? "清空当前结果" : "当前没有可清空的结果"}
            >
              <Trash2 aria-hidden="true" />
              清空
            </button>
          </div>
        </div>

        <div className={styles.resultScroll}>
          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.emptyContent}>
                <span className={styles.emptyMark}>
                  <WandSparkles aria-hidden="true" />
                </span>
                <h3>正在生成图片策略预览</h3>
                <p>{creationMode === "prompt"
                  ? "正在安全整理提示词、比例与商品上下文，请保持页面打开。"
                  : "正在根据图片类型、风格、比例与商品信息组织方案，请保持页面打开。"}</p>
              </div>
            </div>
          ) : error ? (
            <div className={styles.errorState} role="alert">
              <div className={styles.emptyContent}>
                <h3>生成未完成</h3>
                <p>{error}</p>
              </div>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div className={styles.prefillNotice} data-testid="manual-image-authority-notice">
                {result.meta.visualAuthority === "product_visual_draft"
                  ? result.meta.mode === "mock"
                    ? "Mock 仅验证参考图批准与多候选流程，未依据参考图还原商品外观。"
                    : "本批候选图基于你上传并批准的商品参考图，仍需逐张人工核对商品外观。"
                  : "本批候选图仅为构图、场景和创意概念，不代表真实商品外观。"}
              </div>
              <ImageResultWorkspace
                result={result}
                selectedIndices={selectedIndices}
                onToggleSelected={handleToggleSelected}
              />
            </div>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyContent}>
                <span className={styles.emptyMark}><ImageIcon aria-hidden="true" /></span>
                <h3>{creationMode === "prompt" ? "从清楚的创意需求开始" : "从图片策略开始"}</h3>
                <p>{creationMode === "prompt"
                  ? "选择模板或编写提示词。默认 Mock 会确定性消费提示词、避免元素、比例和商品上下文。"
                  : "填写左侧商品事实并选择素材用途。默认 Mock 会返回本地确定性方案，不调用真实 AI。"}</p>
                <div className={styles.emptyChecklist} aria-label="生成后可用能力">
                  <span>方案对比</span>
                  <span>人工选择</span>
                  <span>本地辅助检查</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
