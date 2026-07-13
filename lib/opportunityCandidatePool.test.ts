import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY,
  canCandidateEnterAgent,
  buildCandidateStatusUpdatePayload,
  filterCandidatePool,
  getDefaultCandidateStatus,
  getCandidateQueuePresentation,
  getCandidateSourceIntegrityPresentation,
  isAuthoritativeCandidateId,
  isLocalDraftCandidateId,
  isCandidateReadyForAgent,
  mergeCandidatesIntoPool,
  mergeServerCandidatesWithLocalDrafts,
  normalizeCandidate,
  parseCandidatePool,
  readCandidatePool,
  serverCandidateToPoolItem,
  serializeCandidatePool,
  sortCandidatePool,
  updateCandidateStatus,
  writeCandidatePool,
  type OpportunityCandidatePoolItem,
} from "@/lib/opportunityCandidatePool";
import type { R22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";

function r22Snapshot(marketDecision: R22MarketDecisionSnapshot["marketDecision"]): R22MarketDecisionSnapshot {
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId: "candidate-server-001",
    asin: "B000000001",
    briefId: "A",
    frozenRank: 1,
    marketDecision,
    decisionReasons: ["fixture_reason"],
    supportingEvidenceRefs: ["fixture:market"],
    opposingEvidenceRefs: [],
    marketMissingFields: [],
    dataCompleteness: 1,
    confidence: "high",
    stabilityStatus: "stable",
    ruleVersion: "r22-stage1-market-v1",
    inputHash: "a".repeat(64),
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

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
      identitySource: "local_draft",
      sourceIntegrity: "unverified",
      name: "桌面手机支架",
      rawInput: "phone stand",
      score: 100,
      candidateStatus: "worth_analyzing",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("retains only a safe canonical Task id from the authenticated server Candidate", () => {
    const base = {
      id: "candidate-server-001",
      name: "桌面手机支架",
      status: "analyzed",
      createdAt: "2026-07-12T01:00:00.000Z",
      updatedAt: "2026-07-12T02:00:00.000Z",
    };

    expect(serverCandidateToPoolItem({
      ...base,
      convertedTaskId: "task-owner_001",
    })).toMatchObject({
      id: "candidate-server-001",
      identitySource: "server",
      candidateStatus: "analyzed",
      convertedTaskId: "task-owner_001",
    });

    for (const convertedTaskId of [
      "",
      "../tasks/forged",
      "任务-001",
      "x".repeat(121),
    ]) {
      expect(serverCandidateToPoolItem({ ...base, convertedTaskId }).convertedTaskId).toBeNull();
    }
  });

  it("does not mistake the Array.map index for a timestamp fallback", () => {
    const mapped = [
      { id: "candidate-a", name: "A" },
      { id: "candidate-b", name: "B" },
    ].map(serverCandidateToPoolItem);

    expect(mapped[0].createdAt).toBeGreaterThan(1_000_000_000_000);
    expect(mapped[1].createdAt).toBeGreaterThan(1_000_000_000_000);
  });

  it("keeps source integrity separate from queue status and builds acknowledgement payloads", () => {
    expect(getCandidateSourceIntegrityPresentation("verified_public")).toMatchObject({
      label: "来源证据链已验证",
      verified: true,
    });
    expect(getCandidateSourceIntegrityPresentation("unverified")).toMatchObject({
      label: "来源未验证",
      verified: false,
    });

    const unverified = item("未验证商品", 70, 1000, "pending");
    expect(buildCandidateStatusUpdatePayload(unverified, "worth_analyzing")).toEqual({
      status: "worth_analyzing",
      sourceReviewAcknowledged: true,
    });
    expect(buildCandidateStatusUpdatePayload({ ...unverified, candidateStatus: "worth_analyzing" }, "analyzed"))
      .toEqual({ status: "analyzed" });
    expect(buildCandidateStatusUpdatePayload({ ...unverified, sourceIntegrity: "verified_public" }, "worth_analyzing"))
      .toEqual({ status: "worth_analyzing" });
  });

  it("distinguishes local draft ids from authoritative Candidate ids", () => {
    expect(isLocalDraftCandidateId("opp-local123")).toBe(true);
    expect(isAuthoritativeCandidateId("opp-local123")).toBe(false);
    expect(isAuthoritativeCandidateId("candidate-server-001")).toBe(true);
    expect(isAuthoritativeCandidateId("sandbox_candidate_001")).toBe(true);
    expect(isAuthoritativeCandidateId("")).toBe(false);
    expect(canCandidateEnterAgent({ id: "opp-local123", identitySource: "local_draft", candidateStatus: "worth_analyzing" }, true)).toBe(false);
    expect(canCandidateEnterAgent({ id: "candidate-server-001", identitySource: "server", candidateStatus: "worth_analyzing" }, false)).toBe(false);
    expect(canCandidateEnterAgent({ id: "candidate-server-001", identitySource: "server", candidateStatus: "worth_analyzing" }, true)).toBe(true);
  });

  it("derives the five human queue states without changing persisted Candidate statuses", () => {
    expect(getCandidateQueuePresentation("pending")).toMatchObject({ state: "pending_review", label: "待查看", nextAction: "选择为待分析" });
    expect(getCandidateQueuePresentation("paused")).toMatchObject({ state: "pending_review", label: "待查看" });
    expect(getCandidateQueuePresentation("worth_analyzing")).toMatchObject({ state: "pending_analysis", label: "待分析", nextAction: "开始分析" });
    expect(getCandidateQueuePresentation("analyzed")).toMatchObject({ state: "analyzing", label: "分析中", nextAction: "继续分析" });
    expect(getCandidateQueuePresentation("rejected")).toMatchObject({ state: "rejected", label: "已放弃", nextAction: "恢复为待查看" });
    expect(getCandidateQueuePresentation("analyzed", true)).toMatchObject({ state: "converted", label: "已转任务", nextAction: "查看关联任务" });
  });

  it("allows only ready authoritative Owner or Visitor Candidates without linked Tasks", () => {
    expect(isCandidateReadyForAgent("worth_analyzing")).toBe(true);
    expect(isCandidateReadyForAgent("analyzed")).toBe(true);
    expect(isCandidateReadyForAgent("pending")).toBe(false);
    expect(isCandidateReadyForAgent("paused")).toBe(false);
    expect(isCandidateReadyForAgent("rejected")).toBe(false);

    const ownerCandidate = { id: "candidate-owner-001", identitySource: "server" as const, candidateStatus: "worth_analyzing" as const };
    const visitorCandidate = { id: "sandbox_candidate_visitor-a", identitySource: "server" as const, candidateStatus: "analyzed" as const };
    expect(canCandidateEnterAgent(ownerCandidate, true)).toBe(true);
    expect(canCandidateEnterAgent(visitorCandidate, true)).toBe(true);
    expect(canCandidateEnterAgent(ownerCandidate, true, true)).toBe(false);
    expect(canCandidateEnterAgent({ ...ownerCandidate, candidateStatus: "rejected" }, true)).toBe(false);
  });

  it("uses only the server response R2.2 snapshot for entry and never restores it from localStorage", () => {
    const server = serverCandidateToPoolItem({
      id: "candidate-server-001",
      name: "Organizer",
      status: "worth_analyzing",
      r22MarketDecisionSnapshot: r22Snapshot("market_shortlisted"),
    });
    expect(server.r22MarketDecisionSnapshot?.marketDecision).toBe("market_shortlisted");
    expect(canCandidateEnterAgent(server, true)).toBe(true);
    expect(canCandidateEnterAgent({
      ...server,
      r22MarketDecisionSnapshot: r22Snapshot("market_reject"),
    }, true)).toBe(false);
    expect(canCandidateEnterAgent({
      ...server,
      r22MarketDecisionSnapshot: r22Snapshot("market_watch"),
    }, true)).toBe(false);
    expect(canCandidateEnterAgent({
      ...server,
      r22MarketDecisionSnapshot: r22Snapshot("market_watch"),
    }, true, false, true)).toBe(true);

    const raw = serializeCandidatePool([server], 1000);
    expect(raw).not.toContain("r22MarketDecisionSnapshot");
    expect(parseCandidatePool(raw, 1001).items[0]).not.toHaveProperty("r22MarketDecisionSnapshot");
  });

  it("keeps unmatched local drafts while preferring a matching server Candidate", () => {
    const localMatched = item("桌面手机支架", 70, 3000);
    const localOnly = item("本地未保存商品", 60, 2000);
    const serverMatched = {
      ...item("桌面手机支架", 88, 1000),
      id: "candidate-server-001",
      identitySource: "server" as const,
    };

    const merged = mergeServerCandidatesWithLocalDrafts([serverMatched], [localMatched, localOnly]);

    expect(merged).toHaveLength(2);
    expect(merged.find((candidate) => candidate.name === "桌面手机支架")).toMatchObject({
      id: "candidate-server-001",
      identitySource: "server",
      score: 88,
    });
    expect(merged.find((candidate) => candidate.name === "本地未保存商品")).toMatchObject({
      identitySource: "local_draft",
    });
  });

  it("infers identity source for historical stored items without the new field", () => {
    const local = item("本地商品", 70, 1000);
    const server = { ...item("服务端商品", 80, 1000), id: "candidate-server-001" };
    const raw = JSON.stringify({ version: 1, updatedAt: 1000, value: [
      Object.fromEntries(Object.entries(local).filter(([key]) => key !== "identitySource")),
      Object.fromEntries(Object.entries(server).filter(([key]) => key !== "identitySource")),
    ] });

    expect(parseCandidatePool(raw, 2000).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "本地商品", identitySource: "local_draft", sourceIntegrity: "unverified" }),
      expect.objectContaining({ name: "服务端商品", identitySource: "server", sourceIntegrity: "unverified" }),
    ]));
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

  it("preserves the canonical Task relation when a matching server Candidate is re-analyzed locally", () => {
    const existing = [{
      ...item("桌面手机支架", 70, 1000, "analyzed"),
      id: "candidate-server-linked",
      identitySource: "server" as const,
      convertedTaskId: "task-canonical-001",
    }];

    const merged = mergeCandidatesIntoPool(existing, [{
      name: "桌面手机支架",
      score: 90,
      riskLevel: "green",
      riskLabel: "低风险",
    }], 2000);

    expect(merged[0]).toMatchObject({
      id: "candidate-server-linked",
      identitySource: "server",
      convertedTaskId: "task-canonical-001",
    });
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

  it("does not trust or persist server Evidence review links in client-modifiable localStorage", () => {
    const candidate = {
      ...item("服务端商品", 80, 1000),
      id: "candidate-server-001",
      identitySource: "server" as const,
      sourceIntegrity: "verified_public" as const,
      sourceReview: {
        version: "candidate-evidence-review-v1" as const,
        integrity: "unverified" as const,
        reason: "legacy_or_invalid" as const,
        openUrl: "https://example.com/product",
      },
    };

    const stored = serializeCandidatePool([candidate], 1000);
    expect(stored).not.toContain("sourceReview");
    expect(stored).not.toContain("https://example.com/product");
    expect(parseCandidatePool(stored, 2000).items[0]).toMatchObject({
      sourceIntegrity: "unverified",
    });
    expect(parseCandidatePool(stored, 2000).items[0].sourceReview).toBeUndefined();
  });

  it("does not persist or restore a canonical Task relation from client-modifiable localStorage", () => {
    const candidate = {
      ...item("服务端已转任务商品", 80, 1000),
      id: "candidate-server-linked",
      identitySource: "server" as const,
      convertedTaskId: "task-canonical-001",
    };

    const stored = serializeCandidatePool([candidate], 1000);
    expect(JSON.parse(stored).value[0]).not.toHaveProperty("convertedTaskId");

    const forged = JSON.stringify({
      version: 1,
      updatedAt: 1000,
      value: [{ ...candidate, convertedTaskId: "task-forged" }],
    });
    expect(parseCandidatePool(forged, 2000).items[0].convertedTaskId).toBeUndefined();
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
