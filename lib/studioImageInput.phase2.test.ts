import { describe, expect, it } from "vitest";
import { parseStudioImageInput, toStudioImageContext } from "./studioImageInput";

const VALID_IMAGE_BRIEF = {
  briefVersion: "studio-creative-brief.v1",
  productName: "Insulated bottle",
  description: "Matte blue bottle with a carry handle.",
  creationMode: "guided",
  imageType: "product_main",
  visualStyle: "minimal",
  aspectRatio: "square_1_1",
  count: 2,
  compositionRequirements: "Centered with soft shadow",
  prohibitedElements: "No logo additions",
  factsConfirmed: true,
  humanReviewRequired: true,
  mode: "mock",
} as const;

describe("studio-creative-brief.v1 Image contract", () => {
  it("keeps no-reference Manual generation in composition-concept mode", () => {
    const parsed = parseStudioImageInput(VALID_IMAGE_BRIEF);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.visualAuthority).toBe("composition_concept");
    expect(parsed.data.referenceImageDataUrl).toBeUndefined();
    expect(toStudioImageContext(parsed.data)).not.toHaveProperty("referenceImageDataUrl");
  });

  it("requires explicit approval when a reference image is supplied", () => {
    const parsed = parseStudioImageInput({
      ...VALID_IMAGE_BRIEF,
      referenceImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      referenceImageApproved: false,
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("reference_image_confirmation_required");
  });

  it("marks an explicitly approved reference as product-visual authority without exposing it in public context", () => {
    const parsed = parseStudioImageInput({
      ...VALID_IMAGE_BRIEF,
      referenceImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      referenceImageApproved: true,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.visualAuthority).toBe("product_visual_draft");
    expect(toStudioImageContext(parsed.data)).not.toHaveProperty("referenceImageDataUrl");
  });
});
