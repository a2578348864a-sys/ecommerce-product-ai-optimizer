import { describe, it, expect } from "vitest";
import {
  extractCandidateSourceMeta,
  isTaskFromCandidate,
  buildCandidateTaskLinkMap,
  resolveCandidateTaskLinks,
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
    // Missing createdAt falls back to stable taskId descending order.
    expect(linked[0].taskId).toBe("task-2");
    expect(linked[1].taskId).toBe("task-1");
  });

  it("sorts linked tasks by createdAt descending even when taskId order conflicts", () => {
    const tasks = [
      {
        id: "task-z-older",
        title: "较早分析",
        createdAt: "2026-06-20T08:00:00.000Z",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
      {
        id: "task-a-newer",
        title: "最新分析",
        createdAt: "2026-07-10T08:00:00.000Z",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
    ];

    const linked = buildCandidateTaskLinkMap(tasks).get("cand-1")!;

    expect(linked.map((task) => task.taskId)).toEqual(["task-a-newer", "task-z-older"]);
  });

  it("places valid createdAt before invalid timestamps", () => {
    const tasks = [
      {
        id: "task-z-invalid",
        createdAt: "not-a-date",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
      {
        id: "task-a-valid",
        createdAt: "2026-07-10T08:00:00.000Z",
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
    ];

    const linked = buildCandidateTaskLinkMap(tasks).get("cand-1")!;

    expect(linked.map((task) => task.taskId)).toEqual(["task-a-valid", "task-z-invalid"]);
  });

  it("uses taskId descending as a stable tie-breaker for equal timestamps", () => {
    const createdAt = "2026-07-10T08:00:00.000Z";
    const tasks = [
      {
        id: "task-a",
        createdAt,
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
      {
        id: "task-z",
        createdAt,
        result: { sourceMeta: { candidateId: "cand-1", from: "opportunity" } },
      },
    ];

    const linked = buildCandidateTaskLinkMap(tasks).get("cand-1")!;

    expect(linked.map((task) => task.taskId)).toEqual(["task-z", "task-a"]);
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

describe("resolveCandidateTaskLinks", () => {
  it("creates a minimal direct link when the canonical Task is outside the recent Snapshot window", () => {
    expect(resolveCandidateTaskLinks({
      id: "candidate-1",
      name: "桌面手机支架",
      convertedTaskId: "task-canonical-001",
    }, [])).toEqual([{
      taskId: "task-canonical-001",
      title: "关联任务",
      createdAt: "",
      source: "",
    }]);
  });

  it("reuses canonical Snapshot metadata, places it first and removes duplicate Task ids", () => {
    const links: LinkedTaskInfo[] = [
      { taskId: "task-history", title: "历史分析", createdAt: "2026-07-10T00:00:00Z", source: "agent_run" },
      { taskId: "task-canonical", title: "最新可信任务", createdAt: "2026-07-11T00:00:00Z", source: "ai" },
      { taskId: "task-canonical", title: "重复快照", createdAt: "", source: "" },
    ];

    const resolved = resolveCandidateTaskLinks({
      id: "candidate-1",
      name: "桌面手机支架",
      convertedTaskId: "task-canonical",
    }, links);

    expect(resolved.map((task) => task.taskId)).toEqual(["task-canonical", "task-history"]);
    expect(resolved[0].title).toBe("最新可信任务");
  });

  it("keeps legacy Snapshot links unchanged when no valid canonical Task id exists", () => {
    const links: LinkedTaskInfo[] = [
      { taskId: "task-history", title: "历史任务", createdAt: "", source: "agent_run" },
    ];

    expect(resolveCandidateTaskLinks({
      id: "candidate-1",
      name: "历史 Candidate",
      convertedTaskId: null,
    }, links)).toEqual(links);
    expect(resolveCandidateTaskLinks({
      id: "candidate-1",
      name: "损坏 Candidate",
      convertedTaskId: "../tasks/forged",
    }, links)).toEqual(links);
  });
});
