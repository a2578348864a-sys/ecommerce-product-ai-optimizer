import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end trace coverage for the real Listing V5 chain:
 * route -> strategy -> generation -> structuredRepair -> validation -> fallback.
 *
 * Only infrastructure (auth / storage / gate / aiClient transport) is mocked,
 * so the recorded trace comes from the real execution path instead of a stubbed
 * result object.
 */

const state = vi.hoisted(() => ({
  authResult: null as any,
  gate: null as any,
  useProvider: true,
  visitorProviderEnabled: true,
  resultJson: "{}",
}));

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  getSandboxTask: vi.fn(),
  checkCreativeHandoffGate: vi.fn(),
  buildListingInputFromCreativeHandoff: vi.fn(),
  mutateTaskResultJson: vi.fn(),
  reserveDemoAiCalls: vi.fn(),
  markDemoAiProviderCallStarted: vi.fn(),
  settleDemoAiCalls: vi.fn(),
  isRealAiListingEnabled: vi.fn(),
  isRealAiVisitorListingEnabled: vi.fn(),
  findUnique: vi.fn(),
  callAiJson: vi.fn(),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_task_"),
  getSandboxTask: mocks.getSandboxTask,
}));
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  reserveDemoAiCalls: mocks.reserveDemoAiCalls,
  markDemoAiProviderCallStarted: mocks.markDemoAiProviderCallStarted,
  settleDemoAiCalls: mocks.settleDemoAiCalls,
}));
vi.mock("@/lib/server/realAiListingGate", () => ({
  isRealAiListingEnabled: mocks.isRealAiListingEnabled,
  isRealAiVisitorListingEnabled: mocks.isRealAiVisitorListingEnabled,
}));
vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: mocks.checkCreativeHandoffGate,
}));
vi.mock("@/lib/listingHandoff/listingGenerationInput", () => ({
  buildListingInputFromCreativeHandoff: mocks.buildListingInputFromCreativeHandoff,
}));
vi.mock("@/lib/server/taskResultJsonMutation", () => ({
  mutateTaskResultJson: mocks.mutateTaskResultJson,
  TaskResultJsonMutationError: class TaskResultJsonMutationError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number, message: string) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));
vi.mock("@/lib/server/db", () => ({
  prisma: { viralAnalysisRecord: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson: mocks.callAiJson }));

import { POST } from "./route";

const ownerContext = { mode: "owner", token: "owner-token" };

const strategyJson = {
  targetAudience: ["everyday shoppers"],
  purchaseMotivations: ["clear product details"],
  painPoints: ["keep everyday spaces organized"],
  useCases: ["everyday use"],
  primaryAngle: "Make the organizer easier to understand",
  secondaryAngles: ["easy comparison"],
  tone: ["clear"],
  keywordIntent: { primary: ["organizer"], secondary: ["kitchen"], backendOnly: [] },
  bulletAngles: [
    { role: "core_outcome", shopperValue: "understand the main product value" },
    { role: "pain_relief", shopperValue: "address a common need" },
    { role: "use_scenario", shopperValue: "picture a realistic use" },
  ],
  avoidClaims: [],
};

function writerJson(overrides: Record<string, unknown> = {}) {
  return {
    title: { text: "Insulated Stainless Steel Organizer 2 pack Black", factIds: ["material-1", "quantity-1", "color-1"] },
    bullets: [
      { text: "Insulated stainless steel construction supports everyday organizing routines.", factIds: ["material-1"], strategyRole: "core_outcome" },
      { text: "A 2 pack option helps shoppers comparing practical choices.", factIds: ["quantity-1"], strategyRole: "pain_relief" },
      { text: "The Black finish fits a range of everyday spaces.", factIds: ["color-1"], strategyRole: "use_scenario" },
    ],
    description: {
      text: "This organizer brings insulated stainless steel and 2 pack together for shoppers comparing practical options. It fits everyday use where clear product information helps guide a purchase.",
      factIds: ["material-1", "quantity-1"],
    },
    backendSearchTerms: ["organizer"],
    ...overrides,
  };
}

const ok = (data: unknown, responseCharLength = 800) => ({
  ok: true as const,
  data,
  providerCallStarted: true,
  diagnostics: {
    model: "test-model",
    thinkingMode: "default" as const,
    maxTokens: 3200,
    providerHttpStatusClass: "success" as const,
    finishReason: "stop",
    completionTokens: 512,
    reasoningTokens: null,
    responseCharLength,
    jsonParseStage: "passed" as const,
    elapsedMs: 1200,
  },
});

const providerFailure = (code = "rate_limited") => ({
  ok: false as const,
  error: { code, message: "provider message is never persisted", provider: "openai", model: "test-model", detail: "detail is never persisted" },
  providerCallStarted: true,
  diagnostics: {
    model: "test-model",
    thinkingMode: "default" as const,
    maxTokens: 3200,
    providerHttpStatusClass: code === "rate_limited" ? ("rate_limited" as const) : ("client_error" as const),
    finishReason: null,
    completionTokens: null,
    reasoningTokens: null,
    responseCharLength: 0,
    jsonParseStage: "not_started" as const,
    elapsedMs: 800,
  },
});

function request(action: string, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/tasks/task-1/listing-v5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, confirmRealAi: true, ...body }),
  });
}

async function generate() {
  const response = await POST(request("generate"), { params: Promise.resolve({ id: "task-1" }) });
  const json = (await response.json()) as Record<string, any>;
  if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? `unexpected status ${response.status}`);
  return json.data.snapshot;
}

function reset() {
  state.authResult = { ok: true, context: ownerContext };
  state.useProvider = true;
  state.visitorProviderEnabled = true;
  state.resultJson = "{}";
  state.gate = {
    allowed: true,
    reason: "ok",
    candidate: { productName: "Steel Organizer", sourceResearch: { researchRevision: 7 } },
    currentHandoff: {
      currentRevision: 3,
      versions: [{
        confirmedFacts: [
          { factId: "material-1", field: "material", label: "Material", value: "insulated stainless steel", usageScopes: ["listing"] },
          { factId: "quantity-1", field: "quantity", label: "Quantity", value: "2 pack", usageScopes: ["listing"] },
          { factId: "color-1", field: "color_or_variant", label: "Color", value: "Black", usageScopes: ["listing"] },
        ],
      }],
    },
  };
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireAuthenticated.mockImplementation(() => state.authResult);
  mocks.checkCreativeHandoffGate.mockImplementation(async () => state.gate);
  mocks.buildListingInputFromCreativeHandoff.mockReturnValue({ ok: true, input: { productFacts: [], prohibitedClaims: [], unknowns: [] } });
  mocks.findUnique.mockImplementation(async () => ({ resultJson: state.resultJson }));
  mocks.isRealAiListingEnabled.mockImplementation(() => state.useProvider);
  mocks.isRealAiVisitorListingEnabled.mockImplementation(() => state.visitorProviderEnabled);
  mocks.reserveDemoAiCalls.mockReturnValue({ ok: true, reservation: { reservationId: "r", plannedCount: 3 } });
  mocks.markDemoAiProviderCallStarted.mockReturnValue({ ok: true });
  mocks.settleDemoAiCalls.mockReturnValue({ ok: true, snapshot: null });
  mocks.mutateTaskResultJson.mockImplementation(async ({ mutate }: { mutate: (current: Record<string, unknown>) => unknown }) => {
    const output = mutate(JSON.parse(state.resultJson)) as { result: Record<string, unknown> };
    state.resultJson = JSON.stringify(output.result);
    return { resultJson: state.resultJson, value: { saved: true }, updatedAt: "2026-09-10T00:00:00.000Z" };
  });
}

describe("Listing V5 AI execution trace", () => {
  beforeEach(() => reset());

  it("1. records a successful provider run that passes validation without fallback", async () => {
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok(writerJson()));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.strategyAttempted).toBe(true);
    expect(trace.strategySuccess).toBe(true);
    expect(trace.strategyFailureReason).toBe("none");
    expect(trace.writerAttempted).toBe(true);
    expect(trace.writerSuccess).toBe(true);
    expect(trace.writerFailureReason).toBe("none");
    expect(trace.repairAttempted).toBe(false);
    expect(trace.repairSuccess).toBe(false);
    expect(trace.validationStatus).toBe("PASS");
    expect(trace.finalValidationStatus).toBe("PASS");
    expect(trace.validationBlockReasons).toEqual([]);
    expect(trace.fallbackUsed).toBe(false);
    expect(trace.fallbackReason).toBe("none");
    expect(trace.stages.writer.model).toBe("test-model");
    expect(trace.stages.writer.jsonParseStage).toBe("passed");
    expect(trace.stages.writer.finishReason).toBe("stop");
    expect(trace.stages.writer.responseCharLength).toBe(800);
    expect(snapshot.listing.title.text).toContain("Insulated");
  });

  it("2. records a schema normalization failure when the writer returns an unexpected structure", async () => {
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok({ title: { text: "no bullets, no description" } }));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.strategySuccess).toBe(true);
    expect(trace.writerAttempted).toBe(true);
    expect(trace.writerSuccess).toBe(false);
    expect(trace.writerFailureReason).toBe("schema_normalization_failed");
    expect(trace.stages.writer.jsonParseStage).toBe("passed");
    expect(trace.stages.writer.providerErrorCode).toBeNull();
    expect(trace.fallbackUsed).toBe(true);
    expect(trace.fallbackReason).toBe("writer_stage_failed");
  });

  it("2b. records a bounded repair when the writer draft is repairable and keeps the AI draft", async () => {
    const repairable = writerJson({
      description: { text: "This organizer brings insulated stainless steel and 2 pack together for shoppers comparing practical options.", factIds: ["material-1"] },
    });
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok(repairable))
      .mockResolvedValueOnce(ok({ path: "description", text: "This organizer brings insulated stainless steel and 2 pack together. It fits everyday use where clear product information helps." }));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.validationStatus).toBe("REPAIRABLE");
    expect(trace.validationBlockReasons).toContain("description:description_should_be_2_to_4_sentences");
    expect(trace.repairAttempted).toBe(true);
    expect(trace.repairSuccess).toBe(true);
    expect(trace.repairFailureReason).toBe("none");
    expect(trace.finalValidationStatus).toBe("PASS");
    // Repair succeeded and the repaired draft passed, so this really is an AI
    // result: fallbackUsed stays false. (If the repaired draft were still not
    // PASS the route must fall back instead - see the repair-failure test.)
    expect(trace.fallbackUsed).toBe(false);
    expect(trace.fallbackReason).toBe("none");
  });

  it("3. records a locally repairable claim, repairs that one field and keeps the AI draft", async () => {
    const blocked = writerJson({
      bullets: [
        { text: "Insulated stainless steel keeps drinks cold for 24 hours.", factIds: ["material-1"], strategyRole: "core_outcome" },
        { text: "A 2 pack option helps shoppers comparing practical choices.", factIds: ["quantity-1"], strategyRole: "pain_relief" },
        { text: "The Black finish fits a range of everyday spaces.", factIds: ["color-1"], strategyRole: "use_scenario" },
      ],
    });
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok(blocked))
      .mockResolvedValueOnce(ok({ repairs: [{ path: "bullets[0]", text: "Insulated stainless steel construction fits everyday routines." }] }));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.strategySuccess).toBe(true);
    expect(trace.writerSuccess).toBe(true);
    // A single invented duration inside one bullet is repairable, not fatal.
    expect(trace.validationStatus).toBe("REPAIRABLE");
    expect(trace.validationBlockReasons.some((reason: string) => reason.startsWith("claims:unsupported:"))).toBe(true);
    expect(trace.repairAttempted).toBe(true);
    expect(trace.repairSuccess).toBe(true);
    expect(trace.finalValidationStatus).toBe("PASS");
    expect(trace.fallbackUsed).toBe(false);
    expect(snapshot.listing.bullets[0].text).toBe("Insulated stainless steel construction fits everyday routines.");
  });

  it("3b. records a blocking claim that cannot be confined to one field and falls back", async () => {
    const blocked = writerJson({
      bullets: [
        { text: "FDA approved and BPA free construction for families.", factIds: ["material-1"], strategyRole: "core_outcome" },
        { text: "A 2 pack option helps shoppers comparing practical choices.", factIds: ["quantity-1"], strategyRole: "pain_relief" },
        { text: "The Black finish fits a range of everyday spaces.", factIds: ["color-1"], strategyRole: "use_scenario" },
      ],
    });
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok(blocked));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.writerSuccess).toBe(true);
    expect(trace.validationStatus).toBe("BLOCK");
    expect(trace.fallbackUsed).toBe(true);
    expect(trace.fallbackReason).toBe("validation_blocked");
    expect(trace.repairAttempted).toBe(false);
  });

  it("4. records a provider request failure with its classified error code and no raw provider text", async () => {
    mocks.callAiJson
      .mockResolvedValueOnce(providerFailure("rate_limited"))
      .mockResolvedValueOnce(providerFailure("rate_limited"));
    const snapshot = await generate();
    const trace = snapshot.trace;
    const serialized = JSON.stringify(trace);
    expect(trace.strategyAttempted).toBe(true);
    expect(trace.strategySuccess).toBe(false);
    expect(trace.strategyFailureReason).toBe("provider_request_failed");
    expect(trace.writerAttempted).toBe(true);
    expect(trace.writerSuccess).toBe(false);
    expect(trace.writerFailureReason).toBe("provider_request_failed");
    expect(trace.stages.strategy.providerErrorCode).toBe("rate_limited");
    expect(trace.stages.strategy.providerHttpStatusClass).toBe("rate_limited");
    expect(trace.stages.writer.providerHttpStatusClass).toBe("rate_limited");
    expect(trace.fallbackUsed).toBe(true);
    expect(trace.fallbackReason).toBe("writer_stage_failed");
    expect(serialized).not.toContain("provider message is never persisted");
    expect(serialized).not.toContain("detail is never persisted");
  });

  it("4b. distinguishes a json parse failure from a request failure", async () => {
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(providerFailure("json_parse_error"));
    const snapshot = await generate();
    expect(snapshot.trace.writerFailureReason).toBe("provider_response_not_json");
    expect(snapshot.trace.writerSuccess).toBe(false);
  });

  it("5. keeps the fallback trace correct when the provider is never used", async () => {
    state.useProvider = false;
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(mocks.callAiJson).not.toHaveBeenCalled();
    expect(trace.strategyAttempted).toBe(false);
    expect(trace.strategyFailureReason).toBe("provider_disabled");
    expect(trace.writerAttempted).toBe(false);
    expect(trace.writerFailureReason).toBe("provider_disabled");
    expect(trace.repairAttempted).toBe(false);
    expect(trace.repairFailureReason).toBe("stage_not_run");
    expect(trace.fallbackUsed).toBe(true);
    expect(trace.fallbackReason).toBe("writer_stage_failed");
    // The deterministic draft is now clean (no false keyword-stuffing signal), so
    // no repair is needed and nothing is flagged for repair.
    expect(trace.validationStatus).toBe("PASS");
    expect(trace.finalValidationStatus).toBe("PASS");
  });

  it("never writes provider credentials or raw model output into the persisted snapshot", async () => {
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson, 12_345))
      .mockResolvedValueOnce(ok(writerJson(), 54_321));
    await generate();
    const serialized = JSON.stringify(JSON.parse(state.resultJson));
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("provider message is never persisted");
    expect(serialized).toContain("listing-v5.execution-trace.v1");
    expect(serialized).toContain('"responseCharLength":54321');
  });

  it("6. records the conversion rewrite stage and its re-validation in the trace", async () => {
    const blocked = writerJson({
      bullets: [
        { text: "FDA approved and BPA free construction for families.", factIds: ["material-1"], strategyRole: "core_outcome" },
        { text: "A 2 pack option helps shoppers comparing practical choices.", factIds: ["quantity-1"], strategyRole: "pain_relief" },
        { text: "The Black finish fits a range of everyday spaces.", factIds: ["color-1"], strategyRole: "use_scenario" },
      ],
    });
    // V5.2: the BLOCKed draft is not repairable in place, so the chain spends its
    // single Conversion Rewrite on it. The rewrite is built from Confirmed Facts
    // only, so the same Validator passes the rewritten draft and that draft is
    // what the user receives - no fallback.
    const rewritten = writerJson({ backendSearchTerms: ["ant bait stations", "insulated"] });
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok(blocked))
      .mockResolvedValueOnce(ok(rewritten));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.validationStatus).toBe("BLOCK");
    expect(trace.repairAttempted).toBe(false);
    expect(trace.rewriteAttempted).toBe(true);
    // "none" means the rewrite stage ran and reported no failure of its own; the
    // re-validation below is what decides whether its draft is usable.
    expect(trace.rewriteReason).toBe("none");
    expect(trace.rewriteValidationStatus).toBe("PASS");
    expect(trace.stages.rewrite.attempted).toBe(true);
    expect(trace.stages.rewrite.success).toBe(true);
    expect(trace.finalValidationStatus).toBe("PASS");
    expect(trace.fallbackUsed).toBe(false);
    expect(trace.fallbackReason).toBe("none");
    expect(snapshot.provider.rewriteAttempted).toBe(true);
    expect(snapshot.provider.fallbackUsed).toBe(false);
    // backendSearchTerms is the one field no Validator rule inspects, so the
    // rewrite filters it against the hard-claim vocabulary: "insulated" is a hard
    // claim and never reaches the client through the keyword list.
    expect(snapshot.listing.backendSearchTerms).toEqual(["ant bait stations"]);
  });

  it("7. records the recovery stage in the trace when recovery is the stage that delivers", async () => {
    const blocked = writerJson({
      bullets: [
        { text: "FDA approved and BPA free construction for families.", factIds: ["material-1"], strategyRole: "core_outcome" },
        { text: "A 2 pack option helps shoppers comparing practical choices.", factIds: ["quantity-1"], strategyRole: "pain_relief" },
        { text: "The Black finish fits a range of everyday spaces.", factIds: ["color-1"], strategyRole: "use_scenario" },
      ],
    });
    // Rewrite answers with an unusable structure, so the last-resort recovery pass
    // runs and its draft is the one that validates. Before V5.2 the route never
    // passed the recovery stage into the trace, so this was invisible.
    mocks.callAiJson
      .mockResolvedValueOnce(ok(strategyJson))
      .mockResolvedValueOnce(ok(blocked))
      .mockResolvedValueOnce(ok({ title: { text: "no bullets and no description" } }))
      .mockResolvedValueOnce(ok(writerJson()));
    const snapshot = await generate();
    const trace = snapshot.trace;
    expect(trace.rewriteAttempted).toBe(true);
    expect(trace.rewriteReason).toBe("schema_normalization_failed");
    expect(trace.rewriteValidationStatus).toBeNull();
    expect(trace.recoveryAttempted).toBe(true);
    expect(trace.recoveryValidationStatus).toBe("PASS");
    expect(trace.stages.recovery.attempted).toBe(true);
    expect(trace.stages.recovery.success).toBe(true);
    expect(trace.finalValidationStatus).toBe("PASS");
    expect(trace.fallbackUsed).toBe(false);
    expect(snapshot.provider.recoveryAttempted).toBe(true);
  });
});
