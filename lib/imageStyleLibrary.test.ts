import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_STYLE_PRESET_BY_PURPOSE,
  DEFAULT_IMAGE_STYLE_PRESET_ID,
  IMAGE_STYLE_PRESETS,
  IMAGE_STYLE_PRESET_IDS,
  findImageStyleFactLeak,
  getImageStylePreset,
  imageStylePresetLabel,
  isImageStylePresetCompatibleWithPurpose,
  isImageStylePresetId,
  recommendedImageStylePreset,
} from "@/lib/imageStyleLibrary";
import { STUDIO_IMAGE_PRIMARY_PURPOSES } from "@/lib/studioImageCreativeIntent";

/**
 * Image Style Library V1 契约（§26 A）。
 * 核心不变量：风格库是纯视觉数据 —— 8 个预设、id 唯一、字段非空、且**不含任何商品事实**。
 */
describe("image style library", () => {
  it("ships exactly the eight V1 presets with unique ids", () => {
    expect(IMAGE_STYLE_PRESETS).toHaveLength(8);
    expect(IMAGE_STYLE_PRESET_IDS).toHaveLength(8);
    const ids = IMAGE_STYLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(8);
    expect(ids).toEqual([
      "amazon_clean_hero",
      "premium_editorial",
      "lifestyle_home",
      "outdoor_story",
      "macro_detail",
      "feature_board",
      "packaging_set",
      "campaign_visual",
    ]);
  });

  it("keeps every visual field non-empty and free of product facts", () => {
    for (const preset of IMAGE_STYLE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(1);
      expect(preset.description.length).toBeGreaterThan(3);
      for (const field of [
        preset.composition,
        preset.lighting,
        preset.environment,
        preset.colorMood,
        preset.cameraLanguage,
        preset.propPolicy,
        preset.textPolicy,
      ]) {
        expect(field.trim().length).toBeGreaterThan(8);
        expect(findImageStyleFactLeak(field)).toEqual([]);
      }
      expect(preset.negativeRules.length).toBeGreaterThanOrEqual(3);
      for (const rule of preset.negativeRules) {
        expect(rule.trim().length).toBeGreaterThan(3);
        expect(findImageStyleFactLeak(rule)).toEqual([]);
      }
      expect(findImageStyleFactLeak(preset.label)).toEqual([]);
      expect(findImageStyleFactLeak(preset.description)).toEqual([]);
    }
  });

  it("detects a fact leak when a style text claims a product attribute", () => {
    // 反向校验：检测器本身必须能抓到事实类表达（否则上面的断言毫无意义）。
    expect(findImageStyleFactLeak("brushed titanium body with waterproof coating")).toEqual(
      expect.arrayContaining(["titanium", "brushed", "waterproof"]),
    );
    expect(findImageStyleFactLeak("controlled premium editorial lighting with subtle highlights")).toEqual([]);
  });

  it("resists disguised spellings and contrastive negations", () => {
    // 零宽字符、全角字符与「空格/连字符拆词」都是同一种事实表达的伪装形式。
    // 注意：检测器只覆盖「词内分隔符」类伪装；插入/重复字母属于另一串字符，不在 lint 范围内。
    expect(findImageStyleFactLeak("tit\u200Banium body")).toContain("titanium");
    expect(findImageStyleFactLeak("ｔｉｔａｎｉｕｍ body")).toContain("titanium");
    expect(findImageStyleFactLeak("water proof shell")).toContain("waterproof");
    expect(findImageStyleFactLeak("water-proof shell")).toContain("waterproof");
    // 让步对比不是否定：后面跟的仍是真实断言。
    expect(findImageStyleFactLeak("Not only waterproof.")).toContain("waterproof");
    expect(findImageStyleFactLeak("Not just waterproof.")).toContain("waterproof");
    // 真正的禁止语境仍然豁免，避免把「不得声称」误判成「声称」。
    expect(findImageStyleFactLeak("no certification badge")).toEqual([]);
    expect(findImageStyleFactLeak("never invent waterproof packaging")).toEqual([]);
  });

  it("maps each purpose to a compatible default direction", () => {
    for (const purpose of STUDIO_IMAGE_PRIMARY_PURPOSES) {
      const recommended = recommendedImageStylePreset(purpose.id);
      expect(isImageStylePresetId(recommended)).toBe(true);
      expect(DEFAULT_IMAGE_STYLE_PRESET_BY_PURPOSE[purpose.id]).toBe(recommended);
      // 推荐方向必须声明与用途兼容，避免推荐一个不适配的方向。
      expect(isImageStylePresetCompatibleWithPurpose(recommended, purpose.id)).toBe(true);
    }
    expect(recommendedImageStylePreset("white_studio")).toBe("amazon_clean_hero");
    expect(recommendedImageStylePreset("detail_closeup")).toBe("macro_detail");
    expect(recommendedImageStylePreset("packaging_bundle")).toBe("packaging_set");
    expect(recommendedImageStylePreset("dimension_specification")).toBe("feature_board");
    expect(recommendedImageStylePreset("custom")).toBe("premium_editorial");
  });

  it("exposes safe lookups for the default and unknown ids", () => {
    expect(DEFAULT_IMAGE_STYLE_PRESET_ID).toBe("amazon_clean_hero");
    expect(getImageStylePreset("campaign_visual").label).toBe("Campaign");
    expect(imageStylePresetLabel("lifestyle_home")).toBe("家居生活");
    expect(isImageStylePresetId("amazon_clean_hero")).toBe(true);
    expect(isImageStylePresetId("titanium_luxury")).toBe(false);
    expect(isImageStylePresetId(undefined)).toBe(false);
    expect(() => getImageStylePreset("titanium_luxury" as never)).toThrow(/unknown_image_style_preset/);
  });

  it("keeps the Chinese card copy stable for the UI contract", () => {
    const labels = IMAGE_STYLE_PRESETS.map((preset) => `${preset.label}｜${preset.description}`);
    expect(labels).toEqual([
      "高级白底｜干净棚拍，突出商品主体",
      "杂志质感｜克制侧光与高级商业摄影",
      "家居生活｜自然窗光与真实家庭场景",
      "户外故事｜自然环境中的使用叙事",
      "微距细节｜突出结构、纹理和工艺细节",
      "卖点视觉｜商品主体 + 信息留白",
      "套装展示｜包装、组件和套装规整呈现",
      "Campaign｜更强主视觉和广告构图",
    ]);
  });
});
