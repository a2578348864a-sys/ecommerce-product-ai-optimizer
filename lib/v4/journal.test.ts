import { describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
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

  it("recorded (not committed) + same inputHash -> retry (crash recovery)", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    // status still "recorded" (crash before commit)
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(decision.kind).toBe("retry");
  });

  it("failed + same inputHash -> retry", async () => {
    const db = makeJournalDb();
    const journal = new SideEffectJournal(db);
    await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    await journal.fail({ runId: "r", idempotencyKey: "k" });
    const decision = await journal.resolve({ runId: "r", idempotencyKey: "k", inputHash: "h", action: "tool" });
    expect(decision.kind).toBe("retry");
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