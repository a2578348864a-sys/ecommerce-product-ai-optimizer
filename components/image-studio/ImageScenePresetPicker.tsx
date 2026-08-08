import { STUDIO_IMAGE_SCENE_GROUPS, type ImageScenePreset } from "@/lib/client/studioImageRequest";
import styles from "./ImageStudioPolish.module.css";

export function ImageScenePresetPicker({
  value,
  onChange,
  name = "scenePreset",
}: {
  value: ImageScenePreset;
  onChange: (value: ImageScenePreset) => void;
  name?: string;
}) {
  return (
    <fieldset>
      <legend className={styles.fieldLabel}>场景与用途（图片类型）</legend>
      <div className="grid gap-4">
        {STUDIO_IMAGE_SCENE_GROUPS.map((group) => (
          <fieldset key={group.id} className="grid gap-2">
            <legend className="text-xs font-bold text-slate-500">{group.label}</legend>
            <div className={styles.strategyGrid}>
              {group.presets.map((preset) => (
                <label
                  key={preset.id}
                  className={styles.strategyOption}
                  data-selected={value === preset.id}
                >
                  <input
                    type="radio"
                    name={name}
                    value={preset.id}
                    checked={value === preset.id}
                    onChange={() => onChange(preset.id)}
                  />
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className={styles.fieldHint}>
        未批准商品参考图时，预设只表示构图与场景概念，不代表真实商品外观。
      </p>
    </fieldset>
  );
}
