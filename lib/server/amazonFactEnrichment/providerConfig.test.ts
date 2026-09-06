import { describe, expect, it, vi } from "vitest";

const { callAiText } = vi.hoisted(() => ({ callAiText: vi.fn(async () => ({ ok: true as const, data: JSON.stringify({ candidates: [] }) })) }));
vi.mock("@/lib/server/aiClient", () => ({
  callAiText,
  getAiConfig: () => ({ ok: true, data: { provider: "deepseek", baseURL: "https://api.deepseek.com", apiKey: "redacted", maskedApiKey: "***", model: "deepseek-v4-flash", timeoutMs: 45000 } }),
}));

import { buildAmazonFactEnrichmentPreview } from "./service";

describe("amazon fact provider request contract", () => {
  it("disables thinking and uses a bounded 30 second timeout", async () => {
    vi.stubEnv("AMAZON_FACT_ENRICHMENT_AI_ENABLED", "true");
    await buildAmazonFactEnrichmentPreview({ taskId: "t", asin: "B000000000", blocks: [{ sourceBlockId: "bullet:0", section: "bullet", label: "bullet", text: "Ceramic organizer for kitchen counter.", sourceUrl: "https://amazon.com" }] });
    expect(callAiText).toHaveBeenCalledTimes(1);
    expect(callAiText).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0, thinkingMode: "disabled", timeoutMs: 30000, responseFormat: { type: "json_object" } }));
    vi.unstubAllEnvs();
  });
});
