import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { computeSellerSpriteRowHash } from "@/lib/server/sellerSpriteImportContract";
import type { SellerSpriteImportRow } from "@/lib/server/sellerSpriteImportContract";
import type { AccessContext } from "@/lib/server/accessPassword";

// ── Owner path: mock Prisma ──────────────────────
const mocks = vi.hoisted(() => {
  let records: Array<Record<string, unknown>> = [];
  return {
    reset: () => { records = []; },
    records: () => records,
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        opportunityCandidate: {
          findMany: vi.fn(async () => records.map((r) => ({ ...r }))),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const record = { id: `candidate-${records.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() };
            records.push(record);
            return { ...record };
          }),
        },
      };
      return fn(tx);
    }),
  };
});

vi.mock("@/lib/server/db", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { importSellerSpriteCandidates } from "@/lib/server/sellerSpriteCandidateImport";

// ── Visitor path: real isolated file store ───────
let tempRoot = "";

function makeRow(asin: string, overrides: Partial<SellerSpriteImportRow> = {}): SellerSpriteImportRow {
  return {
    rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin, title: `Product ${asin}`, amazonUrl: `https://www.amazon.com/dp/${asin}` }),
    rowNumber: 2,
    asin,
    parentAsin: null,
    title: `Product ${asin}`,
    amazonUrl: `https://www.amazon.com/dp/${asin}`,
    imageUrl: null,
    priceUsd: 19.99,
    rating: 4.5,
    reviewCount: 100,
    brand: null,
    category: null,
    searchRank: null,
    estimatedMonthlySales: null,
    estimatedMonthlyRevenueUsd: null,
    ...overrides,
  };
}

const ownerCtx: AccessContext = { mode: "owner", token: "" };
const visitorA: AccessContext = { mode: "demo", token: "", demoAccessId: "visitor-a", isActive: true, isExpired: false, remainingAiCalls: 50 };
const visitorB: AccessContext = { mode: "demo", token: "", demoAccessId: "visitor-b", isActive: true, isExpired: false, remainingAiCalls: 50 };
const FILE_HASH = "f".repeat(64);
const OTHER_HASH = "e".repeat(64);

describe("SellerSprite Candidate Authority", () => {
  beforeEach(() => {
    mocks.reset();
    vi.clearAllMocks();
    tempRoot = mkdtempSync(join(tmpdir(), "pv-import-sandbox-"));
    process.env.DEMO_SANDBOX_STORE_PATH = join(tempRoot, "demo-sandbox.json");
    process.env.DEMO_ACCESS_STORE_PATH = join(tempRoot, "demo-access.json");
  });
  afterEach(() => {
    delete process.env.DEMO_SANDBOX_STORE_PATH;
    delete process.env.DEMO_ACCESS_STORE_PATH;
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const importedAt = "2026-07-31T09:00:00.000Z";

  describe("Owner authority", () => {
    it("creates on first import", async () => {
      const summary = await importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      expect(summary.created).toHaveLength(1);
      expect(summary.skipped).toHaveLength(0);
      expect(summary.conflicts).toHaveLength(0);
      expect(mocks.records()).toHaveLength(1);
      const record = mocks.records()[0];
      expect(record.score).toBe(0);
      expect(record.riskLevel).toBe("");
      expect(record.analysisJson).toBe("{}");
      expect(record.convertedTaskId).toBeNull();
      expect(record.source).toBe("SellerSprite");
      expect(record.status).toBe("pending");
      expect(record.rawInput).toBe("");
      expect(record.keyword).toBe("");
      expect(record.originProductBatchItemId).toBeUndefined();
      const meta = JSON.parse(String(record.sourceMetaJson));
      expect(meta.schema).toBe("sellersprite_candidate_source_v1");
      expect(meta.source.sourceFileSha256).toBe(FILE_HASH);
      expect(meta.identity.asin).toBe("B0TEST0001");
    });

    it("skips the same snapshot on retry", async () => {
      const first = await importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const second = await importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      expect(first.created).toHaveLength(1);
      expect(second.skipped).toHaveLength(1);
      expect(second.skipped[0].reason).toBe("already_imported");
      expect(second.skipped[0].candidateId).toBe(first.created[0].candidateId);
      expect(mocks.records()).toHaveLength(1);
    });

    it("conflicts on a different snapshot for the same ASIN", async () => {
      const first = await importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const second = await importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: OTHER_HASH, importedAt });
      expect(second.conflicts).toHaveLength(1);
      expect(second.conflicts[0].reason).toBe("candidate_exists_with_different_snapshot");
      expect(second.conflicts[0].candidateId).toBe(first.created[0].candidateId);
      expect(mocks.records()).toHaveLength(1);
    });

    it("serializes concurrent same-ASIN imports into one created + one skipped", async () => {
      const results = await Promise.all([
        importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt }),
        importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt }),
      ]);
      const created = results.flatMap((r) => r.created);
      const skipped = results.flatMap((r) => r.skipped);
      expect(created).toHaveLength(1);
      expect(skipped).toHaveLength(1);
      expect(mocks.records()).toHaveLength(1);
    });

    it("keeps response order stable with mixed outcomes", async () => {
      const first = await importSellerSpriteCandidates({
        context: ownerCtx,
        rows: [makeRow("B0TEST0001"), makeRow("B0TEST0002")],
        sourceFileSha256: FILE_HASH,
        importedAt,
      });
      const second = await importSellerSpriteCandidates({
        context: ownerCtx,
        rows: [makeRow("B0TEST0001"), makeRow("B0TEST0002")],
        sourceFileSha256: OTHER_HASH,
        importedAt,
      });
      expect(first.created.map((c) => c.rowHash)).toEqual([makeRow("B0TEST0001").rowHash, makeRow("B0TEST0002").rowHash]);
      expect(second.conflicts.map((c) => c.rowHash)).toEqual([makeRow("B0TEST0001").rowHash, makeRow("B0TEST0002").rowHash]);
    });
  });

  describe("Visitor authority", () => {
    it("creates on first import and isolates by demoAccessId", async () => {
      const a = await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const b = await importSellerSpriteCandidates({ context: visitorB, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      expect(a.created).toHaveLength(1);
      expect(b.created).toHaveLength(1);
      expect(a.created[0].candidateId).not.toBe(b.created[0].candidateId);
    });

    it("skips the same snapshot on retry", async () => {
      const first = await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const second = await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      expect(first.created).toHaveLength(1);
      expect(second.skipped).toHaveLength(1);
      expect(second.skipped[0].candidateId).toBe(first.created[0].candidateId);
    });

    it("conflicts on a different snapshot", async () => {
      const first = await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const second = await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: OTHER_HASH, importedAt });
      expect(second.conflicts).toHaveLength(1);
      expect(second.conflicts[0].candidateId).toBe(first.created[0].candidateId);
    });

    it("serializes concurrent same-subject imports into one created + one skipped", async () => {
      const results = await Promise.all([
        importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt }),
        importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt }),
      ]);
      const created = results.flatMap((r) => r.created);
      const skipped = results.flatMap((r) => r.skipped);
      expect(created).toHaveLength(1);
      expect(skipped).toHaveLength(1);
    });

    it("does not let a visitor see another visitor's candidate", async () => {
      await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      // Importing the same row for a different visitor must be a fresh created, not skipped.
      const b = await importSellerSpriteCandidates({ context: visitorB, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      expect(b.created).toHaveLength(1);
      expect(b.skipped).toHaveLength(0);
    });

    it("stores the expected frozen fields in the sandbox candidate", async () => {
      await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const { loadDemoSandboxStore } = await import("@/lib/server/demoSandbox");
      const store = loadDemoSandboxStore();
      const candidate = store.candidates.find((c) => c.demoAccessId === "visitor-a");
      expect(candidate).toBeDefined();
      expect(candidate!.score).toBe(0);
      expect(candidate!.riskLevel).toBe("");
      expect(candidate!.analysisJson).toBe("{}");
      expect(candidate!.source).toBe("SellerSprite");
      expect(candidate!.status).toBe("pending");
      const meta = JSON.parse(candidate!.sourceMetaJson);
      expect(meta.schema).toBe("sellersprite_candidate_source_v1");
    });
  });

  describe("Owner vs Visitor response shape parity", () => {
    it("returns the exact same DTO shape from both authorities", async () => {
      const ownerResult = await importSellerSpriteCandidates({ context: ownerCtx, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      const visitorResult = await importSellerSpriteCandidates({ context: visitorA, rows: [makeRow("B0TEST0001")], sourceFileSha256: FILE_HASH, importedAt });
      expect(Object.keys(ownerResult).sort()).toEqual(["conflicts", "created", "skipped"]);
      expect(Object.keys(visitorResult).sort()).toEqual(["conflicts", "created", "skipped"]);
      expect(ownerResult.created[0]).toMatchObject({ rowHash: makeRow("B0TEST0001").rowHash });
      expect(visitorResult.created[0]).toMatchObject({ rowHash: makeRow("B0TEST0001").rowHash });
      expect(ownerResult.created[0]).toHaveProperty("candidateId");
      expect(visitorResult.created[0]).toHaveProperty("candidateId");
    });
  });
});
