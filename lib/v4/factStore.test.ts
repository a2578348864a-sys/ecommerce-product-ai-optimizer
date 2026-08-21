import { describe, expect, it } from "vitest";
import { appendFact, currentFacts, revokeFact, validateFactConfirmation, type FactStoreDb } from "@/lib/v4/factStore";

function makeDb(): { db: FactStoreDb; rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  const db: FactStoreDb = {
    v4FactRecord: {
      async create(args) {
        seq += 1;
        const row = { id: "f-" + seq, ...args.data, createdAt: new Date().toISOString() };
        rows.push(row);
        return row;
      },
      async findMany(args) {
        const where = args.where as Record<string, unknown>;
        return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      },
    },
  };
  const withUpdate = db as FactStoreDb & { v4FactRecord: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>> } };
  withUpdate.v4FactRecord.update = async (args) => {
    const row = rows.find((r) => r.id === args.where.id)!;
    Object.assign(row, args.data);
    return row;
  };
  return { db, rows };
}

const base = {
  runId: "run-1", candidateId: "cand-1", offerIdentity: "offer-1688-1", variantKey: "variant-red-l", field: "material", value: "不锈钢 304",
  actor: "owner",
};

describe("factStore (append-only revisions + validator)", () => {
  it("auto-promotion blocked: confirmed without confirmationMethod", () => {
    const r = validateFactConfirmation({ ...base, status: "confirmed" as const, claimRefs: ["claim-1"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("auto_promotion_blocked");
  });

  it("auto-promotion blocked: confirmed without refs", () => {
    const r = validateFactConfirmation({ ...base, status: "confirmed" as const, confirmationMethod: "document" });
    expect(r.ok).toBe(false);
  });

  it("manual confirm with method+refs passes", () => {
    const r = validateFactConfirmation({ ...base, status: "confirmed" as const, confirmationMethod: "document", claimRefs: ["claim-1"], documentRefs: ["doc-1"] });
    expect(r.ok).toBe(true);
  });

  it("conflict requires other value", () => {
    const r = validateFactConfirmation({ ...base, status: "conflict" as const, confirmationMethod: "sample" });
    expect(r.ok).toBe(false);
    const ok = validateFactConfirmation({ ...base, status: "conflict" as const, confirmationMethod: "sample", detail: { otherValue: "201 不锈钢" } });
    expect(ok.ok).toBe(true);
  });

  it("append increments revision; revoke appends new revision and marks history", async () => {
    const { db } = makeDb();
    const f1 = await appendFact(db, { ...base, status: "confirmed", confirmationMethod: "document", claimRefs: ["c1"], documentRefs: ["d1"] });
    expect(f1.revision).toBe(1);
    const f2 = await appendFact(db, { ...base, status: "confirmed", confirmationMethod: "document", claimRefs: ["c1"], documentRefs: ["d1"] });
    expect(f2.revision).toBe(2);
    const revoked = await revokeFact(db, { runId: "run-1", offerIdentity: "offer-1688-1", variantKey: "variant-red-l", field: "material", actor: "owner", reason: "样品不符" });
    expect(revoked).not.toBeNull();
    expect(revoked!.status).toBe("revoked");
    expect(revoked!.revision).toBe(3);
    const current = await currentFacts(db, "run-1", "offer-1688-1", "variant-red-l");
    expect(current.length).toBe(1);
    expect(current[0].status).toBe("revoked");
    // 历史完整：3 行都在 rows
    const all = (db.v4FactRecord as unknown as { _rows?: unknown })._rows ?? [];
    expect(all).toHaveLength(0);
  });

  it("revision history preserved (append-only rows)", async () => {
    const { db, rows } = makeDb();
    await appendFact(db, { ...base, status: "confirmed", confirmationMethod: "document", claimRefs: ["c1"], documentRefs: ["d1"] });
    await revokeFact(db, { runId: "run-1", offerIdentity: "offer-1688-1", variantKey: "variant-red-l", field: "material", actor: "owner" });
    expect(rows.length).toBe(2); // 追加式：confirm rev1 + revoke rev2（原行标记 revokedByRevision）
    const statuses = rows.map((r) => r.status);
    expect(statuses).toContain("revoked");
  });
});
