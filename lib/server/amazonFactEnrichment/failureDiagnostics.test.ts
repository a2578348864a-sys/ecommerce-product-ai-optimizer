import { afterEach, describe, expect, it, vi } from "vitest";

const { callAiText } = vi.hoisted(() => ({ callAiText: vi.fn() }));

vi.mock("@/lib/server/aiClient", () => ({
 callAiText,
 getAiConfig: () => ({ ok: true, data: { provider: "deepseek", baseURL: "https://api.deepseek.com", apiKey: "redacted", maskedApiKey: "***", model: "deepseek-v4-flash", timeoutMs: 45000 } }),
}));

import { buildAmazonFactEnrichmentPreview } from "./service";

afterEach(() => {
 vi.clearAllMocks();
 vi.unstubAllEnvs();
});

const block = {
 sourceBlockId: "bullet:0",
 section: "bullet" as const,
 label: "bullet",
 text: "Ceramic organizer fits 10 utensils and is easy to wipe clean; capacity 2.3 pounds.",
 sourceUrl: "https://www.amazon.com/dp/B000000000",
};

function providerSuccess(payload: unknown) {
 return { ok: true as const, data: JSON.stringify(payload), diagnostics: { providerHttpStatusClass: "success" as const } };
}

function build() {
 return buildAmazonFactEnrichmentPreview({ taskId: "task-1", asin: "B000000000", blocks: [block], structured: { construction: "Ceramic" } });
}

describe("Amazon AI failure taxonomy", () => {
 it("completes a valid Provider response", async () => {
  vi.stubEnv("AMAZON_FACT_ENRICHMENT_AI_ENABLED", "true");
  callAiText.mockResolvedValueOnce(providerSuccess({ candidates: [{ field: "other", value: "fits 10 utensils", sourceBlockId: "bullet:0", evidenceText: "Ceramic organizer fits 10 utensils", qualifier: "direct", confidence: "high" }] }));
  const preview = await build();
  expect(preview.naturalLanguageStatus).toBe("completed");
  expect(preview.naturalLanguageFailureStage).toBeUndefined();
  expect(preview.candidates.some((candidate) => candidate.id.includes(":ai:"))).toBe(true);
 });

 it.each([
  ["evidence missing", { field: "other", value: "fits 10 utensils", sourceBlockId: "bullet:0", evidenceText: "not present", qualifier: "direct", confidence: "high" }, "evidence", "ai_evidence_not_found"],
  ["numeric mismatch", { field: "other", value: "fits 20 utensils", sourceBlockId: "bullet:0", evidenceText: "Ceramic organizer fits 10 utensils", qualifier: "direct", confidence: "high" }, "evidence", "ai_numeric_mismatch"],
  ["strong claim upgrade", { field: "care", value: "Dishwasher Safe", sourceBlockId: "bullet:0", evidenceText: "easy to wipe clean", qualifier: "direct", confidence: "high" }, "evidence", "ai_strong_claim_upgrade"],
  ["capacity unit mismatch", { field: "capacity", value: "2.3 pounds", sourceBlockId: "bullet:0", evidenceText: "capacity 2.3 pounds", qualifier: "direct", confidence: "high" }, "evidence", "ai_capacity_unit_mismatch"],
 ] as const)("classifies %s after a successful Provider response", async (_label, candidate, stage, code) => {
  vi.stubEnv("AMAZON_FACT_ENRICHMENT_AI_ENABLED", "true");
  callAiText.mockResolvedValueOnce(providerSuccess({ candidates: [candidate] }));
  const preview = await build();
  expect(preview.naturalLanguageStatus).toBe("failed");
  expect(preview.naturalLanguageFailureStage).toBe(stage);
  expect(preview.naturalLanguageFailureCode).toBe(code);
  expect(preview.candidates.some((item) => !item.id.includes(":ai:"))).toBe(true);
 });

 it("classifies a valid JSON response with the wrong shape as schema", async () => {
  vi.stubEnv("AMAZON_FACT_ENRICHMENT_AI_ENABLED", "true");
  callAiText.mockResolvedValueOnce(providerSuccess({ foo: "bar" }));
  const preview = await build();
  expect(preview.naturalLanguageFailureStage).toBe("schema");
  expect(preview.naturalLanguageFailureCode).toBe("ai_invalid_schema");
 });

 it("classifies non-JSON Provider output as response_parse", async () => {
  vi.stubEnv("AMAZON_FACT_ENRICHMENT_AI_ENABLED", "true");
  callAiText.mockResolvedValueOnce({ ok: true as const, data: "not-json", diagnostics: { providerHttpStatusClass: "success" as const } });
  const preview = await build();
  expect(preview.naturalLanguageFailureStage).toBe("response_parse");
  expect(preview.naturalLanguageFailureCode).toBe("ai_json_parse_error");
 });

 it("keeps Provider HTTP 400 separate from response and evidence failures", async () => {
  vi.stubEnv("AMAZON_FACT_ENRICHMENT_AI_ENABLED", "true");
  callAiText.mockResolvedValueOnce({ ok: false as const, error: { code: "invalid_parameters", message: "safe" }, diagnostics: { providerHttpStatusClass: "client_error" as const } });
  const preview = await build();
  expect(preview.naturalLanguageFailureStage).toBe("provider");
  expect(preview.naturalLanguageFailureCode).toBe("provider_invalid_parameters");
  expect(preview.naturalLanguageProviderHttpStatusClass).toBe("client_error");
 });
});
