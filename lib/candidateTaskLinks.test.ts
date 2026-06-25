import { describe, it, expect } from "vitest";
import {
  extractCandidateSourceMeta,
  isTaskFromCandidate,
  buildCandidateTaskLinkMap,
  type LinkedTaskInfo,
} from "./candidateTaskLinks";

describe("extractCandidateSourceMeta", () => {
  it("returns null for null/undefined result", () => {
    expect(extractCandidateSourceMeta({})).toBeNull();
    expect(extractCandidateSourceMeta({ result: null })).toBeNull();
    expect(extractCandidateSourceMeta({ result: undefined })).toBeNull();
  });

  it("returns null for result without sourceMeta", () => {
    expect(extractCandidateSourceMeta({ result: { productName: "test" } })).toBeNull();
  });

  it("returns null when sourceMeta has no candidateId", () => {
    expect(extractCandidateSourceMeta({
      result: { sourceMeta: { from: "opportunity" } },
    })).toBeNull();
  });

  it("returns null when sourceMeta.from is not 'opportunity'", () => {
    expect(extractCandidateSourceMeta({
      result: { sourceMeta: { candidateId: "abc123", from: "workflow" } },
    })).toBeNull();
  });

  it("extracts full sourceMeta when valid", () => {
    const task = {
      result: {
        sourceMeta: {
          candidateId: "cmqtwpu3k0001eurv5pgur70p",
          from: "opportunity",
          entry: "candidate_to_agent_m1",
          sourceTitle: "新手可小单测试",
          originalName: "桌面收纳盒",
          analyzedName: "桌面收纳盒",
        },
      },
    };
    const meta = extractCandidateSourceMeta(task);
    expect(meta).not.toBeNull();
    expect(meta!.candidateId).toBe("cmqtwpu3k0001eurv5pgur70p");
    expect(meta!.sourceTitle).toBe("新手可小单测试");
    expect(meta!.originalName).toBe("桌面收纳盒");
    expect(meta!.analyzedName).toBe("桌面收纳盒");
    expect(meta!.entry).toBe("candidate_to_agent_m1");
    expect(meta!.from).toBe("opportunity");
  });

  it("handles result as JSON string gracefully", () => {
    // result is already parsed by the API layer, but guard against edge cases
    expect(extractCandidateSourceMeta({ result: "not an object" })).toBeNull();
  });

  it("handles empty sourceMeta gracefully", () => {
    expect(extractCandidateSourceMeta({
      result: { sourceMeta: {} },
    })).toBeNull();
  });

  it("falls back to opportunitySource when sourceTitle missing (old tasks)", () => {
    const task = {
      result: {
        sourceMeta: {
          candidateId: "opp-123",
          from: "opportunity",
          opportunitySource: "机会雷达来源",
        },
      },
    };
    const meta = extractCandidateSourceMeta(task);
    expect(meta).not.toBeNull();
    expect(meta!.sourceTitle).toBe("机会雷达来源");
  });
});

describe("isTaskFromCandidate", () => {
  it("returns true for task with valid candidate sourceMeta", () => {
    expect(isTaskFromCandidate({
      result: { sourceMeta: { candidateId: "abc", from: "opportunity" } },
    })).toBe(true);
  });

  it("returns false for task without candidate sourceMeta", () => {
    expect(isTaskFromCandidate({ result: {} })).toBe(false);
    expect(isTaskFromCandidate({})).toBe(false);
    expect(isTaskFromCandidate({ result: { sourceMeta: {} } })).toBe(false);
  });

  it("returns false for non-opportunity source", () => {
    expect(isTaskFromCandidate({
      result: { sourceMeta: { candidateId: "abc", from: "workflow" } },
    })).toBe(false);
  });
});

describe("buildCandidateTaskLinkMap", () => {
  it("returns empty map for empty tasks array", () => {
    const map = buildCandidateTaskLinkMap([]);
    expect(map.size).toBe(0);
  });

  it("builds map for tasks with valid candidate links", () => {
    const tasks = [
      {
        id: "task-1",
        title: "桌面收纳盒 一键分析",
        createdAt: "2026-06-26T03:00:00Z",
        source: "agent_run",
        result: {
          sourceMeta: {
            candidateId: "cand-1",
            from: "opportunity",
            sourceTitle: "桌面收纳盒",
          },
        },
      },
    ];
    const map = buildCandidateTaskLinkMap(tasks);
    expect(map.size).toBe(1);
    expect(map.get("cand-1")).toHaveLength(1);
    expect(map.get("cand-1")![0].taskId).toBe("task-1");
    expect(map.get("cand-1")![0].title).toBe("桌面收纳盒 一键分析");
  });

  it("skips tasks without valid candidate sourceMeta", () => {
    const tasks = [
      { id: "task-1", result: {} },
      { id: "task-2", result: { sourceMeta: {} } },
      { id: "task-3", result: { sourceMeta: { from: "workflow" } } },
    ];
    const map = buildCandidateTaskLinkMap(tasks);
    expect(map.size).toBe(0);
  });

  it("groups multiple tasks for same candidateId", () => {
    const tasks = [
      {
        id: "task-2",
        title: "第二次分析",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
      {
        id: "task-1",
        title: "第一次分析",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
    ];
    const map = buildCandidateTaskLinkMap(tasks);
    expect(map.size).toBe(1);
    const linked = map.get("cand-1")!;
    expect(linked).toHaveLength(2);
    // Should be sorted by taskId descending
    expect(linked[0].taskId).toBe("task-2");
    expect(linked[1].taskId).toBe("task-1");
  });

  it("handles mixed valid and invalid tasks", () => {
    const tasks = [
      { id: "bad-1", result: null },
      {
        id: "good-1",
        title: "valid",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
      { id: "bad-2", result: "not object" },
    ];
    const map = buildCandidateTaskLinkMap(tasks);
    expect(map.size).toBe(1);
    expect(map.get("cand-1")).toHaveLength(1);
  });

  it("handles tasks with null/undefined result gracefully", () => {
    const tasks = [
      { id: "task-x", result: null } as unknown as { id: string; result: unknown },
      { id: "task-y", result: undefined } as unknown as { id: string; result: unknown },
    ];
    const map = buildCandidateTaskLinkMap(tasks);
    expect(map.size).toBe(0);
    // No crash
  });

  it("extracts sourceTitle and analyzedName", () => {
    const tasks = [{
      id: "task-1",
      result: {
        sourceMeta: {
          candidateId: "cand-1",
          from: "opportunity",
          sourceTitle: "来源标题",
          analyzedName: "分析名称",
        },
      },
    }];
    const map = buildCandidateTaskLinkMap(tasks);
    const info = map.get("cand-1")![0];
    expect(info.sourceTitle).toBe("来源标题");
    expect(info.analyzedName).toBe("分析名称");
  });
});
