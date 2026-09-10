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
  repair: { allowed: true, reason: "仅允许一次结构化修复" },
  title: { valid: true, issues: [] },
  bullets: [
    { valid: true, issues: [] },
    { valid: true, issues: [] },
    { valid: false, issues: ["unsupported_duration"] },
  ],
  description: { valid: true, issues: [] },
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
    expect(result).toEqual({ draft, attempted: false, succeeded: false });
    expect(callAiJson).not.toHaveBeenCalled();
  });
});
