"use client";

/**
 * Image Style Library V1 — 视觉方向选择器。
 *
 * 用户只需选择「我想要什么视觉感觉」，专业 Prompt 由 lib/imagePromptComposer.ts 生成。
 * 卡片只展示中文标题、一句说明与一个轻量预览图形（纯内联 SVG，不使用任何第三方图片）。
 * 视觉方向不改变商品事实：提示文案在 UI 上明确说明这一点。
 */
import {
  IMAGE_STYLE_PRESETS,
  type ImageStylePresetId,
} from "@/lib/imageStyleLibrary";
import styles from "./ImageStudioPolish.module.css";

/** 轻量预览：只表达灯光方向、版式与氛围，不含任何商品或品牌元素。 */
const PREVIEW_GLYPHS: Record<ImageStylePresetId, { shapes: string; label: string }> = {
  amazon_clean_hero: {
    label: "居中主体 + 均匀棚光",
    shapes: "<rect x='9' y='6' width='14' height='12' rx='2' fill='currentColor' opacity='.85'/><ellipse cx='16' cy='19.4' rx='8' ry='1.4' fill='currentColor' opacity='.22'/>",
  },
  premium_editorial: {
    label: "侧光 + 大留白",
    shapes: "<rect x='12' y='6' width='13' height='12' rx='2' fill='currentColor' opacity='.8'/><path d='M4 4 L9 4 L9 20 L4 20 Z' fill='currentColor' opacity='.18'/>",
  },
  lifestyle_home: {
    label: "窗光 + 家居场景",
    shapes: "<rect x='11' y='8' width='10' height='10' rx='2' fill='currentColor' opacity='.8'/><path d='M4 4 L9 4 L9 13 L4 13 Z' fill='currentColor' opacity='.3'/><path d='M4 20 L28 20' stroke='currentColor' stroke-width='1.2' opacity='.3'/>",
  },
  outdoor_story: {
    label: "自然日光 + 环境纵深",
    shapes: "<circle cx='23' cy='7' r='3' fill='currentColor' opacity='.35'/><rect x='9' y='10' width='10' height='9' rx='2' fill='currentColor' opacity='.8'/><path d='M3 20 L29 20' stroke='currentColor' stroke-width='1.4' opacity='.35'/>",
  },
  macro_detail: {
    label: "浅景深 + 局部特写",
    shapes: "<circle cx='16' cy='12' r='7' fill='currentColor' opacity='.75'/><circle cx='16' cy='12' r='3' fill='currentColor' opacity='.35'/><path d='M6 21 L26 21' stroke='currentColor' stroke-width='1' opacity='.25'/>",
  },
  feature_board: {
    label: "主体 + 信息留白格",
    shapes: "<rect x='6' y='6' width='11' height='12' rx='2' fill='currentColor' opacity='.8'/><rect x='20' y='6' width='6' height='4' rx='1' fill='currentColor' opacity='.25'/><rect x='20' y='12' width='6' height='4' rx='1' fill='currentColor' opacity='.25'/><rect x='20' y='18' width='6' height='3' rx='1' fill='currentColor' opacity='.25'/>",
  },
  packaging_set: {
    label: "规整平铺 + 清晰层级",
    shapes: "<rect x='5' y='9' width='7' height='9' rx='1.5' fill='currentColor' opacity='.8'/><rect x='14' y='9' width='7' height='9' rx='1.5' fill='currentColor' opacity='.6'/><rect x='23' y='9' width='5' height='9' rx='1.5' fill='currentColor' opacity='.4'/>",
  },
  campaign_visual: {
    label: "强主视觉 + 广告构图",
    shapes: "<path d='M5 20 L16 4 L27 20 Z' fill='currentColor' opacity='.22'/><rect x='12' y='9' width='9' height='10' rx='2' fill='currentColor' opacity='.85'/>",
  },
};

function StylePreviewGlyph({ id }: { id: ImageStylePresetId }) {
  const glyph = PREVIEW_GLYPHS[id];
  return (
    <span className={styles.stylePreview} aria-hidden="true">
      <svg viewBox="0 0 32 24" width="32" height="24" role="presentation" focusable="false">
        <rect x="0.5" y="0.5" width="31" height="23" rx="3" fill="none" stroke="currentColor" strokeOpacity=".18" />
        <g dangerouslySetInnerHTML={{ __html: glyph.shapes }} />
      </svg>
    </span>
  );
}

export function ImageStylePresetPicker({
  value,
  onChange,
  recommendedId,
  name = "imageStylePreset",
}: {
  value: ImageStylePresetId;
  onChange: (value: ImageStylePresetId) => void;
  /** 依据图片用途给出的推荐方向：只做提示，不覆盖用户的显式选择。 */
  recommendedId?: ImageStylePresetId;
  name?: string;
}) {
  return (
    <div className="grid gap-2" data-testid="image-style-preset-picker">
      <fieldset>
        <legend className={styles.fieldLabel}>视觉方向</legend>
        <div className={styles.styleGrid}>
          {IMAGE_STYLE_PRESETS.map((preset) => (
            <label
              key={preset.id}
              className={styles.styleOption}
              data-selected={value === preset.id}
              data-recommended={recommendedId === preset.id}
              title={PREVIEW_GLYPHS[preset.id].label}
            >
              <input
                type="radio"
                name={name}
                value={preset.id}
                checked={value === preset.id}
                onChange={() => onChange(preset.id)}
              />
              <StylePreviewGlyph id={preset.id} />
              <span className={styles.styleOptionText}>
                <strong>
                  {preset.label}
                  {recommendedId === preset.id ? <em className={styles.styleRecommended}>推荐</em> : null}
                </strong>
                <small>{preset.description}</small>
              </span>
            </label>
          ))}
        </div>
        <p className={styles.fieldHint}>
          视觉方向只决定「怎么画」（构图、灯光、场景、色彩、镜头语言），不改变商品事实、材质或配件。
        </p>
      </fieldset>
    </div>
  );
}
