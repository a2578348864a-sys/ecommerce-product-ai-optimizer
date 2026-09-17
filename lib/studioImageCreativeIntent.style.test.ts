import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  inferStudioImageCreativeIntentFromPreferences,
  normalizeStudioImageCreativeIntent,
  resolveStudioImageCreativeIntent,
} from "@/lib/studioImageCreativeIntent";
import { DEFAULT_IMAGE_STYLE_PRESET_ID, isImageStylePresetId } from "@/lib/imageStyleLibrary";

/**
 * Studio 专属视觉方向不得泄漏到共用的任务链路意图对象。
 *
 * 背景：`lib/studioImageCreativeIntent.ts` 同时被 Studio 独立入口与任务链路
 * （Creative Handoff 偏好、TaskStudioPreparation）使用，而 Handoff 的生成请求体
 * 由 Route 严格字段白名单校验 —— 多带一个未知键整次生成会被 400 拒绝。
 * 因此「默认风格」只能由 Studio 自己的请求构建/服务端解析补齐。
 */
describe("studio style dimension containment", () => {
  it("keeps the shared default intent and the legacy inference free of the studio-only field", () => {
    expect(DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT).toEqual({
      primaryImagePurpose: "white_studio",
      lifestyleScene: "none",
      customImagePurpose: "",
    });

    // Handoff 偏好回退路径：即使偏好完全匹配某个用途，也不得带上风格维度。
    const inferred = inferStudioImageCreativeIntentFromPreferences({
      imageStyle: "minimal",
      backgroundPreference: "Clean white studio background.",
      compositionPreference: "Centered product-first composition with a natural shadow.",
      additionalRequirements: "",
    });
    expect(inferred).toEqual(DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT);
    expect("stylePresetId" in inferred).toBe(false);
    expect("stylePresetId" in inferStudioImageCreativeIntentFromPreferences(null)).toBe(false);
  });

  it("preserves an explicit style but never invents one while normalising", () => {
    const untouched = normalizeStudioImageCreativeIntent({
      primaryImagePurpose: "detail_closeup",
      lifestyleScene: "outdoor_travel",
      customImagePurpose: "",
    });
    expect("stylePresetId" in untouched).toBe(false);

    const chosen = normalizeStudioImageCreativeIntent({
      primaryImagePurpose: "detail_closeup",
      lifestyleScene: "outdoor_travel",
      customImagePurpose: "",
      stylePresetId: "macro_detail",
    });
    expect(chosen.stylePresetId).toBe("macro_detail");

    // 切换用途不会重置已选风格（视觉方向与用途正交）。
    const switched = normalizeStudioImageCreativeIntent({ ...chosen, primaryImagePurpose: "white_studio" });
    expect(switched.stylePresetId).toBe("macro_detail");
  });

  it("resolves the default style only at the studio resolution boundary", () => {
    const resolved = resolveStudioImageCreativeIntent({
      primaryImagePurpose: "white_studio",
      lifestyleScene: "none",
      customImagePurpose: "",
    });
    expect(resolved.stylePresetId).toBe(DEFAULT_IMAGE_STYLE_PRESET_ID);
    expect(isImageStylePresetId(resolved.stylePresetId)).toBe(true);

    // 非法值回退到默认方向，不抛错（旧草稿或被篡改的请求不会打断生成）。
    const fallback = resolveStudioImageCreativeIntent({
      primaryImagePurpose: "custom",
      lifestyleScene: "none",
      customImagePurpose: "节日礼赠套装展示",
      stylePresetId: "titanium_luxury" as never,
    });
    expect(fallback.stylePresetId).toBe(DEFAULT_IMAGE_STYLE_PRESET_ID);
    expect(fallback.stylePresetLabel).toBe("高级白底");
  });
});
