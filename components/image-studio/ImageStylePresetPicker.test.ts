import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageStylePresetPicker } from "@/components/image-studio/ImageStylePresetPicker";
import { IMAGE_STYLE_PRESETS } from "@/lib/imageStyleLibrary";

/**
 * 视觉方向选择器 UI 契约（§17/§18/§31）：
 * 8 张卡片、中文标题 + 一句说明 + 轻量预览，不暴露 JSON / Prompt internals / 外部仓库术语。
 */
function render(value: Parameters<typeof ImageStylePresetPicker>[0]["value"], recommendedId?: Parameters<typeof ImageStylePresetPicker>[0]["recommendedId"]) {
  return renderToStaticMarkup(createElement(ImageStylePresetPicker, { value, onChange: () => undefined, recommendedId }));
}

describe("ImageStylePresetPicker", () => {
  it("renders all eight style cards with Chinese labels and one-line explanations", () => {
    const html = render("amazon_clean_hero");
    expect(html).toContain('data-testid="image-style-preset-picker"');
    expect(html).toContain("视觉方向");
    for (const preset of IMAGE_STYLE_PRESETS) {
      expect(html).toContain(preset.label);
      expect(html).toContain(preset.description);
      expect(html).toContain(`value="${preset.id}"`);
    }
    expect((html.match(/type="radio"/g) ?? [])).toHaveLength(8);
    expect((html.match(/<svg/g) ?? [])).toHaveLength(8);
  });

  it("marks the selected style and never leaks prompt internals", () => {
    const html = render("campaign_visual");
    expect(html).toMatch(/<input(?=[^>]*value="campaign_visual")(?=[^>]*checked)[^>]*>/);
    expect(html).not.toContain("stylePresetId");
    expect(html).not.toContain("[STYLE PRESET]");
    expect(html).not.toContain("gpt-image");
    expect(html).not.toContain("awesome-gpt-image-2");
    expect(html).not.toContain("{");
  });

  it("shows the recommended direction for the current purpose without overriding the user choice", () => {
    const html = render("premium_editorial", "macro_detail");
    expect(html).toContain('data-recommended="true"');
    expect(html).toContain("推荐");
    // 用户显式选择仍然是被勾选的那一个，推荐只做标记。
    expect(html).toMatch(/<input(?=[^>]*value="premium_editorial")(?=[^>]*checked)[^>]*>/);
    expect(html).not.toMatch(/<input(?=[^>]*value="macro_detail")(?=[^>]*checked)[^>]*>/);
  });

  it("states that the visual direction cannot change product facts", () => {
    const html = render("lifestyle_home");
    expect(html).toContain("不改变商品事实、材质或配件");
  });
});
