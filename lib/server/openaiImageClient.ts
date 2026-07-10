import "server-only";

import OpenAI from "openai";
import type { AiImageDraftType } from "@/lib/aiImageDraft";

export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2-2026-04-21";
const DEFAULT_TIMEOUT_MS = 130_000;

export type AiImageProviderInput = {
  imageType: AiImageDraftType;
  count: 1 | 2;
  prompt: string;
};

export type AiImageProviderOutput = {
  model: string;
  requestId?: string;
  images: Array<{ base64: string }>;
};

export type AiImageProvider = (input: AiImageProviderInput) => Promise<AiImageProviderOutput>;

export class AiImageProviderError extends Error {
  constructor(
    public readonly code: "timeout" | "rate_limited" | "provider_unavailable" | "content_blocked" | "invalid_request" | "empty_response" | "configuration_error" | "provider_error",
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

function mapProviderError(error: unknown): AiImageProviderError {
  if (error instanceof AiImageProviderError) return error;
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const name = error instanceof Error ? error.name : "";
  if (code === "moderation_blocked" || code === "image_generation_user_error") {
    return new AiImageProviderError("content_blocked", "图片请求未通过内容安全检查。", false);
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
  const model = (process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL).trim();
  const client = new OpenAI({ apiKey, timeout: timeoutMs(), maxRetries: 0 });
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
    const images = (response.data || [])
      .map((item) => typeof item.b64_json === "string" ? { base64: item.b64_json } : null)
      .filter((item): item is { base64: string } => Boolean(item));
    if (images.length === 0) throw new AiImageProviderError("empty_response", "图片服务没有返回有效图片。", true);
    const requestId = (response as unknown as { _request_id?: string })._request_id;
    return { model, requestId, images };
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
