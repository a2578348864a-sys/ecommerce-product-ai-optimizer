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
import { buildAccessHeaders, isAuthenticated } from "@/lib/client/accessToken";
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
import { useStudioTaskPrefill } from "@/hooks/useStudioTaskPrefill";
import {
  ImageResultWorkspace,
  type ImageStudioData,
} from "@/components/image-studio/ImageResultWorkspace";
import styles from "./ImageStudioPolish.module.css";

type StudioMode = "mock" | "real";

const IMAGE_TYPE_OPTIONS = [
  { value: "product_main", label: "商品主图", description: "清晰主体与干净背景" },
  { value: "lifestyle_scene", label: "场景图", description: "展示使用环境与氛围" },
  { value: "selling_point_display", label: "卖点展示图", description: "预留信息标注层级" },
  { value: "ad_creative", label: "广告素材", description: "强调视觉节奏与留白" },
] as const;

function apiErrorCode(json: unknown): string | null {
  if (!json || typeof json !== "object" || !("error" in json)) return null;
  const error = (json as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as Record<string, unknown>).code);
}

function errorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json) {
    const error = (json as Record<string, unknown>).error;
    if (error && typeof error === "object" && "message" in error) {
      return String((error as Record<string, unknown>).message);
    }
  }
  return fallback;
}

export function ImageStudioClient({ taskId = "" }: { taskId?: string }) {
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [creationMode, setCreationMode] = useState<"guided" | "prompt">("guided");
  const [intent, setIntent] = useState<ImageFormIntent>(EMPTY_IMAGE_INTENT);
  const [promptIntent, setPromptIntent] = useState<PromptImageFormIntent>(EMPTY_PROMPT_IMAGE_INTENT);
  const [mode, setMode] = useState<StudioMode>("mock");
  const [realConfirmed, setRealConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImageStudioData | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const realAttemptRef = useRef<StudioAttempt | null>(null);
  const taskPrefill = useStudioTaskPrefill(taskId);

  useEffect(() => setAuthenticated(isAuthenticated()), []);
  useEffect(() => {
    if (taskPrefill.status !== "ready") return;
    setProductName((current) => current || taskPrefill.data.productName);
    setDescription((current) => current || taskPrefill.data.description);
  }, [taskPrefill]);

  const activeIntent = creationMode === "guided" ? intent : promptIntent;
  const hasRequiredCreativeInput = creationMode === "guided"
    ? productName.trim().length > 0
    : promptIntent.creativePrompt.trim().length > 0;
  const canGenerate = authenticated
    && hasRequiredCreativeInput
    && (mode === "mock" || realConfirmed);

  const updateIntent = useCallback(<Key extends keyof ImageFormIntent>(
    key: Key,
    value: ImageFormIntent[Key],
  ) => {
    setIntent((current) => ({ ...current, [key]: value }));
    realAttemptRef.current = null;
  }, []);

  const updatePromptIntent = useCallback(<Key extends keyof PromptImageFormIntent>(
    key: Key,
    value: PromptImageFormIntent[Key],
  ) => {
    setPromptIntent((current) => ({ ...current, [key]: value }));
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
      });
      const attempt = mode === "real"
        ? getOrCreateStudioAttempt(
            realAttemptRef.current,
            JSON.stringify(requestCore),
            () => crypto.randomUUID(),
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
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok || !json || typeof json !== "object" || !("ok" in json) || json.ok !== true || !("data" in json)) {
        if (mode === "real" && !shouldRetainStudioAttempt(apiErrorCode(json))) {
          realAttemptRef.current = null;
        }
        setError(errorMessage(json, "图片生成失败，请稍后重试。"));
        return;
      }
      if (mode === "real") realAttemptRef.current = null;
      setResult((json as { data: ImageStudioData }).data);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [activeIntent, canGenerate, loading, productName, description, mode]);

  const handleReset = useCallback(() => {
    setProductName("");
    setDescription("");
    setCreationMode("guided");
    setIntent(EMPTY_IMAGE_INTENT);
    setPromptIntent(EMPTY_PROMPT_IMAGE_INTENT);
    setMode("mock");
    setRealConfirmed(false);
    setResult(null);
    setSelectedIndices([]);
    setError("");
    realAttemptRef.current = null;
  }, []);

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

        {taskPrefill.status === "loading" ? (
          <p className={styles.prefillNotice} data-testid="studio-task-prefill-status">正在读取任务信息…</p>
        ) : taskPrefill.status === "ready" ? (
          <p className={styles.prefillNotice} data-testid="studio-task-prefill-status">
            已从任务 {taskPrefill.data.taskId} 带入商品信息；Image Studio 仍可脱离 Task 独立使用。
          </p>
        ) : taskPrefill.status === "unavailable" ? (
          <p className={styles.prefillNotice} data-testid="studio-task-prefill-status">
            未能读取关联任务，仍可直接填写商品信息并生成。
          </p>
        ) : null}

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
                realAttemptRef.current = null;
              }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="image-description">商品描述</label>
            <textarea
              id="image-description"
              name="description"
              autoComplete="off"
              maxLength={1000}
              className={styles.control}
              rows={3}
              placeholder="描述外观、颜色、材质和已确认功能；不要填写未核实参数"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                realAttemptRef.current = null;
              }}
            />
          </div>
        </section>

        {creationMode === "guided" ? (
        <section className={styles.formSection} aria-labelledby="image-strategy-section">
          <div className={styles.formSectionHeader}>
            <h3 id="image-strategy-section">02 图片策略</h3>
            <span>决定素材用途与视觉语气</span>
          </div>
          <fieldset>
            <legend className={styles.fieldLabel}>图片类型</legend>
            <div className={styles.strategyGrid}>
              {IMAGE_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={styles.strategyOption}
                  data-selected={intent.imageType === option.value}
                >
                  <input
                    type="radio"
                    name="imageType"
                    value={option.value}
                    checked={intent.imageType === option.value}
                    onChange={() => updateIntent("imageType", option.value)}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={styles.field}>
            <label htmlFor="image-visual-style">视觉风格</label>
            <select
              id="image-visual-style"
              name="visualStyle"
              className={styles.control}
              value={intent.visualStyle}
              onChange={(event) => updateIntent(
                "visualStyle",
                event.target.value as ImageFormIntent["visualStyle"],
              )}
            >
              <option value="minimal">极简</option>
              <option value="premium">高端</option>
              <option value="tech">科技</option>
              <option value="home">家居</option>
              <option value="outdoor">户外</option>
              <option value="brand_ad">品牌广告</option>
            </select>
          </div>
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
              <p className={styles.fieldHint}>Visitor Real 模式仍限制为 1 张。</p>
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
              <label htmlFor="image-composition">构图要求</label>
              <textarea
                id="image-composition"
                name="compositionRequirements"
                maxLength={240}
                className={styles.control}
                rows={3}
                placeholder="例如：主体居中，右侧保留文案区域"
                value={intent.compositionRequirements}
                onChange={(event) => updateIntent("compositionRequirements", event.target.value)}
              />
            </div>
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
              正在生成图片方案
            </>
          ) : (
            <>
              <Sparkles aria-hidden="true" />
              {mode === "mock" ? "生成 Mock 图片方案" : "确认并调用真实图片 AI"}
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
            <ImageResultWorkspace
              result={result}
              selectedIndices={selectedIndices}
              onToggleSelected={handleToggleSelected}
            />
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
