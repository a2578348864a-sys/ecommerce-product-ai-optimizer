import { describe, expect, it } from "vitest";
import {
  buildStudioImageRequestCore,
  EMPTY_IMAGE_INTENT,
  EMPTY_PROMPT_IMAGE_INTENT,
  STUDIO_IMAGE_PROMPT_TEMPLATES,
  STUDIO_IMAGE_SCENE_GROUPS,
  createImageSceneSelection,
  type ImageFormIntent,
  type PromptImageFormIntent,
} from "@/lib/client/studioImageRequest";

describe("buildStudioImageRequestCore", () => {
  it("wires every visible guided image strategy field into the API request", () => {
    const intent: ImageFormIntent = {
      creationMode: "guided",
      imageType: "lifestyle_scene",
      visualStyle: "home",
      ...createImageSceneSelection("home_lifestyle", "  Warm morning light. "),
      count: 2,
      aspectRatio: "portrait_4_5",
      prohibitedElements: " Logo, watermark ",
    };

    expect(buildStudioImageRequestCore({
      productName: "  Foldable Laptop Stand ",
      description: " Silver aluminum body. ",
      intent,
      mode: "mock",
    })).toEqual({
      briefVersion: "studio-creative-brief.v1",
      factsConfirmed: true,
      humanReviewRequired: true,
      creationMode: "guided",
      productName: "Foldable Laptop Stand",
      description: "Silver aluminum body.",
      imageType: "lifestyle_scene",
      visualStyle: "home",
      count: 2,
      aspectRatio: "portrait_4_5",
      compositionRequirements: "Believable home-living context. Natural in-use composition with clear product scale. Warm morning light.",
      prohibitedElements: "Logo, watermark",
      mode: "mock",
    });
  });

  it("wires only prompt-mode fields plus optional product context", () => {
    const intent: PromptImageFormIntent = {
      creationMode: "prompt",
      creativePrompt: "  Editorial still life with soft side light. ",
      avoidElements: " Logos, watermarks ",
      count: 2,
      aspectRatio: "landscape_16_9",
    };

    const request = buildStudioImageRequestCore({
      productName: "  Ceramic mug ",
      description: " Matte green glaze. ",
      intent,
      mode: "mock",
    });

    expect(request).toEqual({
      briefVersion: "studio-creative-brief.v1",
      factsConfirmed: true,
      humanReviewRequired: true,
      creationMode: "prompt",
      productName: "Ceramic mug",
      description: "Matte green glaze.",
      creativePrompt: "Editorial still life with soft side light.",
      avoidElements: "Logos, watermarks",
      count: 2,
      aspectRatio: "landscape_16_9",
      mode: "mock",
    });
    expect(request).not.toHaveProperty("imageType");
    expect(request).not.toHaveProperty("visualStyle");
    expect(request).not.toHaveProperty("compositionRequirements");
    expect(request).not.toHaveProperty("prohibitedElements");
  });

  it("carries an explicitly approved reference image only when supplied", () => {
    const request = buildStudioImageRequestCore({
      productName: "Bottle",
      description: "Blue bottle",
      intent: EMPTY_IMAGE_INTENT,
      mode: "mock",
      referenceImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      referenceImageApproved: true,
    });

    expect(request).toMatchObject({
      referenceImageApproved: true,
      referenceImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("starts in the safe guided Mock product-main strategy", () => {
    expect(EMPTY_IMAGE_INTENT).toEqual({
      creationMode: "guided",
      imageType: "product_main",
      visualStyle: "minimal",
      ...createImageSceneSelection("white_studio"),
      count: 1,
      aspectRatio: "square_1_1",
      prohibitedElements: "",
    });
    expect(EMPTY_PROMPT_IMAGE_INTENT).toEqual({
      creationMode: "prompt",
      creativePrompt: "",
      avoidElements: "",
      count: 1,
      aspectRatio: "square_1_1",
    });
  });

  it("offers the bounded grouped ecommerce scene presets and maps them into the existing request contract", () => {
    expect(STUDIO_IMAGE_SCENE_GROUPS.map((group) => group.label)).toEqual([
      "电商基础",
      "生活方式",
      "其他",
    ]);
    expect(STUDIO_IMAGE_SCENE_GROUPS.flatMap((group) => group.presets.map((preset) => preset.label))).toEqual([
      "白底主图 / 棚拍",
      "卖点信息图",
      "尺寸规格图",
      "产品细节特写",
      "包装 / 套装展示",
      "使用步骤图",
      "家居生活",
      "办公 / 通勤",
      "户外 / 旅行",
      "运动 / 健身",
      "对比展示",
      "自定义场景",
    ]);

    const selection = createImageSceneSelection("outdoor_travel", "Keep room for a short headline.");
    expect(selection).toMatchObject({
      scenePreset: "outdoor_travel",
      sceneIntent: "outdoor_travel_context",
      customInstruction: "Keep room for a short headline.",
    });
    const request = buildStudioImageRequestCore({
      productName: "Travel bottle",
      description: "Blue insulated bottle",
      intent: {
        ...EMPTY_IMAGE_INTENT,
        ...selection,
        imageType: "lifestyle_scene",
        visualStyle: "outdoor",
      },
      mode: "mock",
    });
    expect(request).not.toHaveProperty("scenePreset");
    expect(request).not.toHaveProperty("sceneIntent");
    expect(request).not.toHaveProperty("customInstruction");
    const guidedRequest = request as { compositionRequirements: string };
    expect(guidedRequest.compositionRequirements).toContain("outdoor or travel context");
    expect(guidedRequest.compositionRequirements).toContain("Keep room for a short headline.");
  });

  it("exposes four controlled prompt templates without generation side effects", () => {
    expect(STUDIO_IMAGE_PROMPT_TEMPLATES.map((template) => template.id)).toEqual([
      "white_background",
      "lifestyle_scene",
      "detail_closeup",
      "ad_creative",
    ]);
    expect(STUDIO_IMAGE_PROMPT_TEMPLATES.every((template) => template.prompt.length > 40)).toBe(true);
  });
});
