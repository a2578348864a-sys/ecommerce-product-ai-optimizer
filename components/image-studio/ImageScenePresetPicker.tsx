import {
  normalizeStudioImageCreativeIntent,
  STUDIO_IMAGE_LIFESTYLE_SCENES,
  STUDIO_IMAGE_PRIMARY_PURPOSES,
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

  return (
    <div className="grid gap-4" data-testid="image-creative-intent-picker">
      <fieldset>
        <legend className={styles.fieldLabel}>图片主用途（必选）</legend>
        <div className={styles.strategyGrid}>
          {STUDIO_IMAGE_PRIMARY_PURPOSES.map((purpose) => (
            <label
              key={purpose.id}
              className={styles.strategyOption}
              data-selected={value.primaryImagePurpose === purpose.id}
            >
              <input
                type="radio"
                name={`${name}-primary`}
                value={purpose.id}
                checked={value.primaryImagePurpose === purpose.id}
                onChange={() => update({ ...value, primaryImagePurpose: purpose.id })}
              />
              <strong>{purpose.label}</strong>
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
            ? "白底主图不使用生活场景，已自动设为“不指定”。"
            : "生活场景是可选补充，不会替代图片主用途。"}
        </p>
      </fieldset>
      <p className={styles.fieldHint}>
        未批准商品参考图时，图片用途与场景只表示构图方向，不代表真实商品外观。
      </p>
    </div>
  );
}
