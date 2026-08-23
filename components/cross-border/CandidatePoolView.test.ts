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

function render(overrides: Record<string, unknown> = {}) {
  const props = {
    state: "ready",
    items: [item as never],
    total: 101,
    hasMore: true,
    statusFilter: "all",
    query: "",
    selectedIds: [] as string[],
    busy: false,
    manualOpen: false,
    manualName: "",
    manualUrl: "",
    message: "",
    onRefresh: () => undefined,
    onLoadMore: () => undefined,
    onStatusFilterChange: () => undefined,
    onQueryChange: () => undefined,
    onToggleSelect: () => undefined,
    onSelectAll: () => undefined,
    onDeleteItem: () => undefined,
    onDeleteSelected: () => undefined,
    onStartSelected: () => undefined,
    onManualToggle: () => undefined,
    onManualNameChange: () => undefined,
    onManualUrlChange: () => undefined,
    onManualSubmit: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(CandidatePoolView, props as never));
}

describe("CandidatePoolView", () => {
  it("renders the server total, source, marketplace, status filter and load-more recovery", () => {
    const html = render();
    expect(html).toContain("商品研究池");
    expect(html).toContain("101");
    expect(html).toContain("卖家精灵直接导入");
    expect(html).toContain("Amazon US");
    expect(html).toContain("加载更多");
    // F1：未转候选渲染「开始研究」按钮（start-research → Workbench），不再直接链到候选研究页
    expect(html).toContain("开始研究");
    expect(html).not.toContain("/opportunity-candidates/candidate-101?source=opportunity");
  });

  it("renders loading, empty and retryable error states", () => {
    expect(render({ state: "loading", items: [], total: 0 })).toContain("正在读取商品研究池");
    expect(render({ state: "ready", items: [], total: 0, hasMore: false })).toContain("研究池还没有商品");
    expect(render({ state: "error", items: [], total: 0, message: "读取失败" })).toContain("重试");
  });

  it("keeps manual add collapsed by default and never labels the page Owner-only", () => {
    const html = render();
    expect(html).toContain("手工添加商品");
    expect(html).not.toContain("仅 Owner");
    expect(html).not.toContain("localStorage");
  });

  it("renders the server-owned blocked reason without an Agent link", () => {
    const html = render({
      items: [{
        ...item,
        researchAction: "research_blocked" as const,
        researchBlockReasonCode: "candidate_not_ready" as const,
        researchActionMessage: "该候选尚未满足研究条件。",
      }],
    });
    expect(html).toContain("该候选尚未满足研究条件。");
    expect(html).not.toContain("/agent/run?");
  });

  it("renders runtime-validation Candidates as an available research action", () => {
    const html = render({
      items: [{
        ...item,
        researchAction: "runtime_validation_required",
        researchActionMessage: "进入研究前需要服务端再次校验来源。",
      }],
    });
    expect(html).not.toContain("进入研究前需要服务端再次校验来源。");
    // F1：可研究候选显示「开始研究」按钮（点击 → start-research API → Research Workbench）
    expect(html).toContain("开始研究");
    expect(html).not.toContain("/opportunity-candidates/");
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
    expect(html).toContain("查看研究记录");
    expect(html).toContain("尚无正式决定");
    expect(html).toContain("移出研究池");
    expect(html).not.toContain(">删除</button>");
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


describe("候选卡主图（轮 6）", () => {
  it("有可用图 → 同源 img /api 引用；无图 → 诚实占位（无外链）", () => {
    const withImage = render({
      items: [{ ...item, imageAvailable: true, imageUrl: "/api/opportunity-candidates/candidate-101/image" } as never],
    });
    expect(withImage).toContain('data-testid="candidate-main-image"');
    expect(withImage).toContain('src="/api/opportunity-candidates/candidate-101/image"');
    expect(withImage).not.toContain("商品图待补充");

    const noImage = render({
      items: [{ ...item, imageAvailable: false, imageUrl: null } as never],
    });
    expect(noImage).toContain('data-testid="candidate-image-placeholder"');
    expect(noImage).toContain("商品图待补充");
    expect(noImage).not.toContain("candidate-main-image");
    expect(noImage).not.toContain('src="http');
    expect(noImage).not.toContain("https://");
  });
});


describe("轮 7 startable 视图与精确聚焦", () => {
  function items() {
    return [
      { ...item, id: "c-avail", researchAction: "research_available" as const, name: "可研究品" },
      { ...item, id: "c-conv", researchAction: "converted" as const, convertedTaskId: "task-1", name: "历史品" },
      { ...item, id: "c-blocked", researchAction: "research_blocked" as const, researchBlockReasonCode: "candidate_not_ready" as const, researchActionMessage: "n", name: "被阻断品" },
    ];
  }
  it("startableOnly：只显示授权可研究的卡（converted/blocked 不出现）", () => {
    const html = render({ items: items() as never, startableOnly: true });
    expect(html).toContain("可研究品");
    expect(html).not.toContain("历史品");
    expect(html).not.toContain("被阻断品");
  });
  it("非 startableOnly 视图仍显示全部（历史/普通视图不变）", () => {
    const html = render({ items: items() as never });
    expect(html).toContain("历史品");
    expect(html).toContain("被阻断品");
  });
  it("candidateId 精确聚焦：目标存在 → 高亮；不存在 → 诚实提示（不得聚焦第一项）", () => {
    const found = render({ items: items() as never, startableOnly: true, focusCandidateId: "c-avail" });
    expect(found).toContain('data-testid="candidate-focused"');
    const missing = render({ items: items() as never, startableOnly: true, focusCandidateId: "c-not-exist" });
    expect(missing).toContain("没有找到这个候选商品");
    expect(missing).not.toContain('data-testid="candidate-focused"');
  });
});
