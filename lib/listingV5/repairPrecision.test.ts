import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import { repairListingV5Draft } from "./structuredRepair";
import type { ListingV5WriterDraft } from "./types";

/**
 * Repair targeting precision (zero Provider calls).
 *
 * A real case exposed this: the Validator flagged a sentence, the repair step
 * received only that sentence, and the model rewrote the sentence while keeping
 * the word that actually failed ("high-use" survived). The Validator knows the
 * exact rejected words, so it now reports them as `offendingSpans` and the
 * repair request forwards them.
 *
 * offendingSpans explain a failure. They are never a fact source.
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

const facts = [
  { factId: "material-1", field: "material", label: "Material", value: "ceramic" },
  { factId: "care-1", field: "care", label: "Care", value: "hand wash only" },
  { factId: "color-1", field: "color", label: "Colour", value: "white" },
];

function contextOf(confirmed = facts) {
  return buildListingV5Context({
    taskId: "task-repair-precision",
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
    confirmedFacts: confirmed,
  });
}

function draftWith(description: string): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Ceramic Holder", factIds: ["material-1"] },
    bullets: [
      { text: "This ceramic holder keeps utensils within reach.", factIds: ["material-1"], strategyRole: "core_outcome" },
      { text: "The holder is made of ceramic and is hand wash only.", factIds: ["care-1"], strategyRole: "pain_relief" },
    ],
    description: { text: description, factIds: ["material-1"] },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

/** The frozen Case B description from the real benchmark (out/benchmark-abc.txt). */
const FROZEN_CASE_B_DESCRIPTION = "The LE TAUCI Ceramic Utensil Holder set brings elegant kitchen decor and practical countertop organization to high-use kitchens. The two-piece set includes a larger 7.3-inch holder that comfortably fits about 10 to 15 cooking utensils such as spatulas, ladles and whisks, plus a 5.4-inch holder ideal for smaller tools, serving spoons or flatware. The solid construction supports daily use while giving the set a clean, elevated presence on the counter. With its white ceramic finish and two-size design, this organizer keeps everyday essentials better sorted and easier to reach.";

/** Abridged Case B confirmed facts: enough to anchor the other three sentences. */
const CASE_B_FACTS = [
  { factId: "b-material", field: "material", label: "Material", value: "Ceramic" },
  { factId: "b-color", field: "color", label: "Colour", value: "White" },
  { factId: "b-quantity", field: "quantity", label: "Quantity", value: "2-Piece Set" },
  { factId: "b-construction", field: "construction", label: "Construction", value: "Solid construction" },
  { factId: "b-size", field: "dimensions", label: "Size options", value: 'Two sizes: a larger 7.3-inch holder that fits about 10 to 15 cooking utensils such as spatulas, ladles and whisks, and a 5.4-inch holder for smaller tools, serving spoons or flatware' },
];

function caseBDraft(description: string): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "LE TAUCI Ceramic Utensil Holder for Kitchen Countertop", factIds: ["b-material"] },
    bullets: [
      { text: "The two-piece set includes a larger 7.3-inch holder that comfortably fits about 10 to 15 cooking utensils.", factIds: ["b-size"], strategyRole: "core_outcome" },
      { text: "The solid construction supports daily use while giving the set a clean, elevated presence on the counter.", factIds: ["b-construction"], strategyRole: "pain_relief" },
    ],
    description: { text: description, factIds: ["b-material"] },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

async function requestFor(context: ReturnType<typeof contextOf>, draft: ListingV5WriterDraft) {
  const strategy = buildListingV5Strategy(context);
  const validation = validateListingV5Draft(context, strategy, draft);
  callAiJson.mockReset();
  callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
  const result = await repairListingV5Draft({ context, strategy, validation, draft, useProvider: true });
  const params = callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
  const payload = params ? JSON.parse(params.messages.find((message) => message.role === "user")!.content) as Record<string, any> : null;
  const prompt = params ? params.messages.find((message) => message.role === "system")!.content : "";
  return { validation, result, payload, prompt };
}

function violationsOf(payload: Record<string, any> | null): Array<{ issueCode: string; sentence: string; offendingSpans: string[] }> {
  return (payload?.targets ?? []).flatMap((target: any) => target.issues?.violations ?? []);
}

describe("Listing V5 repair targeting precision", () => {
  beforeEach(() => callAiJson.mockReset());

  it("A. reports the exact rejected word and carries it into the repair request", async () => {
    const context = contextOf();
    const draft = draftWith("This ceramic holder suits high-use kitchens. The holder is made of ceramic and is hand wash only.");
    const { validation, payload } = await requestFor(context, draft);

    const detail = validation.claims.unsupportedDetails?.find((item) => item.text.includes("high-use"));
    expect(detail).toBeDefined();
    expect(detail!.issueCode).toBe("unsupported_hard_claim");
    expect(detail!.offendingSpans).toEqual(["high-use"]);
    expect(detail!.field).toBe("description");

    const violations = violationsOf(payload);
    expect(violations.some((violation) => violation.offendingSpans.includes("high-use"))).toBe(true);
    expect(JSON.stringify(payload)).toContain("high-use");
  });

  it("B. accepts a repair that removes the offending span", async () => {
    const context = contextOf();
    const draft = draftWith("This ceramic holder suits high-use kitchens. The holder is made of ceramic and is hand wash only.");
    const repaired = "This ceramic holder keeps kitchen counters tidy. The holder is made of ceramic and is hand wash only.";
    const strategy = buildListingV5Strategy(context);
    const before = validateListingV5Draft(context, strategy, draft);
    expect(before.status).toBe("REPAIRABLE");

    callAiJson.mockReset();
    callAiJson.mockResolvedValue({ ok: true, providerCallStarted: true, data: { repairs: [{ path: "description", text: repaired }] } });
    const result = await repairListingV5Draft({ context, strategy, validation: before, draft, useProvider: true });
    expect(result.succeeded).toBe(true);
    expect(result.appliedPaths).toEqual(["description"]);

    const after = validateListingV5Draft(context, strategy, result.draft);
    expect(after.status).toBe("PASS");
    expect(after.claims.unsupportedClaims).toEqual([]);
    // The repair still touches text only.
    expect(result.draft.title).toEqual(draft.title);
    expect(result.draft.bullets).toEqual(draft.bullets);
    expect(result.draft.description.factIds).toEqual(draft.description.factIds);
    expect(result.draft.backendSearchTerms).toEqual(draft.backendSearchTerms);
  });

  it("C. keeps flagging a repair that preserved the offending span", async () => {
    const context = contextOf();
    const draft = draftWith("This ceramic holder suits high-use kitchens. The holder is made of ceramic and is hand wash only.");
    const strategy = buildListingV5Strategy(context);
    const before = validateListingV5Draft(context, strategy, draft);
    const kept = "This ceramic holder is a strong pick for high-use kitchens. The holder is made of ceramic and is hand wash only.";

    callAiJson.mockReset();
    callAiJson.mockResolvedValue({ ok: true, providerCallStarted: true, data: { repairs: [{ path: "description", text: kept }] } });
    const result = await repairListingV5Draft({ context, strategy, validation: before, draft, useProvider: true });
    const after = validateListingV5Draft(context, strategy, result.draft);
    expect(result.succeeded).toBe(true);
    expect(after.status).toBe("REPAIRABLE");
    expect(after.claims.unsupportedClaims.join(" ")).toContain("high-use");
    expect(after.claims.unsupportedDetails?.some((item) => item.offendingSpans.includes("high-use"))).toBe(true);
  });

  it("D. keeps flagging a swap to another unsupported hard claim", async () => {
    const context = contextOf();
    const draft = draftWith("This ceramic holder suits high-use kitchens. The holder is made of ceramic and is hand wash only.");
    const strategy = buildListingV5Strategy(context);
    const before = validateListingV5Draft(context, strategy, draft);
    const swapped = "This ceramic holder suits heavy-duty kitchens. The holder is made of ceramic and is hand wash only.";

    callAiJson.mockReset();
    callAiJson.mockResolvedValue({ ok: true, providerCallStarted: true, data: { repairs: [{ path: "description", text: swapped }] } });
    const result = await repairListingV5Draft({ context, strategy, validation: before, draft, useProvider: true });
    const after = validateListingV5Draft(context, strategy, result.draft);
    expect(after.status).not.toBe("PASS");
    const details = after.claims.unsupportedDetails ?? [];
    const heavy = details.find((item) => item.text.includes("heavy-duty"));
    expect(heavy).toBeDefined();
    expect(heavy!.offendingSpans).toContain("heavy-duty");
    expect(heavy!.offendingSpans).not.toContain("high-use");
  });

  it("E. spans stay bounded and are a subset of the sentence they came from", async () => {
    const context = contextOf();
    const draft = draftWith("This ceramic holder suits high-use and heavy-duty kitchens. The holder is made of ceramic and is hand wash only.");
    const { validation } = await requestFor(context, draft);
    const details = validation.claims.unsupportedDetails ?? [];
    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) {
      expect(detail.offendingSpans.length).toBeLessThanOrEqual(6);
      for (const span of detail.offendingSpans) {
        expect(span.length).toBeLessThanOrEqual(48);
        expect(detail.text).toContain(span);
        expect(span).not.toMatch(/[.!?]/);
        // A span is a rejected word, never a restatement of the whole sentence.
        expect(span.length).toBeLessThan(detail.text.length);
      }
    }
  });

  it("regression: the frozen Case B description yields offendingSpans [high-use]", async () => {
    const context = contextOf(CASE_B_FACTS);
    const draft = caseBDraft(FROZEN_CASE_B_DESCRIPTION);
    const { validation, payload, prompt } = await requestFor(context, draft);

    const detail = validation.claims.unsupportedDetails?.find((item) => item.text.includes("high-use"));
    expect(detail, "the frozen Case B copy must reproduce the real finding").toBeDefined();
    expect(detail!.offendingSpans).toEqual(["high-use"]);
    expect(detail!.field).toBe("description");

    const descriptionTarget = (payload?.targets ?? []).find((target: any) => target.path === "description");
    expect(descriptionTarget).toBeDefined();
    expect(descriptionTarget.original).toBe(FROZEN_CASE_B_DESCRIPTION);
    const spans = violationsOf(payload).flatMap((violation) => violation.offendingSpans);
    expect(spans).toContain("high-use");

    // The prompt must instruct the model how to use the spans without ever
    // treating them as facts.
    expect(prompt).toContain("Remove or rewrite every offending span.");
    expect(prompt).toContain("Do not preserve an offending span unless a Confirmed Fact supports it.");
    expect(prompt).toContain("Do not replace it with another unsupported hard claim");
    expect(prompt).toContain("They are not facts and are never a source of product facts");
  });
});
