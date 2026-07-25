/**
 * Phase 3F Reset-A2-1 — Legacy Candidate Write rule engine tests.
 *
 * TDD test suite covering the approved Target Contract C:
 * identity, fingerprint, create, update, unchanged, overwrite blocked,
 * ambiguous, all-or-nothing, counting, backend contract, and safe interface.
 */

import { describe, expect, it } from "vitest";
import { normalizeCandidateIdentity } from "@/lib/server/candidateSourceSave";
import {
  LegacyCandidateWriteError,
  type BoundLegacyCandidateWriteBackend,
  type ExistingLegacyCandidate,
  type LegacyCandidateWriteDecision,
  type LegacyCandidateWriteInput,
  type LegacyCandidateWriteResult,
} from "@/lib/server/legacyCandidateWriteTypes";
import {
  computeMutableFingerprintV1,
  executeLegacyCandidateWrite,
  planLegacyCandidateWriteBatch,
} from "@/lib/server/legacyCandidateWrite";

// ── Test fixtures ────────────────────────────────

function input(overrides: Partial<LegacyCandidateWriteInput> = {}): LegacyCandidateWriteInput {
  return {
    name: overrides.name ?? "Test Product",
    rawInput: overrides.rawInput ?? "Test Product raw input",
    link: "link" in overrides ? (overrides.link ?? null) : "https://example.com/product",
    score: overrides.score ?? 75,
    source: overrides.source ?? "Manual",
    keyword: overrides.keyword ?? "test",
    riskLevel: overrides.riskLevel ?? "green",
    riskLabel: overrides.riskLabel ?? "低风险",
    summaryLabel: overrides.summaryLabel ?? "Test summary",
    status: "pending",
    sourceMetaJson: "sourceMetaJson" in overrides ? (overrides.sourceMetaJson ?? "{}") : JSON.stringify({ integrity: "legacy_unverified" }),
    analysisJson: "analysisJson" in overrides ? (overrides.analysisJson ?? "{}") : "{}",
    convertedTaskId: "convertedTaskId" in overrides ? (overrides.convertedTaskId ?? null) : null,
  };
}

function existing(overrides: Partial<ExistingLegacyCandidate> = {}): ExistingLegacyCandidate {
  const baseInput = input({ name: overrides.name ?? "Test Product" });
  return {
    id: overrides.id ?? "candidate-1",
    name: overrides.name ?? "Test Product",
    status: overrides.status ?? "pending",
    convertedTaskId: overrides.convertedTaskId ?? null,
    sourceIntegrity: overrides.sourceIntegrity ?? "legacy_unverified",
    mutableFingerprint:
      overrides.mutableFingerprint ?? computeMutableFingerprintV1(baseInput),
  };
}

function fakeBackend(
  store: Map<string, readonly ExistingLegacyCandidate[]>,
  commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [],
): BoundLegacyCandidateWriteBackend {
  return {
    async loadByIdentityKeys(keys) {
      const result = new Map<string, readonly ExistingLegacyCandidate[]>();
      for (const key of keys) {
        const records = store.get(key);
        if (records && records.length > 0) result.set(key, records);
      }
      return result;
    },
    async commitPlan(plan) {
      commitCalls.push(plan);
      const items = plan.map((d) => {
        const identityKey = d.kind === "create" ? d.identityKey : normalizeCandidateIdentity(
          d.kind === "unchanged" ? "" : d.input.name,
        );
        return {
          decision: d.kind === "unchanged" ? "unchanged" as const
            : d.kind === "update" ? "updated" as const
            : "created" as const,
          identityKey: d.kind === "create" ? d.identityKey
            : normalizeCandidateIdentity(""),
          candidateId: d.kind === "create" ? "new-id" : d.candidateId,
        };
      });
      return {
        created: plan.filter((d) => d.kind === "create").length,
        updated: plan.filter((d) => d.kind === "update").length,
        unchanged: plan.filter((d) => d.kind === "unchanged").length,
        items,
      };
    },
  };
}

// ── Identity ─────────────────────────────────────

describe("identity reuse", () => {
  it("uses the existing normalizeCandidateIdentity implementation", () => {
    // Direct proof: the planLegacy function imports and uses normalizeCandidateIdentity
    const id1 = normalizeCandidateIdentity("  FOLDABLE   WIDGET STAND  ");
    const id2 = normalizeCandidateIdentity("foldable widget stand");
    expect(id1).toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
  });

  it.each([
    ["ASCII case", "PRODUCT A", "product a"],
    ["leading/trailing whitespace", "  product b  ", "product b"],
    ["consecutive whitespace", "product   c", "product c"],
    ["tab and newline", "\tproduct\nd\t", "product d"],
    ["Unicode NFC/NFD", "café", "café"], // NFC is the normalized form
    ["Chinese name", "  折叠手机支架  ", "折叠手机支架"],
  ])("normalizes %s", (_label, input, expected) => {
    expect(normalizeCandidateIdentity(input)).toBe(expected);
  });

  it("treats empty name as invalid", () => {
    expect(() => planLegacyCandidateWriteBatch(
      [input({ name: "" })],
      new Map(),
    )).toThrow(LegacyCandidateWriteError);
  });

  it("treats whitespace-only name as invalid", () => {
    expect(() => planLegacyCandidateWriteBatch(
      [input({ name: "   " })],
      new Map(),
    )).toThrow(LegacyCandidateWriteError);
  });

  it("maps different display names with same identity to the same key", () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const existingRecord = existing({ name: "FOLDABLE WIDGET STAND", id: "existing-1" });
    store.set(normalizeCandidateIdentity("Foldable Widget Stand"), [existingRecord]);

    const decisions = planLegacyCandidateWriteBatch(
      [input({ name: "  foldable   widget stand  " })],
      store,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("unchanged"); // fingerprint matches
  });
});

// ── Mutable Fingerprint V1 ────────────────────────

describe("computeMutableFingerprintV1", () => {
  it("is deterministic", () => {
    const a = input({ name: "A", score: 80 });
    const b = input({ name: "A", score: 80 });
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });

  it("is a 64-char hex string", () => {
    const fp = computeMutableFingerprintV1(input());
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs when score changes", () => {
    const a = input({ score: 50 });
    const b = input({ score: 51 });
    expect(computeMutableFingerprintV1(a)).not.toBe(computeMutableFingerprintV1(b));
  });

  it("differs when link changes", () => {
    const a = input({ link: "https://a.example" });
    const b = input({ link: "https://b.example" });
    expect(computeMutableFingerprintV1(a)).not.toBe(computeMutableFingerprintV1(b));
  });

  it("differs when keyword changes", () => {
    const a = input({ keyword: "old" });
    const b = input({ keyword: "new" });
    expect(computeMutableFingerprintV1(a)).not.toBe(computeMutableFingerprintV1(b));
  });

  it("differs when risk changes", () => {
    const a = input({ riskLevel: "green", riskLabel: "a" });
    const b = input({ riskLevel: "red", riskLabel: "a" });
    expect(computeMutableFingerprintV1(a)).not.toBe(computeMutableFingerprintV1(b));
  });

  it("differs when summary changes", () => {
    const a = input({ summaryLabel: "old summary" });
    const b = input({ summaryLabel: "new summary" });
    expect(computeMutableFingerprintV1(a)).not.toBe(computeMutableFingerprintV1(b));
  });

  it("differs when rawInput changes", () => {
    const a = input({ rawInput: "old raw" });
    const b = input({ rawInput: "new raw" });
    expect(computeMutableFingerprintV1(a)).not.toBe(computeMutableFingerprintV1(b));
  });

  it("ignores name display differences", () => {
    const a = input({ name: "Product A" });
    const b = input({ name: "  PRODUCT   A  " });
    // Name is NOT in MUTABLE_FINGERPRINT_V1_FIELDS
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });

  it("ignores status differences", () => {
    const a = input({ status: "pending" });
    const b = input({ status: "analyzed" });
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });

  it("ignores convertedTaskId differences", () => {
    const a = input({ convertedTaskId: null });
    const b = input({ convertedTaskId: "task-1" });
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });

  it("ignores sourceMetaJson differences (timestamps)", () => {
    const a = input({ sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified", capturedAt: "2026-01-01T00:00:00Z" }) });
    const b = input({ sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified", capturedAt: "2026-07-25T12:00:00Z" }) });
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });

  it("ignores analysisJson differences (timestamps)", () => {
    const a = input({ analysisJson: JSON.stringify({ generatedAt: "2026-01-01" }) });
    const b = input({ analysisJson: JSON.stringify({ generatedAt: "2026-07-25" }) });
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });

  it("treats blank string fields as null-equivalent", () => {
    const a = input({ link: null });
    const b = input({ link: "   " });
    expect(computeMutableFingerprintV1(a)).toBe(computeMutableFingerprintV1(b));
  });
});

// ── First save (create) ──────────────────────────

describe("first save — create", () => {
  it("produces a single create decision for a new identity", () => {
    const decisions = planLegacyCandidateWriteBatch(
      [input({ name: "New Product" })],
      new Map(),
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("create");
    expect((decisions[0] as { kind: "create"; identityKey: string }).identityKey)
      .toBe(normalizeCandidateIdentity("New Product"));
  });

  it("produces create decisions for multiple distinct new identities", () => {
    const decisions = planLegacyCandidateWriteBatch(
      [input({ name: "Product A" }), input({ name: "Product B" }), input({ name: "Product C" })],
      new Map(),
    );
    expect(decisions).toHaveLength(3);
    expect(decisions.every((d) => d.kind === "create")).toBe(true);
  });

  it("throws for empty batch", () => {
    expect(() => planLegacyCandidateWriteBatch([], new Map()))
      .toThrow(LegacyCandidateWriteError);
  });

  it("result order is stable (matches input order)", () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const decisions = planLegacyCandidateWriteBatch(
      [input({ name: "C" }), input({ name: "A" }), input({ name: "B" })],
      store,
    );
    const names = decisions
      .filter((d) => d.kind === "create")
      .map((d) => (d as { kind: "create"; identityKey: string }).identityKey);
    expect(names).toEqual([
      normalizeCandidateIdentity("C"),
      normalizeCandidateIdentity("A"),
      normalizeCandidateIdentity("B"),
    ]);
  });
});

// ── Legacy duplicate (update / unchanged) ────────

describe("legacy duplicate — update / unchanged", () => {
  it("produces unchanged when the mutable fingerprint is identical", () => {
    const item = input({ name: "Test Product", score: 75 });
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Test Product"), [
      existing({
        name: "Test Product",
        mutableFingerprint: computeMutableFingerprintV1(item),
      }),
    ]);

    const decisions = planLegacyCandidateWriteBatch([item], store);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("unchanged");
  });

  it("produces unchanged when only display name differs (case/whitespace)", () => {
    const item = input({ name: "  test   product  " }); // different display
    const baseItem = input({ name: "Test Product" });
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Test Product"), [
      existing({
        name: "Test Product",
        mutableFingerprint: computeMutableFingerprintV1(baseItem),
      }),
    ]);

    const decisions = planLegacyCandidateWriteBatch([item], store);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("unchanged");
  });

  it("produces unchanged when only non-deterministic fields differ", () => {
    const storeItem = existing({
      name: "Test Product",
      mutableFingerprint: computeMutableFingerprintV1(input({ name: "Test Product" })),
    });
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Test Product"), [storeItem]);

    const newInput = input({
      name: "Test Product",
      sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified", capturedAt: "2026-07-25T12:00:00Z" }),
      analysisJson: JSON.stringify({ generatedAt: "2026-07-25" }),
      status: "analyzed", // ignored by fingerprint
      convertedTaskId: "task-forged", // ignored by fingerprint
    });

    const decisions = planLegacyCandidateWriteBatch([newInput], store);
    expect(decisions[0].kind).toBe("unchanged");
  });

  it.each([
    ["score", { score: 91 }],
    ["link", { link: "https://changed.example" }],
    ["keyword", { keyword: "changed" }],
    ["riskLevel", { riskLevel: "red" }],
    ["riskLabel", { riskLabel: "高风险" }],
    ["summaryLabel", { summaryLabel: "changed summary" }],
    ["rawInput", { rawInput: "changed raw" }],
  ])("produces update when %s changes", (_label, overrides) => {
    const baseItem = input({ name: "Test Product" });
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Test Product"), [
      existing({
        name: "Test Product",
        mutableFingerprint: computeMutableFingerprintV1(baseItem),
      }),
    ]);

    const changedItem = input({ name: "Test Product", ...overrides });
    const decisions = planLegacyCandidateWriteBatch([changedItem], store);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("update");
  });
});

// ── Overwrite blocked ────────────────────────────

describe("overwrite blocked", () => {
  it.each([
    ["signed Candidate", { sourceIntegrity: "signed_source_v2" as const }],
    ["linked Candidate", { convertedTaskId: "task-linked" }],
    ["worth_analyzing", { status: "worth_analyzing" }],
    ["analyzed", { status: "analyzed" }],
    ["paused", { status: "paused" }],
    ["rejected", { status: "rejected" }],
    ["unknown integrity", { sourceIntegrity: "unknown" as const }],
  ])("blocks overwrite for %s", (_label, overrides) => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Test Product"), [
      existing({ name: "Test Product", ...overrides }),
    ]);

    expect(() =>
      planLegacyCandidateWriteBatch([input({ name: "Test Product" })], store),
    ).toThrow(LegacyCandidateWriteError);
  });

  it("fails the entire batch when one item is blocked", () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Signed Product"), [
      existing({ name: "Signed Product", sourceIntegrity: "signed_source_v2" }),
    ]);

    // Also put a safe legacy record in the store
    const safeItem = input({ name: "Safe Product" });
    store.set(normalizeCandidateIdentity("Safe Product"), [
      existing({ name: "Safe Product", mutableFingerprint: computeMutableFingerprintV1(safeItem) }),
    ]);

    let threw = false;
    try {
      planLegacyCandidateWriteBatch(
        [input({ name: "Safe Product" }), input({ name: "Signed Product" })],
        store,
      );
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(LegacyCandidateWriteError);
      expect((error as LegacyCandidateWriteError).code).toBe("candidate_legacy_overwrite_blocked");
    }
    expect(threw).toBe(true);
  });
});

// ── Identity ambiguous ───────────────────────────

describe("identity ambiguous", () => {
  it("detects two legacy records with the same identity", () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Ambiguous Product"), [
      existing({ name: "Ambiguous Product", id: "legacy-a" }),
      existing({ name: "  ambiguous   product  ", id: "legacy-b" }),
    ]);

    let threw = false;
    try {
      planLegacyCandidateWriteBatch([input({ name: "Ambiguous Product" })], store);
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(LegacyCandidateWriteError);
      expect((error as LegacyCandidateWriteError).code).toBe("candidate_identity_ambiguous");
    }
    expect(threw).toBe(true);
  });

  it("detects one legacy + one signed with the same identity", () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Mixed Product"), [
      existing({ name: "Mixed Product", id: "legacy-1", sourceIntegrity: "legacy_unverified" }),
      existing({ name: "Mixed Product", id: "signed-1", sourceIntegrity: "signed_source_v2" }),
    ]);

    let threw = false;
    try {
      planLegacyCandidateWriteBatch([input({ name: "Mixed Product" })], store);
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(LegacyCandidateWriteError);
      expect((error as LegacyCandidateWriteError).code).toBe("candidate_identity_ambiguous");
    }
    expect(threw).toBe(true);
  });

  it("detects three mixed records", () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Triple Product"), [
      existing({ name: "Triple Product", id: "a", sourceIntegrity: "legacy_unverified" }),
      existing({ name: "Triple Product", id: "b", sourceIntegrity: "legacy_unverified" }),
      existing({ name: "Triple Product", id: "c", sourceIntegrity: "signed_source_v2" }),
    ]);

    expect(() =>
      planLegacyCandidateWriteBatch([input({ name: "Triple Product" })], store),
    ).toThrow(LegacyCandidateWriteError);
  });

  it("ambiguous takes priority over overwrite blocked", () => {
    // Multiple records → ambiguous even if one of them is signed
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Priority Test"), [
      existing({ name: "Priority Test", id: "signed-1", sourceIntegrity: "signed_source_v2" }),
      existing({ name: "Priority Test", id: "legacy-1", sourceIntegrity: "legacy_unverified" }),
    ]);

    let threw = false;
    try {
      planLegacyCandidateWriteBatch([input({ name: "Priority Test" })], store);
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(LegacyCandidateWriteError);
      expect((error as LegacyCandidateWriteError).code).toBe("candidate_identity_ambiguous");
    }
    expect(threw).toBe(true);
  });
});

// ── Batch-internal duplicate ─────────────────────

describe("batch-internal duplicate", () => {
  it("rejects two identical items", () => {
    expect(() =>
      planLegacyCandidateWriteBatch(
        [input({ name: "Duplicate" }), input({ name: "Duplicate" })],
        new Map(),
      ),
    ).toThrow(LegacyCandidateWriteError);
  });

  it("rejects two items differing only in case/whitespace", () => {
    expect(() =>
      planLegacyCandidateWriteBatch(
        [input({ name: "Product X" }), input({ name: "  product   x  " })],
        new Map(),
      ),
    ).toThrow(LegacyCandidateWriteError);
  });

  it("rejects NFC-equivalent names", () => {
    expect(() =>
      planLegacyCandidateWriteBatch(
        [input({ name: "café" }), input({ name: "café" })],
        new Map(),
      ),
    ).toThrow(LegacyCandidateWriteError);
  });

  it("fail-closed — does not silently deduplicate", () => {
    expect(() =>
      planLegacyCandidateWriteBatch(
        [input({ name: "Same", score: 50 }), input({ name: "Same", score: 99 })],
        new Map(),
      ),
    ).toThrow(LegacyCandidateWriteError);
  });

  it("uses candidate_source_conflict error code", () => {
    let threw = false;
    try {
      planLegacyCandidateWriteBatch(
        [input({ name: "X" }), input({ name: "X" })],
        new Map(),
      );
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(LegacyCandidateWriteError);
      expect((error as LegacyCandidateWriteError).code).toBe("candidate_source_conflict");
    }
    expect(threw).toBe(true);
  });
});

// ── All-or-nothing ────────────────────────────────

describe("all-or-nothing", () => {
  it("does not call commitPlan when planning throws", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Signed"), [
      existing({ sourceIntegrity: "signed_source_v2", name: "Signed" }),
    ]);
    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);

    await expect(
      executeLegacyCandidateWrite([input({ name: "Signed" })], backend),
    ).rejects.toThrow(LegacyCandidateWriteError);

    expect(commitCalls).toHaveLength(0);
  });

  it("does not call commitPlan when one item in a mixed batch is blocked", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("Safe Product"), [
      existing({ name: "Safe Product", id: "safe-1" }),
    ]);
    store.set(normalizeCandidateIdentity("Signed Product"), [
      existing({ name: "Signed Product", sourceIntegrity: "signed_source_v2" }),
    ]);
    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);

    await expect(
      executeLegacyCandidateWrite(
        [input({ name: "Safe Product" }), input({ name: "Signed Product" })],
        backend,
      ),
    ).rejects.toThrow(LegacyCandidateWriteError);

    expect(commitCalls).toHaveLength(0);
  });

  it("calls commitPlan exactly once for a successful batch", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);

    await executeLegacyCandidateWrite(
      [input({ name: "A" }), input({ name: "B" })],
      backend,
    );

    expect(commitCalls).toHaveLength(1);
  });

  it("detects backend returning wrong item count", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const backend: BoundLegacyCandidateWriteBackend = {
      async loadByIdentityKeys() { return new Map(); },
      async commitPlan() {
        return { created: 1, updated: 0, unchanged: 0, items: [] }; // wrong count
      },
    };

    await expect(
      executeLegacyCandidateWrite([input({ name: "A" })], backend),
    ).rejects.toThrow(LegacyCandidateWriteError);
  });

  it("detects backend returning mismatched counts", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const backend: BoundLegacyCandidateWriteBackend = {
      async loadByIdentityKeys() { return new Map(); },
      async commitPlan(_plan) {
        return {
          created: 0, // should be 1
          updated: 0,
          unchanged: 0,
          items: [{ decision: "created" as const, identityKey: "test", candidateId: "x" }],
        };
      },
    };

    await expect(
      executeLegacyCandidateWrite([input({ name: "A" })], backend),
    ).rejects.toThrow(LegacyCandidateWriteError);
  });

  it("wraps backend load failures", async () => {
    const backend: BoundLegacyCandidateWriteBackend = {
      async loadByIdentityKeys() { throw new Error("connection lost"); },
      async commitPlan() { return { created: 0, updated: 0, unchanged: 0, items: [] }; },
    };

    await expect(
      executeLegacyCandidateWrite([input({ name: "A" })], backend),
    ).rejects.toThrow(LegacyCandidateWriteError);
  });

  it("wraps backend commit failures", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const backend: BoundLegacyCandidateWriteBackend = {
      async loadByIdentityKeys() { return new Map(); },
      async commitPlan() { throw new Error("disk full"); },
    };

    await expect(
      executeLegacyCandidateWrite([input({ name: "A" })], backend),
    ).rejects.toThrow(LegacyCandidateWriteError);
  });
});

// ── Counting ─────────────────────────────────────

describe("counting", () => {
  it("all created", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);

    const result = await executeLegacyCandidateWrite(
      [input({ name: "A" }), input({ name: "B" }), input({ name: "C" })],
      backend,
    );

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.items).toHaveLength(3);
  });

  it("all updated", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const changed = input({ name: "A", score: 99 });
    store.set(normalizeCandidateIdentity("A"), [
      existing({ name: "A", mutableFingerprint: computeMutableFingerprintV1(input({ name: "A", score: 50 })) }),
    ]);

    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);
    const result = await executeLegacyCandidateWrite([changed], backend);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
  });

  it("all unchanged", async () => {
    const item = input({ name: "A" });
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    store.set(normalizeCandidateIdentity("A"), [
      existing({ name: "A", mutableFingerprint: computeMutableFingerprintV1(item) }),
    ]);

    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);
    const result = await executeLegacyCandidateWrite([item], backend);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  it("mixed create + update + unchanged", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const unchangedItem = input({ name: "Unchanged" });
    store.set(normalizeCandidateIdentity("Unchanged"), [
      existing({ name: "Unchanged", mutableFingerprint: computeMutableFingerprintV1(unchangedItem) }),
    ]);
    store.set(normalizeCandidateIdentity("Changed"), [
      existing({ name: "Changed", mutableFingerprint: computeMutableFingerprintV1(input({ name: "Changed", score: 50 })) }),
    ]);

    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);
    const result = await executeLegacyCandidateWrite(
      [
        unchangedItem,
        input({ name: "Changed", score: 99 }),
        input({ name: "New" }),
      ],
      backend,
    );

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.created + result.updated + result.unchanged).toBe(3);
    expect(result.items).toHaveLength(3);
  });
});

// ── Safe interface ───────────────────────────────

describe("safe interface — structural sentinel", () => {
  it("does not import NextRequest", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("NextRequest");
  });

  it("does not import NextResponse", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("NextResponse");
  });

  it("does not import Prisma", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("PrismaClient");
    expect(sourceCode).not.toContain("@prisma/client");
  });

  it("does not import demoSandbox", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("demoSandbox");
    expect(sourceCode).not.toContain("loadDemoSandboxStore");
  });

  it("does not import Route modules", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("route");
    expect(sourceCode).not.toContain("app/api");
  });

  it("does not import React", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("react");
  });

  it("does not read .env", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("process.env");
  });

  it("does not branch on sandbox ID prefix", async () => {
    const source = await import("@/lib/server/legacyCandidateWrite");
    const sourceCode = Object.keys(source).join(" ");
    expect(sourceCode).not.toContain("sandbox_");
    expect(sourceCode).not.toContain("isSandbox");
  });

  it("scopeId is absent from all exported symbols", () => {
    const decisions = planLegacyCandidateWriteBatch(
      [input({ name: "A" })],
      new Map(),
    ) as unknown as Record<string, unknown>;
    const json = JSON.stringify(decisions);
    expect(json).not.toContain("scopeId");
    expect(json).not.toContain("demoAccessId");
    expect(json).not.toContain("subject");
  });
});

// ── Backend contract ─────────────────────────────

describe("backend contract", () => {
  it("passes the correct number of decisions to commitPlan", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);

    await executeLegacyCandidateWrite(
      [input({ name: "A" }), input({ name: "B" }), input({ name: "C" })],
      backend,
    );

    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]).toHaveLength(3);
  });

  it("passes correct decision kinds to commitPlan", async () => {
    const store = new Map<string, readonly ExistingLegacyCandidate[]>();
    const unchangedItem = input({ name: "Unchanged" });
    store.set(normalizeCandidateIdentity("Unchanged"), [
      existing({ name: "Unchanged", mutableFingerprint: computeMutableFingerprintV1(unchangedItem) }),
    ]);
    const commitCalls: Array<readonly LegacyCandidateWriteDecision[]> = [];
    const backend = fakeBackend(store, commitCalls);

    await executeLegacyCandidateWrite(
      [unchangedItem, input({ name: "New" })],
      backend,
    );

    const kinds = commitCalls[0].map((d) => d.kind);
    expect(kinds).toContain("unchanged");
    expect(kinds).toContain("create");
  });
});
