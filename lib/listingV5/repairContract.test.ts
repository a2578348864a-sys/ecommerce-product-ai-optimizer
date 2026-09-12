import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairListingV5Draft } from "./structuredRepair";

/**
 * Repair request/answer contract.
 *
 * Root cause of two real Provider failures: the request handed the model an
 * item named `currentText` and asked for an item named `text`, so the model
 * mirrored the request schema back and the answer never carried `text` at all.
 * Input and output vocabularies are now deliberately unrelated
 * (`targets[].original` -> `repairs[].text`), and the answer schema is stated
 * explicitly in the prompt.
 *
 * These tests also keep the safety boundary intact: an answer that carries only
 * `currentText` is still rejected, so nothing was loosened for one case.
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

const context = {
  confirmedFacts: [{ id: "fact-1", canonicalField: "construction", label: "Construction", value: "ceramic", sourceRefs: [] }],
} as any;
const strategy = { bulletAngles: [{ role: "core_outcome" }] } as any;
const draft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Ceramic Holder", factIds: ["fact-1"] },
  bullets: [{ text: "Bullet stays unchanged.", factIds: ["fact-1"], strategyRole: "core_outcome" }],
  description: { text: "This holder is built for high-use kitchens.", factIds: ["fact-1"] },
  backendSearchTerms: ["ceramic holder"],
  humanReviewRequired: true,
} as any;
const validation = {
  repair: { allowed: true, reason: null, targets: ["description"] },
  title: { valid: true, issues: [] },
  bullets: [{ valid: true, issues: [] }],
  description: { valid: false, issues: ["unsupported_claim"] },
  claims: { unsupportedClaims: ["This holder is built for high-use kitchens."], prohibitedClaims: [], competitorOverlap: [] },
} as any;

const REPAIRED = "This ceramic holder supports everyday countertop storage.";

async function requestPayload() {
  callAiJson.mockReset();
  callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
  await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
  const params = callAiJson.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }> };
  return {
    payload: JSON.parse(params.messages.find((message) => message.role === "user")!.content) as Record<string, any>,
    prompt: params.messages.find((message) => message.role === "system")!.content,
  };
}

async function repairWith(data: unknown) {
  callAiJson.mockReset();
  callAiJson.mockResolvedValue({ ok: true, providerCallStarted: true, data });
  return repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
}

describe("Listing V5 repair request/answer contract", () => {
  beforeEach(() => callAiJson.mockReset());

  it("sends targets[].original and never the field name the model echoed back", async () => {
    const { payload } = await requestPayload();
    expect(Object.keys(payload)).toEqual(["targets", "confirmedFacts", "strategy"]);
    expect(payload.targets).toHaveLength(1);
    expect(payload.targets[0]).toMatchObject({ path: "description", original: draft.description.text });
    // A caller without structured violation evidence still forwards the sentence,
    // with no span invented for it.
    expect(payload.targets[0].issues.violations).toEqual([
      { issueCode: "unsupported_claim", sentence: "This holder is built for high-use kitchens.", offendingSpans: [] },
    ]);
    // The echoed-back name must be gone from the whole request.
    expect(JSON.stringify(payload)).not.toContain("currentText");
  });

  it("states the answer schema explicitly and forbids echoing request fields", async () => {
    const { prompt } = await requestPayload();
    expect(prompt).toContain('{"repairs":[{"path":"<one requested path>","text":"<replacement text>"}]}');
    expect(prompt).toMatch(/Every object in "repairs" has exactly two keys: "path" and "text"/);
    expect(prompt).toContain("Do not return: original, source, currentText, factIds, strategyRole, issues, analysis, reason, explanation.");
    expect(prompt).toMatch(/Return JSON only/);
  });

  it("applies a conforming answer and leaves every other field untouched", async () => {
    const result = await repairWith({ repairs: [{ path: "description", text: REPAIRED }] });
    expect(result.attempted).toBe(true);
    expect(result.succeeded).toBe(true);
    expect(result.appliedPaths).toEqual(["description"]);
    expect(result.draft.description.text).toBe(REPAIRED);
    expect(result.draft.description.factIds).toEqual(draft.description.factIds);
    expect(result.draft.title).toEqual(draft.title);
    expect(result.draft.bullets).toEqual(draft.bullets);
    expect(result.draft.backendSearchTerms).toEqual(draft.backendSearchTerms);
    expect(result.trace.failureReason).toBe("none");
  });

  it("still rejects an answer that only carries currentText", async () => {
    const result = await repairWith({ repairs: [{ path: "description", currentText: REPAIRED }] });
    expect(result.succeeded).toBe(false);
    expect(result.appliedPaths).toEqual([]);
    expect(result.trace.failureReason).toBe("repair_response_shape_invalid");
    expect(result.draft).toEqual(draft);
    // The shape record makes the rejection diagnosable without a second call.
    expect(result.responseShape).toContain("wrapper=none");
    expect(result.responseShape).toContain("items=0");
  });
});
