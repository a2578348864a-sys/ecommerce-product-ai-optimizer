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
  ALLOWED_IMAGE_BASE_HOSTNAME,
  ALLOWED_IMAGE_MODELS,
  generateOpenAiImage,
  validateImageBaseUrl,
  validateImageModel,
} from "@/lib/server/openaiImageClient";

describe("image base URL validation", () => {
  it("throws configuration_error when baseURL is empty", () => {
    expect(() => validateImageBaseUrl("")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl(""); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
      expect((e as AiImageProviderError).message).toMatch(/[一-鿿]/);
      // Must not leak raw input
      expect((e as AiImageProviderError).message).not.toContain("http");
    }
  });

  it("throws configuration_error for a non-HTTPS URL", () => {
    expect(() => validateImageBaseUrl("http://api.65535.space/v1")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl("http://api.65535.space/v1"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
      expect((e as AiImageProviderError).message).toMatch(/[一-鿿]/);
      expect((e as AiImageProviderError).message).not.toContain("http://");
    }
  });

  it("throws configuration_error for a non-allowed hostname", () => {
    expect(() => validateImageBaseUrl("https://api.openai.com/v1")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl("https://api.openai.com/v1"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
      expect((e as AiImageProviderError).message).not.toContain("openai.com");
    }
  });

  it("throws configuration_error for a URL containing username:password", () => {
    expect(() => validateImageBaseUrl("https://user:pass@api.65535.space/v1")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl("https://user:pass@api.65535.space/v1"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
      expect((e as AiImageProviderError).message).not.toContain("user");
      expect((e as AiImageProviderError).message).not.toContain("pass");
    }
  });

  it("throws configuration_error for a URL with query string", () => {
    expect(() => validateImageBaseUrl("https://api.65535.space/v1?foo=bar")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl("https://api.65535.space/v1?foo=bar"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
    }
  });

  it("throws configuration_error for a URL with fragment", () => {
    expect(() => validateImageBaseUrl("https://api.65535.space/v1#section")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl("https://api.65535.space/v1#section"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
    }
  });

  it("throws configuration_error for a non-parseable URL", () => {
    expect(() => validateImageBaseUrl("not-a-url")).toThrowError(AiImageProviderError);
    try { validateImageBaseUrl("not-a-url"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
      expect((e as AiImageProviderError).message).not.toContain("not-a-url");
    }
  });

  it("normalizes the path to /v1 and strips query and fragment", () => {
    const result = validateImageBaseUrl("https://api.65535.space/");
    expect(result).toBe("https://api.65535.space/v1");
  });

  it("accepts the canonical relay base URL as-is", () => {
    expect(validateImageBaseUrl("https://api.65535.space/v1")).toBe("https://api.65535.space/v1");
  });

  it("accepts a URL with trailing whitespace", () => {
    expect(validateImageBaseUrl("  https://api.65535.space/v1  ")).toBe("https://api.65535.space/v1");
  });
});

describe("image model validation", () => {
  it("throws configuration_error when model is empty", () => {
    expect(() => validateImageModel("")).toThrowError(AiImageProviderError);
    try { validateImageModel(""); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
    }
  });

  it("throws configuration_error for a model not in the allowlist", () => {
    expect(ALLOWED_IMAGE_MODELS.has("gpt-image-2")).toBe(true);
    expect(() => validateImageModel("gpt-image-2-2026-04-21")).toThrowError(AiImageProviderError);
    expect(() => validateImageModel("dall-e-3")).toThrowError(AiImageProviderError);
    expect(() => validateImageModel("gpt-image-1")).toThrowError(AiImageProviderError);
    try { validateImageModel("dall-e-3"); } catch (e) {
      expect((e as AiImageProviderError).code).toBe("configuration_error");
      expect((e as AiImageProviderError).message).toMatch(/[一-鿿]/);
    }
  });

  it("accepts gpt-image-2", () => {
    expect(validateImageModel("gpt-image-2")).toBe("gpt-image-2");
  });

  it("trims whitespace from the model name", () => {
    expect(validateImageModel("  gpt-image-2  ")).toBe("gpt-image-2");
  });
});

describe("OpenAI image client relay configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.options = null;
    process.env.OPENAI_API_KEY = "test-relay-key";
    process.env.OPENAI_IMAGE_BASE_URL = "https://api.65535.space/v1";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_BASE_URL;
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
  });

  it("creates the OpenAI client with the validated relay baseURL, maxRetries: 0 and timeout", async () => {
    state.generate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }], _request_id: "request-1" });
    await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe prompt" });
    expect(state.options).toMatchObject({
      baseURL: "https://api.65535.space/v1",
      maxRetries: 0,
      timeout: 130_000,
    });
  });

  it("passes the validated model and OpenAI-compatible parameters to images.generate", async () => {
    state.generate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }] });
    await generateOpenAiImage({ imageType: "lifestyle_scene", count: 2, prompt: "test prompt" });
    expect(state.generate).toHaveBeenCalledWith({
      model: "gpt-image-2",
      prompt: "test prompt",
      n: 2,
      size: "1536x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 85,
      background: "auto",
      moderation: "auto",
    });
  });

  it("returns the relay provider label in output", async () => {
    state.generate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }], _request_id: "req-2" });
    const result = await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" });
    expect(result).toEqual({
      model: "gpt-image-2",
      provider: "openai_compatible_relay",
      requestId: "req-2",
      images: [{ base64: "aW1hZ2U=" }],
    });
  });

  it("accepts b64_json responses from the relay", async () => {
    state.generate.mockResolvedValue({ data: [{ b64_json: "cmVsYXk=" }] });
    const result = await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" });
    expect(result.images).toEqual([{ base64: "cmVsYXk=" }]);
  });

  it("rejects a response where any item has only a URL but no base64", async () => {
    state.generate.mockResolvedValue({ data: [{ url: "https://cdn.example.com/img.png" }] });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toEqual(
      expect.objectContaining<AiImageProviderError>({
        code: "image_provider_incompatible_response",
        retryable: false,
      }),
    );
  });

  it("rejects a mixed response that includes both b64_json items and URL-only items", async () => {
    state.generate.mockResolvedValue({
      data: [{ b64_json: "aW1hZ2U=" }, { url: "https://cdn.example.com/fallback.png" }],
    });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 2, prompt: "safe" }),
    ).rejects.toEqual(
      expect.objectContaining<AiImageProviderError>({
        code: "image_provider_incompatible_response",
      }),
    );
  });

  it("does NOT download arbitrary upstream URLs (SSRF prevention)", async () => {
    state.generate.mockResolvedValue({ data: [{ url: "http://169.254.169.254/latest/meta-data/" }] });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toEqual(
      expect.objectContaining<AiImageProviderError>({
        code: "image_provider_incompatible_response",
      }),
    );
    // The client must not have attempted to fetch the URL — the mock generate just returns data.
    // The rejection comes from our post-processing, not from an HTTP fetch.
  });

  it("throws configuration_error when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "configuration_error" });
  });

  it("throws configuration_error when OPENAI_IMAGE_BASE_URL is missing", async () => {
    delete process.env.OPENAI_IMAGE_BASE_URL;
    await expect(
      generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "configuration_error" });
  });

  it("throws configuration_error when OPENAI_IMAGE_MODEL is missing", async () => {
    delete process.env.OPENAI_IMAGE_MODEL;
    await expect(
      generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "configuration_error" });
  });

  it("throws configuration_error with a non-HTTPS OPENAI_IMAGE_BASE_URL", async () => {
    process.env.OPENAI_IMAGE_BASE_URL = "http://api.65535.space/v1";
    await expect(
      generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "configuration_error" });
  });
});

describe("OpenAI image client error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.options = null;
    process.env.OPENAI_API_KEY = "test-relay-key";
    process.env.OPENAI_IMAGE_BASE_URL = "https://api.65535.space/v1";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_BASE_URL;
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
  });

  it("maps 401 to provider_error with a Chinese message that does not leak the base URL", async () => {
    state.generate.mockRejectedValue({ status: 401, message: "raw upstream detail" });
    try {
      await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AiImageProviderError).code).toBe("provider_error");
      expect((e as AiImageProviderError).retryable).toBe(false);
      expect((e as AiImageProviderError).message).toMatch(/[一-鿿]/);
      expect((e as AiImageProviderError).message).not.toContain("65535");
      expect((e as AiImageProviderError).message).not.toContain("raw upstream detail");
    }
  });

  it("maps 403 to provider_error", async () => {
    state.generate.mockRejectedValue({ status: 403 });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "provider_error", retryable: false });
  });

  it("maps 429 to rate_limited (retryable but not auto-retried)", async () => {
    state.generate.mockRejectedValue({ status: 429, message: "raw provider details" });
    await expect(
      generateOpenAiImage({ imageType: "lifestyle_scene", count: 1, prompt: "safe" }),
    ).rejects.toEqual(
      expect.objectContaining<AiImageProviderError>({ code: "rate_limited", retryable: true }),
    );
  });

  it("maps 500 to provider_unavailable (retryable)", async () => {
    state.generate.mockRejectedValue({ status: 500 });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("maps 503 to provider_unavailable", async () => {
    state.generate.mockRejectedValue({ status: 503 });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("maps connection timeout to timeout error", async () => {
    const timeoutError = new Error("Connection timed out");
    (timeoutError as { name?: string }).name = "APIConnectionTimeoutError";
    state.generate.mockRejectedValue(timeoutError);
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });

  it("maps network errors to provider_error", async () => {
    state.generate.mockRejectedValue(new Error("fetch failed"));
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "provider_error", retryable: false });
  });

  it("maps ETIMEDOUT to timeout", async () => {
    const err = new Error("connect ETIMEDOUT");
    (err as { code?: string }).code = "ETIMEDOUT";
    state.generate.mockRejectedValue(err);
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });

  it("maps ABORT_ERR to timeout", async () => {
    const err = new Error("The operation was aborted");
    (err as { code?: string }).code = "ABORT_ERR";
    state.generate.mockRejectedValue(err);
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });

  it("maps moderation_blocked to content_blocked", async () => {
    const err = new Error("moderation");
    (err as { code?: string }).code = "moderation_blocked";
    state.generate.mockRejectedValue(err);
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "content_blocked", retryable: false });
  });

  it("maps empty response to empty_response (retryable)", async () => {
    state.generate.mockResolvedValue({ data: [] });
    await expect(
      generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" }),
    ).rejects.toMatchObject({ code: "empty_response", retryable: true });
  });

  it("does not leak the API key in any error message", async () => {
    state.generate.mockRejectedValue({ status: 500, message: "internal error" });
    try {
      await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" });
    } catch (e) {
      const msg = (e as AiImageProviderError).message;
      expect(msg).not.toContain("test-relay-key");
      expect(msg).not.toContain("sk-");
    }
    delete process.env.OPENAI_API_KEY;
    try {
      await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: "safe" });
    } catch (e) {
      expect((e as AiImageProviderError).message).not.toContain("test-relay-key");
    }
  });

  it("does not leak the full prompt in error messages", async () => {
    const longPrompt = "A".repeat(4000);
    state.generate.mockRejectedValue({ status: 500 });
    try {
      await generateOpenAiImage({ imageType: "white_background_concept", count: 1, prompt: longPrompt });
    } catch (e) {
      const msg = (e as AiImageProviderError).message;
      expect(msg).not.toContain(longPrompt);
      expect(msg.length).toBeLessThan(200);
    }
  });
});

describe("relay constants", () => {
  it("only allows the approved relay hostname", () => {
    expect(ALLOWED_IMAGE_BASE_HOSTNAME).toBe("api.65535.space");
  });

  it("only allows gpt-image-2 as the image model", () => {
    expect(ALLOWED_IMAGE_MODELS).toEqual(new Set(["gpt-image-2"]));
  });

  it("rejects the old official snapshot model identifier", () => {
    expect(ALLOWED_IMAGE_MODELS.has("gpt-image-2-2026-04-21")).toBe(false);
  });
});
