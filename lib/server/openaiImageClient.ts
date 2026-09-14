import "server-only";

import OpenAI from "openai";
import type { AiImageDraftType } from "@/lib/aiImageDraft";
import {
  downloadImageFromUrl,
  getImageResultHostWhitelist,
  ImageUrlFetchError,
  validateImageResultUrl,
} from "@/lib/server/aiImageUrlFetcher";

/** 默认允许的 Base URL 主机（精确匹配；不得用通配符） */
export const DEFAULT_IMAGE_BASE_HOSTNAMES = Object.freeze(["api.65535.space"] as const);

/**
 * 允许的 Base URL 主机精确列表（环境变量 OPENAI_IMAGE_BASE_HOSTS 逗号分隔覆盖）。
 * 仅 HTTPS；精确主机匹配；禁止通配/contains/endsWith 模糊匹配。
 */
export function getAllowedImageBaseHostnames(): Set<string> {
  const raw = (process.env.OPENAI_IMAGE_BASE_HOSTS || "").trim();
  if (!raw) return new Set(DEFAULT_IMAGE_BASE_HOSTNAMES);
  return new Set(raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
}

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
      | "provider_auth_failed"
      | "provider_quota"
      | "provider_unavailable"
      | "network_error"
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
  if (!getAllowedImageBaseHostnames().has(url.hostname)) {
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

/**
 * V2.1.1：上游图片服务失败的**服务端**诊断日志（仅控制台，绝不进入 API 响应）。
 *
 * 记录：上游 HTTP 状态、上游错误类型、response 摘要（脱敏 + 截断）、上游 request id。
 * 脱敏规则（避免泄漏凭据与内部地址）：
 *  - 抹掉 `sk-…` / `Bearer …` 形式的密钥；
 *  - 抹掉一切 http(s) URL（中转站/内部地址不外泄）；
 *  - 摘要截断到 300 字符。
 */
function redactUpstreamText(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .slice(0, 300);
}

function extractUpstreamRequestId(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidates = ["request_id", "_request_id", "requestId", "generation_id", "id"];
  for (const key of candidates) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return redactUpstreamText(value.trim());
  }
  const headers = (error as { headers?: unknown }).headers;
  if (headers && typeof headers === "object") {
    const headerValue = (headers as Record<string, unknown>)["x-request-id"];
    if (typeof headerValue === "string" && headerValue.trim()) return redactUpstreamText(headerValue.trim());
  }
  return null;
}

function logUpstreamImageFailure(input: {
  status: number;
  code: string;
  name: string;
  constructorName: string;
  message: string;
  nestedCode: string;
  nestedMessage: string;
  causeName: string;
  causeCode: string;
  causeMessage: string;
  requestId: string | null;
  elapsedMs: number | null;
}): void {
  try {
    console.error("[image-upstream-failure]", JSON.stringify({
      providerHttpStatus: Number.isFinite(input.status) && input.status > 0 ? input.status : null,
      upstreamErrorName: input.name || null,
      // V2.1.2：SDK 不设置 name，真正可靠的是类名
      upstreamErrorConstructorName: input.constructorName || null,
      upstreamErrorCode: input.code || null,
      upstreamNestedCode: input.nestedCode || null,
      // V2.1.3：连接层判因字段（如 ConnectTimeoutError / UND_ERR_CONNECT_TIMEOUT / timeout: 10000ms）
      upstreamCauseName: input.causeName || null,
      upstreamCauseCode: input.causeCode || null,
      upstreamRequestId: input.requestId,
      elapsedMs: input.elapsedMs,
      upstreamSummary: redactUpstreamText(input.nestedMessage || input.message || ""),
      upstreamCauseSummary: redactUpstreamText(input.causeMessage || ""),
    }));
  } catch {
    // 诊断路径绝不影响主流程
  }
}

export function mapProviderError(error: unknown, providerResultReceived = false): AiImageProviderError {
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
  /**
   * V2.1.2：**不能只依赖 `error.name`**。
   * OpenAI SDK 的错误类不设置 `this.name`，因此 `new APIConnectionTimeoutError()` 实例的
   * `error.name` 实际是继承来的 `"Error"`（见 node_modules/openai/core/error.js:88-92），
   * 导致原先 `name === "APIConnectionTimeoutError"` 的判断**永远不成立**，
   * 真实超时被误判为兜底的 provider_error。这里额外取 `constructor.name`（类名保留）作为可靠判据。
   */
  const constructorName = error instanceof Error ? (error.constructor?.name ?? "") : "";
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  const nestedError = typeof error === "object" && error !== null && "error" in error
    && typeof (error as { error?: unknown }).error === "object"
    && (error as { error?: unknown }).error !== null
    ? (error as { error: Record<string, unknown> }).error
    : null;
  /**
   * V2.1.3：**连接层信息在 `error.cause` 里**。
   *
   * 实证：Node 内置 undici 的默认 `connectTimeout` 是 **10 秒**；连接建立失败时抛出
   * `TypeError: fetch failed`，其 `cause` 为
   * `ConnectTimeoutError: Connect Timeout Error (attempted address: …, timeout: 10000ms)`
   * （`code = UND_ERR_CONNECT_TIMEOUT`）。OpenAI SDK 在 client.js:373-397 用它匹配
   * `/timed? ?out/i` 后转成 `APIConnectionTimeoutError("Request timed out.")`，
   * 因此 `error.message` 只剩一句泛化文案 —— **真正的判因字段是 cause**。
   */
  const cause = typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause?: unknown }).cause
    : null;
  const causeName = cause instanceof Error ? cause.name : "";
  const causeCode = cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code || "")
    : "";
  const causeMessage = cause instanceof Error
    ? cause.message
    : cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message?: unknown }).message || "")
      : "";
  // V2.1.1：在**分类之前**记录可判因诊断（仅服务端日志；对外合同与脱敏规则不变）。
  logUpstreamImageFailure({
    status,
    code,
    name,
    constructorName,
    message,
    nestedCode: nestedError ? String(nestedError.code || "") : "",
    nestedMessage: nestedError ? String(nestedError.message || "") : "",
    causeName,
    causeCode,
    causeMessage,
    requestId: extractUpstreamRequestId(error),
    elapsedMs: typeof (error as { elapsedMs?: unknown }).elapsedMs === "number"
      ? Number((error as { elapsedMs: number }).elapsedMs)
      : null,
  });
  const classificationText = [
    code,
    message,
    nestedError ? String(nestedError.code || "") : "",
    nestedError ? String(nestedError.message || "") : "",
    // V2.1.3：连接层判因信息（ConnectTimeoutError / UND_ERR_CONNECT_TIMEOUT 等）在 cause 里，
    // 不纳入分类文本就会漏判（例如把连接超时误判成网络错误或兜底错误）。
    causeName,
    causeCode,
    causeMessage,
  ].join(" ").toLowerCase();
  if (code === "moderation_blocked" || code === "image_generation_user_error") {
    return new AiImageProviderError("content_blocked", "图片请求未通过内容安全检查。", false);
  }
  if (/(?:insufficient[_ -]?(?:balance|quota|credit)|quota|balance|billing|credit)/i.test(classificationText)) {
    return new AiImageProviderError("provider_quota", "图片服务额度不足，请补充额度后重试。", false);
  }
  if (status === 401 || status === 403) {
    return new AiImageProviderError("provider_auth_failed", "图片中转站鉴权失败，请检查 API Key 配置。", false);
  }
  if (status === 429) return new AiImageProviderError("rate_limited", "图片服务繁忙，请稍后重试。", true);
  if (status >= 500) return new AiImageProviderError("provider_unavailable", "图片服务暂时不可用。", true);
  if (status >= 400) return new AiImageProviderError("invalid_request", "图片请求不符合服务要求。", false);
  // ── V2.1.2：超时判定改用三重判据（类名 / 码 / 文案），不再只依赖 error.name ──
  // 说明：状态码分支（429/≥500/≥400）已在本段之前，因此走到这里意味着**没有 HTTP 响应**
  // （status 为 0 或 NaN）——这正是 SDK 超时与网络中断的典型形态。
  const TIMEOUT_CONSTRUCTOR_NAMES = new Set([
    "APIConnectionTimeoutError", "TimeoutError", "HeadersTimeoutError", "BodyTimeoutError", "ConnectTimeoutError",
  ]);
  const TIMEOUT_CODES = new Set([
    "ETIMEDOUT", "ABORT_ERR", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT",
  ]);
  if (
    TIMEOUT_CONSTRUCTOR_NAMES.has(constructorName)
    || name === "APIConnectionTimeoutError"
    || TIMEOUT_CODES.has(code)
    || /request timed out|timed out|timeout/i.test(classificationText)
  ) {
    return new AiImageProviderError("timeout", "图片生成超时。", true);
  }
  if (
    constructorName === "APIConnectionError"
    || name === "APIConnectionError"
    || ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code)
    || /(?:fetch failed|network error|socket hang up|connection refused|connection error|other side closed|terminated)/i.test(classificationText)
  ) {
    return new AiImageProviderError("network_error", "图片服务网络连接失败。", true);
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
