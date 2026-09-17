import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairListingV5Draft } from "./structuredRepair";

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

const context = {
  confirmedFacts: [{ id: "fact-1", canonicalField: "construction", label: "Construction", value: "insulated stainless steel", sourceRefs: [] }],
} as any;
const strategy = { bulletAngles: [{ role: "core_outcome" }, { role: "pain_relief" }, { role: "use_scenario" }] } as any;
const draft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Bottle", factIds: ["fact-1"] },
  bullets: [
    { text: "First stays unchanged.", factIds: ["fact-1"], strategyRole: "core_outcome" },
    { text: "Second stays unchanged.", factIds: ["fact-1"], strategyRole: "pain_relief" },
    { text: "Third contains unsupported duration.", factIds: ["fact-1"], strategyRole: "use_scenario" },
  ],
  description: { text: "Description stays unchanged.", factIds: ["fact-1"] },
  backendSearchTerms: ["bottle"],
  humanReviewRequired: true,
} as any;
const validation = {
  repair: { allowed: true, reason: "仅允许一次结构化修复", targets: ["bullets[2]"] },
  title: { valid: true, issues: [] },
  bullets: [
    { valid: true, issues: [] },
    { valid: true, issues: [] },
    { valid: false, issues: ["unsupported_duration"] },
  ],
  description: { valid: true, issues: [] },
  claims: { unsupportedClaims: ["Third contains unsupported duration."], prohibitedClaims: [], competitorOverlap: [] },
} as any;

describe("Listing V5 structured repair", () => {
  beforeEach(() => callAiJson.mockReset());

  it("changes only the invalid bullet text and preserves all other fields", async () => {
    callAiJson.mockResolvedValue({ ok: true, data: { path: "bullets[2]", text: "Third fits everyday hydration routines." }, providerCallStarted: true });
    const result = await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
    expect(result.succeeded).toBe(true);
    expect(result.draft.title).toEqual(draft.title);
    expect(result.draft.bullets[0]).toEqual(draft.bullets[0]);
    expect(result.draft.bullets[1]).toEqual(draft.bullets[1]);
    expect(result.draft.bullets[2]).toEqual({ ...draft.bullets[2], text: "Third fits everyday hydration routines." });
    expect(result.draft.description).toEqual(draft.description);
    expect(result.draft.backendSearchTerms).toEqual(draft.backendSearchTerms);
  });

  it("fails closed without provider and returns the original draft", async () => {
    const result = await repairListingV5Draft({ context, strategy, validation, draft, useProvider: false });
    expect(result.draft).toEqual(draft);
    expect(result.attempted).toBe(false);
    expect(result.succeeded).toBe(false);
    expect(result.trace).toMatchObject({ attempted: false, success: false, failureReason: "provider_disabled" });
    expect(callAiJson).not.toHaveBeenCalled();
  });

  it("records a bounded reason when repair is not allowed for the validation status", async () => {
    const result = await repairListingV5Draft({ context, strategy, validation: { ...validation, repair: { allowed: false, reason: null } }, draft, useProvider: true });
    expect(result.attempted).toBe(false);
    expect(result.trace.failureReason).toBe("repair_not_allowed");
    expect(callAiJson).not.toHaveBeenCalled();
  });

  it("records a bounded reason when the provider repair response has the wrong shape", async () => {
    callAiJson.mockResolvedValue({ ok: true, data: { path: "title", text: "Wrong path" }, providerCallStarted: true });
    const result = await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
    expect(result.succeeded).toBe(false);
    expect(result.trace).toMatchObject({ attempted: true, success: false, failureReason: "repair_response_shape_invalid" });
  });

  it("repairs several whitelisted fields in a single provider call and preserves everything else", async () => {
    const multiValidation = {
      ...validation,
      repair: { allowed: true, reason: "仅允许一次结构化修复", targets: ["bullets[1]", "description"] },
      bullets: [
        { valid: true, issues: [] },
        { valid: false, issues: ["unsupported_hard_claim"] },
        { valid: true, issues: [] },
      ],
      description: { valid: false, issues: ["description_should_be_2_to_4_sentences"] },
      claims: { unsupportedClaims: ["Second carries an unconfirmed adjective."], prohibitedClaims: [], competitorOverlap: [] },
    } as any;
    callAiJson.mockResolvedValue({
      ok: true,
      providerCallStarted: true,
      data: { repairs: [
        { path: "bullets[1]", text: "Second no longer asserts the unconfirmed adjective." },
        { path: "description", text: "A short first sentence. A short second sentence." },
      ] },
    });
    const result = await repairListingV5Draft({ context, strategy, validation: multiValidation, draft, useProvider: true });

    expect(callAiJson).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(true);
    expect(result.succeeded).toBe(true);
    expect(result.appliedPaths).toEqual(["bullets[1]", "description"]);
    // Untouched fields keep their exact previous values.
    expect(result.draft.bullets[0]).toEqual(draft.bullets[0]);
    expect(result.draft.bullets[2]).toEqual(draft.bullets[2]);
    expect(result.draft.title).toEqual(draft.title);
    expect(result.draft.backendSearchTerms).toEqual(draft.backendSearchTerms);
    expect(result.draft.bullets[1].factIds).toEqual(draft.bullets[1].factIds);
    expect(result.draft.bullets[1].strategyRole).toEqual(draft.bullets[1].strategyRole);
    expect(result.draft.description.factIds).toEqual(draft.description.factIds);
    expect(result.draft.bullets[1].text).toBe("Second no longer asserts the unconfirmed adjective.");
    expect(result.draft.description.text).toBe("A short first sentence. A short second sentence.");
  });

  it("rejects a repair response that tries to write a path outside the whitelist", async () => {
    callAiJson.mockResolvedValue({
      ok: true,
      providerCallStarted: true,
      data: { repairs: [
        { path: "bullets[2]", text: "Third fits everyday hydration routines." },
        { path: "title", text: "Injected title" },
        { path: "bullets[9]", text: "Out of range" },
      ] },
    });
    const result = await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
    expect(result.appliedPaths).toEqual(["bullets[2]"]);
    expect(result.draft.title).toEqual(draft.title);
    expect(result.draft.bullets).toHaveLength(draft.bullets.length);
  });
});
