"use client";

/**
 * 图片工作台「自由创作生成」表单（MVP 极简）。
 *
 * 只保留三个决策：描述、比例、数量；另外复用 lib/client/studioImageRequest.ts 里
 * **既有的** 4 套提示词模板做一键填入，不新造模板、不做 Prompt 配方编辑器。
 * 本表单不绑定商品研究事实与参考图，请求体也不会携带任何事实字段。
 */
import { STUDIO_IMAGE_PROMPT_TEMPLATES } from "@/lib/client/studioImageRequest";
import {
  STUDIO_IMAGE_ASPECT_RATIOS,
  STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH,
  type StudioImageAspectRatio,
} from "@/lib/studioImageInput";
import styles from "./ImageStudioPolish.module.css";

export const STUDIO_ASPECT_RATIO_LABELS: Record<StudioImageAspectRatio, string> = {
  square_1_1: "1:1 方图",
  portrait_4_5: "4:5 竖图",
  landscape_16_9: "16:9 横图",
};

export type FreeCreationValues = {
  creativePrompt: string;
  aspectRatio: StudioImageAspectRatio;
  count: 1 | 2;
};

export function FreeCreationForm({
  values,
  onChange,
  disabled = false,
}: {
  values: FreeCreationValues;
  onChange: (next: FreeCreationValues) => void;
  disabled?: boolean;
}) {
  const update = (patch: Partial<FreeCreationValues>) => onChange({ ...values, ...patch });

  return (
    <div className="grid gap-3" data-testid="free-creation-form">
      <div className={styles.field}>
        <label htmlFor="free-creation-prompt">
          自定义图片描述<span className={styles.required}> *</span>
        </label>
        <textarea
          id="free-creation-prompt"
          name="creativePrompt"
          className={styles.control}
          required
          disabled={disabled}
          maxLength={STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH}
          value={values.creativePrompt}
          placeholder="例如：极简白色背景的陶瓷马克杯主视觉，柔和侧光，留出文案空间"
          onChange={(event) => update({ creativePrompt: event.target.value })}
        />
        <p className={styles.fieldHint}>
          描述画面本身即可（主体、场景、光线、构图）。不要填写供应商、模型或文件路径等信息。
        </p>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>快速模板（可选，一键填入描述）</span>
        <div className={styles.templateGrid}>
          {STUDIO_IMAGE_PROMPT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={styles.templateButton}
              disabled={disabled}
              data-testid={`free-creation-template-${template.id}`}
              onClick={() => update({ creativePrompt: template.prompt })}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <fieldset className={styles.modeFieldset} disabled={disabled}>
        <legend>图片比例</legend>
        <div className={styles.modeGrid}>
          {STUDIO_IMAGE_ASPECT_RATIOS.map((ratio) => (
            <label
              key={ratio}
              className={styles.modeOption}
              data-selected={values.aspectRatio === ratio}
            >
              <input
                type="radio"
                name="free-creation-aspect-ratio"
                value={ratio}
                checked={values.aspectRatio === ratio}
                onChange={() => update({ aspectRatio: ratio })}
              />
              <strong>{STUDIO_ASPECT_RATIO_LABELS[ratio]}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.modeFieldset} disabled={disabled}>
        <legend>图片数量</legend>
        <div className={styles.modeGrid}>
          {([1, 2] as const).map((count) => (
            <label
              key={count}
              className={styles.modeOption}
              data-selected={values.count === count}
            >
              <input
                type="radio"
                name="free-creation-count"
                value={count}
                checked={values.count === count}
                onChange={() => update({ count })}
              />
              <strong>{count} 张</strong>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
