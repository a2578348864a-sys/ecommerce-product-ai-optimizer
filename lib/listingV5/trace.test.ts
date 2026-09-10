import { describe, expect, it } from "vitest";
import {
  buildListingV5ExecutionTrace,
  buildStageTrace,
  idleStageTrace,
  isListingV5TraceEnabled,
  summarizeValidationTrace,
  traceProviderStage,
} from "./trace";
import type { ListingV5ValidationResult } from "./types";

function validation(overrides: Partial<ListingV5ValidationResult> = {}): ListingV5ValidationResult {
  return {
    version: "listing-v5.validation.v3",
    status: "PASS",
    title: { valid: true, issues: [] },
    bullets: [],
    description: { valid: true, issues: [] },
    claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] },
    quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
    repair: { allowed: false, reason: null, targets: [] },
    ...overrides,
  };
}

describe("Listing V5 execution trace", () => {
  it("is disabled in production unless explicitly opted in", () => {
    expect(isListingV5TraceEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isListingV5TraceEnabled({ NODE_ENV: "production", LISTING_V5_TRACE: "1" })).toBe(true);
    expect(isListingV5TraceEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isListingV5TraceEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(isListingV5TraceEnabled({ NODE_ENV: "development", LISTING_V5_TRACE: "0" })).toBe(false);
  });

  it("separates a provider request failure from a schema normalization failure", () => {
    const requestFailed = traceProviderStage({
      useProvider: true,
      response: {
        ok: false,
        providerCallStarted: true,
        error: { code: "rate_limited", message: "ignored", provider: "openai", model: "gpt", detail: "ignored" },
        diagnostics: { model: "gpt", providerHttpStatusClass: "rate_limited" },
      } as never,
      normalized: false,
    });
    expect(requestFailed).toMatchObject({ attempted: true, success: false, failureReason: "provider_request_failed", providerErrorCode: "rate_limited" });

    const schemaFailed = traceProviderStage({
      useProvider: true,
      response: { ok: true, providerCallStarted: true, diagnostics: { model: "gpt", jsonParseStage: "passed", responseCharLength: 42 } } as never,
      normalized: false,
    });
    expect(schemaFailed).toMatchObject({ attempted: true, success: false, failureReason: "schema_normalization_failed", jsonParseStage: "passed" });
    expect(schemaFailed.providerErrorCode).toBeNull();
  });

  it("maps a json parse failure to its own reason so it is not read as a network failure", () => {
    const trace = traceProviderStage({
      useProvider: true,
      response: { ok: false, providerCallStarted: true, error: { code: "json_parse_error", message: "ignored" } } as never,
      normalized: false,
    });
    expect(trace.failureReason).toBe("provider_response_not_json");
  });

  it("never carries provider messages, keys or raw output into the trace", () => {
    const trace = buildStageTrace({
      attempted: true,
      success: false,
      failureReason: "provider_request_failed",
      response: {
        ok: false,
        error: { code: "invalid_api_key", message: "sk-SECRET should not travel", detail: "Bearer sk-SECRET" },
        diagnostics: { model: "gpt", responseCharLength: 1200, jsonParseStage: "failed", finishReason: "length", completionTokens: 3200, reasoningTokens: 3100 },
      } as never,
    });
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("sk-SECRET");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("should not travel");
    expect(trace.responseCharLength).toBe(1200);
    expect(trace.providerErrorCode).toBe("invalid_api_key");
    // finishReason / token counts separate "no content" from "ran out of tokens".
    expect(trace.finishReason).toBe("length");
    expect(trace.completionTokens).toBe(3200);
    expect(trace.reasoningTokens).toBe(3100);
  });

  it("reduces validation failures to bounded reason codes without generated copy", () => {
    const report = validation({
      status: "BLOCK",
      title: { valid: false, issues: ["title_empty"] },
      bullets: [
        { valid: false, factIds: [], strategyRole: "core_outcome", issues: ["missing_confirmed_fact_anchor"] },
        { valid: false, factIds: [], strategyRole: "pain_relief", issues: ["missing_confirmed_fact_anchor"] },
      ],
      description: { valid: false, issues: ["description_should_be_2_to_4_sentences"] },
      claims: {
        allHaveEvidence: false,
        unsupportedClaims: ["Steel keeps drinks cold for 24 hours", "Another unsupported claim"],
        prohibitedClaims: ["Guaranteed waterproof"],
        competitorOverlap: ["a long overlap phrase"],
      },
      quality: { repetitive: true, keywordStuffing: false, mechanicalTemplate: false },
    });
    const summary = summarizeValidationTrace(report);
    expect(summary.status).toBe("BLOCK");
    expect(summary.blockReasons).toEqual([
      "title:title_empty",
      "bullet:missing_confirmed_fact_anchor:2",
      "description:description_should_be_2_to_4_sentences",
      "claims:unsupported:2",
      "claims:prohibited:1",
      "claims:competitor_overlap:1",
      "quality:repetitive",
    ]);
    expect(JSON.stringify(summary)).not.toContain("cold for 24 hours");
    expect(JSON.stringify(summary)).not.toContain("Guaranteed");
  });

  it("reports NOT_RUN when validation never executed", () => {
    expect(summarizeValidationTrace(null)).toEqual({ status: "NOT_RUN", blockReasons: [] });
  });

  it("keeps the first validation pass and the final pass visible separately", () => {
    const trace = buildListingV5ExecutionTrace({
      strategy: idleStageTrace(),
      writer: idleStageTrace(),
      repair: idleStageTrace(),
      validation: validation({ status: "BLOCK", claims: { allHaveEvidence: false, unsupportedClaims: ["x"], prohibitedClaims: [], competitorOverlap: [] } }),
      finalValidation: validation(),
      fallbackUsed: true,
      fallbackReason: "validation_blocked",
    });
    expect(trace.validationStatus).toBe("BLOCK");
    expect(trace.finalValidationStatus).toBe("PASS");
    expect(trace.fallbackUsed).toBe(true);
    expect(trace.fallbackReason).toBe("validation_blocked");
  });
});
