import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import { repairListingV5Draft } from "./structuredRepair";
import type { ListingV5WriterDraft } from "./types";

/**
 * Repair response-shape compatibility.
 *
 * A provider answer is the same answer whether it arrives as
 * {"repairs":[{...}]}, as a bare single-field object, or wrapped one level
 * deep. Rejecting those variants turned a successful repair into a fallback.
 * The permission boundary is unchanged: every item must name a *requested*
 * target and carry non-empty text, and only `text` may be replaced.
 */

const mocks = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson: mocks.callAiJson }));

const facts = [
  { factId: "dims-1", field: "dimensions", label: "Dimensions", value: '9.8"L x 8.8"W x 7.4"H' },
  { factId: "material-1", field: "material", label: "Material", value: "Ceramic" },
];

function context() {
  return buildListingV5Context({
    taskId: "task-repair-shape",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Ceramic Holder",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [],
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
    },
    confirmedFacts: facts,
  });
}

function draft(): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Ceramic Holder", factIds: ["material-1"] },
    bullets: [
      { text: "A ceramic holder for daily use.", factIds: ["material-1"], strategyRole: "core_outcome" },
      { text: "It measures 9.8\"L x 8.8\"W x 7.4\"H.", factIds: ["dims-1"], strategyRole: "pain_relief" },
      { text: "The ceramic body suits the counter.", factIds: ["material-1"], strategyRole: "use_scenario" },
    ],
    description: { text: "This holder brings ceramic storage to high-use kitchens. It measures 9.8\"L x 8.8\"W x 7.4\"H.", factIds: ["material-1"] },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

const ok = (data: unknown) => ({
  ok: true as const,
  data,
  providerCallStarted: true,
  diagnostics: {
    model: "test-model", thinkingMode: "default" as const, maxTokens: 2000,
    providerHttpStatusClass: "success" as const, finishReason: "stop",
    completionTokens: 100, reasoningTokens: null, responseCharLength: 200,
    jsonParseStage: "passed" as const, elapsedMs: 500,
  },
});

const REPAIRED = "This holder brings ceramic storage to daily kitchens. It measures 9.8\"L x 8.8\"W x 7.4\"H.";

async function repairWith(data: unknown) {
  mocks.callAiJson.mockReset();
  mocks.callAiJson.mockResolvedValueOnce(ok(data));
  const ctx = context();
  const strategy = buildListingV5Strategy(ctx);
  const current = draft();
  const validation = validateListingV5Draft(ctx, strategy, current);
  const result = await repairListingV5Draft({ context: ctx, strategy, validation, draft: current, useProvider: true });
  return { result, ctx, strategy };
}

describe("Listing V5 repair response shapes", () => {
  beforeEach(() => { mocks.callAiJson.mockReset(); });

  it("accepts the documented repairs[] shape", async () => {
    const { result } = await repairWith({ repairs: [{ path: "description", text: REPAIRED }] });
    expect(result.appliedPaths).toEqual(["description"]);
    expect(result.succeeded).toBe(true);
    expect(result.draft.description.text).toBe(REPAIRED);
  });

  it("accepts a single repair object instead of an array", async () => {
    const { result } = await repairWith({ repairs: { path: "description", text: REPAIRED } });
    expect(result.appliedPaths).toEqual(["description"]);
    expect(result.succeeded).toBe(true);
  });

  it("accepts a bare single-field object", async () => {
    const { result } = await repairWith({ path: "description", text: REPAIRED });
    expect(result.appliedPaths).toEqual(["description"]);
    expect(result.succeeded).toBe(true);
  });

  it("accepts a one-level wrapper", async () => {
    const { result } = await repairWith({ result: { repairs: [{ path: "description", text: REPAIRED }] } });
    expect(result.appliedPaths).toEqual(["description"]);
    expect(result.succeeded).toBe(true);
  });

  it("normalizes formatting differences in the requested path", async () => {
    const { result } = await repairWith({ repairs: [{ path: " Description ", text: REPAIRED }] });
    expect(result.appliedPaths).toEqual(["description"]);
    expect(result.succeeded).toBe(true);
  });

  it("still refuses a path that was not requested", async () => {
    const { result } = await repairWith({ repairs: [{ path: "title", text: "A rewritten title" }] });
    expect(result.appliedPaths).toEqual([]);
    expect(result.succeeded).toBe(false);
    // The unrequested field is untouched.
    expect(result.draft.title.text).toBe("Ceramic Holder");
  });

  it("still refuses empty repaired text", async () => {
    const { result } = await repairWith({ repairs: [{ path: "description", text: "   " }] });
    expect(result.appliedPaths).toEqual([]);
    expect(result.succeeded).toBe(false);
  });

  it("still refuses a payload with no repair item at all", async () => {
    const { result } = await repairWith({ note: "nothing to change" });
    expect(result.appliedPaths).toEqual([]);
    expect(result.succeeded).toBe(false);
    expect(result.responseShape).toContain("items=0");
  });

  it("reports a bounded shape summary without leaking the whole payload", async () => {
    const { result } = await repairWith({ repairs: [{ path: "description", text: REPAIRED }] });
    expect(result.responseShape).toContain("keys=repairs");
    expect(result.responseShape).toContain("paths=description");
    expect(result.responseShape).toContain(`textLengths=${REPAIRED.length}`);
  });

  it("names the recognized container so a rejected shape is diagnosable", async () => {
    const wrapped = await repairWith({ repairs: [{ path: "description", text: REPAIRED }] });
    expect(wrapped.result.responseShape).toContain("wrapper=repairs[0]");
    expect(wrapped.result.responseShape).toContain("textPresent=y");

    const bare = await repairWith({ path: "description", text: REPAIRED });
    expect(bare.result.responseShape).toContain("wrapper=root");

    const nested = await repairWith({ data: { repairs: [{ path: "description", text: REPAIRED }] } });
    expect(nested.result.responseShape).toContain("wrapper=data.repairs[0]");
    expect(nested.result.succeeded).toBe(true);

    const empty = await repairWith({ repairs: [{ path: "description", text: "   " }] });
    expect(empty.result.responseShape).toContain("items=1");
    expect(empty.result.responseShape).toContain("textPresent=n");

    const nothing = await repairWith({ note: "nothing to change" });
    expect(nothing.result.responseShape).toContain("wrapper=none");
    expect(nothing.result.responseShape).toContain("items=0");
  });

  it("never lets a repair change fact ids or strategy roles", async () => {
    const { result } = await repairWith({ repairs: [{ path: "description", text: REPAIRED }] });
    expect(result.draft.title.factIds).toEqual(["material-1"]);
    expect(result.draft.bullets.map((bullet) => bullet.strategyRole)).toEqual(["core_outcome", "pain_relief", "use_scenario"]);
    expect(result.draft.bullets.map((bullet) => bullet.factIds)).toEqual([["material-1"], ["dims-1"], ["material-1"]]);
  });
});
