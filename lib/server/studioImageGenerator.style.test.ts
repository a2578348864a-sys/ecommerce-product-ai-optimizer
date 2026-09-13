import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { generateMockStudioImage } from "@/lib/server/studioImageGenerator";
import { IMAGE_STYLE_PRESETS, type ImageStylePresetId } from "@/lib/imageStyleLibrary";
import type { StudioImageInput } from "@/lib/studioImageInput";

/**
 * 本地 Mock 的风格区分（§25）：8 个视觉方向在 palette 与 marker 上必须可区分，
 * 且 mock 不得因为风格而改变商品事实（标题/描述逐字不变）。
 * 真实效果以 Real Provider 为准 —— 这里只证明「视觉方向确实传导到了生成层」。
 */
const baseInput: StudioImageInput = {
  creationMode: "guided",
  productName: "Foldable Laptop Stand",
  description: "Silver aluminum stand for compact desks.",
  imageType: "product_main",
  visualStyle: "minimal",
  stylePresetId: "amazon_clean_hero",
  aspectRatio: "square_1_1",
  count: 1,
  compositionRequirements: "Centered three-quarter view",
  prohibitedElements: "Logo and watermark",
  mode: "mock",
  confirmRealAi: false,
  idempotencyKey: "",
  legacyAdditionalDirection: "",
};

function svgOf(dataUrl: string) {
  return Buffer.from(dataUrl.split(",")[1] || "", "base64").toString("utf8");
}

function mockFor(stylePresetId: ImageStylePresetId) {
  const result = generateMockStudioImage({ ...baseInput, stylePresetId });
  if (!result.ok) throw new Error("mock generation failed");
  return svgOf(result.images[0]!.base64);
}

describe("studio mock style variance", () => {
  it("emits a distinct style marker and palette per visual direction", () => {
    const svgs = IMAGE_STYLE_PRESETS.map((preset) => mockFor(preset.id));
    const markers = svgs.map((svg) => /data-mock-style="([^"]+)"/.exec(svg)?.[1] ?? "");
    // 8 个方向 → 8 个不同 marker（同时覆盖 palette marker 与 SVG 属性）。
    expect(new Set(markers).size).toBe(8);
    // 8 个方向 → 至少 6 种不同底色（保证肉眼可区分，不要求两两不同色号）。
    const backgrounds = svgs.map((svg) => /<rect fill="(#[0-9a-f]{6})" width/.exec(svg)?.[1] ?? "");
    expect(new Set(backgrounds).size).toBeGreaterThanOrEqual(6);
  });

  it("labels the mock with the Chinese visual direction without touching product facts", () => {
    const svg = mockFor("campaign_visual");
    expect(svg).toContain("Campaign");
    expect(svg).toContain("Style: campaign-key");
    expect(svg).toContain("Foldable Laptop Stand");
    expect(svg).toContain("Silver aluminum stand for compact desks.");
  });

  it("keeps prompt-mode mocks style-aware as well", () => {
    const promptInput: StudioImageInput = {
      creationMode: "prompt",
      productName: "Ceramic travel mug",
      description: "Matte green glaze.",
      creativePrompt: "Create a quiet editorial still life with soft side light.",
      avoidElements: "logos, watermarks",
      aspectRatio: "square_1_1",
      count: 1,
      stylePresetId: "macro_detail",
      mode: "mock",
      confirmRealAi: false,
      idempotencyKey: "",
      legacyAdditionalDirection: "",
    };
    const result = generateMockStudioImage(promptInput);
    if (!result.ok) throw new Error("mock generation failed");
    const svg = svgOf(result.images[0]!.base64);
    expect(svg).toContain('data-mock-style="macro-detail"');
    expect(svg).toContain("微距细节");
    expect(result.meta.creationMode).toBe("prompt");
    if (result.meta.creationMode === "prompt") {
      expect(result.meta.input.stylePresetId).toBe("macro_detail");
    }
  });

  it("is deterministic for the same style and input", () => {
    expect(mockFor("premium_editorial")).toBe(mockFor("premium_editorial"));
    expect(mockFor("premium_editorial")).not.toBe(mockFor("outdoor_story"));
  });
});
