import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  clientOptions: null as Record<string, unknown> | null,
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: openAiMocks.create } };

    constructor(options: Record<string, unknown>) {
      openAiMocks.clientOptions = options;
    }
  },
}));

import {
  bindProviderCallStartBoundary,
  callAiJson,
  callAiText,
  safeParseJsonFromAiText,
} from "@/lib/server/aiClient";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_API_KEY", "unit-test-key");
  vi.stubEnv("AI_MODEL", "unit-test-model");
  vi.stubEnv("AI_BASE_URL", "https://provider.invalid/v1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeParseJsonFromAiText", () => {
  it("AI 返回 fenced JSON 时能解析", () => {
    const result = safeParseJsonFromAiText<{ verdict: string }>("```json\n{\"verdict\":\"可做但需控制成本\"}\n```");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toBe("可做但需控制成本");
    }
  });

  it("AI 返回 JSON 前后有说明文字时能提取第一个 JSON 对象", () => {
    const result = safeParseJsonFromAiText<{ verdict: string }>("下面是结果：\n{\"verdict\":\"新手不建议做\"}\n请参考。");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toBe("新手不建议做");
    }
  });

  it("AI 返回不可解析文本时返回 json_parse_error，不泄露 Provider 正文", () => {
    const sensitiveProviderText = "PRIVATE_PROVIDER_BODY_NOT_FOR_LOGS ".repeat(20);
    const result = safeParseJsonFromAiText(sensitiveProviderText);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("json_parse_error");
      expect(result.error.detail?.length).toBeLessThanOrEqual(240);
      expect(result.error.detail).not.toContain("PRIVATE_PROVIDER_BODY_NOT_FOR_LOGS");
    }
  });
});

describe("providerCallStarted", () => {
  it("persists the started boundary immediately before invoking the Provider SDK", async () => {
    const events: string[] = [];
    openAiMocks.create.mockImplementationOnce(async () => {
      events.push("provider");
      return { choices: [{ message: { content: "ok" } }] };
    });

    await callAiText({
      messages: [{ role: "user", content: "test" }],
      onProviderCallStart: () => { events.push("persisted"); },
    });

    expect(events).toEqual(["persisted", "provider"]);
  });

  it("does not invoke the Provider when persisting the started boundary fails", async () => {
    await expect(callAiText({
      messages: [{ role: "user", content: "test" }],
      onProviderCallStart: () => { throw new Error("quota boundary unavailable"); },
    })).rejects.toThrow("quota boundary unavailable");

    expect(openAiMocks.create).not.toHaveBeenCalled();
  });

  it("uses a one-shot request boundary for legacy quota callers", async () => {
    const boundary = vi.fn();
    bindProviderCallStartBoundary(boundary);
    openAiMocks.create
      .mockResolvedValueOnce({ choices: [{ message: { content: "first" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "second" } }] });

    await callAiText({ messages: [{ role: "user", content: "first" }] });
    await callAiText({ messages: [{ role: "user", content: "second" }] });

    expect(boundary).toHaveBeenCalledOnce();
    expect(openAiMocks.create).toHaveBeenCalledTimes(2);
  });

  it("sets maxRetries=0 and marks a successful SDK call as started", async () => {
    openAiMocks.create.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });

    const result = await callAiText({ messages: [{ role: "user", content: "test" }] });

    expect(result.providerCallStarted).toBe(true);
    expect(openAiMocks.create).toHaveBeenCalledOnce();
    expect(openAiMocks.clientOptions).toEqual(expect.objectContaining({ maxRetries: 0 }));
  });

  it.each([
    ["rate_limited", Object.assign(new Error("429 rate limited"), { status: 429 })],
    ["timeout", Object.assign(new Error("request timed out"), { name: "TimeoutError" })],
  ])("marks %s after the SDK call starts", async (_label, error) => {
    openAiMocks.create.mockRejectedValueOnce(error);

    const result = await callAiText({ messages: [{ role: "user", content: "test" }] });

    expect(result.ok).toBe(false);
    expect(result.providerCallStarted).toBe(true);
  });

  it("marks an empty provider response as started", async () => {
    openAiMocks.create.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    const result = await callAiText({ messages: [{ role: "user", content: "test" }] });

    expect(result.ok).toBe(false);
    expect(result.providerCallStarted).toBe(true);
    if (!result.ok) expect(result.error.code).toBe("empty_response");
  });

  it("preserves the started marker when JSON parsing fails", async () => {
    openAiMocks.create.mockResolvedValueOnce({
      choices: [{ finish_reason: "length", message: { content: "not-json" } }],
    });

    const result = await callAiJson({ messages: [{ role: "user", content: "test" }] });

    expect(result.ok).toBe(false);
    expect(result.providerCallStarted).toBe(true);
    if (!result.ok) {
      expect(result.error.code).toBe("json_parse_error");
      expect(result.diagnostics).toMatchObject({
        providerHttpStatusClass: "success",
        finishReason: "length",
        responseCharLength: 8,
        jsonParseStage: "failed",
      });
      expect(result.diagnostics?.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("sends the DeepSeek thinking toggle with JSON output and records only safe token diagnostics", async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    openAiMocks.create.mockResolvedValueOnce({
      model: "deepseek-v4-flash",
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: {
        completion_tokens: 42,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    });

    const result = await callAiJson<{ ok: boolean }>({
      messages: [{ role: "user", content: "return JSON" }],
      maxTokens: 6000,
      thinkingMode: "disabled",
    });

    expect(result.ok).toBe(true);
    expect(openAiMocks.create).toHaveBeenCalledTimes(1);
    expect(openAiMocks.create.mock.calls[0][0]).toMatchObject({
      max_tokens: 6000,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(result.diagnostics).toMatchObject({
      model: "deepseek-v4-flash",
      thinkingMode: "disabled",
      maxTokens: 6000,
      finishReason: "stop",
      completionTokens: 42,
      reasoningTokens: 0,
      responseCharLength: 11,
    });
  });

  it("records only the Provider HTTP status class when the SDK returns an error", async () => {
    openAiMocks.create.mockRejectedValueOnce(Object.assign(new Error("secret upstream body"), { status: 429 }));

    const result = await callAiJson({ messages: [{ role: "user", content: "test" }] });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toMatchObject({
      providerHttpStatusClass: "rate_limited",
      finishReason: null,
      responseCharLength: 0,
      jsonParseStage: "not_started",
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain("secret upstream body");
  });

  it("does not mark or invoke the SDK when configuration fails first", async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await callAiText({ messages: [{ role: "user", content: "test" }] });

    expect(result.ok).toBe(false);
    expect(result.providerCallStarted).toBe(false);
    expect(openAiMocks.create).not.toHaveBeenCalled();
  });
});
