import { afterEach, describe, expect, it, vi } from "vitest";

import { callAiText } from "./aiClient";

afterEach(() => {
 vi.unstubAllEnvs();
 vi.unstubAllGlobals();
});

describe("DeepSeek OpenAI SDK request serialization", () => {
 it("sends the expected JSON body without making a network request", async () => {
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("AI_API_KEY", "unit-test-key");
  vi.stubEnv("AI_BASE_URL", "https://provider.invalid/v1");
  vi.stubEnv("AI_MODEL", "deepseek-v4-flash");

  let serializedBody: Record<string, unknown> | null = null;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
   serializedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
   return new Response(JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "deepseek-v4-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{\"candidates\":[]}" } }],
   }), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await callAiText({
   messages: [{ role: "user", content: "fixture prompt" }],
   thinkingMode: "disabled",
   temperature: 0,
   responseFormat: { type: "json_object" },
   maxTokens: 1800,
   timeoutMs: 30000,
  });

  expect(result.ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(serializedBody).toMatchObject({
   model: "deepseek-v4-flash",
   messages: [{ role: "user", content: "fixture prompt" }],
   thinking: { type: "disabled" },
   temperature: 0,
   response_format: { type: "json_object" },
   max_tokens: 1800,
  });
  expect(serializedBody).not.toHaveProperty("apiKey");
  expect(serializedBody).not.toHaveProperty("authorization");
 });
});
