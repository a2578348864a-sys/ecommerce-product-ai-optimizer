import { describe, expect, it } from "vitest";
import { FakeToolRegistry, fakeResultFor } from "@/lib/v4/fakeTools";
import { computeInputHash } from "@/lib/v4/journal";

describe("FakeToolRegistry (deterministic, zero network)", () => {
  const tools = new FakeToolRegistry();

  it("plan is deterministic for the same input", () => {
    const a = tools.plan({ contextHash: "ctx-1", budgetInputHash: "0" });
    const b = tools.plan({ contextHash: "ctx-1", budgetInputHash: "0" });
    expect(a).toEqual(b);
    expect(a.questions.length).toBeGreaterThanOrEqual(2);
    expect(a.questions.length).toBeLessThanOrEqual(4);
    expect(a.questions.every((q) => q.questionId && q.toolName && q.inputHash)).toBe(true);
  });

  it("plan differs when context changes", () => {
    const a = tools.plan({ contextHash: "ctx-1", budgetInputHash: "0" });
    const b = tools.plan({ contextHash: "ctx-2", budgetInputHash: "0" });
    expect(a.questions).not.toEqual(b.questions);
  });

  it("tool result is deterministic and keyed by inputHash", () => {
    const input = { toolName: "keyword_research", questionId: "q-1", inputHash: "abc123" };
    const a = tools.tool(input);
    const b = tools.tool(input);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(a.outputHash).toMatch(/^[0-9a-f]{64}$/);
    // fakeResultFor is a deterministic convenience table (different key than tool()).
    expect(fakeResultFor("keyword_research", "abc123")).toMatch(/^(alpha|beta|gamma|delta|epsilon)$/);
  });

  it("tool with different inputHash yields different outputHash", () => {
    const a = tools.tool({ toolName: "keyword_research", questionId: "q-1", inputHash: "aaa" });
    const b = tools.tool({ toolName: "keyword_research", questionId: "q-1", inputHash: "bbb" });
    expect(a.outputHash).not.toBe(b.outputHash);
  });

  it("validate accepts ok results and rejects failures", () => {
    const ok = tools.validate({ toolResult: { toolName: "x", outputHash: "h", payload: {}, ok: true }, questionId: "q" });
    expect(ok.valid).toBe(true);
    const bad = tools.validate({ toolResult: { toolName: "x", outputHash: "h", payload: {}, ok: false }, questionId: "q" });
    expect(bad.valid).toBe(false);
  });

  it("evidence derives deterministic evidenceId from outputHash", () => {
    const ev = tools.evidence({ toolResult: { toolName: "keyword_research", outputHash: "h1", payload: { summary: "s", inputHash: "in-1" }, ok: true }, questionId: "q-1" });
    expect(ev.evidenceId).toMatch(/^ev-/);
    expect(ev.questionId).toBe("q-1");
    expect(ev.inputHash).toBe("in-1");
  });

  it("merge deduplicates by evidenceId", () => {
    const ev = { evidenceId: "ev-1", questionId: "q-1", sourceType: "t", summary: "s", inputHash: "h" };
    const { mergedEvidence } = tools.merge({ evidence: [ev, ev, { ...ev, evidenceId: "ev-2" }] });
    expect(mergedEvidence.length).toBe(2);
  });

  it("conflicts is deterministic and empty for normal evidence", () => {
    const { conflicts } = tools.conflicts({ evidence: [{ evidenceId: "ev-1", questionId: "q-1", sourceType: "t", summary: "normal", inputHash: "h" }] });
    expect(conflicts).toEqual([]);
  });

  it("conflicts detects duplicate summaries with conflict-marker", () => {
    const ev = (id: string) => ({ evidenceId: id, questionId: "q", sourceType: "t", summary: "conflict-marker", inputHash: id });
    const { conflicts } = tools.conflicts({ evidence: [ev("a"), ev("b")] });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].involvedEvidenceIds).toEqual(["a", "b"]);
  });

  it("feasibility is deterministic", () => {
    const a = tools.feasibility({ facts: { x: 1 }, budgetInputHash: "0" });
    const b = tools.feasibility({ facts: { x: 1 }, budgetInputHash: "0" });
    expect(a).toEqual(b);
    expect(a.margin).toBeGreaterThanOrEqual(1);
    expect(a.currency).toBe("USD");
  });

  it("content is deterministic", () => {
    const a = tools.content({ handoff: { factRevision: 1, policyPackVersion: "policy.v1" } });
    const b = tools.content({ handoff: { factRevision: 1, policyPackVersion: "policy.v1" } });
    expect(a).toEqual(b);
    expect(a.listingTitle).toContain("facts rev 1");
  });

  it("computeInputHash is stable and content-sensitive", () => {
    expect(computeInputHash({ a: 1, b: [2, 3] })).toBe(computeInputHash({ b: [2, 3], a: 1 }));
    expect(computeInputHash({ a: 1 })).not.toBe(computeInputHash({ a: 2 }));
  });
});