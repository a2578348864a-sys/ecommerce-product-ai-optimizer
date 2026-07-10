import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  generate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    images = { generate: state.generate };

    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
  },
}));

import {
  AiImageProviderError,
  DEFAULT_OPENAI_IMAGE_MODEL,
  generateOpenAiImage,
} from "@/lib/server/openaiImageClient";

describe("OpenAI image client contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.options = null;
    process.env.OPENAI_API_KEY = "test-only-key";
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
  });

  it("uses the official GPT Image 2 snapshot and base64 Image API parameters", async () => {
    state.generate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }], _request_id: "request-1" });
    const result = await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe prompt" });
    expect(DEFAULT_OPENAI_IMAGE_MODEL).toBe("gpt-image-2-2026-04-21");
    expect(state.options).toMatchObject({ maxRetries: 0, timeout: 130_000 });
    expect(state.generate).toHaveBeenCalledWith({
      model: DEFAULT_OPENAI_IMAGE_MODEL,
      prompt: "safe prompt",
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 85,
      background: "opaque",
      moderation: "auto",
    });
    expect(result).toEqual({ model: DEFAULT_OPENAI_IMAGE_MODEL, requestId: "request-1", images: [{ base64: "aW1hZ2U=" }] });
  });

  it("fails closed without configuration and sanitizes provider failures", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }))
      .rejects.toMatchObject({ code: "configuration_error" });

    process.env.OPENAI_API_KEY = "test-only-key";
    state.generate.mockRejectedValue({ status: 429, message: "raw provider details" });
    await expect(generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }))
      .rejects.toEqual(expect.objectContaining<AiImageProviderError>({ code: "rate_limited", retryable: true }));
  });
});
