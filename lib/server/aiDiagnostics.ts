import "server-only";

import {
  getSafeAiClientErrorMessage,
  type AiClientErrorCode,
  type AiProvider,
} from "@/lib/server/aiClient";

const DEFAULT_PROVIDER = "openai";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 45_000;

type DiagnosticErrorCode = AiClientErrorCode | "invalid_endpoint_or_model_api";

type DiagnosticError = {
  code: DiagnosticErrorCode;
  message: string;
  status?: number;
};

export type DiagnosticResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DiagnosticError };

export type AiDiagnosticsSnapshot = {
  provider: string;
  keyConfigured: boolean;
  baseURLConfigured: boolean;
  modelConfigured: boolean;
  baseURLHost?: string;
  model?: string;
  timeoutMs: number;
  nodeEnv: string;
  diagnosticsEnabled: boolean;
};

type ResolvedDiagnosticsConfig = AiDiagnosticsSnapshot & {
  apiKey: string;
  baseURL: string;
};

type ModelsPayload = {
  modelsReachable: boolean;
  status: number;
  models: string[];
};

type PingPayload = {
  message: "pong";
  status: number;
  model: string;
};

function ok<T>(data: T): DiagnosticResult<T> {
  return { ok: true, data };
}

function fail(code: DiagnosticErrorCode, status?: number): DiagnosticResult<never> {
  return {
    ok: false,
    error: {
      code,
      message: getDiagnosticErrorMessage(code),
      status,
    },
  };
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

function getHostFromBaseURL(baseURL: string) {
  if (!baseURL) return undefined;

  try {
    return new URL(baseURL).host;
  } catch {
    return "invalid-url";
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildModelsUrl(baseURL: string) {
  return `${trimTrailingSlash(baseURL)}/models`;
}

function buildChatCompletionsUrl(baseURL: string) {
  const trimmed = trimTrailingSlash(baseURL);
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

function mapModelsStatusToErrorCode(status: number): DiagnosticErrorCode {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 402) return "insufficient_balance";
  if (status === 404) return "invalid_endpoint_or_model_api";
  if (status === 429) return "rate_limited";
  if (status === 500 || status === 502 || status === 503 || status === 504) return "provider_unavailable";
  return "provider_error";
}

function mapChatStatusToErrorCode(status: number): DiagnosticErrorCode {
  if (status === 400 || status === 422) return "invalid_parameters";
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 402) return "insufficient_balance";
  if (status === 404) return "invalid_model";
  if (status === 429) return "rate_limited";
  if (status === 500 || status === 502 || status === 503 || status === 504) return "provider_unavailable";
  return "provider_error";
}

function getDiagnosticErrorMessage(code: DiagnosticErrorCode) {
  if (code === "invalid_endpoint_or_model_api") {
    return "AI 模型列表接口不可用，请检查 Base URL 或服务商是否支持 /models。";
  }

  return getSafeAiClientErrorMessage(code);
}

function getAbortSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function getResolvedDiagnosticsConfig(): ResolvedDiagnosticsConfig {
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

  return {
    provider,
    keyConfigured: Boolean(apiKey),
    baseURLConfigured: Boolean(baseURL),
    modelConfigured: Boolean(model),
    baseURLHost: getHostFromBaseURL(baseURL),
    model: model || undefined,
    timeoutMs,
    nodeEnv: process.env.NODE_ENV || "development",
    diagnosticsEnabled: isAiDiagnosticsAllowed(),
    apiKey,
    baseURL,
  };
}

function toPublicSnapshot(config: ResolvedDiagnosticsConfig): AiDiagnosticsSnapshot {
  return {
    provider: config.provider,
    keyConfigured: config.keyConfigured,
    baseURLConfigured: config.baseURLConfigured,
    modelConfigured: config.modelConfigured,
    baseURLHost: config.baseURLHost,
    model: config.model,
    timeoutMs: config.timeoutMs,
    nodeEnv: config.nodeEnv,
    diagnosticsEnabled: config.diagnosticsEnabled,
  };
}

function validateConfig(config: ResolvedDiagnosticsConfig, needsModel = false): DiagnosticResult<ResolvedDiagnosticsConfig> {
  if (!config.apiKey) return fail("missing_api_key");
  if (!config.baseURL) return fail("missing_base_url");
  if (needsModel && !config.model) return fail("missing_model");
  return ok(config);
}

function extractModelIds(value: unknown) {
  if (!value || typeof value !== "object" || !("data" in value)) return [];

  const data = Reflect.get(value, "data");
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const id = Reflect.get(item, "id");
      return typeof id === "string" ? id.trim() : "";
    })
    .filter(Boolean)
    .slice(0, 20);
}

function extractPongMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";

  const choices = Reflect.get(value, "choices");
  if (!Array.isArray(choices)) return "";

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";

  const message = Reflect.get(firstChoice, "message");
  if (!message || typeof message !== "object") return "";

  const content = Reflect.get(message, "content");
  return typeof content === "string" ? content : "";
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function isAiDiagnosticsAllowed() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_AI_DIAGNOSTICS === "1";
}

export function getAiDiagnosticsSnapshot() {
  return toPublicSnapshot(getResolvedDiagnosticsConfig());
}

export async function checkAiModels(): Promise<DiagnosticResult<ModelsPayload>> {
  const configResult = validateConfig(getResolvedDiagnosticsConfig());
  if (!configResult.ok) return configResult;

  const { apiKey, baseURL, timeoutMs } = configResult.data;
  const abort = getAbortSignal(timeoutMs);

  try {
    const response = await fetch(buildModelsUrl(baseURL), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: abort.signal,
    });

    if (!response.ok) {
      return fail(mapModelsStatusToErrorCode(response.status), response.status);
    }

    const raw = await response.json().catch(() => ({}));

    return ok({
      modelsReachable: true,
      status: response.status,
      models: extractModelIds(raw),
    });
  } catch (error) {
    if (isAbortError(error)) return fail("timeout");
    return fail("network_error");
  } finally {
    abort.clear();
  }
}

export async function pingAiProvider(): Promise<DiagnosticResult<PingPayload>> {
  const configResult = validateConfig(getResolvedDiagnosticsConfig(), true);
  if (!configResult.ok) return configResult;

  const { apiKey, baseURL, model, timeoutMs } = configResult.data;
  const abort = getAbortSignal(timeoutMs);

  try {
    const response = await fetch(buildChatCompletionsUrl(baseURL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: "Return only JSON: {\"ok\":true,\"message\":\"pong\"}",
          },
        ],
        max_tokens: 50,
        temperature: 0,
      }),
      signal: abort.signal,
    });

    if (!response.ok) {
      return fail(mapChatStatusToErrorCode(response.status), response.status);
    }

    const raw = await response.json().catch(() => ({}));
    const message = extractPongMessage(raw);

    if (!message.toLowerCase().includes("pong")) {
      return fail("provider_error", response.status);
    }

    return ok({
      message: "pong",
      status: response.status,
      model: model || "",
    });
  } catch (error) {
    if (isAbortError(error)) return fail("timeout");
    return fail("network_error");
  } finally {
    abort.clear();
  }
}
