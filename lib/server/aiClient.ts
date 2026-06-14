import "server-only";

import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

const DEFAULT_PROVIDER = "openai";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 45_000;

export type AiProvider = "openai" | "deepseek" | (string & { readonly __aiProvider?: never });

export type AiClientErrorCode =
  | "missing_api_key"
  | "missing_model"
  | "missing_base_url"
  | "timeout"
  | "network_error"
  | "invalid_api_key"
  | "insufficient_balance"
  | "invalid_model"
  | "invalid_parameters"
  | "invalid_endpoint"
  | "rate_limited"
  | "provider_unavailable"
  | "empty_response"
  | "json_parse_error"
  | "provider_error"
  | "unknown_error";

export type AiClientError = {
  code: AiClientErrorCode;
  message: string;
  status?: number;
  provider?: string;
  model?: string;
  detail?: string;
};

export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AiClientError };

export type AiConfig = {
  provider: AiProvider;
  baseURL: string;
  apiKey: string;
  maskedApiKey: string;
  model: string;
  timeoutMs: number;
};

export type CallAiTextParams = {
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  responseFormat?: ChatCompletionCreateParamsNonStreaming["response_format"];
  maxTokens?: number;
  model?: string;
  timeoutMs?: number;
};

let cachedClient: OpenAI | null = null;
let cachedClientKey = "";

function ok<T>(data: T): AiResult<T> {
  return { ok: true, data };
}

function fail(error: AiClientError): AiResult<never> {
  return { ok: false, error };
}

function readEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function parseTimeoutMs(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_TIMEOUT_MS;
}

function normalizeProvider(value: string): AiProvider {
  return (value || DEFAULT_PROVIDER).toLowerCase() as AiProvider;
}

function getProviderDefaultBaseUrl(provider: AiProvider) {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_BASE_URL : DEFAULT_OPENAI_BASE_URL;
}

function getProviderDefaultModel(provider: AiProvider) {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_OPENAI_MODEL;
}

export function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function buildConfigError(
  code: AiClientErrorCode,
  message: string,
  config?: Partial<Pick<AiConfig, "provider" | "model">>,
): AiResult<never> {
  return fail({
    code,
    message,
    provider: config?.provider,
    model: config?.model,
  });
}

/** Read AI runtime config from environment variables without exposing secrets. */
export function getAiConfig(): AiResult<AiConfig> {
  const provider = normalizeProvider(readEnv("AI_PROVIDER") || (
    readEnv("DEEPSEEK_API_KEY") && !readEnv("OPENAI_API_KEY") ? "deepseek" : DEFAULT_PROVIDER
  ));
  const apiKey = readEnv("AI_API_KEY")
    || (provider === "deepseek" ? readEnv("DEEPSEEK_API_KEY") : readEnv("OPENAI_API_KEY"));
  const baseURL = readEnv("AI_BASE_URL")
    || (provider === "deepseek" ? readEnv("DEEPSEEK_BASE_URL") : readEnv("OPENAI_BASE_URL"))
    || getProviderDefaultBaseUrl(provider);
  const model = readEnv("AI_MODEL")
    || (provider === "deepseek" ? readEnv("DEEPSEEK_MODEL") : readEnv("OPENAI_MODEL"))
    || getProviderDefaultModel(provider);
  const timeoutMs = parseTimeoutMs(readEnv("AI_TIMEOUT_MS"));

  if (!apiKey) {
    return buildConfigError("missing_api_key", "AI API Key is missing.", { provider, model });
  }

  if (!baseURL) {
    return buildConfigError("missing_base_url", "AI base URL is missing.", { provider, model });
  }

  if (!model) {
    return buildConfigError("missing_model", "AI model is missing.", { provider });
  }

  return ok({
    provider,
    baseURL,
    apiKey,
    maskedApiKey: maskSecret(apiKey),
    model,
    timeoutMs,
  });
}

/** Create and cache an OpenAI-compatible client for server-side route handlers. */
export function createAiClient(config = getAiConfig()): AiResult<OpenAI> {
  if (!config.ok) {
    return config;
  }

  const { apiKey, baseURL, timeoutMs } = config.data;
  const cacheKey = `${baseURL}|${maskSecret(apiKey)}|${timeoutMs}`;

  if (cachedClient && cachedClientKey === cacheKey) {
    return ok(cachedClient);
  }

  cachedClient = new OpenAI({
    apiKey,
    baseURL,
    timeout: timeoutMs,
  });
  cachedClientKey = cacheKey;

  return ok(cachedClient);
}

function getObjectProperty(value: unknown, property: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return "";
  return Reflect.get(value, property);
}

function getNestedPropertyCandidates(value: unknown, property: string) {
  const direct = getObjectProperty(value, property);
  const nestedError = getObjectProperty(value, "error");
  const nestedResponse = getObjectProperty(value, "response");
  const nestedCause = getObjectProperty(value, "cause");

  return [
    direct,
    getObjectProperty(nestedError, property),
    getObjectProperty(nestedResponse, property),
    getObjectProperty(nestedCause, property),
  ];
}

function getStringProperty(value: unknown, property: string) {
  const item = getNestedPropertyCandidates(value, property).find((candidate) => typeof candidate === "string");
  return typeof item === "string" ? item : "";
}

function getNumberProperty(value: unknown, property: string) {
  for (const item of getNestedPropertyCandidates(value, property)) {
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string" && item.trim()) {
      const parsed = Number(item);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function getSafeAiClientErrorMessage(code: AiClientErrorCode) {
  switch (code) {
    case "missing_api_key":
      return "服务端 AI Key 未配置，请检查环境变量。";
    case "missing_model":
      return "服务端 AI_MODEL / DEEPSEEK_MODEL 未配置。";
    case "missing_base_url":
      return "服务端 AI_BASE_URL / DEEPSEEK_BASE_URL 未配置。";
    case "timeout":
      return "AI 请求超时，请稍后重试。";
    case "network_error":
      return "AI 服务网络连接失败，请检查服务器网络或 Base URL。";
    case "invalid_api_key":
      return "AI Key 无效或权限不足，请检查服务端环境变量。";
    case "insufficient_balance":
      return "AI 服务余额不足或额度不可用，请检查服务商账户。";
    case "invalid_model":
      return "AI 模型名无效或当前 Key 无权使用，请检查 AI_MODEL / DEEPSEEK_MODEL。";
    case "invalid_parameters":
      return "AI 请求参数不被服务商接受，请检查模型兼容性和请求格式。";
    case "invalid_endpoint":
      return "AI 服务地址无效，请检查 Base URL 或接口路径。";
    case "rate_limited":
      return "AI 请求过于频繁或触发限流，请稍后重试。";
    case "provider_unavailable":
      return "AI 服务商暂时不可用，请稍后重试。";
    case "provider_error":
      return "AI 服务返回错误，请检查模型名、余额、权限或服务商状态。";
    case "json_parse_error":
      return "AI 返回格式异常，请稍后重试。";
    case "empty_response":
      return "AI 返回为空，请稍后重试。";
    case "unknown_error":
    default:
      return "AI 服务出现未知错误，请检查服务端 AI 配置或稍后重试。";
  }
}

function getProviderCodeFromStatus(status?: number): AiClientErrorCode | undefined {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 402) return "insufficient_balance";
  if (status === 404) return "invalid_model";
  if (status === 400 || status === 422) return "invalid_parameters";
  if (status === 429) return "rate_limited";
  if (status === 500 || status === 502 || status === 503 || status === 504) return "provider_unavailable";
  return undefined;
}

function getProviderCodeFromText(text: string): AiClientErrorCode | undefined {
  if (text.includes("401") || text.includes("403")) {
    return "invalid_api_key";
  }

  if (text.includes("402")) {
    return "insufficient_balance";
  }

  if (text.includes("404")) {
    return "invalid_model";
  }

  if (text.includes("400") || text.includes("422")) {
    return "invalid_parameters";
  }

  if (text.includes("500") || text.includes("502") || text.includes("503") || text.includes("504")) {
    return "provider_unavailable";
  }

  if (
    text.includes("invalid_api_key")
    || text.includes("incorrect api key")
    || text.includes("unauthorized")
    || text.includes("authentication")
    || text.includes("permission denied")
  ) {
    return "invalid_api_key";
  }

  if (
    text.includes("insufficient_quota")
    || text.includes("insufficient balance")
    || text.includes("balance")
    || text.includes("billing")
    || text.includes("payment required")
  ) {
    return "insufficient_balance";
  }

  if (
    text.includes("model_not_found")
    || text.includes("model not found")
    || text.includes("model does not exist")
    || text.includes("no such model")
    || text.includes("invalid model")
  ) {
    return "invalid_model";
  }

  if (
    text.includes("invalid_request")
    || text.includes("invalid parameter")
    || text.includes("invalid_request_error")
    || text.includes("response_format")
    || text.includes("json_object")
    || text.includes("bad request")
    || text.includes("unprocessable")
  ) {
    return "invalid_parameters";
  }

  if (
    text.includes("rate_limit")
    || text.includes("rate limit")
    || text.includes("too many requests")
    || text.includes("429")
  ) {
    return "rate_limited";
  }

  if (
    text.includes("service unavailable")
    || text.includes("bad gateway")
    || text.includes("gateway timeout")
    || text.includes("internal server error")
  ) {
    return "provider_unavailable";
  }

  return undefined;
}

function classifyAiError(error: unknown, config?: AiConfig): AiClientError {
  const name = error instanceof Error ? error.name : getStringProperty(error, "name");
  const message = error instanceof Error
    ? error.message
    : getStringProperty(error, "message") || getStringProperty(error, "error") || "Unknown AI SDK error.";
  const status = getNumberProperty(error, "status");
  const codeText = getStringProperty(error, "code").toLowerCase();
  const typeText = getStringProperty(error, "type").toLowerCase();
  const lowerMessage = message.toLowerCase();
  const lowerName = name.toLowerCase();
  const providerText = [lowerName, codeText, typeText, lowerMessage].filter(Boolean).join(" ");

  if (
    lowerName.includes("timeout")
    || codeText.includes("timeout")
    || typeText.includes("timeout")
    || lowerMessage.includes("timeout")
    || lowerMessage.includes("timed out")
  ) {
    return {
      code: "timeout",
      message: "AI request timed out.",
      provider: config?.provider,
      model: config?.model,
      detail: message.slice(0, 240),
    };
  }

  if (
    lowerName.includes("apiconnection")
    || codeText.includes("econn")
    || codeText.includes("network")
    || typeText.includes("network")
    || lowerMessage.includes("fetch failed")
    || lowerMessage.includes("network")
  ) {
    return {
      code: "network_error",
      message: "AI network request failed.",
      provider: config?.provider,
      model: config?.model,
      detail: message.slice(0, 240),
    };
  }

  const providerCode = getProviderCodeFromStatus(status) || getProviderCodeFromText(providerText);

  if (
    status
    || ((typeof error === "object" || typeof error === "function") && error !== null)
    || lowerName.includes("apierror")
    || lowerName.includes("badrequest")
    || lowerName.includes("authentication")
    || lowerName.includes("permission")
    || lowerName.includes("ratelimit")
    || codeText.includes("invalid")
    || codeText.includes("auth")
    || codeText.includes("permission")
    || codeText.includes("rate")
    || typeText.includes("invalid")
    || typeText.includes("auth")
    || typeText.includes("permission")
    || typeText.includes("rate")
    || lowerMessage.includes("401")
    || lowerMessage.includes("403")
    || lowerMessage.includes("404")
    || lowerMessage.includes("429")
    || lowerMessage.includes("model")
    || lowerMessage.includes("quota")
    || lowerMessage.includes("balance")
    || lowerMessage.includes("permission")
    || lowerMessage.includes("api key")
  ) {
    return {
      code: providerCode || "provider_error",
      message: "AI provider returned an error.",
      status,
      provider: config?.provider,
      model: config?.model,
      detail: message.slice(0, 240),
    };
  }

  return {
    code: "unknown_error",
    message: "Unknown AI request error.",
    provider: config?.provider,
    model: config?.model,
    detail: message.slice(0, 240),
  };
}

function makeChatParams(config: AiConfig, params: CallAiTextParams): ChatCompletionCreateParamsNonStreaming {
  return {
    model: params.model || config.model,
    messages: params.messages,
    temperature: params.temperature,
    response_format: params.responseFormat,
    max_tokens: params.maxTokens,
  };
}

/** Call an OpenAI-compatible chat completion endpoint and return text content. */
export async function callAiText(params: CallAiTextParams): Promise<AiResult<string>> {
  const configResult = getAiConfig();
  if (!configResult.ok) {
    return configResult;
  }

  const clientResult = createAiClient(configResult);
  if (!clientResult.ok) {
    return clientResult;
  }

  try {
    const response = await clientResult.data.chat.completions.create(
      makeChatParams(configResult.data, params),
      { timeout: params.timeoutMs || configResult.data.timeoutMs },
    );
    const content = response.choices[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";

    if (!text) {
      return fail({
        code: "empty_response",
        message: "AI returned empty text.",
        provider: configResult.data.provider,
        model: params.model || configResult.data.model,
      });
    }

    return ok(text);
  } catch (error) {
    return fail(classifyAiError(error, configResult.data));
  }
}

function stripJsonCodeFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    || trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function extractJsonCandidate(text: string) {
  const cleaned = stripJsonCodeFence(text).replace(/\u0000/g, "").trim();
  const objectStart = cleaned.indexOf("{");
  const arrayStart = cleaned.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);

  if (!starts.length) {
    return cleaned;
  }

  const start = Math.min(...starts);
  const opening = cleaned[start];
  const closing = opening === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(closing);

  return end > start ? cleaned.slice(start, end + 1).trim() : cleaned;
}

function lightlyRepairJson(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

/** Parse JSON from AI text, including code fences or surrounding explanation text. */
export function safeParseJsonFromAiText<T = unknown>(text: string): AiResult<T> {
  const candidates = [
    text.trim(),
    stripJsonCodeFence(text),
    extractJsonCandidate(text),
    lightlyRepairJson(extractJsonCandidate(text)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return ok(JSON.parse(candidate) as T);
    } catch {
      // Try next candidate.
    }
  }

  return fail({
    code: "json_parse_error",
    message: "Failed to parse JSON from AI text.",
    detail: text.slice(0, 240),
  });
}

/** Call AI and parse the response as JSON. */
export async function callAiJson<T>(params: Omit<CallAiTextParams, "responseFormat"> & {
  responseFormat?: ChatCompletionCreateParamsNonStreaming["response_format"];
}): Promise<AiResult<T>> {
  const textResult = await callAiText({
    ...params,
    responseFormat: params.responseFormat || { type: "json_object" },
  });

  if (!textResult.ok) {
    return textResult;
  }

  return safeParseJsonFromAiText<T>(textResult.data);
}
