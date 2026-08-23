import { describe, expect, it } from "vitest";
import {
  candidatePrimaryHref,
  collectStartableCandidates,
  filterStartableCandidates,
  isCandidateResearchActionAvailable,
  mergeCandidatePages,
  parseCandidateListResponse,
  type CandidateResearchPoolItem,
} from "@/lib/candidateResearchPool";

function apiItem(index: number, options: {
  convertedTaskId?: string | null;
  researchAction?: "converted" | "research_available" | "research_blocked" | "runtime_validation_required";
  researchBlockReasonCode?: "candidate_not_ready" | null;
  researchActionMessage?: string | null;
  researchDecision?: unknown;
} = {}): CandidateResearchPoolItem {
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
    researchDecision: (options.researchDecision ?? null) as CandidateResearchPoolItem["researchDecision"],
    updatedAt: "2026-08-01T00:00:00.000Z",
    imageAvailable: false,
    imageUrl: null,
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

  it("routes unconverted Candidates to research and converted Candidates to Task", () => {
    expect(candidatePrimaryHref(apiItem(1))).toBe("/opportunity-candidates/candidate-1?source=opportunity&candidateId=candidate-1");
    expect(candidatePrimaryHref(apiItem(2, {
      convertedTaskId: "task-002",
      researchAction: "converted",
    }))).toBe("/tasks/task-002");
  });

  it("keeps blocked projections unauthorized but routes runtime-validation Candidates into research", () => {
    expect(candidatePrimaryHref(apiItem(3, {
      researchAction: "research_blocked",
      researchBlockReasonCode: "candidate_not_ready",
      researchActionMessage: "该候选尚未满足研究条件。",
    }))).toBeNull();
    expect(candidatePrimaryHref(apiItem(4, {
      researchAction: "runtime_validation_required",
    }))).toBe("/opportunity-candidates/candidate-4?source=opportunity&candidateId=candidate-4");
    expect(isCandidateResearchActionAvailable(apiItem(4, {
      researchAction: "runtime_validation_required",
    }))).toBe(true);
    expect(isCandidateResearchActionAvailable(apiItem(3, {
      researchAction: "research_blocked",
    }))).toBe(false);
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


describe("轮 6 候选主图安全字段", () => {
  function baseItem(over: Record<string, unknown> = {}) {
    return { id: "cand-1", name: "N", status: "pending", sourceKind: "manual", marketplace: "US", convertedTaskId: null, researchAction: "research_available", researchBlockReasonCode: null, researchActionMessage: null, researchDecision: null, updatedAt: "2026-08-22T00:00:00.000Z", ...over };
  }

  it("保留服务端安全图片引用（同源 /api 路径），无图 → false/null", () => {
    const page = parseCandidateListResponse({
      ok: true, total: 1, hasMore: false, nextOffset: null,
      items: [baseItem({ imageAvailable: true, imageUrl: "/api/opportunity-candidates/cand-1/image" })],
    });
    expect(page).not.toBeNull();
    expect((page!.items[0] as any).imageAvailable).toBe(true);
    expect((page!.items[0] as any).imageUrl).toBe("/api/opportunity-candidates/cand-1/image");

    const noImage = parseCandidateListResponse({
      ok: true, total: 1, hasMore: false, nextOffset: null,
      items: [baseItem({ imageAvailable: false, imageUrl: null })],
    });
    expect((noImage!.items[0] as any).imageAvailable).toBe(false);
    expect((noImage!.items[0] as any).imageUrl).toBeNull();
  });

  it("拒绝外链图片引用（http(s) 绝对地址不可作为合法 imageUrl）", () => {
    const page = parseCandidateListResponse({
      ok: true, total: 1, hasMore: false, nextOffset: null,
      items: [baseItem({ imageAvailable: true, imageUrl: "https://evil.example.com/img.png" })],
    });
    expect(page).not.toBeNull();
    expect((page!.items[0] as any).imageUrl).toBeNull();
  });
});


describe("轮 7 可研究口径与 fail-closed 收集", () => {
  const available: CandidateResearchPoolItem = { id: "c-avail", researchAction: "research_available", convertedTaskId: null, name: "可研究品", status: "pending", sourceKind: "manual", marketplace: null, researchBlockReasonCode: null, researchActionMessage: null, researchDecision: null, updatedAt: "2026-08-22T00:00:00.000Z", imageAvailable: false, imageUrl: null };
  const converted: CandidateResearchPoolItem = { ...available, id: "c-conv", researchAction: "converted", convertedTaskId: "task-1" };
  const blocked: CandidateResearchPoolItem = { ...available, id: "c-blocked", researchAction: "research_blocked", researchBlockReasonCode: "candidate_not_ready", researchActionMessage: "n" };

  it("startable 唯一依据 isCandidateResearchActionAvailable：converted/blocked 不计入；严格过滤", () => {
    expect(isCandidateResearchActionAvailable(available)).toBe(true);
    expect(isCandidateResearchActionAvailable({ ...available, researchAction: "runtime_validation_required" as const })).toBe(true);
    expect(isCandidateResearchActionAvailable(converted)).toBe(false);
    expect(isCandidateResearchActionAvailable(blocked)).toBe(false);
    expect(filterStartableCandidates([available, converted, blocked])).toEqual([available]);
  });

  it("收集 fail-closed：中页失败 → 抛错（不返回残缺列表）；跨页完整", async () => {
    await expect(collectStartableCandidates(async (offset) => offset === 0 ? { items: [available], hasMore: true } : null)).rejects.toThrow("product_research_tasks_unavailable");
    let pages = 0;
    const all = await collectStartableCandidates(async (offset) => { pages += 1; return { items: offset < 100 ? [available, converted] : [converted], hasMore: offset < 100 }; });
    expect(pages).toBe(3); // 0 / 50 / 100 三页完整读取到 hasMore=false
    expect(all).toHaveLength(2);
    expect(all.every((c) => isCandidateResearchActionAvailable(c))).toBe(true);
  });
});
