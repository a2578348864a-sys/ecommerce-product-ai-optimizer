import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  createSandbox: vi.fn(),
  getSelection: vi.fn(),
  getBatch: vi.fn(),
  getBatchItems: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    $queryRaw: mocks.findUnique,
  },
}));

vi.mock("@/lib/server/productBatchStoreResolver", () => ({
  getProductBatchStore: () => ({
    getSelection: mocks.getSelection,
    getBatch: mocks.getBatch,
    getBatchItems: mocks.getBatchItems,
  }),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  createOrReuseSandboxProductBatchCandidate: mocks.createSandbox,
  SandboxProductBatchCandidateError: class SandboxProductBatchCandidateError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { convertProductBatchItemToCandidate } from "@/lib/server/productBatchCandidateService";

function batch(id = "batch-a") {
  return {
    id,
    batchName: "Home organizer",
    marketplace: "US",
    currency: "USD",
    reportType: "search_results" as const,
    query: "organizer",
    category: "Home",
    priceMinCents: 1_000,
    priceMaxCents: 4_000,
    briefHash: "f".repeat(64),
    sourceFileName: "input.xlsx",
    sourceFileSha256: "1".repeat(64),
    normalizedBusinessHash: "2".repeat(64),
    snapshotHash: "b".repeat(64),
    manifestHash: "a".repeat(64),
    itemCount: 1,
    acceptedCount: 1,
    quarantinedCount: 0,
    dataQualityStatus: "passed" as const,
    batchStatus: "ready" as const,
    sellerSpriteDisclaimerVersion: "v1",
    normalizedSnapshotJson: "{}",
    manifestJson: "{}",
    qualitySummaryJson: "{}",
    errorJson: null,
    dedupeKey: "3".repeat(64),
    importedAt: "2026-07-28T00:00:00.000Z",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}

function item(id = "item-a", batchId = "batch-a") {
  return {
    id,
    batchId,
    productKey: "amazon:US:B000000001",
    ordinal: 0,
    asin: "B000000001",
    parentAsin: null,
    itemIdentityHash: id === "item-a" ? "c".repeat(64) : "4".repeat(64),
    itemHash: id === "item-a" ? "d".repeat(64) : "5".repeat(64),
    evidenceHash: id === "item-a" ? "e".repeat(64) : "6".repeat(64),
    normalizedProductJson: JSON.stringify({
      providerMetrics: {
        productTitle: { status: "resolved", normalized: "Closet organizer" },
        price: { status: "resolved", normalized: 29.99 },
      },
    }),
    occurrenceProjectionJson: "{}",
    familyProjectionJson: "{}",
    rankingJson: "{}",
    provisionalDisposition: "provisional_score_only",
    researchPriority: "priority_1",
    evidenceStatus: "sufficient_for_comparison",
    promotionEligible: false,
    imageSnapshotJson: '{"status":"not_cached"}',
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

type Stored = {
  id: string;
  name: string;
  status: string;
  sourceMetaJson: string;
  analysisJson: string;
  convertedTaskId: string | null;
  originProductBatchItemId: string | null;
};

function installOwnerStore() {
  const records = new Map<string, Stored>();
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    mocks.txFindUnique.mockImplementation(async (_strings: TemplateStringsArray, originId: string) => (
      records.has(originId) ? [records.get(originId)!] : []
    ));
    mocks.txCreate.mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const record = {
        id: String(values[0]),
        name: String(values[1]),
        status: String(values[10]),
        sourceMetaJson: String(values[11]),
        analysisJson: String(values[12]),
        convertedTaskId: null,
        originProductBatchItemId: String(values[14]),
      };
      records.set(record.originProductBatchItemId, record);
      return 1;
    });
    return callback({
      $queryRaw: mocks.txFindUnique,
      $executeRaw: mocks.txCreate,
    });
  });
  mocks.findUnique.mockImplementation(async (_strings: TemplateStringsArray, originId: string) => (
    records.has(originId) ? [records.get(originId)!] : []
  ));
  return records;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSelection.mockResolvedValue({
    activeProductBatchId: "batch-a",
    activeLegacyRegistrationId: null,
    updatedAt: "2026-07-28T00:00:00.000Z",
  });
  mocks.getBatch.mockResolvedValue(batch());
  mocks.getBatchItems.mockResolvedValue([item()]);
  mocks.createSandbox.mockImplementation(async (_accessId: string, input: {
    name: string;
    status: string;
    sourceMetaJson: string;
    analysisJson: string;
    originProductBatchItemId: string;
  }) => ({
    created: true,
    candidate: {
      id: "visitor-candidate-a",
      name: input.name,
      status: input.status,
      sourceMetaJson: input.sourceMetaJson,
      analysisJson: input.analysisJson,
      convertedTaskId: null,
      originProductBatchItemId: input.originProductBatchItemId,
    },
  }));
});

describe("Owner ProductBatchItem to Candidate conversion", () => {
  it("is idempotent by originProductBatchItemId and never reuses by title", async () => {
    const records = installOwnerStore();
    const first = await convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    );
    const repeated = await convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    );

    expect(first.candidateId).toBe(repeated.candidateId);
    expect(first.destinationUrl).toBe(
      `/opportunity-candidates/${encodeURIComponent(first.candidateId)}`,
    );
    expect(first.destinationUrl).not.toContain("sourceMeta");
    expect(first.destinationUrl).not.toContain("Closet");
    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(mocks.txCreate).toHaveBeenCalledTimes(1);
    expect(records.get("item-a")).toMatchObject({
      name: "Closet organizer",
      status: "worth_analyzing",
      convertedTaskId: null,
      originProductBatchItemId: "item-a",
    });

    mocks.getSelection.mockResolvedValue({
      activeProductBatchId: "batch-b",
      activeLegacyRegistrationId: null,
      updatedAt: "2026-07-28T01:00:00.000Z",
    });
    mocks.getBatch.mockResolvedValue(batch("batch-b"));
    mocks.getBatchItems.mockResolvedValue([item("item-b", "batch-b")]);
    const sameAsinDifferentBatch = await convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-b",
    );

    expect(sameAsinDifferentBatch.candidateId).not.toBe(first.candidateId);
    expect(records.size).toBe(2);
  });

  it("uses the isolated Visitor Candidate store and stops before Agent execution", async () => {
    const result = await convertProductBatchItemToCandidate(
      {
        mode: "demo",
        token: "demo",
        demoAccessId: "visitor-a",
        isActive: true,
        isExpired: false,
        remainingAiCalls: 1,
      },
      "item-a",
    );

    expect(mocks.createSandbox).toHaveBeenCalledWith(
      "visitor-a",
      expect.objectContaining({
        status: "worth_analyzing",
        originProductBatchItemId: "item-a",
      }),
    );
    expect(result).toMatchObject({
      candidateId: "visitor-candidate-a",
      created: true,
      destination: "research",
      destinationUrl: "/opportunity-candidates/visitor-candidate-a",
    });
    expect(result.destinationUrl).not.toContain("/agent/run");
  });

  it("returns existing history instead of creating a duplicate Candidate or Task", async () => {
    const records = installOwnerStore();
    const first = await convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    );
    records.get("item-a")!.convertedTaskId = "task-a";

    const repeated = await convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    );

    expect(repeated).toMatchObject({
      candidateId: first.candidateId,
      created: false,
      destination: "history",
      destinationUrl: "/tasks/task-a",
    });
    expect(mocks.txCreate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an existing Candidate carries changed immutable source context", async () => {
    const records = installOwnerStore();
    await convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    );
    const stored = records.get("item-a")!;
    stored.sourceMetaJson = JSON.stringify({
      ...JSON.parse(stored.sourceMetaJson),
      query: "changed-query",
    });

    await expect(convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    )).rejects.toMatchObject({ code: "product_batch_candidate_source_conflict" });
    expect(mocks.txCreate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the active batch does not own the submitted item id", async () => {
    installOwnerStore();
    mocks.getBatchItems.mockResolvedValue([item("item-b")]);

    await expect(convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    )).rejects.toMatchObject({ code: "product_batch_item_not_found" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed without an active ProductBatch or when the active batch is not ready", async () => {
    installOwnerStore();
    mocks.getSelection.mockResolvedValueOnce(null);
    await expect(convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    )).rejects.toMatchObject({ code: "product_batch_selection_required" });

    for (const batchState of [
      { batchStatus: "processing", dataQualityStatus: "pending" },
      { batchStatus: "blocked", dataQualityStatus: "blocked" },
      { batchStatus: "archived", dataQualityStatus: "passed" },
      { batchStatus: "ready", dataQualityStatus: "blocked" },
    ] as const) {
      mocks.getSelection.mockResolvedValueOnce({
        activeProductBatchId: "batch-a",
        activeLegacyRegistrationId: null,
        updatedAt: "2026-07-28T00:00:00.000Z",
      });
      mocks.getBatch.mockResolvedValueOnce({ ...batch(), ...batchState });
      await expect(convertProductBatchItemToCandidate(
        { mode: "owner", token: "owner" },
        "item-a",
      )).rejects.toMatchObject({ code: "product_batch_not_ready" });
    }

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("maps corrupted or incomplete Item evidence to a closed research gate", async () => {
    installOwnerStore();
    mocks.getBatchItems.mockResolvedValueOnce([{
      ...item(),
      evidenceHash: "not-a-hash",
    }]);

    await expect(convertProductBatchItemToCandidate(
      { mode: "owner", token: "owner" },
      "item-a",
    )).rejects.toMatchObject({ code: "product_batch_candidate_not_researchable" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
