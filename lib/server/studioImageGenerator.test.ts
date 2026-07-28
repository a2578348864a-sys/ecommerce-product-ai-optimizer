import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { generateMockStudioImage } from "@/lib/server/studioImageGenerator";
import type { StudioImageInput } from "@/lib/studioImageInput";

const baseInput: StudioImageInput = {
  creationMode: "guided",
  productName: "Foldable Laptop Stand",
  description: "Silver aluminum stand for compact desks.",
  imageType: "product_main",
  visualStyle: "minimal",
  aspectRatio: "square_1_1",
  count: 1,
  compositionRequirements: "Centered three-quarter view",
  prohibitedElements: "Logo and watermark",
  mode: "mock",
  confirmRealAi: false,
  idempotencyKey: "",
  legacyAdditionalDirection: "",
};

const promptInput: StudioImageInput = {
  creationMode: "prompt",
  productName: "Ceramic travel mug",
  description: "Matte green glaze with a simple cylindrical silhouette.",
  creativePrompt: "Create a quiet editorial still life with soft side light and restrained shadows.",
  avoidElements: "logos, watermarks, embedded copy",
  aspectRatio: "square_1_1",
  count: 1,
  mode: "mock",
  confirmRealAi: false,
  idempotencyKey: "",
  legacyAdditionalDirection: "",
};

function decodedSvg(dataUrl: string) {
  return Buffer.from(dataUrl.split(",")[1] || "", "base64").toString("utf8");
}

describe("generateMockStudioImage", () => {
  it.each([
    ["product_main", "product-main"],
    ["lifestyle_scene", "lifestyle-scene"],
    ["selling_point_display", "selling-point-display"],
    ["ad_creative", "ad-creative"],
  ] as const)("renders a deterministic, type-specific %s composition", (imageType, marker) => {
    const result = generateMockStudioImage({ ...baseInput, imageType });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodedSvg(result.images[0].base64)).toContain(`data-mock-layout="${marker}"`);
    expect(result.meta.creationMode).toBe("guided");
    if (result.meta.creationMode === "guided") {
      expect(result.meta.input.imageType).toBe(imageType);
    }
  });

  it("uses style, product facts, composition, and exclusions in the deterministic context", () => {
    const minimal = generateMockStudioImage(baseInput);
    const premium = generateMockStudioImage({ ...baseInput, visualStyle: "premium" });

    expect(minimal.ok).toBe(true);
    expect(premium.ok).toBe(true);
    if (!minimal.ok || !premium.ok) return;
    expect(minimal.images[0].base64).not.toBe(premium.images[0].base64);
    const svg = decodedSvg(minimal.images[0].base64);
    expect(svg).toContain("Foldable Laptop Stand");
    expect(svg).toContain("Silver aluminum stand");
    expect(svg).toContain("Centered three-quarter view");
    expect(svg).toContain("Logo and watermark");
  });

  it("maps aspect ratio to dimensions and gives each requested variant a distinct preview", () => {
    const result = generateMockStudioImage({
      ...baseInput,
      aspectRatio: "landscape_16_9",
      count: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({ width: 1200, height: 675 });
    expect(result.images[0].base64).not.toBe(result.images[1].base64);
  });

  it("reports transparent local-only quality checks", () => {
    const result = generateMockStudioImage(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.qualityCheck).toEqual({
      source: "local_mock_helper",
      logo: "mock_not_added",
      text: "mock_label_present",
      watermark: "mock_not_added",
      descriptionConsistency: "request_context_embedded",
      humanReviewRequired: true,
    });
  });

  it("renders prompt mode deterministically while consuming prompt, avoid list, and product context", () => {
    const first = generateMockStudioImage(promptInput);
    const same = generateMockStudioImage(promptInput);
    const promptChanged = generateMockStudioImage({
      ...promptInput,
      creativePrompt: "Create a bold geometric campaign image with hard directional light.",
    });
    const avoidChanged = generateMockStudioImage({
      ...promptInput,
      avoidElements: "logos, watermarks, embedded copy, reflections",
    });
    const productChanged = generateMockStudioImage({
      ...promptInput,
      productName: "Foldable laptop stand",
    });

    expect(first.ok).toBe(true);
    expect(same.ok).toBe(true);
    expect(promptChanged.ok).toBe(true);
    expect(avoidChanged.ok).toBe(true);
    expect(productChanged.ok).toBe(true);
    if (!first.ok || !same.ok || !promptChanged.ok || !avoidChanged.ok || !productChanged.ok) return;

    expect(first.images[0].base64).toBe(same.images[0].base64);
    expect(first.images[0].base64).not.toBe(promptChanged.images[0].base64);
    expect(first.images[0].base64).not.toBe(avoidChanged.images[0].base64);
    expect(first.images[0].base64).not.toBe(productChanged.images[0].base64);
    expect(first.meta.creationMode).toBe("prompt");
    if (first.meta.creationMode !== "prompt") return;
    expect(first.meta.promptSummary).toContain("自定义创意");
    expect(first.meta.avoidElementsSummary).toBe("logos, watermarks, embedded copy");
    expect(JSON.stringify(first)).not.toContain(promptInput.creativePrompt);
    expect(decodedSvg(first.images[0].base64)).not.toContain(promptInput.creativePrompt);
  });

  it("applies prompt-mode aspect ratio and count without returning identical variants", () => {
    const result = generateMockStudioImage({
      ...promptInput,
      aspectRatio: "portrait_4_5",
      count: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({ width: 800, height: 1000 });
    expect(result.images[0].base64).not.toBe(result.images[1].base64);
  });

});
