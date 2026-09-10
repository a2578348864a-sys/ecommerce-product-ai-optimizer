import type { AiCallDiagnostics, AiClientError } from "@/lib/server/aiClient";
import type { ListingV5ValidationResult } from "./types";

/**
 * Listing V5 AI execution trace (development / test observability only).
 *
 * The existing snapshot `provider` block collapses several different failures
 * into the same booleans, so a fallback result alone cannot tell whether the
 * provider was unreachable, returned non-JSON, returned an unexpected schema,
 * or was rejected by the validator. This trace records one bounded reason per
 * stage so the real execution path is visible.
 *
 * Safety rules enforced here:
 * - no API key, no credentials, no request payload, no user input;
 * - no raw model output (only bounded counters such as character length);
 * - provider errors keep the classified enum code and HTTP status class only,
 *   never the provider message body.
 */

export const LISTING_V5_TRACE_VERSION = "listing-v5.execution-trace.v1" as const;

export type ListingV5StageName = "strategy" | "writer" | "repair";

export const LISTING_V5_STAGE_FAILURE_REASONS = [
  "none",
  "stage_not_run",
  "provider_disabled",
  "provider_not_started",
  "provider_request_failed",
  "provider_empty_response",
  "provider_response_not_json",
  "schema_normalization_failed",
  "repair_not_allowed",
  "repair_target_missing",
  "repair_response_shape_invalid",
  "repair_apply_failed",
] as const;

export type ListingV5StageFailureReason = (typeof LISTING_V5_STAGE_FAILURE_REASONS)[number];

export const LISTING_V5_FALLBACK_REASONS = ["none", "writer_stage_failed", "validation_blocked"] as const;

export type ListingV5FallbackReason = (typeof LISTING_V5_FALLBACK_REASONS)[number];

export const LISTING_V5_VALIDATION_STATUSES = ["PASS", "REPAIRABLE", "BLOCK", "NOT_RUN"] as const;

export type ListingV5ValidationStatus = (typeof LISTING_V5_VALIDATION_STATUSES)[number];

export type ListingV5StageTrace = {
  attempted: boolean;
  success: boolean;
  failureReason: ListingV5StageFailureReason;
  /** Classified provider error enum only; provider messages are never kept. */
  providerErrorCode: string | null;
  providerHttpStatusClass: string | null;
  model: string | null;
  jsonParseStage: string | null;
  /** Provider finish_reason: the fastest way to tell "no content" from "ran out of tokens". */
  finishReason: string | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  responseCharLength: number | null;
  elapsedMs: number | null;
};

export type ListingV5ExecutionTrace = {
  version: typeof LISTING_V5_TRACE_VERSION;
  strategyAttempted: boolean;
  strategySuccess: boolean;
  strategyFailureReason: ListingV5StageFailureReason;
  writerAttempted: boolean;
  writerSuccess: boolean;
  writerFailureReason: ListingV5StageFailureReason;
  repairAttempted: boolean;
  repairSuccess: boolean;
  repairFailureReason: ListingV5StageFailureReason;
  validationStatus: ListingV5ValidationStatus;
  validationBlockReasons: string[];
  /** Validation of the draft the user finally receives (after repair / fallback). */
  finalValidationStatus: ListingV5ValidationStatus;
  fallbackUsed: boolean;
  fallbackReason: ListingV5FallbackReason;
  stages: {
    strategy: ListingV5StageTrace;
    writer: ListingV5StageTrace;
    repair: ListingV5StageTrace;
  };
  generatedAt: string;
};

/**
 * Trace is a development / test instrument. Production never emits it unless
 * an operator explicitly opts in with LISTING_V5_TRACE=1.
 */
export function isListingV5TraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LISTING_V5_TRACE === "1") return true;
  if (env.LISTING_V5_TRACE === "0") return false;
  return env.NODE_ENV !== "production";
}

export function classifyAiErrorReason(error: AiClientError | undefined): ListingV5StageFailureReason {
  if (!error) return "provider_request_failed";
  if (error.code === "empty_response") return "provider_empty_response";
  if (error.code === "json_parse_error") return "provider_response_not_json";
  return "provider_request_failed";
}

export function buildStageTrace(input: {
  attempted: boolean;
  success: boolean;
  failureReason: ListingV5StageFailureReason;
  response?: { ok: boolean; error?: AiClientError; diagnostics?: AiCallDiagnostics };
}): ListingV5StageTrace {
  const diagnostics = input.response?.diagnostics;
  return {
    attempted: input.attempted,
    success: input.success,
    failureReason: input.failureReason,
    providerErrorCode: input.response && !input.response.ok && input.response.error
      ? input.response.error.code
      : null,
    providerHttpStatusClass: diagnostics?.providerHttpStatusClass ?? null,
    model: diagnostics?.model ?? null,
    jsonParseStage: diagnostics?.jsonParseStage ?? null,
    finishReason: diagnostics?.finishReason ?? null,
    completionTokens: typeof diagnostics?.completionTokens === "number" ? diagnostics.completionTokens : null,
    reasoningTokens: typeof diagnostics?.reasoningTokens === "number" ? diagnostics.reasoningTokens : null,
    responseCharLength: typeof diagnostics?.responseCharLength === "number" ? diagnostics.responseCharLength : null,
    elapsedMs: typeof diagnostics?.elapsedMs === "number" ? diagnostics.elapsedMs : null,
  };
}

/** Map one provider stage outcome to a bounded trace. Never inspects payload text. */
export function traceProviderStage(input: {
  useProvider: boolean;
  response: { ok: boolean; error?: AiClientError; diagnostics?: AiCallDiagnostics; providerCallStarted?: boolean };
  normalized: boolean;
}): ListingV5StageTrace {
  if (!input.useProvider) {
    return buildStageTrace({ attempted: false, success: false, failureReason: "provider_disabled", response: input.response });
  }
  if (!input.response.ok) {
    if (input.response.providerCallStarted !== true) {
      return buildStageTrace({ attempted: false, success: false, failureReason: "provider_not_started", response: input.response });
    }
    return buildStageTrace({
      attempted: true,
      success: false,
      failureReason: classifyAiErrorReason(input.response.error),
      response: input.response,
    });
  }
  if (!input.normalized) {
    return buildStageTrace({ attempted: true, success: false, failureReason: "schema_normalization_failed", response: input.response });
  }
  return buildStageTrace({ attempted: true, success: true, failureReason: "none", response: input.response });
}

const MAX_BLOCK_REASONS = 12;

function pushCount(list: string[], key: string, count: number) {
  if (count > 0) list.push(`${key}:${count}`);
}

/**
 * Summarize validation into bounded reason codes. Claim texts are reduced to
 * category + count so no generated copy is copied into the trace.
 */
export function summarizeValidationTrace(validation: ListingV5ValidationResult | null): {
  status: ListingV5ValidationStatus;
  blockReasons: string[];
} {
  if (!validation) return { status: "NOT_RUN", blockReasons: [] };
  const reasons: string[] = [];
  for (const issue of validation.title.issues) reasons.push(`title:${issue}`);
  const bulletIssues = new Map<string, number>();
  for (const bullet of validation.bullets) {
    for (const issue of bullet.issues) bulletIssues.set(issue, (bulletIssues.get(issue) ?? 0) + 1);
  }
  for (const [issue, count] of bulletIssues) reasons.push(`bullet:${issue}:${count}`);
  for (const issue of validation.description.issues) reasons.push(`description:${issue}`);
  pushCount(reasons, "claims:unsupported", validation.claims.unsupportedClaims.length);
  pushCount(reasons, "claims:prohibited", validation.claims.prohibitedClaims.length);
  pushCount(reasons, "claims:competitor_overlap", validation.claims.competitorOverlap.length);
  if (validation.quality.repetitive) reasons.push("quality:repetitive");
  if (validation.quality.keywordStuffing) reasons.push("quality:keyword_stuffing");
  if (validation.quality.mechanicalTemplate) reasons.push("quality:mechanical_template");
  return {
    status: validation.status,
    blockReasons: reasons.slice(0, MAX_BLOCK_REASONS),
  };
}

export function buildListingV5ExecutionTrace(input: {
  strategy: ListingV5StageTrace;
  writer: ListingV5StageTrace;
  repair: ListingV5StageTrace;
  /** First validation pass: this is the one that answers "did the validator block the AI draft?". */
  validation: ListingV5ValidationResult | null;
  /** Last validation pass, run on the draft the user finally receives. */
  finalValidation?: ListingV5ValidationResult | null;
  fallbackUsed: boolean;
  fallbackReason: ListingV5FallbackReason;
  generatedAt?: string;
}): ListingV5ExecutionTrace {
  const validationSummary = summarizeValidationTrace(input.validation);
  return {
    version: LISTING_V5_TRACE_VERSION,
    strategyAttempted: input.strategy.attempted,
    strategySuccess: input.strategy.success,
    strategyFailureReason: input.strategy.failureReason,
    writerAttempted: input.writer.attempted,
    writerSuccess: input.writer.success,
    writerFailureReason: input.writer.failureReason,
    repairAttempted: input.repair.attempted,
    repairSuccess: input.repair.success,
    repairFailureReason: input.repair.failureReason,
    validationStatus: validationSummary.status,
    validationBlockReasons: validationSummary.blockReasons,
    finalValidationStatus: summarizeValidationTrace(input.finalValidation ?? input.validation).status,
    fallbackUsed: input.fallbackUsed,
    fallbackReason: input.fallbackReason,
    stages: { strategy: input.strategy, writer: input.writer, repair: input.repair },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

export const LISTING_V5_IDLE_STAGE_TRACE: ListingV5StageTrace = {
  attempted: false,
  success: false,
  failureReason: "stage_not_run",
  providerErrorCode: null,
  providerHttpStatusClass: null,
  model: null,
  jsonParseStage: null,
  finishReason: null,
  completionTokens: null,
  reasoningTokens: null,
  responseCharLength: null,
  elapsedMs: null,
};

export function idleStageTrace(): ListingV5StageTrace {
  return { ...LISTING_V5_IDLE_STAGE_TRACE };
}
