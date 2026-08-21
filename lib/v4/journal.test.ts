import { describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  IdempotencyPendingError,
  SideEffectJournal,
  buildIdempotencyKey,
  computeInputHash,
  sha256,
  stableStringify,
  type JournalDb,
  type JournalEntry,
} from "@/lib/v4/journal";

/** In-memory JournalDb that enforces UNIQUE(runId, idempotencyKey). */
function makeJournalDb(): JournalDb & { entries: Map<string, JournalEntry> } {
  const entries = new Map<string, JournalEntry>();
  let seq = 0;
  const delegate = {
    async findFirst(args: { where: { runId: string; idempotencyKey: string } }) {
      const entry = entries.get(`${args.where.runId}|${args.where.idempotencyKey}`);
      return entry ? { ...entry } : null;
    },
    async create(args: { data: { runId: string; idempotencyKey: string; inputHash: string; action: string; status: JournalEntry["status"]; detailJson?: string } }) {
      const key = `${args.data.runId}|${args.data.idempotencyKey}`;
      if (entries.has(key)) {
        // Simulate SQLite UNIQUE violation.
        throw new Error("UNIQUE constraint failed: V4SideEffectJournal.runId, V4SideEffectJournal.idempotencyKey");
      }
      seq += 1;
      const entry: JournalEntry = {
        id: `j-${seq}`,
        runId: args.data.runId,
        idempotencyKey: args.data.idempotencyKey,
        inputHash: args.data.inputHash,
        action: args.data.action,
        status: args.data.status,
        detailJson: args.data.detailJson ?? "{}",
        createdAt: new Date().toISOString(),
      };
      entries.set(key, entry);
      return { ...entry };
    },
    async updateMany(args: { where: { runId: string; idempotencyKey: string }; data: { status: JournalEntry["status"]; detailJson?: string } }) {
      const key = `${args.where.runId}|${args.where.idempotencyKey}`;
      const entry = entries.get(key);
      if (!entry) return { count: 0 };
      entry.status = args.data.status;
      if (args.data.detailJson !== undefined) entry.detailJson = args.data.detailJson;
      entries.set(key, entry);
      return { count: 1 };
    },
  };
  return { entries, v4SideEffectJournal: delegate } as JournalDb & { entries: Map<string, JournalEntry> };
}

describe("SideEffectJournal (V4SideEffectJournal semantics)", () => {
  it("idempotencyKey = sha256(runId + questionId + toolName + inputHash)", () => {
    const key = buildIdempotencyKey({ runId: "r", questionId: "q", toolName: "t", inputHash: "h" });
    expect(key).toBe(sha256("r|q|t|h"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("first resolve records and returns apply", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(decision.kind).toBe("apply");
    expect(decision.entry?.status).toBe("recorded");
    expect(db.entries.size).toBe(1);
  });

  it("same key + same inputHash after commit -> skip (skipped_duplicate, no replay)", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    await journal.commit({ runId: "r", idempotencyKey: "k" });
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(decision.kind).toBe("skip");
    expect(decision.entry?.status).toBe("skipped_duplicate");
  });

  it("same key + different inputHash -> conflict", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h1", action: "tool" });
    await journal.commit({ runId: "r", idempotencyKey: "k" });
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h2", action: "tool" });
    expect(decision.kind).toBe("conflict");
    expect(decision.entry?.inputHash).toBe("h1");
  });

  it("recorded (dangling) does NOT auto-replay -> pending; explicit retry -> retry", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    // status still "recorded" (crash before commit): must NOT auto-replay
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(decision.kind).toBe("pending");
    // explicit retry (resume kind=retry -> explicitRetry=true) allows re-execution
    await journal.retry("r", "k");
    const retried = await journal.resolve(
      { runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" },
      { explicitRetry: true },
    );
    expect(retried.kind).toBe("retry");
  });

  it("failed + same inputHash -> pending (no auto-replay); explicit retry -> retry", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    await journal.fail({ runId: "r", idempotencyKey: "k" });
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(decision.kind).toBe("pending");
    await journal.retry("r", "k");
    const retried = await journal.resolve(
      { runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" },
      { explicitRetry: true },
    );
    expect(retried.kind).toBe("retry");
  });

  it("commit/fail transition status", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    await journal.commit({ runId: "r", idempotencyKey: "k" });
    expect(db.entries.get("r|k")?.status).toBe("committed");
    await journal.fail({ runId: "r", idempotencyKey: "k2" });
  });

  it("UNIQUE(runId, idempotencyKey): duplicate create is rejected (in-memory)", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    await expect(
      db.v4SideEffectJournal.create({ data: { runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool", status: "recorded" } }),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("stableStringify is key-order independent; computeInputHash content-sensitive", () => {
    expect(stableStringify({ a: 1, b: { c: 2 } })).toBe(stableStringify({ b: { c: 2 }, a: 1 }));
    expect(computeInputHash({ x: 1 })).toBe(computeInputHash({ x: 1 }));
    expect(computeInputHash({ x: 1 })).not.toBe(computeInputHash({ x: 2 }));
  });
});

describe("Journal API contract (ensureCommitted / markFailed)", () => {
  it("ensureCommitted commits the first time and returns committed", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    const result = await journal.ensureCommitted("r", { idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(result.status).toBe("committed");
    expect(db.entries.get("r|k")?.status).toBe("committed");
  });

  it("ensureCommitted returns skipped_duplicate on re-call (no replay)", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.ensureCommitted("r", { idempotencyKey: "k", inputHash: "h", action: "tool" });
    const second = await journal.ensureCommitted("r", { idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(second.status).toBe("skipped_duplicate");
    // Still exactly one committed side-effect; the re-call did not re-apply.
    expect(db.entries.get("r|k")?.status).toBe("skipped_duplicate");
  });

  it("ensureCommitted throws conflict on different inputHash", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.ensureCommitted("r", { idempotencyKey: "k", inputHash: "h1", action: "tool" });
    await expect(
      journal.ensureCommitted("r", { idempotencyKey: "k", inputHash: "h2", action: "tool" }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("markFailed -> ensureCommitted throws pending; after retry -> committed", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    await journal.markFailed("r", { idempotencyKey: "k" });
    expect(db.entries.get("r|k")?.status).toBe("failed");
    // dangling failed: no auto-replay
    await expect(
      journal.ensureCommitted("r", { idempotencyKey: "k", inputHash: "h", action: "tool" }),
    ).rejects.toBeInstanceOf(IdempotencyPendingError);
    // explicit retry -> re-execute via resolve(explicitRetry) then commit
    await journal.retry("r", "k");
    const retryDecision = await journal.resolve(
      { runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" },
      { explicitRetry: true },
    );
    expect(retryDecision.kind).toBe("retry");
    await journal.commit({ runId: "r", idempotencyKey: "k" });
    expect(db.entries.get("r|k")?.status).toBe("committed");
  });
});

describe("P1-C: canonical JSON inputHash (§7.2)", () => {
  it("inputHash is key-order independent (canonical JSON)", () => {
    const a = computeInputHash({ z: 1, a: { y: 2, x: 3 } });
    const b = computeInputHash({ a: { x: 3, y: 2 }, z: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different values still yield different inputHash", () => {
    expect(computeInputHash({ a: 1 })).not.toBe(computeInputHash({ a: 2 }));
    expect(computeInputHash({ a: [1, 2] })).not.toBe(computeInputHash({ a: [2, 1] }));
  });

  it("idempotencyKey derives from canonical inputHash", () => {
    const keyA = buildIdempotencyKey({ runId: "r", questionId: "q", toolName: "t", inputHash: computeInputHash({ a: 1, b: 2 }) });
    const keyB = buildIdempotencyKey({ runId: "r", questionId: "q", toolName: "t", inputHash: computeInputHash({ b: 2, a: 1 }) });
    expect(keyA).toBe(keyB);
  });
});
