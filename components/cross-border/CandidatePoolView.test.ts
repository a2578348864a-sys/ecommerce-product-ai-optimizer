import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidatePoolView } from "@/components/cross-border/CandidatePoolView";

const item = {
  id: "candidate-101",
  name: "Face sunscreen powder",
  status: "pending" as const,
  sourceKind: "sellersprite_direct" as const,
  marketplace: "Amazon US",
  convertedTaskId: null,
  researchAction: "research_available" as const,
  researchBlockReasonCode: null,
  researchActionMessage: null,
  researchDecision: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function render(overrides: Partial<Parameters<typeof CandidatePoolView>[0]> = {}) {
  return renderToStaticMarkup(createElement(CandidatePoolView, {
    state: "ready",
    items: [item],
    total: 101,
    hasMore: true,
    statusFilter: "all",
    busy: false,
    manualOpen: false,
    manualName: "",
    manualUrl: "",
    message: "",
    onRefresh: () => undefined,
    onLoadMore: () => undefined,
    onStatusFilterChange: () => undefined,
    onManualToggle: () => undefined,
    onManualNameChange: () => undefined,
    onManualUrlChange: () => undefined,
    onManualSubmit: () => undefined,
    ...overrides,
  }));
}

describe("CandidatePoolView", () => {
  it("renders the server total, source, marketplace, status filter and load-more recovery", () => {
    const html = render();
    expect(html).toContain("商品研究池");
    expect(html).toContain("101");
    expect(html).toContain("卖家精灵直接导入");
    expect(html).toContain("Amazon US");
    expect(html).toContain("加载更多");
    expect(html).toContain("/agent/run?source=opportunity&amp;candidateId=candidate-101");
  });

  it("renders loading, empty and retryable error states", () => {
    expect(render({ state: "loading", items: [], total: 0 })).toContain("正在读取商品研究池");
    expect(render({ state: "ready", items: [], total: 0, hasMore: false })).toContain("研究池还没有商品");
    expect(render({ state: "error", items: [], total: 0, message: "读取失败" })).toContain("重试");
  });

  it("keeps manual add collapsed by default and never labels the page Owner-only", () => {
    const html = render();
    expect(html).toContain("手工添加（旧版兼容）");
    expect(html).not.toContain("仅 Owner");
    expect(html).not.toContain("localStorage");
  });

  it("renders the server-owned blocked reason without an Agent link", () => {
    const html = render({
      items: [{
        ...item,
        researchAction: "research_blocked",
        researchBlockReasonCode: "candidate_not_ready",
        researchActionMessage: "该候选尚未满足研究条件。",
      }],
    });
    expect(html).toContain("该候选尚未满足研究条件。");
    expect(html).not.toContain("/agent/run?");
  });

  it("does not render runtime validation as an available research link", () => {
    const html = render({
      items: [{
        ...item,
        researchAction: "runtime_validation_required",
        researchActionMessage: "进入研究前需要服务端再次校验来源。",
      }],
    });
    expect(html).toContain("进入研究前需要服务端再次校验来源。");
    expect(html).not.toContain("/agent/run?");
  });

  it("renders the converted action from the server projection", () => {
    const html = render({
      items: [{
        ...item,
        convertedTaskId: "task-101",
        researchAction: "converted",
      }],
    });
    expect(html).toContain("/tasks/task-101");
    expect(html).toContain("查看研究结果");
    expect(html).toContain("尚无正式决定");
  });

  it("renders only the safe decision summary for a converted Candidate", () => {
    const html = render({
      items: [{
        ...item,
        convertedTaskId: "task-101",
        researchAction: "converted",
        researchDecision: {
          schema: "product-research-record.v1",
          status: "needs_information",
          label: "待补信息",
          reasonSummary: "需要补充供应商证明。",
          nextActionSummary: "收集证明后再复核。",
          revision: 2,
          decidedAt: "2026-08-03T01:00:00.000Z",
          legacy: false,
        },
      }],
    });

    expect(html).toContain("待补信息");
    expect(html).toContain("需要补充供应商证明");
    expect(html).toContain("第 2 版");
    expect(html).not.toContain("decisionEvents");
  });
});
