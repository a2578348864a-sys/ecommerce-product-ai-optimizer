import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY,
  buildCandidatePoolCounts,
  buildVisibleCandidatePoolItems,
  canCandidateEnterAgent,
  buildCandidateStatusUpdatePayload,
  filterCandidatePool,
  getDefaultCandidateStatus,
  getCandidateQueuePresentation,
  getCandidateStatusToneClass,
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
  type CandidateStatus,
  type CandidateQueueState,
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
  describe("buildCandidatePoolCounts", () => {
    const emptyCounts = {
      all: 0,
      pending: 0,
      worth_analyzing: 0,
      analyzed: 0,
      paused: 0,
      rejected: 0,
    };

    it.each([
      ["empty", [], emptyCounts],
      ["pending", [item("pending", 60, 1000, "pending")], { ...emptyCounts, all: 1, pending: 1 }],
      ["worth_analyzing", [item("worth", 80, 1000, "worth_analyzing")], { ...emptyCounts, all: 1, worth_analyzing: 1 }],
      ["analyzed", [item("analyzed", 80, 1000, "analyzed")], { ...emptyCounts, all: 1, analyzed: 1 }],
      ["paused", [item("paused", 60, 1000, "paused")], { ...emptyCounts, all: 1, paused: 1 }],
      ["rejected", [item("rejected", 40, 1000, "rejected")], { ...emptyCounts, all: 1, rejected: 1 }],
    ] as const)("counts the %s contract exactly", (_name, candidates, expected) => {
      expect(buildCandidatePoolCounts(candidates)).toEqual(expected);
    });

    it("counts mixed and duplicate statuses by array element", () => {
      const candidates = [
        item("pending-1", 60, 1000, "pending"),
        item("pending-2", 61, 1001, "pending"),
        item("worth", 80, 1002, "worth_analyzing"),
        item("analyzed", 80, 1003, "analyzed"),
        item("paused", 60, 1004, "paused"),
        item("rejected", 40, 1005, "rejected"),
      ];

      expect(buildCandidatePoolCounts(candidates)).toEqual({
        all: 6,
        pending: 2,
        worth_analyzing: 1,
        analyzed: 1,
        paused: 1,
        rejected: 1,
      });
    });

    it("keeps converted analyzed Candidates in all but out of analyzed", () => {
      const analyzing = item("analyzing", 80, 1000, "analyzed");
      const converted = {
        ...item("converted", 80, 1001, "analyzed"),
        convertedTaskId: "task-001",
      };

      expect(buildCandidatePoolCounts([analyzing, converted])).toEqual({
        ...emptyCounts,
        all: 2,
        analyzed: 1,
      });
    });

    it("preserves direct unknown and normalized unknown status behavior", () => {
      const directUnknown = {
        ...item("unknown", 60, 1000),
        candidateStatus: "unknown_status" as CandidateStatus,
      };
      const normalizedUnknown = serverCandidateToPoolItem({
        id: "candidate-unknown",
        name: "normalized unknown",
        status: "unknown_status",
      });

      expect(buildCandidatePoolCounts([directUnknown])).toEqual({
        ...emptyCounts,
        all: 1,
      });
      expect(normalizedUnknown.candidateStatus).toBe("pending");
      expect(buildCandidatePoolCounts([normalizedUnknown])).toEqual({
        ...emptyCounts,
        all: 1,
        pending: 1,
      });
    });

    it("is order-independent and deterministic with complete output fields", () => {
      const candidates = [
        item("pending", 60, 1000, "pending"),
        item("worth", 80, 1001, "worth_analyzing"),
        item("rejected", 40, 1002, "rejected"),
      ];
      const first = buildCandidatePoolCounts(candidates);
      const second = buildCandidatePoolCounts([...candidates].reverse());

      expect(first).toEqual(second);
      expect(buildCandidatePoolCounts(candidates)).toEqual(first);
      expect(Object.keys(first).sort()).toEqual([
        "all",
        "analyzed",
        "paused",
        "pending",
        "rejected",
        "worth_analyzing",
      ]);
    });

    it("accepts frozen readonly input without changing the array or Candidate objects", () => {
      const first = Object.freeze(item("pending", 60, 1000, "pending"));
      const second = Object.freeze(item("analyzed", 80, 1001, "analyzed"));
      const candidates: readonly OpportunityCandidatePoolItem[] = Object.freeze([first, second]);
      const before = JSON.stringify(candidates);

      expect(buildCandidatePoolCounts(candidates)).toEqual({
        ...emptyCounts,
        all: 2,
        pending: 1,
        analyzed: 1,
      });
      expect(JSON.stringify(candidates)).toBe(before);
      expect(candidates[0]).toBe(first);
      expect(candidates[1]).toBe(second);
    });

    it("matches the former inline filter-based calculation across representative samples", () => {
      const inlineCounts = (candidates: OpportunityCandidatePoolItem[]) => ({
        all: candidates.length,
        pending: filterCandidatePool(candidates, "pending").length,
        worth_analyzing: filterCandidatePool(candidates, "worth_analyzing").length,
        analyzed: filterCandidatePool(candidates, "analyzed").length,
        paused: filterCandidatePool(candidates, "paused").length,
        rejected: filterCandidatePool(candidates, "rejected").length,
      });
      const directUnknown = {
        ...item("unknown", 60, 1000),
        candidateStatus: "unknown_status" as CandidateStatus,
      };
      const samples = [
        [],
        [item("pending", 60, 1000, "pending")],
        [
          item("pending", 60, 1000, "pending"),
          item("worth", 80, 1001, "worth_analyzing"),
          item("analyzed", 80, 1002, "analyzed"),
          { ...item("converted", 80, 1003, "analyzed"), convertedTaskId: "task-001" },
          item("paused", 60, 1004, "paused"),
          item("rejected", 40, 1005, "rejected"),
          directUnknown,
        ],
      ];

      for (const candidates of samples) {
        expect(buildCandidatePoolCounts(candidates)).toEqual(inlineCounts(candidates));
      }
    });
  });

  describe("buildVisibleCandidatePoolItems", () => {
    const pool = [
      item("pending-b", 70, 1_000, "pending"),
      item("worth-high", 95, 500, "worth_analyzing"),
      { ...item("converted", 85, 800, "analyzed"), convertedTaskId: "task-001" },
      item("pending-a", 70, 1_000, "pending"),
      item("analyzed", 90, 900, "analyzed"),
      item("paused", 80, 1_100, "paused"),
      item("rejected", 60, 1_200, "rejected"),
      {
        ...item("unknown", 100, 1_300),
        candidateStatus: "unknown_status" as CandidateStatus,
      },
      item("worth-low", 50, 1_400, "worth_analyzing"),
    ];

    const names = (candidates: readonly OpportunityCandidatePoolItem[]) => (
      candidates.map((candidate) => candidate.name)
    );
    const ids = (candidates: readonly OpportunityCandidatePoolItem[]) => (
      candidates.map((candidate) => candidate.id)
    );
    const edgeItem = (
      id: string,
      name: string,
      score: number,
      updatedAt: number,
    ): OpportunityCandidatePoolItem => ({
      ...item(name, 0, 0),
      id,
      score,
      updatedAt,
    });

    it.each([
      ["all", ["worth-low", "unknown", "rejected", "paused", "pending-a", "pending-b", "analyzed", "converted", "worth-high"]],
      ["pending", ["pending-a", "pending-b"]],
      ["worth_analyzing", ["worth-low", "worth-high"]],
      ["analyzed", ["analyzed"]],
      ["paused", ["paused"]],
      ["rejected", ["rejected"]],
    ] as const)("filters %s before applying the updated sort", (filter, expected) => {
      expect(names(buildVisibleCandidatePoolItems(pool, filter, "updated"))).toEqual(expected);
    });

    it.each([
      ["updated", ["worth-low", "unknown", "rejected", "paused", "pending-a", "pending-b", "analyzed", "converted", "worth-high"]],
      ["score", ["unknown", "worth-high", "analyzed", "converted", "paused", "pending-a", "pending-b", "rejected", "worth-low"]],
    ] as const)("preserves the %s sort direction and tie-breakers", (sort, expected) => {
      expect(names(buildVisibleCandidatePoolItems(pool, "all", sort))).toEqual(expected);
    });

    it.each([
      ["worth_analyzing", "updated", ["worth-low", "worth-high"]],
      ["worth_analyzing", "score", ["worth-high", "worth-low"]],
      ["pending", "updated", ["pending-a", "pending-b"]],
      ["pending", "score", ["pending-a", "pending-b"]],
      ["analyzed", "score", ["analyzed"]],
    ] as const)("preserves the %s + %s combination", (filter, sort, expected) => {
      expect(names(buildVisibleCandidatePoolItems(pool, filter, sort))).toEqual(expected);
    });

    it("keeps direct unknown and converted Candidate behavior unchanged", () => {
      expect(names(buildVisibleCandidatePoolItems(pool, "all", "score"))).toContain("unknown");
      expect(names(buildVisibleCandidatePoolItems(pool, "all", "score"))).toContain("converted");

      for (const filter of ["pending", "worth_analyzing", "analyzed", "paused", "rejected"] as const) {
        const filtered = names(buildVisibleCandidatePoolItems(pool, filter, "updated"));
        expect(filtered).not.toContain("unknown");
        expect(filtered).not.toContain("converted");
      }
    });

    it.each([
      {
        name: "updated ranks positive and negative Infinity as extremes before score",
        sort: "updated",
        candidates: [
          edgeItem("updated-finite", "Updated finite", 1_000, 100),
          edgeItem("updated-negative-infinity", "Updated negative infinity", 2_000, Number.NEGATIVE_INFINITY),
          edgeItem("updated-positive-infinity", "Updated positive infinity", -100, Number.POSITIVE_INFINITY),
        ],
        expectedIds: ["updated-positive-infinity", "updated-finite", "updated-negative-infinity"],
      },
      {
        name: "updated falls back from undefined and NaN to score",
        sort: "updated",
        candidates: [
          edgeItem("updated-finite", "Updated finite", 60, 100),
          {
            ...edgeItem("updated-undefined", "Updated undefined", 70, 0),
            updatedAt: undefined as unknown as number,
          },
          {
            ...edgeItem("updated-nan", "Updated NaN", 80, 0),
            updatedAt: Number.NaN,
          },
        ],
        expectedIds: ["updated-nan", "updated-undefined", "updated-finite"],
      },
      {
        name: "updated falls back from equal positive Infinity to score and name",
        sort: "updated",
        candidates: [
          edgeItem("updated-infinity-high-b", "Edge B", 20, Number.POSITIVE_INFINITY),
          edgeItem("updated-infinity-low", "Edge Low", 10, Number.POSITIVE_INFINITY),
          edgeItem("updated-infinity-high-a", "Edge A", 20, Number.POSITIVE_INFINITY),
        ],
        expectedIds: ["updated-infinity-high-a", "updated-infinity-high-b", "updated-infinity-low"],
      },
      {
        name: "score ranks positive and negative Infinity as extremes before updatedAt",
        sort: "score",
        candidates: [
          edgeItem("score-finite", "Score finite", 100, 1_000),
          edgeItem("score-negative-infinity", "Score negative infinity", Number.NEGATIVE_INFINITY, 2_000),
          edgeItem("score-positive-infinity", "Score positive infinity", Number.POSITIVE_INFINITY, -100),
        ],
        expectedIds: ["score-positive-infinity", "score-finite", "score-negative-infinity"],
      },
      {
        name: "score falls back from undefined and NaN to updatedAt",
        sort: "score",
        candidates: [
          edgeItem("score-finite", "Score finite", 50, 100),
          {
            ...edgeItem("score-undefined", "Score undefined", 0, 200),
            score: undefined as unknown as number,
          },
          {
            ...edgeItem("score-nan", "Score NaN", 0, 300),
            score: Number.NaN,
          },
        ],
        expectedIds: ["score-nan", "score-undefined", "score-finite"],
      },
      {
        name: "score falls back from equal negative Infinity to updatedAt and name",
        sort: "score",
        candidates: [
          edgeItem("score-infinity-recent-b", "Edge B", Number.NEGATIVE_INFINITY, 20),
          edgeItem("score-infinity-old", "Edge Old", Number.NEGATIVE_INFINITY, 10),
          edgeItem("score-infinity-recent-a", "Edge A", Number.NEGATIVE_INFINITY, 20),
        ],
        expectedIds: ["score-infinity-recent-a", "score-infinity-recent-b", "score-infinity-old"],
      },
      {
        name: "score preserves stable input order when every key is negative Infinity or equal",
        sort: "score",
        candidates: [
          edgeItem("stable-second", "Stable", Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY),
          edgeItem("stable-first", "Stable", Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ],
        expectedIds: ["stable-second", "stable-first"],
      },
    ] as const)("$name", ({ sort, candidates, expectedIds }) => {
      const snapshots = candidates.map((candidate) => ({ ...candidate }));
      const frozenCandidates = candidates.map((candidate) => Object.freeze(candidate));
      const frozenInput: readonly OpportunityCandidatePoolItem[] = Object.freeze(frozenCandidates);
      const inputIds = ids(frozenInput);

      const result = buildVisibleCandidatePoolItems(frozenInput, "all", sort);

      expect(ids(result)).toEqual(expectedIds);
      expect(ids(frozenInput)).toEqual(inputIds);
      expect(result).not.toBe(frozenInput);
      expect(result.every((candidate) => frozenInput.includes(candidate))).toBe(true);
      for (const [index, candidate] of frozenInput.entries()) {
        expect(candidate).toEqual(snapshots[index]);
      }
    });

    it("preserves stable input order after every explicit tie-breaker is equal", () => {
      const first = item("same", 70, 1_000);
      const second = { ...item("same", 70, 1_000), id: "second-same" };
      const third = { ...item("same", 70, 1_000), id: "third-same" };
      const tied = [second, first, third];

      expect(buildVisibleCandidatePoolItems(tied, "all", "updated")).toEqual(tied);
      expect(buildVisibleCandidatePoolItems(tied, "all", "score")).toEqual(tied);
      expect(buildVisibleCandidatePoolItems([...tied].reverse(), "all", "score"))
        .toEqual([...tied].reverse());
    });

    it("accepts frozen readonly input without changing the array or Candidate objects", () => {
      const first = Object.freeze(item("first", 60, 1_000, "pending"));
      const second = Object.freeze(item("second", 80, 900, "worth_analyzing"));
      const candidates: readonly OpportunityCandidatePoolItem[] = Object.freeze([first, second]);
      const before = JSON.stringify(candidates);

      const result = buildVisibleCandidatePoolItems(candidates, "all", "score");

      expect(names(result)).toEqual(["second", "first"]);
      expect(result).not.toBe(candidates);
      expect(result[0]).toBe(second);
      expect(result[1]).toBe(first);
      expect(JSON.stringify(candidates)).toBe(before);
      expect(buildVisibleCandidatePoolItems(candidates, "all", "score")).toEqual(result);
    });

    it("matches the former inline filter-then-sort algorithm item by item", () => {
      const formerInline = (
        candidates: readonly OpportunityCandidatePoolItem[],
        filter: Parameters<typeof filterCandidatePool>[1],
        sort: Parameters<typeof sortCandidatePool>[1],
      ) => sortCandidatePool(filterCandidatePool([...candidates], filter), sort);

      for (const filter of ["all", "pending", "worth_analyzing", "analyzed", "paused", "rejected"] as const) {
        for (const sort of ["updated", "score"] as const) {
          const before = formerInline(pool, filter, sort);
          const after = buildVisibleCandidatePoolItems(pool, filter, sort);

          expect(after).toEqual(before);
          expect(after.map((candidate) => candidate.id)).toEqual(before.map((candidate) => candidate.id));
        }
      }
    });

    it("does not change pool counts when a visible subset is selected", () => {
      const countsBefore = buildCandidatePoolCounts(pool);
      const visible = buildVisibleCandidatePoolItems(pool, "worth_analyzing", "score");

      expect(names(visible)).toEqual(["worth-high", "worth-low"]);
      expect(buildCandidatePoolCounts(pool)).toEqual(countsBefore);
      expect(countsBefore).toEqual({
        all: 9,
        pending: 2,
        worth_analyzing: 2,
        analyzed: 1,
        paused: 1,
        rejected: 1,
      });
    });
  });

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

  it("[PURE_CONTRACT] preserves every Candidate queue status tone and the runtime fallback", () => {
    const cases = [
      ["pending_review", "border-slate-200", "bg-slate-50", "text-slate-700"],
      ["pending_analysis", "border-emerald-200", "bg-emerald-50", "text-emerald-700"],
      ["analyzing", "border-indigo-200", "bg-indigo-50", "text-indigo-700"],
      ["converted", "border-teal-200", "bg-teal-50", "text-teal-700"],
      ["rejected", "border-rose-200", "bg-rose-50", "text-rose-700"],
    ] as const satisfies readonly (
      readonly [CandidateQueueState, string, string, string]
    )[];

    const tones = cases.map(([status, border, background, text]) => {
      const expected = `${border} ${background} ${text}`;
      const first = getCandidateStatusToneClass(status);
      const second = getCandidateStatusToneClass(status);

      expect(first).toBe(expected);
      expect(first.split(" ")).toEqual([border, background, text]);
      expect(second).toBe(first);
      expect(first).not.toContain("undefined");
      return first;
    });

    expect(new Set(tones).size).toBe(cases.length);
    expect(getCandidateStatusToneClass).toHaveLength(1);
    expect(getCandidateStatusToneClass("future_queue_state" as CandidateQueueState))
      .toBe("border-slate-200 bg-slate-50 text-slate-700");
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

  it("does not count a converted Candidate as still analyzing", () => {
    const analyzing = item("分析中候选", 80, 1000, "analyzed");
    const converted = {
      ...item("已转任务候选", 85, 1100, "analyzed"),
      convertedTaskId: "task-001",
    };

    expect(filterCandidatePool([analyzing, converted], "analyzed").map((candidate) => candidate.name))
      .toEqual(["分析中候选"]);
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
