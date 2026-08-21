import { describe, expect, it } from "vitest";
import { CandidateNotFoundError, DomainAdapter, type CandidateRow, type DomainDb } from "@/lib/v4/domain";
import { initialBudget } from "@/lib/v4/graph";

function makeDomainDb(candidate: CandidateRow | null): DomainDb {
  return {
    opportunityCandidate: {
      async findUnique(args) {
        return candidate && candidate.id === args.where.id ? candidate : null;
      },
    },
  };
}

const candidateRow: CandidateRow = {
  id: "c-1",
  name: "Mini LED Ring Light",
  rawInput: "amazon competitor data",
  link: "https://example.com/p",
  score: 82,
  source: "机会雷达",
  keyword: "ring light",
  riskLevel: "low",
  riskLabel: "",
  summaryLabel: "",
  status: "pending",
  analysisJson: JSON.stringify({ summary: "High demand, low competition", score: 82 }),
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

describe("DomainAdapter (read-only load_context)", () => {
  it("loadContext builds a context snapshot from the candidate", async () => {
    const adapter = new DomainAdapter(makeDomainDb(candidateRow));
    const ctx = await adapter.loadContext({ candidateId: "c-1" });
    expect(ctx.candidateId).toBe("c-1");
    expect(ctx.candidate.name).toBe("Mini LED Ring Light");
    expect(ctx.candidate.source).toBe("机会雷达");
    expect(ctx.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.evidence.length).toBeGreaterThan(0);
    // deterministic
    const ctx2 = await adapter.loadContext({ candidateId: "c-1" });
    expect(ctx2.contextHash).toBe(ctx.contextHash);
  });

  it("loadContext throws CandidateNotFoundError for missing candidate", async () => {
    const adapter = new DomainAdapter(makeDomainDb(null));
    await expect(adapter.loadContext({ candidateId: "missing" })).rejects.toBeInstanceOf(CandidateNotFoundError);
  });

  it("validateIdentity confirms when name + source present", async () => {
    const adapter = new DomainAdapter(makeDomainDb(candidateRow));
    const ctx = await adapter.loadContext({ candidateId: "c-1" });
    const result = await adapter.validateIdentity({ candidate: ctx.candidate });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("confirmed");
  });

  it("validateIdentity is ambiguous when name/source missing", async () => {
    const adapter = new DomainAdapter(makeDomainDb({ ...candidateRow, name: "", source: "" }));
    const ctx = await adapter.loadContext({ candidateId: "c-1" });
    const result = await adapter.validateIdentity({ candidate: ctx.candidate });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("ambiguous");
  });

  it("revalidateBudget fails closed when used exceeds max", async () => {
    const adapter = new DomainAdapter(makeDomainDb(candidateRow));
    const budget = initialBudget();
    const ok = await adapter.revalidateBudget({ budget });
    expect(ok.ok).toBe(true);
    const over = await adapter.revalidateBudget({
      budget: { ...budget, usedBrowserSteps: budget.maxBrowserSteps + 1 },
    });
    expect(over.ok).toBe(false);
    expect(over.reason).toMatch(/budget/);
  });
});
