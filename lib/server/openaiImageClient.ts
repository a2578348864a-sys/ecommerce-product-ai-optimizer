import "server-only";

import OpenAI from "openai";
import type { AiImageDraftType } from "@/lib/aiImageDraft";
import {
  downloadImageFromUrl,
  getImageResultHostWhitelist,
  ImageUrlFetchError,
  validateImageResultUrl,
} from "@/lib/server/aiImageUrlFetcher";

export const ALLOWED_IMAGE_BASE_HOSTNAME = "api.65535.space";
export const ALLOWED_IMAGE_MODELS = new Set(["gpt-image-2"]);
const DEFAULT_TIMEOUT_MS = 130_000;

export type AiImageProviderInput = {
  imageType: AiImageDraftType;
  count: 1 | 2;
  prompt: string;
  onResultReceived?: (candidateCount: number) => void;
};

export type AiImageProviderOutput = {
  model: string;
  provider: "openai_compatible_relay";
  requestId?: string;
  images: Array<{ base64: string }>;
  requestedFormat?: "webp";
};

export type AiImageProviderFailureStage =
  | "provider_call"
  | "provider_response"
  | "asset_download"
  | "asset_validation";

export type AiImageProvider = (input: AiImageProviderInput) => Promise<AiImageProviderOutput>;

export class AiImageProviderError extends Error {
  constructor(
    public readonly code:
      | "timeout"
      | "rate_limited"
      | "provider_unavailable"
      | "content_blocked"
      | "invalid_request"
      | "empty_response"
      | "configuration_error"
      | "provider_error"
      | "image_provider_incompatible_response"
      | "image_provider_untrusted_result_url"
      | "image_provider_result_dns_rejected"
      | "image_provider_result_redirect_rejected"
      | "image_provider_result_download_failed"
      | "image_provider_result_timeout"
      | "image_provider_result_too_large"
      | "image_provider_result_invalid_mime"
      | "image_provider_result_invalid_image",
    message: string,
    public readonly retryable = false,
    public readonly providerCostConsumed = false,
    public readonly failureStage: AiImageProviderFailureStage = "provider_call",
  ) {
    super(message);
  }
}

let providerForTests: AiImageProvider | null = null;

function timeoutMs(): number {
  const parsed = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 10_000 ? Math.trunc(parsed) : DEFAULT_TIMEOUT_MS;
}

export function validateImageBaseUrl(raw: string): string {
  if (!raw || !raw.trim()) {
    throw new AiImageProviderError(
      "configuration_error",
      "图片中转站地址尚未配置。",
      false,
    );
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AiImageProviderError(
      "configuration_error",
      "图片中转站地址格式无效。",
      false,
    );
  }
  if (url.protocol !== "https:") {
    throw new AiImageProviderError(
      "configuration_error",
      "图片中转站必须使用 HTTPS 协议。",
      false,
    );
  }
  if (url.hostname !== ALLOWED_IMAGE_BASE_HOSTNAME) {
    throw new AiImageProviderError(
      "configuration_error",
      "图片中转站域名不在允许列表中。",
      false,
    );
  }
  if (url.username || url.password) {
    throw new AiImageProviderError(
      "configuration_error",
      "图片中转站地址不得包含用户名或密码。",
      false,
    );
  }
  if (url.search || url.hash) {
    throw new AiImageProviderError(
      "configuration_error",
      "图片中转站地址不得包含 query 或 fragment。",
      false,
    );
  }
  url.pathname = "/v1";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function validateImageModel(raw: string): string {
  const model = (raw || "").trim();
  if (!model) {
    throw new AiImageProviderError(
      "configuration_error",
      "图片模型尚未配置。",
      false,
    );
  }
  if (!ALLOWED_IMAGE_MODELS.has(model)) {
    throw new AiImageProviderError(
      "configuration_error",
      "图片模型不在当前允许列表中。",
      false,
    );
  }
  return model;
}

function assetFailureStage(code: ImageUrlFetchError["code"]): AiImageProviderFailureStage {
  if ([
    "image_provider_result_too_large",
    "image_provider_result_invalid_mime",
    "image_provider_result_invalid_image",
  ].includes(code)) return "asset_validation";
  return code === "image_provider_untrusted_result_url" ? "provider_response" : "asset_download";
}

function mapProviderError(error: unknown, providerResultReceived = false): AiImageProviderError {
  if (error instanceof AiImageProviderError) return error;
  if (error instanceof ImageUrlFetchError) {
    return new AiImageProviderError(
      error.code,
      error.message,
      false,
      providerResultReceived,
      assetFailureStage(error.code),
    );
  }
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const name = error instanceof Error ? error.name : "";
  if (code === "moderation_blocked" || code === "image_generation_user_error") {
    return new AiImageProviderError("content_blocked", "图片请求未通过内容安全检查。", false);
  }
  if (status === 401 || status === 403) {
    return new AiImageProviderError("provider_error", "图片中转站鉴权失败，请检查 API Key 配置。", false);
  }
  if (status === 429) return new AiImageProviderError("rate_limited", "图片服务繁忙，请稍后重试。", true);
  if (status >= 500) return new AiImageProviderError("provider_unavailable", "图片服务暂时不可用。", true);
  if (status >= 400) return new AiImageProviderError("invalid_request", "图片请求不符合服务要求。", false);
  if (name === "APIConnectionTimeoutError" || code === "ETIMEDOUT" || code === "ABORT_ERR") {
    return new AiImageProviderError("timeout", "图片生成超时。", true);
  }
  return new AiImageProviderError("provider_error", "图片生成服务调用失败。", false);
}

/**
 * Classify each provider response item as base64_result, relay_url_result, or incompatible.
 * Only called when at least one item has a URL and no b64_json.
 */
type ImageResultItem =
  | { kind: "base64_result"; base64: string }
  | { kind: "relay_url_result"; url: string };

function classifyImageResults(
  data: Array<{ b64_json?: string; url?: string }>,
): ImageResultItem[] {
  const result: ImageResultItem[] = [];
  for (const item of data) {
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      result.push({ kind: "base64_result", base64: item.b64_json });
    } else if (typeof item.url === "string" && item.url.length > 0) {
      result.push({ kind: "relay_url_result", url: item.url });
    }
    // else: drop incompatible silently — will be caught by count mismatch below
  }
  return result;
}

/**
 * Convert a relay URL result to base64 via secure download.
 * The downloaded bytes are validated through the full storage pipeline
 * (magic numbers, dimensions, pixel limit, MIME consistency).
 */
async function fetchRelayUrlAsBase64(
  url: string,
  whitelist: Set<string>,
  requestId?: string,
): Promise<string> {
  const result = await downloadImageFromUrl(url, whitelist, undefined, { requestId });
  return result.bytes.toString("base64");
}

export const generateOpenAiImage: AiImageProvider = async (input) => {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new AiImageProviderError("configuration_error", "OpenAI 图片服务尚未配置。", false);

  const baseURL = validateImageBaseUrl((process.env.OPENAI_IMAGE_BASE_URL || "").trim());
  const model = validateImageModel((process.env.OPENAI_IMAGE_MODEL || "").trim());

  const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs(), maxRetries: 0 });

  let responseData: Array<{ b64_json?: string; url?: string }>;
  let requestId: string | undefined;
  try {
    const response = await client.images.generate({
      model,
      prompt: input.prompt,
      n: input.count,
      size: input.imageType === "white_background_concept" ? "1024x1024" : "1536x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 85,
      background: input.imageType === "white_background_concept" ? "opaque" : "auto",
      moderation: "auto",
    });
    responseData = response.data || [];
    requestId = (response as unknown as { _request_id?: string })._request_id;
  } catch (error) {
    throw mapProviderError(error);
  }

  if (responseData.length === 0) {
    throw new AiImageProviderError("empty_response", "图片服务没有返回有效图片。", true);
  }

  // Classify each item
  const classified = classifyImageResults(responseData);

  // Incompatible: no valid items at all (neither b64_json nor url)
  if (classified.length === 0) {
    throw new AiImageProviderError(
      "image_provider_incompatible_response",
      "图片中转站返回了无法识别的响应格式。",
      false,
    );
  }

  input.onResultReceived?.(classified.length);

  // Pre-validate URL items and download them.
  // All URL validation + download errors are mapped through mapProviderError
  // so they surface as AiImageProviderError to the service layer.
  const resultHostWhitelist = getImageResultHostWhitelist();
  const images: Array<{ base64: string }> = [];
  for (const item of classified) {
    if (item.kind === "base64_result") {
      images.push({ base64: item.base64 });
    } else {
      try {
        // Validate URL structure and hostname whitelist (no DNS, no fetch yet)
        validateImageResultUrl(item.url, resultHostWhitelist);
        // Secure download → DNS check → SSRF guard → validate bytes → convert to base64
        const base64 = await fetchRelayUrlAsBase64(item.url, resultHostWhitelist, requestId);
        images.push({ base64 });
      } catch (error) {
        throw mapProviderError(error, true);
      }
    }
  }

  if (images.length === 0) {
    throw new AiImageProviderError("empty_response", "图片服务没有返回有效图片。", true);
  }

  return { model, provider: "openai_compatible_relay", requestId, images, requestedFormat: "webp" };
};

export function getAiImageProvider(): AiImageProvider {
  if (process.env.NODE_ENV === "test" && providerForTests) return providerForTests;
  return generateOpenAiImage;
}

export function setAiImageProviderForTests(provider: AiImageProvider | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_IMAGE_PROVIDER");
  providerForTests = provider;
}
