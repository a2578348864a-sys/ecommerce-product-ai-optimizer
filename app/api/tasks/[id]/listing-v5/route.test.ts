import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LISTING_V5_STRATEGY_PROMPT_VERSION } from "@/lib/listingV5/types";

const state = vi.hoisted(() => ({
  context: null as any,
  contextSequence: null as any[] | null,
  contextCalls: 0,
  resultJson: "{}",
  authResult: null as any,
  gate: null as any,
  useProvider: false,
  visitorProviderEnabled: true,
  generatedDraft: null as any,
  strategy: null as any,
  validation: null as any,
  repair: null as any,
  mutationCalls: 0,
  reserveCalls: [] as number[],
  startedCalls: 0,
  settledCalls: 0,
  settlementOk: true,
  lastExpectedStorageVersion: null as any,
}));

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  getSandboxTask: vi.fn(),
  checkCreativeHandoffGate: vi.fn(),
  buildListingInputFromCreativeHandoff: vi.fn(),
  buildListingV5Context: vi.fn(),
  analyzeListingV5Strategy: vi.fn(),
  generateListingV5Draft: vi.fn(),
  buildListingV5FallbackDraft: vi.fn(),
  repairListingV5Draft: vi.fn(),
    recoverListingV5Draft: vi.fn(),
    rewriteListingV5Draft: vi.fn(),
  validateListingV5Draft: vi.fn(),
  mutateTaskResultJson: vi.fn(),
  reserveDemoAiCalls: vi.fn(),
  markDemoAiProviderCallStarted: vi.fn(),
  settleDemoAiCalls: vi.fn(),
  isRealAiListingEnabled: vi.fn(),
  isRealAiVisitorListingEnabled: vi.fn(),
  findUnique: vi.fn(),
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

vi.mock("@/lib/listingV5/context", () => ({
  buildListingV5Context: mocks.buildListingV5Context,
}));
vi.mock("@/lib/listingV5/strategy", () => ({
  analyzeListingV5Strategy: mocks.analyzeListingV5Strategy,
}));
vi.mock("@/lib/listingV5/generation", () => ({
  generateListingV5Draft: mocks.generateListingV5Draft,
  buildListingV5FallbackDraft: mocks.buildListingV5FallbackDraft,
}));
vi.mock("@/lib/listingV5/structuredRepair", () => ({
  repairListingV5Draft: mocks.repairListingV5Draft,
}));
vi.mock("@/lib/listingV5/conversionRecovery", () => ({
  recoverListingV5Draft: mocks.recoverListingV5Draft,
}));
vi.mock("@/lib/listingV5/conversionRewrite", () => ({
  rewriteListingV5Draft: mocks.rewriteListingV5Draft,
}));
vi.mock("@/lib/listingV5/validation", () => ({
  validateListingV5Draft: mocks.validateListingV5Draft,
}));

import { GET, POST } from "./route";

const ownerContext = { mode: "owner", token: "owner-token" };
const demoContext = { mode: "demo", token: "demo-token", demoAccessId: "demo-a" };

const strategy = {
  version: "listing-v5.strategy.v1",
  referenceOnly: true,
  researchRevision: 7,
  targetAudience: ["commuters"],
  purchaseMotivations: ["easy routines"],
  painPoints: ["messy storage"],
  useCases: ["daily use"],
  primaryAngle: "organized routines",
  secondaryAngles: [],
  tone: ["clear"],
  keywordIntent: { primary: ["organizer"], secondary: [], backendOnly: [] },
  bulletAngles: [{ role: "core_outcome", shopperValue: "keep items ready" }],
  avoidClaims: ["waterproof"],
};

const draft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Example Organizer", factIds: ["fact-1"] },
  bullets: [{ text: "A steel organizer for daily routines.", factIds: ["fact-1"], strategyRole: "core_outcome" }],
  description: { text: "An organizer for daily routines.", factIds: ["fact-1"] },
  backendSearchTerms: ["organizer"],
  humanReviewRequired: true,
};

const passValidation = {
  version: "listing-v5.validation.v1",
  status: "PASS",
  title: { valid: true, issues: [] },
  bullets: [{ valid: true, factIds: ["fact-1"], strategyRole: "core_outcome", issues: [] }],
  description: { valid: true, issues: [] },
  claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] },
  quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
  repair: { allowed: false, reason: null },
};

function context(fingerprint = "fp-1") {
  return {
    version: "listing-v5.context.v1",
    taskId: "task-1",
    researchRevision: 7,
    handoffRevision: 3,
    contextFingerprint: fingerprint,
    marketplace: "amazon-us",
    productIdentity: "Example Organizer",
    confirmedFacts: [{ id: "fact-1", canonicalField: "material", label: "Material", value: "Steel", sourceRefs: ["human_confirmation"] }],
    prohibitedClaims: [],
    unknowns: [],
    references: { voc: [], keywords: [], competitors: [], sourcing: [] },
    manualDirection: null,
  };
}

function gate() {
  return {
    allowed: true,
    reason: "ok",
    candidate: { productName: "Example Organizer", sourceResearch: { researchRevision: 7 } },
    currentHandoff: {
      currentRevision: 3,
      versions: [{ confirmedFacts: [{ factId: "fact-1", field: "material", label: "Material", value: "Steel", usageScopes: ["listing"] }] }],
    },
  };
}

function request(method: "GET" | "POST", taskId = "task-1", body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}/listing-v5`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

function reset(overrides: Partial<typeof state> = {}) {
  state.context = context();
  state.contextSequence = null;
  state.contextCalls = 0;
  state.resultJson = "{}";
  state.authResult = { ok: true, context: ownerContext };
  state.gate = gate();
  state.useProvider = false;
  state.visitorProviderEnabled = true;
  state.generatedDraft = draft;
  state.strategy = strategy;
  state.validation = passValidation;
  state.repair = { draft, attempted: false, succeeded: false };
  state.mutationCalls = 0;
  state.reserveCalls = [];
  state.startedCalls = 0;
  state.settledCalls = 0;
  state.settlementOk = true;
  state.lastExpectedStorageVersion = null;

  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireAuthenticated.mockImplementation(() => state.authResult);
  mocks.checkCreativeHandoffGate.mockImplementation(async () => state.gate);
  mocks.buildListingInputFromCreativeHandoff.mockReturnValue({ ok: true, input: { productFacts: [], prohibitedClaims: [], unknowns: [] } });
  mocks.buildListingV5Context.mockImplementation(() => {
    const sequence = state.contextSequence;
    const value = sequence ? sequence[Math.min(state.contextCalls, sequence.length - 1)] : state.context;
    state.contextCalls += 1;
    return value;
  });
  mocks.findUnique.mockImplementation(async () => ({ resultJson: state.resultJson }));
  mocks.analyzeListingV5Strategy.mockImplementation(async (_ctx: unknown, options: { onProviderCallStart?: () => void }) => {
    options.onProviderCallStart?.();
    return { strategy: state.strategy, providerAttempted: state.useProvider, providerSucceeded: state.useProvider };
  });
  mocks.generateListingV5Draft.mockImplementation(async (_ctx: unknown, _strategy: unknown, options: { onProviderCallStart?: () => void }) => {
    options.onProviderCallStart?.();
    return { draft: state.generatedDraft, providerAttempted: state.useProvider, providerSucceeded: state.useProvider };
  });
  mocks.buildListingV5FallbackDraft.mockReturnValue(state.generatedDraft);
  mocks.validateListingV5Draft.mockImplementation(() => state.validation);
  mocks.repairListingV5Draft.mockImplementation(async () => state.repair);
  mocks.mutateTaskResultJson.mockImplementation(async ({ mutate, expectedStorageVersion }: { mutate: (current: Record<string, unknown>) => unknown; expectedStorageVersion?: unknown }) => {
    state.mutationCalls += 1;
    state.lastExpectedStorageVersion = expectedStorageVersion ?? null;
    const parsed = JSON.parse(state.resultJson) as Record<string, unknown>;
    const output = mutate(parsed) as { result: Record<string, unknown> };
    state.resultJson = JSON.stringify(output.result);
    return { resultJson: state.resultJson, value: { saved: true }, updatedAt: "2026-09-10T00:00:00.000Z", snapshot: {} };
  });
  mocks.isRealAiListingEnabled.mockImplementation(() => state.useProvider);
  mocks.isRealAiVisitorListingEnabled.mockImplementation(() => state.visitorProviderEnabled);
  mocks.reserveDemoAiCalls.mockImplementation((_ctx: unknown, count: number) => {
    state.reserveCalls.push(count);
    return { ok: true, reservation: { reservationId: "reservation-1", plannedCount: count } };
  });
  mocks.markDemoAiProviderCallStarted.mockImplementation(() => {
    state.startedCalls += 1;
    return { ok: true };
  });
  mocks.settleDemoAiCalls.mockImplementation(() => {
    state.settledCalls += 1;
    return state.settlementOk ? { ok: true, snapshot: null } : { ok: false, status: 409, code: "reservation_conflict", message: "quota settlement conflict" };
  });
}

describe("Listing V5 route", () => {
  beforeEach(() => reset());

  it("rejects unauthenticated requests before reading or mutating a task", async () => {
    state.authResult = { ok: false, status: 401, code: "invalid_access", message: "请先登录后再操作。" };
    const response = await GET(request("GET"), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: { code: "invalid_access", message: "请先登录后再操作。" } });
    expect(mocks.checkCreativeHandoffGate).not.toHaveBeenCalled();
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();
  });

  it("does not let an owner context address a demo sandbox task", async () => {
    const response = await GET(request("GET", "sandbox_task_1"), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("task_not_found");
    expect(mocks.checkCreativeHandoffGate).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation when real AI is enabled for a visitor", async () => {
    state.authResult = { ok: true, context: demoContext };
    state.useProvider = true;
    state.visitorProviderEnabled = true;
    const response = await POST(request("POST", "sandbox_task_1", { action: "generate" }), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("real_ai_confirmation_required");
    expect(mocks.reserveDemoAiCalls).not.toHaveBeenCalled();
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();
  });

  it("fails closed when visitor real AI is disabled", async () => {
    state.authResult = { ok: true, context: demoContext };
    state.useProvider = true;
    state.visitorProviderEnabled = false;
    const response = await POST(request("POST", "sandbox_task_1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(response.status).toBe(403);
    expect((await json(response)).error.code).toBe("visitor_listing_generation_disabled");
    expect(mocks.reserveDemoAiCalls).not.toHaveBeenCalled();
  });

  it("reserves and settles the planned provider calls after explicit confirmation", async () => {
    state.authResult = { ok: true, context: demoContext };
    state.useProvider = true;
    const response = await POST(request("POST", "sandbox_task_1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(response.status).toBe(200);
    expect(state.reserveCalls).toEqual([5]); // strategy + writer + one repair + one Conversion Rewrite + the last-resort Safe Recovery slot
    expect(state.startedCalls).toBe(2);
    expect(state.settledCalls).toBe(1);
    expect(mocks.mutateTaskResultJson).toHaveBeenCalledTimes(1);
  });

  it("fails closed on quota settlement and does not persist a generated draft", async () => {
    state.authResult = { ok: true, context: demoContext };
    state.useProvider = true;
    state.settlementOk = false;
    const response = await POST(request("POST", "sandbox_task_1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("reservation_conflict");
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();
  });

  it("forwards an expected storage version to the namespace writer for CAS", async () => {
    const expectedStorageVersion = { resultJsonHash: "hash-before", updatedAt: "2026-09-10T00:00:00.000Z" };
    const response = await POST(request("POST", "task-1", { action: "generate", expectedStorageVersion }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(state.lastExpectedStorageVersion).toEqual(expectedStorageVersion);
  });

  it("rejects a stale context before persistence", async () => {
    state.contextSequence = [context("fp-before"), context("fp-after")];
    const response = await POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("listing_v5_stale_context");
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();
  });

  it("reuses a current cached strategy without analyzing it again", async () => {
    state.resultJson = JSON.stringify({ listingV5: {
      version: "listing-v5.snapshot.v1",
      // Tracked against the live constant so this test keeps asserting "a CURRENT
      // cached strategy is reused" across prompt version bumps instead of pinning
      // one historical version.
      strategyPromptVersion: LISTING_V5_STRATEGY_PROMPT_VERSION,
      researchRevision: 7,
      handoffRevision: 3,
      contextFingerprint: "fp-1",
      strategy,
    } });
    const response = await POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.analyzeListingV5Strategy).not.toHaveBeenCalled();
    expect(mocks.generateListingV5Draft).toHaveBeenCalledTimes(1);
  });

  it("forces a fresh strategy analysis when the user explicitly re-analyzes", async () => {
    state.resultJson = JSON.stringify({ listingV5: {
      version: "listing-v5.snapshot.v1",
      researchRevision: 7,
      handoffRevision: 3,
      contextFingerprint: "fp-1",
      strategy,
    } });
    const response = await POST(request("POST", "task-1", { action: "analyze_strategy", forceStrategy: true }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.analyzeListingV5Strategy).toHaveBeenCalledTimes(1);
    expect(mocks.mutateTaskResultJson).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate in-flight action while the first request owns the job key", async () => {
    // A dedicated context fingerprint keeps this test's job lock from leaking
    // into any other test, even when an assertion below fails.
    state.context = context("fp-duplicate");
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.generateListingV5Draft.mockImplementationOnce(async () => {
      signalEntered();
      await blocked;
      return { draft: state.generatedDraft, providerAttempted: false, providerSucceeded: false };
    });

    const first = POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
    // The mocked stage only runs after the route has taken the lock, so waiting
    // for it proves lock ownership instead of guessing with Promise.resolve().
    await entered;
    try {
      const duplicate = await POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
      expect(duplicate.status).toBe(409);
      expect((await json(duplicate)).error.code).toBe("listing_v5_running");
    } finally {
      // Must run even when an assertion throws: otherwise the blocked first
      // request never settles and its job key stays in ACTIVE_V5_JOBS.
      release();
    }
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
  });

  it("never republishes a cached validation that belongs to another context fingerprint", async () => {
    // Security regression: the carried-forward path used to move cached.listing
    // and cached.validation into the snapshot without checking which frozen
    // context they were validated against, so a stale PASS could be republished
    // under a new fingerprint and shown as "verified".
    state.resultJson = JSON.stringify({ listingV5: {
      version: "listing-v5.snapshot.v1",
      researchRevision: 7,
      handoffRevision: 3,
      contextFingerprint: "fp-other-context",
      strategy,
      listing: draft,
      validation: { ...passValidation },
      repairApplied: true,
      provider: { strategyAttempted: true, writerAttempted: true, repairAttempted: false, fallbackUsed: false },
    } });
    const response = await POST(request("POST", "task-1", { action: "analyze_strategy", forceStrategy: true }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    const saved = JSON.parse(state.resultJson).listingV5 as Record<string, any>;
    // The user's copy survives the strategy refresh...
    expect(saved.listing).toEqual(draft);
    // ...but its previous PASS is not republished as if it validated this context.
    expect(saved.validation.status).toBe("BLOCK");
    expect(saved.validation.title.issues).toContain("validation_not_run");
    expect(saved.validation.claims.allHaveEvidence).toBe(false);
    expect(saved.repairApplied).toBe(false);
  });

  it("keeps the generated listing when the strategy is re-analyzed", async () => {
    // Regression: analyze_strategy used to write `listing: null` plus a
    // synthetic PASS validation, so one click of "重新分析策略" destroyed the
    // user's listing (and reported it as validated).
    state.resultJson = JSON.stringify({ listingV5: {
      version: "listing-v5.snapshot.v1",
      researchRevision: 7,
      handoffRevision: 3,
      contextFingerprint: "fp-1",
      strategy,
      listing: draft,
      validation: { ...passValidation, status: "REPAIRABLE" },
      repairApplied: true,
      provider: { strategyAttempted: true, writerAttempted: true, repairAttempted: true, fallbackUsed: true },
    } });
    const response = await POST(request("POST", "task-1", { action: "analyze_strategy", forceStrategy: true }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    const saved = JSON.parse(state.resultJson).listingV5 as Record<string, any>;
    expect(saved.listing).toEqual(draft);
    expect(saved.validation.status).toBe("REPAIRABLE");
    expect(saved.repairApplied).toBe(true);
    expect(saved.provider.fallbackUsed).toBe(true);
  });

  it("fails a request whose quota reservation throws, without stranding the job lock", async () => {
    state.authResult = { ok: true, context: demoContext };
    state.useProvider = true;
    state.context = context("fp-reservation-throw");
    mocks.reserveDemoAiCalls.mockImplementationOnce(() => { throw new Error("reservation_store_unavailable"); });
    const failed = await POST(request("POST", "sandbox_task_1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(failed.status).toBe(500);
    expect((await json(failed)).error.code).toBe("listing_v5_failed");
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();

    // The same task+context must still be usable: a leaked job key would 409 here.
    const retry = await POST(request("POST", "sandbox_task_1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "sandbox_task_1" }) });
    expect(retry.status).toBe(200);
  });

  it("rejects the removed revalidate action instead of regenerating the listing", async () => {
    const response = await POST(request("POST", "task-1", { action: "revalidate" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_action");
    // Re-validating must never reach the writer or touch persisted state.
    expect(mocks.generateListingV5Draft).not.toHaveBeenCalled();
    expect(mocks.analyzeListingV5Strategy).not.toHaveBeenCalled();
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();
  });

  it("serializes generate behind an in-flight analyze_strategy on the same task and context", async () => {
    state.context = context("fp-analyze-generate");
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.analyzeListingV5Strategy.mockImplementationOnce(async () => {
      signalEntered();
      await blocked;
      return { strategy: state.strategy, providerAttempted: false, providerSucceeded: false };
    });

    const first = POST(request("POST", "task-1", { action: "analyze_strategy" }), { params: Promise.resolve({ id: "task-1" }) });
    await entered;
    try {
      const duplicate = await POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
      expect(duplicate.status).toBe(409);
      expect((await json(duplicate)).error.code).toBe("listing_v5_running");
      // The blocked second request must not start a writer run.
      expect(mocks.generateListingV5Draft).not.toHaveBeenCalled();
    } finally {
      release();
    }
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
  });

  it("serializes analyze_strategy behind an in-flight generate on the same task and context", async () => {
    state.context = context("fp-generate-analyze");
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.generateListingV5Draft.mockImplementationOnce(async () => {
      signalEntered();
      await blocked;
      return { draft: state.generatedDraft, providerAttempted: false, providerSucceeded: false };
    });

    const first = POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
    await entered;
    try {
      const duplicate = await POST(request("POST", "task-1", { action: "analyze_strategy" }), { params: Promise.resolve({ id: "task-1" }) });
      expect(duplicate.status).toBe(409);
      expect((await json(duplicate)).error.code).toBe("listing_v5_running");
      // The first request is a generate run, so it legitimately analyzes the
      // strategy once; the blocked second request must not add a second call.
      expect(mocks.analyzeListingV5Strategy).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
  });

  it("falls back honestly when a successful repair still leaves the draft invalid", async () => {
    state.useProvider = true;
    // Own job-lock key: a lock leaked by another test must not turn this
    // expected 200 into a 409.
    state.context = context("fp-repair-fallback");
    const repairable = {
      ...passValidation,
      status: "REPAIRABLE" as const,
      claims: { ...passValidation.claims, unsupportedClaims: ["an unsupported claim"] },
      repair: { allowed: true, reason: "仅允许一次结构化修复", targets: ["description"] },
    };
    const repairedDraft = {
      ...draft,
      description: { text: "A repaired description that still fails validation.", factIds: ["fact-1"] },
    };
    const fallbackDraft = {
      ...draft,
      title: { text: "Safe Fallback Title", factIds: ["fact-1"] },
      description: { text: "Safe fallback description.", factIds: ["fact-1"] },
    };
    // 1st validation: writer draft is repairable. 2nd: after the successful
    // repair it is STILL not PASS. 3rd: the fallback draft validates.
    mocks.validateListingV5Draft
      .mockReturnValueOnce(repairable)
      .mockReturnValueOnce(repairable)
      .mockReturnValue(passValidation);
    mocks.repairListingV5Draft.mockResolvedValue({
      draft: repairedDraft,
      attempted: true,
      succeeded: true,
      appliedPaths: ["description"],
    });
    mocks.buildListingV5FallbackDraft.mockReturnValue(fallbackDraft);

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);

    const snapshot = body.data.snapshot;
    // The repaired AI draft never passed, so it must not be published and no
    // deterministic rewrite may patch it into PASS.
    expect(snapshot.listing.description.text).toBe("Safe fallback description.");
    expect(snapshot.listing.description.text).not.toBe(repairedDraft.description.text);
    expect(snapshot.listing.title.text).toBe("Safe Fallback Title");
    expect(snapshot.provider.fallbackUsed).toBe(true);
    expect(snapshot.validation.status).toBe("PASS");
    expect(mocks.buildListingV5FallbackDraft).toHaveBeenCalledTimes(1);
    // The repair really was applied before the fallback, and that stays visible.
    expect(mocks.repairListingV5Draft).toHaveBeenCalledTimes(1);
    expect(snapshot.repairApplied).toBe(true);
  });

  it("runs the safe recovery pass once when repair cannot reach PASS, then falls back when recovery also fails", async () => {
    state.useProvider = true;
    state.context = context("fp-recovery-fallback");
    const repairable = {
      ...passValidation,
      status: "REPAIRABLE" as const,
      claims: { ...passValidation.claims, unsupportedClaims: ["an unsupported claim"] },
      repair: { allowed: true, reason: "only one bounded repair", targets: ["description"] },
    };
    const repairedDraft = { ...draft, description: { text: "A repaired description that still fails.", factIds: ["fact-1"] } };
    const fallbackDraft = { ...draft, title: { text: "Safe Fallback Title", factIds: ["fact-1"] } };
    // writer draft repairable -> post-repair repairable -> recovered draft still
    // repairable -> the fallback draft is the one that finally validates.
    mocks.validateListingV5Draft
      .mockReturnValueOnce(repairable)
      .mockReturnValueOnce(repairable)
      .mockReturnValueOnce(repairable)
      .mockReturnValue(passValidation);
    mocks.repairListingV5Draft.mockResolvedValue({ draft: repairedDraft, attempted: true, succeeded: true, appliedPaths: ["description"] });
    mocks.recoverListingV5Draft.mockResolvedValue({ draft: { ...draft, title: { text: "Recovered Title", factIds: ["fact-1"] } }, attempted: true, succeeded: true });
    mocks.buildListingV5FallbackDraft.mockReturnValue(fallbackDraft);

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);
    const snapshot = body.data.snapshot;
    // Recovery ran exactly once, its draft was re-validated, and because that
    // validation still failed the honest fallback shipped.
    expect(mocks.recoverListingV5Draft).toHaveBeenCalledTimes(1);
    expect(mocks.buildListingV5FallbackDraft).toHaveBeenCalledTimes(1);
    expect(snapshot.listing.title.text).toBe("Safe Fallback Title");
    expect(snapshot.provider.recoveryAttempted).toBe(true);
    expect(snapshot.provider.fallbackUsed).toBe(true);
    expect(snapshot.validation.status).toBe("PASS");
  });

  it("publishes the recovered draft when the recovery pass validates", async () => {
    state.useProvider = true;
    state.context = context("fp-recovery-pass");
    const repairable = {
      ...passValidation,
      status: "REPAIRABLE" as const,
      claims: { ...passValidation.claims, unsupportedClaims: ["an unsupported claim"] },
      repair: { allowed: true, reason: "only one bounded repair", targets: ["description"] },
    };
    mocks.validateListingV5Draft
      .mockReturnValueOnce(repairable)
      .mockReturnValueOnce(repairable)
      .mockReturnValue(passValidation);
    mocks.repairListingV5Draft.mockResolvedValue({ draft, attempted: true, succeeded: true, appliedPaths: ["description"] });
    mocks.recoverListingV5Draft.mockResolvedValue({ draft: { ...draft, title: { text: "Recovered Title", factIds: ["fact-1"] } }, attempted: true, succeeded: true });

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);
    const snapshot = body.data.snapshot;
    expect(mocks.recoverListingV5Draft).toHaveBeenCalledTimes(1);
    expect(mocks.buildListingV5FallbackDraft).not.toHaveBeenCalled();
    expect(snapshot.listing.title.text).toBe("Recovered Title");
    expect(snapshot.provider.recoveryAttempted).toBe(true);
    expect(snapshot.provider.fallbackUsed).toBe(false);
    expect(snapshot.validation.status).toBe("PASS");
  });

  it("rewrites a BLOCKed AI draft once and publishes it when the same Validator passes it", async () => {
    state.useProvider = true;
    state.context = context("fp-rewrite-pass");
    const blocked = {
      ...passValidation,
      status: "BLOCK" as const,
      claims: { ...passValidation.claims, allHaveEvidence: false, unsupportedClaims: ["a", "b", "c", "d", "e"] },
      repair: { allowed: false, reason: "blocked", targets: [] },
    };
    const rewrittenDraft = { ...draft, title: { text: "Rewritten Organizer", factIds: ["fact-1"] } };
    // 1st validation: the writer draft is BLOCKed. 2nd: the rewritten draft passes.
    mocks.validateListingV5Draft.mockReturnValueOnce(blocked).mockReturnValue(passValidation);
    mocks.rewriteListingV5Draft.mockResolvedValue({ draft: rewrittenDraft, attempted: true, succeeded: true });

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);

    const snapshot = body.data.snapshot;
    expect(mocks.rewriteListingV5Draft).toHaveBeenCalledTimes(1);
    // BLOCK is not repairable and no deterministic rewrite may patch it into PASS.
    expect(mocks.repairListingV5Draft).not.toHaveBeenCalled();
    expect(mocks.buildListingV5FallbackDraft).not.toHaveBeenCalled();
    expect(snapshot.listing.title.text).toBe("Rewritten Organizer");
    expect(snapshot.provider.rewriteAttempted).toBe(true);
    expect(snapshot.provider.fallbackUsed).toBe(false);
    expect(snapshot.validation.status).toBe("PASS");
  });

  it("repairs the rewritten draft when the rewrite lands on REPAIRABLE, still within one repair", async () => {
    state.useProvider = true;
    state.context = context("fp-rewrite-repair-pass");
    const blocked = {
      ...passValidation,
      status: "BLOCK" as const,
      claims: { ...passValidation.claims, allHaveEvidence: false, unsupportedClaims: ["a", "b", "c", "d", "e"] },
      repair: { allowed: false, reason: "blocked", targets: [] },
    };
    const repairable = {
      ...passValidation,
      status: "REPAIRABLE" as const,
      claims: { ...passValidation.claims, unsupportedClaims: ["one leftover claim"] },
      repair: { allowed: true, reason: "one bounded repair", targets: ["title"] },
    };
    const rewrittenDraft = { ...draft, title: { text: "Rewritten Organizer", factIds: ["fact-1"] } };
    const repairedDraft = { ...draft, title: { text: "Repaired Rewritten Organizer", factIds: ["fact-1"] } };
    // BLOCK -> rewrite -> REPAIRABLE -> repair -> PASS.
    mocks.validateListingV5Draft.mockReturnValueOnce(blocked).mockReturnValueOnce(repairable).mockReturnValue(passValidation);
    mocks.rewriteListingV5Draft.mockResolvedValue({ draft: rewrittenDraft, attempted: true, succeeded: true });
    mocks.repairListingV5Draft.mockResolvedValue({ draft: repairedDraft, attempted: true, succeeded: true, appliedPaths: ["title"] });

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);

    const snapshot = body.data.snapshot;
    expect(mocks.rewriteListingV5Draft).toHaveBeenCalledTimes(1);
    expect(mocks.repairListingV5Draft).toHaveBeenCalledTimes(1);
    expect(mocks.buildListingV5FallbackDraft).not.toHaveBeenCalled();
    expect(snapshot.listing.title.text).toBe("Repaired Rewritten Organizer");
    expect(snapshot.provider.rewriteAttempted).toBe(true);
    expect(snapshot.provider.repairAttempted).toBe(true);
    expect(snapshot.provider.fallbackUsed).toBe(false);
    expect(snapshot.validation.status).toBe("PASS");
  });

  it("falls back when the rewrite and the last-resort recovery both fail", async () => {
    state.useProvider = true;
    state.context = context("fp-rewrite-fallback");
    const blocked = {
      ...passValidation,
      status: "BLOCK" as const,
      claims: { ...passValidation.claims, allHaveEvidence: false, unsupportedClaims: ["a", "b", "c", "d", "e"] },
      repair: { allowed: false, reason: "blocked", targets: [] },
    };
    const fallbackDraft = { ...draft, title: { text: "Safe Fallback Title", factIds: ["fact-1"] } };
    // The AI draft never passes; only the deterministic fallback draft validates.
    mocks.validateListingV5Draft.mockReturnValueOnce(blocked).mockReturnValue(passValidation);
    mocks.rewriteListingV5Draft.mockResolvedValue({ draft: null, attempted: true, succeeded: false });
    mocks.recoverListingV5Draft.mockResolvedValue({ draft: null, attempted: true, succeeded: false });
    mocks.buildListingV5FallbackDraft.mockReturnValue(fallbackDraft);

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);

    const snapshot = body.data.snapshot;
    expect(mocks.rewriteListingV5Draft).toHaveBeenCalledTimes(1);
    expect(mocks.recoverListingV5Draft).toHaveBeenCalledTimes(1);
    expect(mocks.buildListingV5FallbackDraft).toHaveBeenCalledTimes(1);
    expect(snapshot.listing.title.text).toBe("Safe Fallback Title");
    expect(snapshot.provider.rewriteAttempted).toBe(true);
    expect(snapshot.provider.recoveryAttempted).toBe(true);
    expect(snapshot.provider.fallbackUsed).toBe(true);
    expect(snapshot.validation.status).toBe("PASS");
  });

  it("never rewrites a writer-stage fallback draft: the deterministic path stays deterministic", async () => {
    state.useProvider = true;
    const fallbackDraft = { ...draft, title: { text: "Safe Fallback Title", factIds: ["fact-1"] } };
    // The writer stage itself failed, so the pipeline is already on the honest
    // deterministic path and a conversion rewrite would only blur that record.
    mocks.generateListingV5Draft.mockResolvedValue({ draft: fallbackDraft, providerAttempted: true, providerSucceeded: false });
    mocks.validateListingV5Draft.mockReturnValue(passValidation);

    const response = await POST(request("POST", "task-1", { action: "generate", confirmRealAi: true }), { params: Promise.resolve({ id: "task-1" }) });
    const body = await json(response);
    expect(response.status).toBe(200);

    const snapshot = body.data.snapshot;
    expect(mocks.rewriteListingV5Draft).not.toHaveBeenCalled();
    expect(snapshot.listing.title.text).toBe("Safe Fallback Title");
  });
});