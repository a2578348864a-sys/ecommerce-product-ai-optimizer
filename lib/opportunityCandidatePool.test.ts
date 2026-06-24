import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY,
  filterCandidatePool,
  getDefaultCandidateStatus,
  mergeCandidatesIntoPool,
  normalizeCandidate,
  parseCandidatePool,
  readCandidatePool,
  serializeCandidatePool,
  sortCandidatePool,
  updateCandidateStatus,
  writeCandidatePool,
  type OpportunityCandidatePoolItem,
} from "@/lib/opportunityCandidatePool";

function item(name: string, score: number, updatedAt: number, candidateStatus: OpportunityCandidatePoolItem["candidateStatus"] = "pending") {
  const normalized = normalizeCandidate({
    name,
    rawInput: name,
    score,
    riskLevel: "green",
    riskLabel: "低风险",
    summaryLabel: `${name} 摘要`,
  }, updatedAt);
  if (!normalized) throw new Error("missing candidate");
  return { ...normalized, candidateStatus };
}

describe("opportunity candidate pool", () => {
  it("assigns default status from score and risk", () => {
    expect(getDefaultCandidateStatus({ score: 86, riskLevel: "green" })).toBe("worth_analyzing");
    expect(getDefaultCandidateStatus({ score: 86, riskLevel: "red" })).toBe("paused");
    expect(getDefaultCandidateStatus({ score: 66, riskLevel: "yellow" })).toBe("pending");
  });

  it("normalizes candidates and drops invalid names", () => {
    expect(normalizeCandidate({ name: "" })).toBeNull();
    expect(normalizeCandidate({
      name: "桌面手机支架",
      rawInput: "phone stand",
      score: 101,
      source: "机会雷达",
      keyword: "phone stand",
      riskLevel: "green",
      riskLabel: "低风险",
      summaryLabel: "可以继续小单测试",
    }, 1000)).toMatchObject({
      name: "桌面手机支架",
      rawInput: "phone stand",
      score: 100,
      candidateStatus: "worth_analyzing",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("merges by same name and preserves manual status", () => {
    const existing = [item("桌面手机支架", 60, 1000, "rejected")];
    const merged = mergeCandidatesIntoPool(existing, [
      { name: "桌面手机支架", rawInput: "new input", score: 88, riskLevel: "green", riskLabel: "低风险" },
      { name: "宠物慢食碗", score: 40, riskLevel: "red", riskLabel: "高风险" },
    ], 2000);

    expect(merged).toHaveLength(2);
    expect(merged.find((candidate) => candidate.name === "桌面手机支架")).toMatchObject({
      score: 88,
      rawInput: "new input",
      candidateStatus: "rejected",
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(merged.find((candidate) => candidate.name === "宠物慢食碗")?.candidateStatus).toBe("paused");
  });

  it("updates status with action timestamp", () => {
    const candidate = item("桌面手机支架", 80, 1000);
    const updated = updateCandidateStatus([candidate], candidate.id, "analyzed", 3000);
    expect(updated[0]).toMatchObject({
      candidateStatus: "analyzed",
      updatedAt: 3000,
      lastActionAt: 3000,
    });
  });

  it("filters and sorts candidates", () => {
    const candidates = [
      item("A", 60, 1000, "pending"),
      item("B", 90, 900, "worth_analyzing"),
      item("C", 70, 2000, "paused"),
    ];

    expect(filterCandidatePool(candidates, "worth_analyzing").map((candidate) => candidate.name)).toEqual(["B"]);
    expect(sortCandidatePool(candidates, "score").map((candidate) => candidate.name)).toEqual(["B", "C", "A"]);
    expect(sortCandidatePool(candidates, "updated").map((candidate) => candidate.name)).toEqual(["C", "A", "B"]);
  });

  it("parses storage safely and clears invalid or expired payloads", () => {
    const stored = serializeCandidatePool([item("桌面手机支架", 80, 1000)], 1000);
    expect(parseCandidatePool(stored, 2000).items).toHaveLength(1);
    expect(parseCandidatePool("{bad json", 2000)).toEqual({ items: [], shouldClear: true });
    expect(parseCandidatePool(stored, 1000 + 8 * 24 * 60 * 60 * 1000).shouldClear).toBe(true);
  });

  it("reads and writes with a storage-like object", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };

    writeCandidatePool(storage, [item("桌面手机支架", 80, 1000)], 1000);
    expect(store.has(OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY)).toBe(true);
    expect(readCandidatePool(storage, 2000).map((candidate) => candidate.name)).toEqual(["桌面手机支架"]);

    store.set(OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY, "bad");
    expect(readCandidatePool(storage, 2000)).toEqual([]);
    expect(store.has(OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY)).toBe(false);
  });
});
