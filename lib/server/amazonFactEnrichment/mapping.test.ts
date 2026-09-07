import { describe, expect, it } from "vitest";
import { dedupeAmazonFactCandidates, mapSellerBlocksToCandidates } from "./mapping";
import type { AmazonFactCandidateV1 } from "./contract";

const makeCandidate = (overrides: Partial<AmazonFactCandidateV1> = {}): AmazonFactCandidateV1 => ({
  id: "candidate-1",
  taskId: "task-1",
  asin: "B0CKQNP26P",
  field: "use_scenario",
  value: "The two-size design keeps everyday essentials organized",
  status: "direct",
  sourceType: "bullet",
  sources: [{ sourceBlockId: "bullet:0", sourceUrl: "https://www.amazon.com/dp/B0CKQNP26P", section: "bullet", label: "bullet", text: "The two-size design keeps everyday essentials organized" }],
  evidenceTexts: ["The two-size design keeps everyday essentials organized"],
  approximate: false,
  negative: false,
  conflict: false,
  conflictReason: null,
  reviewRequired: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("Amazon deterministic candidate cleanup", () => {
  it("does not classify fits about 10 to 15 utensils as compatibility", () => {
    const candidates = mapSellerBlocksToCandidates({ taskId: "task-1", asin: "B0CKQNP26P", blocks: [{ sourceBlockId: "bullet:0", section: "bullet", label: "bullet", text: "This holder fits about 10 to 15 cooking utensils.", sourceUrl: "https://www.amazon.com/dp/B0CKQNP26P" }] });
    expect(candidates.some((candidate) => candidate.field === "capacity")).toBe(true);
    expect(candidates.some((candidate) => candidate.field === "compatibility")).toBe(false);
  });

  it("classifies compatible with model X as compatibility", () => {
    const candidates = mapSellerBlocksToCandidates({ taskId: "task-1", asin: "B0CKQNP26P", blocks: [{ sourceBlockId: "bullet:0", section: "bullet", label: "bullet", text: "Compatible with model X.", sourceUrl: "https://www.amazon.com/dp/B0CKQNP26P" }] });
    expect(candidates.some((candidate) => candidate.field === "compatibility")).toBe(true);
  });

  it("deduplicates exact value and evidence across fields while preserving provenance", () => {
    const first = makeCandidate({ field: "use_scenario" });
    const second = makeCandidate({ id: "candidate-2", field: "compatibility", sources: [{ ...first.sources[0], sourceBlockId: "aplus:0", section: "aplus" }], evidenceTexts: [first.evidenceTexts[0]] });
    const output = dedupeAmazonFactCandidates([first, second]);
    expect(output).toHaveLength(1);
    expect(output[0].sources.map((source) => source.sourceBlockId)).toEqual(expect.arrayContaining(["bullet:0", "aplus:0"]));
  });

  it("near-deduplicates same-field containment but keeps distinct values", () => {
    const short = makeCandidate({ value: "The two-size design keeps essentials organized" });
    const long = makeCandidate({ id: "candidate-2", value: "The two-size design keeps everyday essentials organized", sources: [{ ...short.sources[0], sourceBlockId: "aplus:0", section: "aplus", text: "The two-size design keeps everyday essentials organized" }], evidenceTexts: ["The two-size design keeps everyday essentials organized"] });
    const distinct = makeCandidate({ id: "candidate-3", value: "The two-size design stores large kitchen tools safely" });
    const output = dedupeAmazonFactCandidates([short, long, distinct]);
    expect(output).toHaveLength(2);
    expect(output.some((candidate) => candidate.value === long.value)).toBe(true);
    expect(output.some((candidate) => candidate.value === distinct.value)).toBe(true);
    expect(output[0].sources.map((source) => source.sourceBlockId)).toEqual(expect.arrayContaining(["bullet:0", "aplus:0"]));
  });
});
