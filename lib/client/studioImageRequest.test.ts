import { describe, expect, it } from "vitest";
import {
  buildStudioImageRequestCore,
  EMPTY_IMAGE_INTENT,
  EMPTY_PROMPT_IMAGE_INTENT,
  STUDIO_IMAGE_LIFESTYLE_SCENES,
  STUDIO_IMAGE_PRIMARY_PURPOSES,
  STUDIO_IMAGE_PROMPT_TEMPLATES,
  type ImageFormIntent,
  type PromptImageFormIntent,
} from "@/lib/client/studioImageRequest";

describe("buildStudioImageRequestCore", () => {
  it("wires every visible guided image strategy field into the API request", () => {
    const intent: ImageFormIntent = {
      creationMode: "guided",
      primaryImagePurpose: "detail_closeup",
      lifestyleScene: "office_commute",
      customImagePurpose: "",
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
      primaryImagePurpose: "detail_closeup",
      lifestyleScene: "office_commute",
      customImagePurpose: "",
      count: 2,
      aspectRatio: "portrait_4_5",
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
      primaryImagePurpose: "white_studio",
      lifestyleScene: "none",
      customImagePurpose: "",
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

  it("separates exactly one primary purpose from at most one optional lifestyle scene", () => {
    expect(STUDIO_IMAGE_PRIMARY_PURPOSES.map((purpose) => purpose.label)).toEqual([
      "白底主图/棚拍",
      "卖点信息图",
      "尺寸规格图",
      "产品细节特写",
      "包装/套装展示",
      "使用步骤图",
      "对比展示",
      "自定义",
    ]);
    expect(STUDIO_IMAGE_LIFESTYLE_SCENES.map((scene) => scene.label)).toEqual([
      "不指定",
      "家居生活",
      "办公/通勤",
      "户外/旅行",
      "运动/健身",
    ]);

    const request = buildStudioImageRequestCore({
      productName: "Travel bottle",
      description: "Blue insulated bottle",
      intent: {
        ...EMPTY_IMAGE_INTENT,
        primaryImagePurpose: "detail_closeup",
        lifestyleScene: "outdoor_travel",
      },
      mode: "mock",
    });
    expect(request).toMatchObject({
      primaryImagePurpose: "detail_closeup",
      lifestyleScene: "outdoor_travel",
      customImagePurpose: "",
    });
    expect(request).not.toHaveProperty("imageType");
    expect(request).not.toHaveProperty("compositionRequirements");
  });

  it("keeps white-background purpose scene-free and carries custom purpose explicitly", () => {
    expect(buildStudioImageRequestCore({
      productName: "Bottle",
      description: "Blue bottle",
      intent: {
        ...EMPTY_IMAGE_INTENT,
        primaryImagePurpose: "white_studio",
        lifestyleScene: "outdoor_travel",
      },
      mode: "mock",
    })).toMatchObject({
      primaryImagePurpose: "white_studio",
      lifestyleScene: "none",
    });

    expect(buildStudioImageRequestCore({
      productName: "Bottle",
      description: "Blue bottle",
      intent: {
        ...EMPTY_IMAGE_INTENT,
        primaryImagePurpose: "custom",
        lifestyleScene: "home_lifestyle",
        customImagePurpose: "节日礼赠展示",
      },
      mode: "mock",
    })).toMatchObject({
      primaryImagePurpose: "custom",
      lifestyleScene: "home_lifestyle",
      customImagePurpose: "节日礼赠展示",
    });
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
