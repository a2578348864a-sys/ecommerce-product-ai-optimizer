import {
  IMAGE_STUDIO_TEMPLATE_OPTIONS,
  normalizeStudioImageCreativeIntent,
  STUDIO_IMAGE_LIFESTYLE_SCENES,
  type StudioImageCreativeIntent,
} from "@/lib/studioImageCreativeIntent";
import styles from "./ImageStudioPolish.module.css";

export function ImageScenePresetPicker({
  value,
  onChange,
  name = "imageCreativeIntent",
}: {
  value: StudioImageCreativeIntent;
  onChange: (value: StudioImageCreativeIntent) => void;
  name?: string;
}) {
  const sceneDisabled = value.primaryImagePurpose === "white_studio";
  const update = (next: StudioImageCreativeIntent) => onChange(normalizeStudioImageCreativeIntent(next));
  const isTemplateSelected = (template: (typeof IMAGE_STUDIO_TEMPLATE_OPTIONS)[number]) => {
    if (template.templateId === "lifestyle_in_use") {
      return value.primaryImagePurpose === "lifestyle_in_use" && value.lifestyleScene === "home_lifestyle";
    }
    if (template.templateId === "selling_points") {
      return value.primaryImagePurpose === "selling_point_infographic" && value.lifestyleScene === "none";
    }
    return value.primaryImagePurpose === template.primaryImagePurpose;
  };

  return (
    <div className="grid gap-4" data-testid="image-creative-intent-picker">
      <fieldset>
        <legend className={styles.fieldLabel}>图片主用途（必选）</legend>
        <div className={styles.strategyGrid}>
          {IMAGE_STUDIO_TEMPLATE_OPTIONS.map((template) => (
            <label
              key={template.templateId}
              className={styles.strategyOption}
              data-template-id={template.templateId}
              data-selected={isTemplateSelected(template)}
            >
              <input
                type="radio"
                name={`${name}-primary`}
                value={template.templateId}
                checked={isTemplateSelected(template)}
                onChange={() => update({
                  ...value,
                  primaryImagePurpose: template.primaryImagePurpose,
                  lifestyleScene: template.lifestyleScene,
                  customImagePurpose: "",
                })}
              />
              <strong>{template.label}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      {value.primaryImagePurpose === "custom" ? (
        <div className={styles.field}>
          <label htmlFor={`${name}-custom-purpose`}>自定义图片用途</label>
          <input
            id={`${name}-custom-purpose`}
            name="customImagePurpose"
            maxLength={160}
            className={styles.control}
            required
            value={value.customImagePurpose}
            placeholder="例如：节日礼赠套装展示"
            onChange={(event) => update({ ...value, customImagePurpose: event.target.value })}
          />
        </div>
      ) : null}

      <fieldset disabled={sceneDisabled}>
        <legend className={styles.fieldLabel}>生活场景（可选，最多一个）</legend>
        <div className={styles.strategyGrid}>
          {STUDIO_IMAGE_LIFESTYLE_SCENES.map((scene) => (
            <label
              key={scene.id}
              className={styles.strategyOption}
              data-selected={value.lifestyleScene === scene.id}
              data-disabled={sceneDisabled}
              aria-disabled={sceneDisabled}
            >
              <input
                type="radio"
                name={`${name}-lifestyle`}
                value={scene.id}
                checked={value.lifestyleScene === scene.id}
                onChange={() => update({ ...value, lifestyleScene: scene.id })}
              />
              <strong>{scene.label}</strong>
            </label>
          ))}
        </div>
        <p className={styles.fieldHint}>
          {sceneDisabled
            ? <>
                白底主图要求干净背景，因此不使用生活方式场景。<br />
                切换到其他图片用途后即可选择。
              </>
            : "生活场景是可选补充，不会替代图片主用途。"}
        </p>
      </fieldset>
      <p className={styles.fieldHint}>
        未批准商品参考图时，图片用途与场景只表示构图方向，不代表真实商品外观。
      </p>
    </div>
  );
}
