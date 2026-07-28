import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  loadMarketScreeningBatch: vi.fn(),
  buildMarketScreeningWorkbenchRenderModel: vi.fn(),
  getActiveProductionMarketScreeningRegistration: vi.fn(),
  selectMarketScreeningCandidateForResearch: vi.fn(),
  actualSelectMarketScreeningCandidateForResearch: null as null | (
    typeof import("@/lib/server/opportunityCandidateService")
  )["selectMarketScreeningCandidateForResearch"],
  transaction: vi.fn(),
  ownerCreate: vi.fn(),
  ownerUpdate: vi.fn(),
  listSandboxCandidates: vi.fn(),
  saveLegacySandboxCandidates: vi.fn(),
  updateSandboxCandidate: vi.fn(),
  sandboxCandidateToListItem: vi.fn((candidate: Record<string, unknown>) => candidate),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/marketScreeningBatchLoader", () => ({
  loadMarketScreeningBatch: mocks.loadMarketScreeningBatch,
}));

vi.mock("@/lib/marketScreeningWorkbench", () => ({
  buildMarketScreeningWorkbenchRenderModel: mocks.buildMarketScreeningWorkbenchRenderModel,
}));

vi.mock("@/lib/marketScreeningProductionRegistry", () => ({
  getActiveProductionMarketScreeningRegistration: mocks.getActiveProductionMarketScreeningRegistration,
}));

vi.mock("@/lib/server/opportunityCandidateService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/server/opportunityCandidateService")
  >();
  mocks.actualSelectMarketScreeningCandidateForResearch =
    actual.selectMarketScreeningCandidateForResearch;
  return {
    ...actual,
    selectMarketScreeningCandidateForResearch:
      mocks.selectMarketScreeningCandidateForResearch,
  };
});

vi.mock("@/lib/server/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    opportunityCandidate: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxCandidates: mocks.listSandboxCandidates,
  saveLegacySandboxCandidates: mocks.saveLegacySandboxCandidates,
  updateSandboxCandidate: mocks.updateSandboxCandidate,
  sandboxCandidateToListItem: mocks.sandboxCandidateToListItem,
}));

import { POST } from "./route";
import {
  MarketScreeningCandidateError,
  type CandidateItem,
  type MarketScreeningCandidateIdentity,
} from "@/lib/server/opportunityCandidateService";
import type { CandidateSaveItem } from "@/lib/server/candidateSourceSave";

const PRODUCT_KEY = "amazon:US:B012345678";
const PRODUCT_NAME = "Foldable Desk Stand";
const PRODUCTION_REGISTRATION = {
  registrationId: "production-registration-test-01",
  manifestId: "market-screening-manifest-1",
  manifestRelativePath: "test/market-screening-manifest.v1.json",
  manifestSha256: "a".repeat(64),
};

function evidenceSnapshot() {
  return {
    version: 1,
    sourceType: "market_screening_batch",
    sourceName: "importPackage",
    sourceUrl: "https://www.amazon.com/dp/B012345678",
    evidenceItems: ["product_page", "source_url_seen", "price_seen", "image_seen"],
    extractionSignals: ["url_available"],
    qualityScore: 0,
    confidence: "medium",
    riskFlags: [],
    decision: "cautious",
    decisionReason: "The candidate has limited source evidence and needs manual confirmation.",
    nextAction: "manual verification required: check the product page, price, image, and compliance risk before analysis.",
    generatedAt: "2026-07-28T01:00:00.000Z",
  };
}

function candidate(
  id: string,
  status: "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected" = "worth_analyzing",
) {
  return {
    id,
    name: PRODUCT_NAME,
    rawInput: PRODUCT_NAME,
    link: "https://www.amazon.com/dp/B012345678",
    score: 0,
    source: "现有候选商品池",
    keyword: "desk stand",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "来自现有候选商品池，需人工研究",
    status,
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "legacy_unverified",
      origin: "frozen_market_screening_batch",
      evidenceSnapshot: evidenceSnapshot(),
    }),
    analysisJson: "{}",
    convertedTaskId: null,
    createdAt: "2026-07-28T01:00:00.000Z",
    updatedAt: "2026-07-28T01:00:00.000Z",
    lastActionAt: null,
  };
}

type OwnerRecord = Omit<
  ReturnType<typeof candidate>,
  "link" | "createdAt" | "updatedAt" | "lastActionAt"
> & {
  link: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActionAt: Date | null;
};

function ownerRecord(
  id: string,
  status: "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected" = "pending",
): OwnerRecord {
  const item = candidate(id, status);
  return {
    ...item,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    lastActionAt: null,
  };
}

function installOwnerStore(initial: OwnerRecord[]) {
  let committed = initial.map((item) => ({ ...item }));
  let nextId = 1;
  mocks.transaction.mockImplementation(async (
    callback: (tx: {
      opportunityCandidate: {
        findMany: () => Promise<OwnerRecord[]>;
        create: typeof mocks.ownerCreate;
        update: typeof mocks.ownerUpdate;
      };
    }) => Promise<unknown>,
  ) => {
    const staged = committed.map((item) => ({ ...item }));
    mocks.ownerCreate.mockImplementation(async ({ data }: { data: CandidateSaveItem }) => {
      const now = new Date("2026-07-28T02:00:00.000Z");
      const created: OwnerRecord = {
        id: `owner-created-${nextId++}`,
        name: data.name,
        rawInput: data.rawInput,
        link: data.link,
        score: data.score,
        source: data.source,
        keyword: data.keyword,
        riskLevel: data.riskLevel,
        riskLabel: data.riskLabel,
        summaryLabel: data.summaryLabel,
        status: "pending",
        sourceMetaJson: data.sourceMetaJson,
        analysisJson: data.analysisJson,
        convertedTaskId: null,
        createdAt: now,
        updatedAt: now,
        lastActionAt: now,
      };
      staged.push(created);
      return created;
    });
    mocks.ownerUpdate.mockImplementation(async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { status: OwnerRecord["status"]; lastActionAt: Date };
    }) => {
      const index = staged.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("owner test record not found");
      staged[index] = {
        ...staged[index],
        status: data.status,
        lastActionAt: data.lastActionAt,
        updatedAt: data.lastActionAt,
      };
      return staged[index];
    });
    const result = await callback({
      opportunityCandidate: {
        findMany: async () => staged,
        create: mocks.ownerCreate,
        update: mocks.ownerUpdate,
      },
    });
    committed = staged;
    return result;
  });
  return {
    snapshot: () => committed.map((item) => ({ ...item })),
  };
}

function useActualOwnerSelection() {
  const actual = mocks.actualSelectMarketScreeningCandidateForResearch;
  if (!actual) throw new Error("actual Owner selection service is unavailable");
  mocks.selectMarketScreeningCandidateForResearch.mockImplementation(actual);
}

function rejectedMarketDecision(candidateId: string) {
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId,
    asin: "B012345678",
    briefId: "A",
    frozenRank: 1,
    marketDecision: "market_reject",
    decisionReasons: ["test_reject"],
    supportingEvidenceRefs: ["fixture:market"],
    opposingEvidenceRefs: [],
    marketMissingFields: [],
    dataCompleteness: 1,
    confidence: "high",
    stabilityStatus: "stable",
    ruleVersion: "r22-stage1-market-v1",
    inputHash: "b".repeat(64),
    createdAt: "2026-07-28T01:30:00.000Z",
  };
}

function readyModel(
  status: "advance" | "watch" | "reject" | "insufficient" = "advance",
  overrides: {
    productKey?: string;
    asin?: string;
    title?: string;
    priceAmount?: number;
  } = {},
) {
  const productKey = overrides.productKey ?? PRODUCT_KEY;
  const asin = overrides.asin ?? "B012345678";
  const title = overrides.title ?? PRODUCT_NAME;
  return {
    status: "ready",
    readiness: "ready_full",
    view: {
      manifestId: "market-screening-manifest-1",
      brief: { query: { value: "desk stand" } },
      items: [{
        productKey,
        asin,
        status,
        title: {
          value: title,
          source: "importPackage",
          capturedAt: "2026-07-28T01:00:00.000Z",
          confidence: "high",
          missingReason: null,
        },
        image: { status: "available", dataUrl: "data:image/jpeg;base64,dGVzdA==" },
        price: {
          value: { amount: overrides.priceAmount ?? 19.99, currency: "USD" },
          source: "importPackage",
          capturedAt: "2026-07-28T01:00:00.000Z",
          confidence: "high",
          missingReason: null,
        },
        rating: {
          value: 4.5,
          source: "importPackage",
          capturedAt: "2026-07-28T01:00:00.000Z",
          confidence: "high",
          missingReason: null,
        },
        reviewCount: {
          value: 120,
          source: "importPackage",
          capturedAt: "2026-07-28T01:00:00.000Z",
          confidence: "high",
          missingReason: null,
        },
        features: {
          value: ["Foldable"],
          source: "detailRun",
          capturedAt: "2026-07-28T01:00:00.000Z",
          confidence: "medium",
          missingReason: null,
        },
        detailEvidence: {
          value: null,
          source: "detailRun",
          capturedAt: null,
          confidence: "unknown",
          missingReason: "not_collected",
        },
        reasonCodes: ["manual_research_required"],
        nextActions: ["verify demand"],
      }],
    },
  };
}

function createRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/opportunity-candidates/from-market-screening",
    nextUrl: new URL("http://localhost:3000/api/opportunity-candidates/from-market-screening"),
    headers: new Headers(),
    json: async () => body,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sandboxCandidateToListItem.mockImplementation(
    (sandboxCandidate: Record<string, unknown>) => sandboxCandidate,
  );
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner" } });
  mocks.loadMarketScreeningBatch.mockReturnValue({ status: "ready" });
  mocks.buildMarketScreeningWorkbenchRenderModel.mockReturnValue(readyModel());
  mocks.getActiveProductionMarketScreeningRegistration.mockReturnValue(PRODUCTION_REGISTRATION);
  mocks.selectMarketScreeningCandidateForResearch.mockResolvedValue({
    candidate: candidate("candidate-default"),
    created: false,
  });
  mocks.listSandboxCandidates.mockReturnValue([]);
});

describe("POST /api/opportunity-candidates/from-market-screening", () => {
  it("reuses an existing authoritative Candidate and returns a complete /agent/run handoff", async () => {
    mocks.selectMarketScreeningCandidateForResearch.mockResolvedValue({
      candidate: candidate("candidate-existing"),
      created: false,
    });

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.item).toMatchObject({ id: "candidate-existing", name: PRODUCT_NAME });
    const url = new URL(body.href, "http://localhost:3000");
    expect(url.pathname).toBe("/agent/run");
    expect(url.searchParams.get("source")).toBe("opportunity");
    expect(url.searchParams.get("candidateId")).toBe("candidate-existing");
    expect(url.searchParams.get("productName")).toBe(PRODUCT_NAME);
    expect(JSON.parse(url.searchParams.get("evidence") || "{}")).toMatchObject({
      sourceType: "market_screening_batch",
      sourceName: "importPackage",
    });
    expect(mocks.selectMarketScreeningCandidateForResearch).toHaveBeenCalledOnce();
  });

  it("creates one canonical Candidate from trusted batch evidence and promotes the explicit selection", async () => {
    const ready = candidate("candidate-created", "worth_analyzing");
    mocks.selectMarketScreeningCandidateForResearch.mockResolvedValue({
      candidate: ready,
      created: true,
    });

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item).toMatchObject({
      id: "candidate-created",
      name: PRODUCT_NAME,
      status: "worth_analyzing",
    });
    expect(mocks.selectMarketScreeningCandidateForResearch).toHaveBeenCalledOnce();
    const [input, identity] = mocks.selectMarketScreeningCandidateForResearch.mock.calls[0];
    const sourceMeta = JSON.parse(input.sourceMetaJson);
    expect(sourceMeta).toMatchObject({
      integrity: "legacy_unverified",
      origin: "frozen_market_screening_batch",
      marketScreeningIdentity: {
        schemaVersion: "market-screening-candidate-identity.v1",
        productionRegistrationId: PRODUCTION_REGISTRATION.registrationId,
        batchManifestHash: PRODUCTION_REGISTRATION.manifestSha256,
        manifestId: PRODUCTION_REGISTRATION.manifestId,
        marketplace: "US",
        productKey: PRODUCT_KEY,
        asin: "B012345678",
      },
      marketScreening: {
        manifestId: "market-screening-manifest-1",
        productKey: PRODUCT_KEY,
        asin: "B012345678",
      },
    });
    expect(identity.identityHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(identity.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(sourceMeta.marketScreeningIdentity).toEqual(identity);
    expect(mocks.loadMarketScreeningBatch).toHaveBeenCalledWith(expect.objectContaining({
      environment: "production",
      productionRegistration: PRODUCTION_REGISTRATION,
    }));
    const url = new URL(body.href, "http://localhost:3000");
    expect(url.searchParams.get("candidateId")).toBe("candidate-created");
    expect(url.searchParams.get("productName")).toBe(PRODUCT_NAME);
  });

  it("runs the real Owner transaction and serializes concurrent repeat selection", async () => {
    const store = installOwnerStore([]);
    useActualOwnerSelection();

    const [first, second] = await Promise.all([
      POST(createRequest({ productKey: PRODUCT_KEY }) as never),
      POST(createRequest({ productKey: PRODUCT_KEY }) as never),
    ]);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.item.id).toBe(secondBody.item.id);
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0]).toMatchObject({
      id: firstBody.item.id,
      name: PRODUCT_NAME,
      status: "worth_analyzing",
      convertedTaskId: null,
    });
    expect(mocks.ownerCreate).toHaveBeenCalledOnce();
    expect(mocks.ownerUpdate).toHaveBeenCalledOnce();
  });

  it("rolls back the real Owner transaction when handoff validation fails", async () => {
    const holder: { store: ReturnType<typeof installOwnerStore> | null } = { store: null };
    const actual = mocks.actualSelectMarketScreeningCandidateForResearch;
    if (!actual) throw new Error("actual Owner selection service is unavailable");
    mocks.selectMarketScreeningCandidateForResearch.mockImplementation((
      input: CandidateSaveItem,
      identity: MarketScreeningCandidateIdentity,
      validateCandidate?: (candidate: CandidateItem) => void,
    ) => {
      const existing = {
        ...ownerRecord("owner-rejected-market", "pending"),
        name: input.name,
        rawInput: input.rawInput,
        sourceMetaJson: input.sourceMetaJson,
        analysisJson: JSON.stringify({
          r22MarketDecision: rejectedMarketDecision("owner-rejected-market"),
        }),
      };
      holder.store = installOwnerStore([existing]);
      return actual(input, identity, validateCandidate);
    });

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("candidate_handoff_invalid");
    expect(holder.store?.snapshot()).toMatchObject([{
      id: "owner-rejected-market",
      status: "pending",
    }]);
    expect(mocks.ownerCreate).not.toHaveBeenCalled();
    expect(mocks.ownerUpdate).not.toHaveBeenCalled();
  });

  it("uses the Visitor sandbox without touching Owner candidates", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    let sandboxCandidate: Record<string, unknown> | null = null;
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (_demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        sandboxCandidate = {
          ...candidate("sandbox_candidate_created", "pending"),
          sourceMetaJson: inputs[0].sourceMetaJson,
        };
        return { items: [sandboxCandidate], created: 1 };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation(() => {
      sandboxCandidate = { ...sandboxCandidate, status: "worth_analyzing" };
      return sandboxCandidate;
    });

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item.id).toBe("sandbox_candidate_created");
    expect(mocks.listSandboxCandidates).toHaveBeenCalledWith("visitor-a");
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledWith("visitor-a", expect.any(Array));
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
  });

  it("does not reuse a same-title Visitor Candidate from a different productKey and ASIN", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    const secondProductKey = "amazon:US:B087654321";
    let stored: Record<string, unknown> | null = null;
    let createdCount = 0;
    mocks.listSandboxCandidates.mockImplementation(() => stored ? [stored] : []);
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (_demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        createdCount += 1;
        stored = {
          ...candidate(`sandbox_candidate_${createdCount}`, "pending"),
          name: inputs[0].name,
          rawInput: inputs[0].rawInput,
          link: inputs[0].link,
          sourceMetaJson: inputs[0].sourceMetaJson,
        };
        return { items: [stored], created: 1 };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation(() => {
      stored = { ...stored, status: "worth_analyzing" };
      return stored;
    });

    const first = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    expect(first.status).toBe(200);

    mocks.buildMarketScreeningWorkbenchRenderModel.mockReturnValue(readyModel("advance", {
      productKey: secondProductKey,
      asin: "B087654321",
      title: PRODUCT_NAME,
    }));
    const second = await POST(createRequest({ productKey: secondProductKey }) as never);
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.created).toBe(true);
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledTimes(2);
    expect(secondBody.item.id).toBe("sandbox_candidate_2");
  });

  it("reuses the same Visitor identity when only the server-side title changes", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    let stored: Record<string, unknown> | null = null;
    mocks.listSandboxCandidates.mockImplementation(() => stored ? [stored] : []);
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (_demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        stored = {
          ...candidate("sandbox_candidate_stable", "pending"),
          name: inputs[0].name,
          rawInput: inputs[0].rawInput,
          sourceMetaJson: inputs[0].sourceMetaJson,
        };
        return { items: [stored], created: 1 };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation(() => {
      stored = { ...stored, status: "worth_analyzing" };
      return stored;
    });

    const first = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    expect(first.status).toBe(200);

    mocks.buildMarketScreeningWorkbenchRenderModel.mockReturnValue(readyModel("advance", {
      title: "Foldable Desk Stand – Revised Title",
    }));
    const second = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.created).toBe(false);
    expect(secondBody.item.id).toBe("sandbox_candidate_stable");
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledOnce();
  });

  it("fails closed when the same Visitor identity has a conflicting evidence hash", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    let stored: Record<string, unknown> | null = null;
    mocks.listSandboxCandidates.mockImplementation(() => stored ? [stored] : []);
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (_demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        stored = {
          ...candidate("sandbox_candidate_conflict", "pending"),
          sourceMetaJson: inputs[0].sourceMetaJson,
        };
        return { items: [stored], created: 1 };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation(() => {
      stored = { ...stored, status: "worth_analyzing" };
      return stored;
    });

    const first = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    expect(first.status).toBe(200);
    const storedCandidate = stored as Record<string, unknown> | null;
    const sourceMeta = JSON.parse(String(storedCandidate?.sourceMetaJson ?? "{}"));
    expect(sourceMeta.marketScreeningIdentity?.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    sourceMeta.marketScreeningIdentity.evidenceHash = "f".repeat(64);
    stored = { ...(storedCandidate ?? {}), sourceMetaJson: JSON.stringify(sourceMeta) };

    const second = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const secondBody = await second.json();

    expect(second.status).toBe(409);
    expect(secondBody.error.code).toBe("candidate_evidence_conflict");
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledOnce();
  });

  it("fails closed when a valid Visitor identity has a related malformed duplicate", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    let stored: Record<string, unknown> | null = null;
    let includeMalformedDuplicate = false;
    mocks.listSandboxCandidates.mockImplementation(() => {
      if (!stored) return [];
      if (!includeMalformedDuplicate) return [stored];
      const sourceMeta = JSON.parse(String(stored.sourceMetaJson ?? "{}"));
      return [
        stored,
        {
          ...stored,
          id: "sandbox_candidate_malformed_duplicate",
          name: "Different title on damaged duplicate",
          sourceMetaJson: JSON.stringify({
            ...sourceMeta,
            marketScreeningIdentity: {
              ...sourceMeta.marketScreeningIdentity,
              identityHash: "c".repeat(64),
            },
          }),
        },
      ];
    });
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (_demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        stored = {
          ...candidate("sandbox_candidate_valid_identity", "pending"),
          sourceMetaJson: inputs[0].sourceMetaJson,
          analysisJson: inputs[0].analysisJson,
        };
        return { items: [stored] };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation(() => {
      stored = { ...stored, status: "worth_analyzing" };
      return stored;
    });

    const first = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    expect(first.status).toBe(200);
    includeMalformedDuplicate = true;

    const second = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await second.json();

    expect(second.status).toBe(409);
    expect(body.error.code).toBe("candidate_identity_conflict");
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledOnce();
  });

  it("serializes concurrent clicks for the same Visitor identity", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-concurrent" },
    });
    let stored: Record<string, unknown> | null = null;
    mocks.listSandboxCandidates.mockImplementation(() => stored ? [stored] : []);
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (_demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        stored = {
          ...candidate("sandbox_candidate_single", "pending"),
          sourceMetaJson: inputs[0].sourceMetaJson,
        };
        return { items: [stored], created: 1 };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation(() => {
      stored = { ...stored, status: "worth_analyzing" };
      return stored;
    });

    const [first, second] = await Promise.all([
      POST(createRequest({ productKey: PRODUCT_KEY }) as never),
      POST(createRequest({ productKey: PRODUCT_KEY }) as never),
    ]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.item.id).toBe("sandbox_candidate_single");
    expect(secondBody.item.id).toBe("sandbox_candidate_single");
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledOnce();
  });

  it("keeps identical market identities isolated between Visitors", async () => {
    const stores = new Map<string, Record<string, unknown>>();
    mocks.requireAuthenticated.mockImplementation((request: { headers?: Headers }) => ({
      ok: true,
      context: {
        mode: "demo",
        demoAccessId: request.headers?.get("x-test-visitor") ?? "visitor-a",
      },
    }));
    mocks.listSandboxCandidates.mockImplementation(
      (demoAccessId: string) => stores.has(demoAccessId) ? [stores.get(demoAccessId)] : [],
    );
    mocks.saveLegacySandboxCandidates.mockImplementation(
      (demoAccessId: string, inputs: Array<Record<string, unknown>>) => {
        const stored = {
          ...candidate(`sandbox_candidate_${demoAccessId}`, "pending"),
          sourceMetaJson: inputs[0].sourceMetaJson,
        };
        stores.set(demoAccessId, stored);
        return { items: [stored], created: 1 };
      },
    );
    mocks.updateSandboxCandidate.mockImplementation((demoAccessId: string) => {
      const stored = { ...stores.get(demoAccessId), status: "worth_analyzing" };
      stores.set(demoAccessId, stored);
      return stored;
    });
    const visitorRequest = (visitor: string) => {
      const request = createRequest({ productKey: PRODUCT_KEY });
      request.headers.set("x-test-visitor", visitor);
      return request;
    };

    const first = await POST(visitorRequest("visitor-a") as never);
    const second = await POST(visitorRequest("visitor-b") as never);
    const repeated = await POST(visitorRequest("visitor-a") as never);
    const [firstBody, secondBody, repeatedBody] = await Promise.all([
      first.json(),
      second.json(),
      repeated.json(),
    ]);

    expect(firstBody.item.id).toBe("sandbox_candidate_visitor-a");
    expect(secondBody.item.id).toBe("sandbox_candidate_visitor-b");
    expect(repeatedBody.item.id).toBe("sandbox_candidate_visitor-a");
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
  });

  it.each(["reject", "insufficient"] as const)(
    "fails closed before Candidate writes for a %s batch item",
    async (status) => {
      mocks.buildMarketScreeningWorkbenchRenderModel.mockReturnValue(readyModel(status));

      const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe("candidate_not_researchable");
      expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
      expect(mocks.saveLegacySandboxCandidates).not.toHaveBeenCalled();
    },
  );

  it("fails closed when an existing Candidate status is not researchable", async () => {
    mocks.selectMarketScreeningCandidateForResearch.mockRejectedValue(
      new MarketScreeningCandidateError("candidate_not_ready", "not ready"),
    );

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("candidate_not_ready");
    expect(mocks.selectMarketScreeningCandidateForResearch).toHaveBeenCalledOnce();
  });

  it("fails closed instead of choosing between duplicate canonical identities", async () => {
    mocks.selectMarketScreeningCandidateForResearch.mockRejectedValue(
      new MarketScreeningCandidateError("candidate_identity_conflict", "duplicate identity"),
    );

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("candidate_identity_conflict");
    expect(mocks.selectMarketScreeningCandidateForResearch).toHaveBeenCalledOnce();
  });

  it("fails closed when the product key is not in the current verified batch", async () => {
    const response = await POST(createRequest({ productKey: "amazon:US:B000000000" }) as never);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("market_screening_item_not_found");
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
  });

  it("fails closed when the verified render model contains a duplicate product key", async () => {
    const model = readyModel();
    model.view.items.push({ ...model.view.items[0] });
    mocks.buildMarketScreeningWorkbenchRenderModel.mockReturnValue(model);

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("market_screening_identity_conflict");
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
    expect(mocks.saveLegacySandboxCandidates).not.toHaveBeenCalled();
  });

  it("fails closed before loading materials when the production registration is missing", async () => {
    mocks.getActiveProductionMarketScreeningRegistration.mockReturnValue(null);

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("market_screening_registration_missing");
    expect(mocks.loadMarketScreeningBatch).not.toHaveBeenCalled();
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
  });

  it("fails closed when the loaded manifest no longer matches the active registration", async () => {
    mocks.buildMarketScreeningWorkbenchRenderModel.mockReturnValue({
      ...readyModel(),
      view: {
        ...readyModel().view,
        manifestId: "drifted-manifest",
      },
    });

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("market_screening_batch_drifted");
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
  });

  it("performs no batch or Candidate work when authentication fails", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: false,
      status: 401,
      code: "auth_required",
      message: "请先登录。",
    });

    const response = await POST(createRequest({ productKey: PRODUCT_KEY }) as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("auth_required");
    expect(mocks.loadMarketScreeningBatch).not.toHaveBeenCalled();
    expect(mocks.listSandboxCandidates).not.toHaveBeenCalled();
    expect(mocks.selectMarketScreeningCandidateForResearch).not.toHaveBeenCalled();
  });
});
