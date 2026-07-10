import "server-only";

import OpenAI from "openai";
import type { AiImageDraftType } from "@/lib/aiImageDraft";

export const ALLOWED_IMAGE_BASE_HOSTNAME = "api.65535.space";
export const ALLOWED_IMAGE_MODELS = new Set(["gpt-image-2"]);
const DEFAULT_TIMEOUT_MS = 130_000;

export type AiImageProviderInput = {
  imageType: AiImageDraftType;
  count: 1 | 2;
  prompt: string;
};

export type AiImageProviderOutput = {
  model: string;
  provider: "openai_compatible_relay";
  requestId?: string;
  images: Array<{ base64: string }>;
};

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
      | "image_provider_incompatible_response",
    message: string,
    public readonly retryable = false,
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

function mapProviderError(error: unknown): AiImageProviderError {
  if (error instanceof AiImageProviderError) return error;
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

export const generateOpenAiImage: AiImageProvider = async (input) => {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new AiImageProviderError("configuration_error", "OpenAI 图片服务尚未配置。", false);

  const baseURL = validateImageBaseUrl((process.env.OPENAI_IMAGE_BASE_URL || "").trim());
  const model = validateImageModel((process.env.OPENAI_IMAGE_MODEL || "").trim());

  const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs(), maxRetries: 0 });

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

    const hasUrlOnly = (response.data || []).some(
      (item) => !item.b64_json && typeof item.url === "string",
    );
    if (hasUrlOnly) {
      throw new AiImageProviderError(
        "image_provider_incompatible_response",
        "图片中转站返回了 URL 而非 base64 数据，当前仅支持 base64 格式。",
        false,
      );
    }

    const images = (response.data || [])
      .map((item) => (typeof item.b64_json === "string" ? { base64: item.b64_json } : null))
      .filter((item): item is { base64: string } => Boolean(item));

    if (images.length === 0) {
      throw new AiImageProviderError("empty_response", "图片服务没有返回有效图片。", true);
    }

    const requestId = (response as unknown as { _request_id?: string })._request_id;
    return { model, provider: "openai_compatible_relay", requestId, images };
  } catch (error) {
    throw mapProviderError(error);
  }
};

export function getAiImageProvider(): AiImageProvider {
  if (process.env.NODE_ENV === "test" && providerForTests) return providerForTests;
  return generateOpenAiImage;
}

export function setAiImageProviderForTests(provider: AiImageProvider | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_IMAGE_PROVIDER");
  providerForTests = provider;
}
