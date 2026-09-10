import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(state.reserveCalls).toEqual([3]);
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
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.generateListingV5Draft.mockImplementationOnce(async () => {
      await blocked;
      return { draft: state.generatedDraft, providerAttempted: false, providerSucceeded: false };
    });

    const first = POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
    await Promise.resolve();
    const duplicate = await POST(request("POST", "task-1", { action: "generate" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(duplicate.status).toBe(409);
    expect((await json(duplicate)).error.code).toBe("listing_v5_running");
    release();
    expect((await first).status).toBe(200);
  });
});
