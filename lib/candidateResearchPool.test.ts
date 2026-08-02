import { describe, expect, it } from "vitest";
import {
  candidatePrimaryHref,
  mergeCandidatePages,
  parseCandidateListResponse,
} from "@/lib/candidateResearchPool";

function apiItem(index: number, options: {
  convertedTaskId?: string | null;
  researchAction?: "converted" | "research_available" | "research_blocked" | "runtime_validation_required";
  researchBlockReasonCode?: "candidate_not_ready" | null;
  researchActionMessage?: string | null;
} = {}) {
  return {
    id: `candidate-${index}`,
    name: `Candidate ${index}`,
    status: "pending" as const,
    sourceKind: "sellersprite_direct" as const,
    marketplace: "Amazon US",
    convertedTaskId: options.convertedTaskId ?? null,
    researchAction: options.researchAction ?? "research_available",
    researchBlockReasonCode: options.researchBlockReasonCode ?? null,
    researchActionMessage: options.researchActionMessage ?? null,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("Candidate research pool contract", () => {
  it("parses only server list responses and keeps pagination authority", () => {
    const result = parseCandidateListResponse({
      ok: true,
      items: [apiItem(1)],
      total: 101,
      hasMore: true,
      nextOffset: 100,
    });

    expect(result).toMatchObject({ total: 101, hasMore: true, nextOffset: 100 });
    expect(result?.items[0]).toMatchObject({
      id: "candidate-1",
      sourceKind: "sellersprite_direct",
      marketplace: "Amazon US",
    });
  });

  it("keeps the 101st Candidate reachable when a second page is merged", () => {
    const first = Array.from({ length: 100 }, (_, index) => apiItem(index + 1));
    const merged = mergeCandidatePages(first, [apiItem(101)]);
    expect(merged).toHaveLength(101);
    expect(merged[100].id).toBe("candidate-101");
  });

  it("routes unconverted Candidates to Agent and converted Candidates to Task", () => {
    expect(candidatePrimaryHref(apiItem(1))).toBe("/agent/run?source=opportunity&candidateId=candidate-1");
    expect(candidatePrimaryHref(apiItem(2, {
      convertedTaskId: "task-002",
      researchAction: "converted",
    }))).toBe("/tasks/task-002");
  });

  it("does not turn blocked or runtime-validation projections into Agent authorization", () => {
    expect(candidatePrimaryHref(apiItem(3, {
      researchAction: "research_blocked",
      researchBlockReasonCode: "candidate_not_ready",
      researchActionMessage: "该候选尚未满足研究条件。",
    }))).toBeNull();
    expect(candidatePrimaryHref(apiItem(4, {
      researchAction: "runtime_validation_required",
    }))).toBeNull();
  });

  it("fails closed when the server action and convertedTaskId disagree", () => {
    expect(parseCandidateListResponse({
      ok: true,
      items: [apiItem(5, {
        convertedTaskId: "task-005",
        researchAction: "research_available",
      })],
      total: 1,
      hasMore: false,
      nextOffset: null,
    })).toBeNull();
  });
});
