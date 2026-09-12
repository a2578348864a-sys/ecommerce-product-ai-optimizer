import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider 调用参数防回归。
 *
 * 上一轮真实 Trace 证据：V5 三处 callAiJson 都没有传 thinkingMode，DeepSeek 走
 * provider 默认（开启思考），reasoning 吃满 maxTokens →
 *   finishReason=length / completionTokens=3200 / reasoningTokens=3200 / responseCharLength=0
 * → aiClient 判定 empty_response → 触发 safe fallback。
 *
 * 本测试锁定：结构化 JSON 生成任务必须显式关闭 thinking，并保持有界 token 预算。
 * 任何一次删除 thinkingMode 都会让上述症状复发。
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { analyzeListingV5Strategy } from "./strategy";
import { generateListingV5Draft } from "./generation";
import { repairListingV5Draft } from "./structuredRepair";
import type { ListingV5Context, ListingV5Strategy } from "./types";

const context = {
  version: "listing-v5.context.v1",
  taskId: "task-params",
  researchRevision: 1,
  handoffRevision: 1,
  contextFingerprint: "fp",
  marketplace: "Amazon US",
  productIdentity: "Insulated Bottle",
  confirmedFacts: [
    { id: "fact-1", canonicalField: "material", label: "Material", value: "insulated stainless steel", sourceRefs: [] },
  ],
  prohibitedClaims: [],
  unknowns: [],
  references: { voc: [], keywords: [], competitors: [], sourcing: [] },
  manualDirection: null,
} as ListingV5Context;

const strategy = {
  version: "listing-v5.strategy.v1",
  referenceOnly: true,
  researchRevision: 1,
  targetAudience: ["shoppers"],
  purchaseMotivations: ["clear value"],
  painPoints: [],
  useCases: ["everyday use"],
  primaryAngle: "Make the bottle easier to understand",
  secondaryAngles: [],
  tone: ["clear"],
  keywordIntent: { primary: ["bottle"], secondary: [], backendOnly: [] },
  bulletAngles: [{ role: "core_outcome", shopperValue: "understand the main product value" }],
  avoidClaims: [],
} as unknown as ListingV5Strategy;

const draft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Bottle", factIds: ["fact-1"] },
  bullets: [{ text: "Insulated stainless steel fits everyday routines.", factIds: ["fact-1"], strategyRole: "core_outcome" }],
  description: { text: "A bottle for daily use. Clear details help shoppers compare.", factIds: ["fact-1"] },
  backendSearchTerms: ["bottle"],
  humanReviewRequired: true,
} as never;

const validation = {
  version: "listing-v5.validation.v1",
  status: "REPAIRABLE",
  title: { valid: true, issues: [] },
  bullets: [{ valid: false, factIds: ["fact-1"], strategyRole: "core_outcome", issues: ["unsupported_duration"] }],
  description: { valid: true, issues: [] },
  claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] },
  quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
  repair: { allowed: true, reason: "仅允许一次结构化修复" },
} as never;

function capturedParams(callIndex = 0) {
  return callAiJson.mock.calls[callIndex]?.[0] as Record<string, unknown> | undefined;
}

describe("Listing V5 provider call parameters", () => {
  beforeEach(() => {
    callAiJson.mockReset();
    // 失败响应已足够：参数在请求发出前就已确定，不依赖返回形态。
    callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
  });

  it("strategy disables thinking and keeps a bounded token budget", async () => {
    await analyzeListingV5Strategy(context, { useProvider: true });
    const params = capturedParams();
    expect(params).toBeDefined();
    expect(params!.thinkingMode).toBe("disabled");
    expect(params!.maxTokens).toBe(8000);
    expect(params!.temperature).toBe(0.2);
    expect(Object.prototype.hasOwnProperty.call(params, "thinkingMode")).toBe(true);
  });

  it("writer disables thinking and keeps a bounded token budget", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const params = capturedParams();
    expect(params).toBeDefined();
    expect(params!.thinkingMode).toBe("disabled");
    expect(params!.maxTokens).toBe(8000);
    expect(params!.temperature).toBe(0.35);
    expect(Object.prototype.hasOwnProperty.call(params, "thinkingMode")).toBe(true);
  });

  it("repair disables thinking and keeps a bounded token budget", async () => {
    await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
    const params = capturedParams();
    expect(params).toBeDefined();
    expect(params!.thinkingMode).toBe("disabled");
    expect(params!.maxTokens).toBe(2000);
    expect(params!.temperature).toBe(0.2);
    expect(Object.prototype.hasOwnProperty.call(params, "thinkingMode")).toBe(true);
  });

  it("never sends a token budget that reasoning alone could exhaust", async () => {
    await analyzeListingV5Strategy(context, { useProvider: true });
    await generateListingV5Draft(context, strategy, { useProvider: true });
    await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
    expect(callAiJson).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 3; index += 1) {
      const params = capturedParams(index)!;
      expect(params.thinkingMode).toBe("disabled");
      expect(typeof params.maxTokens).toBe("number");
      expect(params.maxTokens as number).toBeLessThanOrEqual(8000);
    }
  });

  it("does not send a request when the provider is disabled", async () => {
    await analyzeListingV5Strategy(context, { useProvider: false });
    await generateListingV5Draft(context, strategy, { useProvider: false });
    await repairListingV5Draft({ context, strategy, validation, draft, useProvider: false });
    expect(callAiJson).not.toHaveBeenCalled();
  });
});
