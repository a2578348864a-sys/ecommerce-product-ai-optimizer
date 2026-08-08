import { describe, expect, it } from "vitest";
import {
  validateStudioReferenceImageDataUrl,
} from "./studioReferenceImage";

const VALID_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("validateStudioReferenceImageDataUrl", () => {
  it("accepts a fully decoded image whose declared MIME matches magic bytes", async () => {
    const result = await validateStudioReferenceImageDataUrl(`data:image/png;base64,${VALID_PNG}`);

    expect(result).toMatchObject({ mimeType: "image/png", width: 1, height: 1 });
  });

  it("rejects corrupt image bytes with the stable public category", async () => {
    await expect(validateStudioReferenceImageDataUrl("data:image/png;base64,aGVsbG8="))
      .rejects.toMatchObject({ code: "invalid_reference_image", status: 400 });
  });

  it("rejects a declared MIME that differs from the decoded file", async () => {
    await expect(validateStudioReferenceImageDataUrl(`data:image/jpeg;base64,${VALID_PNG}`))
      .rejects.toMatchObject({ code: "invalid_reference_image" });
  });
});
