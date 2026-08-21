/**
 * V4 P2 — Tool 注册表（Lead 集成）。
 * dispatch_tool 节点通过本注册表调用 P2 adapters（recorded 默认；live 需 QX_V4_TOOL_LIVE=1 且注入读取器）。
 * 所有输出必须通过 envelope.validateToolResult。
 */
import "server-only";

import type { ToolCallEnvelope, ToolResultEnvelope } from "@/lib/v4/tools/envelope";
import { validateToolResult, TOOL_ENVELOPE_VERSION } from "@/lib/v4/tools/envelope";
import { runAmazonAdapter } from "@/lib/v4/adapters/amazon";
import { runKeywordAdapter } from "@/lib/v4/adapters/keyword";
import { runVocAdapter } from "@/lib/v4/adapters/voc";
import { runSellerSpriteAdapter } from "@/lib/v4/adapters/sellersprite";
import { run1688Adapter } from "@/lib/v4/adapters/1688";
import { getCandidateProfileFixture } from "@/lib/v4/adapters/fixtures/candidateProfiles";

export const MARKET_TOOL_NAMES = ["amazon/search", "amazon/detail", "keyword", "voc", "sellersprite", "supplier_1688"] as const;
export type MarketToolName = (typeof MARKET_TOOL_NAMES)[number];

export function isMarketTool(toolName: string): toolName is MarketToolName {
  return (MARKET_TOOL_NAMES as readonly string[]).includes(toolName);
}

export function isMarketToolLiveEnabled(): boolean {
  const raw = process.env.QX_V4_TOOL_LIVE;
  return raw === "1" || raw === "true";
}

export type BuildEnvelopeInput = {
  runId: string;
  questionId: string;
  toolName: string;
  targetEntity: string;
  marketplace: string;
  requestedFields?: string[];
  maxSteps?: number;
  timeoutMs?: number;
  budget?: { maxCost: number; currency: string; maxBrowserSteps: number };
  inputHash: string;
  idempotencyKey: string;
};

export function buildToolEnvelope(input: BuildEnvelopeInput): ToolCallEnvelope {
  return {
    toolCallId: `tc-${input.inputHash.slice(0, 12)}`,
    runId: input.runId,
    questionId: input.questionId,
    toolName: input.toolName,
    toolVersion: TOOL_ENVELOPE_VERSION,
    targetEntity: input.targetEntity,
    marketplace: input.marketplace,
    allowedDomains: input.toolName.startsWith("amazon") ? ["www.amazon.com", "amazon.com"] : [],
    requestedFields: input.requestedFields ?? ["asin", "title", "price", "rating", "reviewCount", "bsr"],
    maxSteps: input.maxSteps ?? 3,
    timeoutMs: input.timeoutMs ?? 30_000,
    budget: input.budget ?? { maxCost: 1, currency: "USD", maxBrowserSteps: 10 },
    inputHash: input.inputHash,
    idempotencyKey: input.idempotencyKey,
  };
}

function noResult(toolName: string, reason: string): ToolResultEnvelope {
  return {
    status: "no_results",
    observedEntity: null,
    data: null,
    rawArtifactRefs: [],
    capturedAt: new Date().toISOString(),
    cost: { usedCost: 0, currency: "USD", usedBrowserSteps: 0 },
    warnings: [{ code: "FIXTURE_NOT_FOUND", message: reason }],
    errors: [],
    nextAction: "revise_plan",
  };
}

/** keyword/voc/sellersprite 的 recorded fixture 从三候选画像解析（确定性）。 */
function profileFixtureFor(toolName: string): ToolResultEnvelope | null {
  try {
    const profile = getCandidateProfileFixture("evidence_sufficient");
    if (!profile) return null;
    const entity = profile.targetEntity ?? "candidate";
    if (toolName === "sellersprite") {
      return {
        status: "ok",
        observedEntity: entity,
        data: { profile: profile.profile, priorityBand: profile.priorityBand, confidence: profile.confidence, conflicts: profile.conflicts, evidenceItems: profile.evidenceItems },
        rawArtifactRefs: [{ kind: "recorded", ref: "candidateProfiles:evidence_sufficient", capturedAt: new Date().toISOString() }],
        capturedAt: new Date().toISOString(),
        cost: { usedCost: 0, currency: "USD", usedBrowserSteps: 0 },
        warnings: [],
        errors: [],
        nextAction: "continue",
      };
    }
    if (toolName === "keyword") {
      const kwItems = profile.evidenceItems.filter((e) => e.sourceType === "keyword_provider");
      return {
        status: kwItems.length ? "ok" : "no_results",
        observedEntity: entity,
        data: { profile: profile.profile, keywords: kwItems.map((e) => ({ term: String(e.entity), metricType: "estimate", value: e.typedValue.value, unit: String(e.typedValue.unit ?? "searches/month"), period: "month", source: e.sourceType, evidenceId: e.evidenceId })) },
        rawArtifactRefs: [{ kind: "recorded", ref: "candidateProfiles:evidence_sufficient", capturedAt: new Date().toISOString() }],
        capturedAt: new Date().toISOString(),
        cost: { usedCost: 0, currency: "USD", usedBrowserSteps: 0 },
        warnings: [],
        errors: [],
        nextAction: "continue",
      };
    }
    if (toolName === "voc") {
      const vocItems = profile.evidenceItems.filter((e) => e.sourceType === "review" || (e.sourceType as string) === "voc");
      return {
        status: vocItems.length ? "ok" : "no_results",
        observedEntity: entity,
        data: { profile: profile.profile, themes: vocItems.map((e) => ({ label: String(e.entity), count: 1, share: 0.5, evidenceRefs: [e.evidenceId] })), sampleSize: vocItems.length },
        rawArtifactRefs: [{ kind: "recorded", ref: "candidateProfiles:evidence_sufficient", capturedAt: new Date().toISOString() }],
        capturedAt: new Date().toISOString(),
        cost: { usedCost: 0, currency: "USD", usedBrowserSteps: 0 },
        warnings: [],
        errors: [],
        nextAction: "continue",
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** 执行市场工具（默认 recorded）。返回已过信封校验的结果。 */
export async function executeMarketTool(envelope: ToolCallEnvelope): Promise<ToolResultEnvelope> {
  let result: ToolResultEnvelope;
  try {
    switch (envelope.toolName) {
      case "amazon/search":
      case "amazon/detail": {
        result = await runAmazonAdapter(envelope);
        break;
      }
      case "keyword":
      case "voc":
      case "supplier_1688": {
        result = await run1688Adapter(envelope);
        break;
      }
      case "sellersprite": {
        const profileResult = profileFixtureFor(envelope.toolName);
        if (profileResult) { result = profileResult; break; }
        result = noResult(envelope.toolName, "no profile fixture");
        break;
      }
      default: {
        result = noResult(envelope.toolName, "unknown tool: " + envelope.toolName);
      }
    }
  } catch (error) {
    result = {
      status: "stopped_error",
      observedEntity: envelope.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt: new Date().toISOString(),
      cost: { usedCost: 0, currency: "USD", usedBrowserSteps: 0 },
      warnings: [],
      errors: [{ code: "UNKNOWN_RECOVERABLE", safeMessage: String(error).slice(0, 300) }],
      nextAction: "revise_plan",
    };
  }
  const validated = validateToolResult(result);
  if (!validated.ok) {
    return {
      ...result,
      status: "stopped_error",
      errors: [...(result.errors ?? []), { code: "SCHEMA_INVALID", safeMessage: "envelope validation: " + validated.reason }],
      nextAction: "stop",
    };
  }
  return validated.result;
}
