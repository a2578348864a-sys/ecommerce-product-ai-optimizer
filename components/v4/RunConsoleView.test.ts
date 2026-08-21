import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RunConsoleView,
  ConclusionTab,
  MarketTab,
  ListingTab,
  ActivityTab,
  deriveVerdict,
  primaryActionFor,
  type ContentView,
} from "./RunConsoleView";
import { makeEvent, makeRun, makeWait } from "./fixtures";
import type { ReportViewLike } from "./api";
import type { ResearchRunEvent } from "@/lib/v4/contracts";

function render(run: ReturnType<typeof makeRun>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(RunConsoleView, { run, events: [], ...props }));
}

const report: ReportViewLike = {
  reportId: "rep_1",
  summary: "市场摘要",
  sections: [{ title: "市场需求", sentences: [{ text: "需求稳定", evidenceRefs: ["e1"], kind: "factual" }] }],
  gaps: [{ question: "缺少关键词数据", reason: "用于判断市场容量" }],
  conflicts: [{ evidenceA: "来源A", evidenceB: "来源B", field: "价格" }],
  unknowns: ["竞品价格"],
  planRevision: 1,
  evidence: [{ type: "sellersprite", entity: "供应商A", fields: { offerIdentity: "o1" } }],
};

describe("RunConsoleView — C 端产品化", () => {
  it("renders the C-end header with title, user status and the six tabs (default 研究结论)", () => {
    const html = render(makeRun({ status: "running", currentNode: "dispatch_tool", wait: null, lastError: null }));
    expect(html).toContain('data-testid="run-console-view"');
    expect(html).toContain('data-testid="run-title"');
    expect(html).toContain("候选商品研究");
    expect(html).toContain('data-testid="tab-conclusion"');
    expect(html).toContain('data-testid="tab-market"');
    expect(html).toContain('data-testid="tab-supply"');
    expect(html).toContain('data-testid="tab-cost"');
    expect(html).toContain('data-testid="tab-listing"');
    expect(html).toContain('data-testid="tab-activity"');
    expect(html).toContain('data-testid="tab-conclusion" data-active="true"');
  });

  it("maps the run status to user language in the status badge", () => {
    const html = render(makeRun({ status: "waiting_human", wait: makeWait(), currentNode: "gate_a" }), {});
    expect(html).toContain('data-status="等待确认"');
  });

  it("shows a single primary action per state (运行时为稍后刷新)", () => {
    const html = render(makeRun({ status: "running", currentNode: "dispatch_tool", wait: null, lastError: null }));
    expect(html).toContain('data-testid="primary-action"');
    expect(html).toContain("正在研究，稍后刷新");
  });

  it("derives the primary action: failed_recoverable → 重试；completed → 查看研究结论；running → 稍后刷新", () => {
    const onRetry = () => undefined;
    const goTab = () => undefined;
    expect(primaryActionFor(makeRun({ status: "failed_recoverable" }), null, { onRetry, goTab })?.label).toBe("重试研究");
    expect(primaryActionFor(makeRun({ status: "completed", currentNode: "complete" }), null, { onRetry, goTab })?.label).toBe("查看研究结论");
    expect(primaryActionFor(makeRun({ status: "running" }), null, { onRetry, goTab })?.label).toBe("正在研究，稍后刷新");
  });

  it("renders a low-visibility debug link but never leaks the candidateId into the header", () => {
    const run = makeRun({ status: "completed", currentNode: "complete", candidateId: "cand_12345678" });
    const html = render(run, {});
    expect(html).toContain('data-testid="debug-link"');
    expect(html).toContain("调试详情");
    expect(html).toContain("/debug");
  });
});

describe("RunConsoleView — 研究结论（五问）", () => {
  it("answers 这个商品目前怎么样 with three verdict cards and derives 资料不足 when completed with gaps", () => {
    const html = renderToStaticMarkup(
      createElement(ConclusionTab, {
        run: makeRun({ status: "completed", currentNode: "complete" }),
        report,
        facts: null,
        goTab: () => undefined,
        primary: null,
      }),
    );
    expect(html).toContain('data-testid="verdict-worth"');
    expect(html).toContain('data-testid="verdict-insufficient"');
    expect(html).toContain('data-testid="verdict-not_recommended"');
    expect(html).toContain('data-testid="verdict-insufficient" data-current="true"');
  });

  it("derives 值得继续研究 when completed with no gaps", () => {
    const v = deriveVerdict(makeRun({ status: "completed", currentNode: "complete" }), {
      ...report,
      gaps: [],
    });
    expect(v.current).toBe("worth");
  });

  it("answers 为什么 with five aspects and 待补充 when absent", () => {
    const html = renderToStaticMarkup(
      createElement(ConclusionTab, {
        run: makeRun({ status: "running", currentNode: "dispatch_tool" }),
        report,
        facts: null,
        goTab: () => undefined,
        primary: null,
      }),
    );
    expect(html).toContain("市场需求");
    expect(html).toContain("竞争情况");
    expect(html).toContain("买家痛点");
    expect(html).toContain("货源匹配");
    expect(html).toContain("成本与风险");
    expect(html).toContain('data-testid="aspect-empty-pain"');
    expect(html).toContain("待补充");
  });

  it("answers 现在确认了什么 by showing confirmed facts with the Chinese field label", () => {
    const html = renderToStaticMarkup(
      createElement(ConclusionTab, {
        run: makeRun({ status: "waiting_human", currentNode: "product_fact_gate", wait: makeWait() }),
        report: null,
        facts: [{ key: "f1", variantKey: "v1", field: "material", value: "304", status: "confirmed" }],
        goTab: () => undefined,
        primary: null,
      }),
    );
    expect(html).toContain("材质");
    expect(html).toContain("304");
    expect(html).not.toContain("还没有确认信息");
  });

  it("answers 还缺什么 by showing gap question/reason/source hint and a 去补充 action", () => {
    const html = renderToStaticMarkup(
      createElement(ConclusionTab, {
        run: makeRun({ status: "waiting_human", currentNode: "gate_a", wait: makeWait() }),
        report,
        facts: null,
        goTab: () => undefined,
        primary: null,
      }),
    );
    expect(html).toContain("缺什么：缺少关键词数据");
    expect(html).toContain("为什么需要：用于判断市场容量");
    expect(html).toContain("去哪里补：");
    expect(html).toContain("商品研究关键词工具 / 供应商资料");
    expect(html).toContain('data-testid="gap-action-0"');
    expect(html).toContain("去补充");
  });

  it("answers 下一步做什么 with a single main button and explanation", () => {
    const html = renderToStaticMarkup(
      createElement(ConclusionTab, {
        run: makeRun({ status: "completed", currentNode: "complete" }),
        report: null,
        facts: null,
        goTab: () => undefined,
        primary: { label: "查看研究结论", hint: "研究已结束，可查看研究结论与缺口。", onSelect: () => undefined },
      }),
    );
    expect(html).toContain('data-testid="next-step-action"');
    expect(html).toContain("查看研究结论");
  });
});

describe("RunConsoleView — Listing 与图片 Tab", () => {
  it("maps image checks to user language and never claims 已批准使用 when images are blocked", () => {
    const content: ContentView = {
      listing: null,
      images: {
        overallStatus: "blocked",
        summary: "存在阻止发布/导出的失败项",
        checks: [{ check: "identity", pass: false, evidence: "未检测到资产身份", issues: ["identity_not_detected"] }],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ListingTab, {
        run: makeRun({ status: "waiting_human", currentNode: "content_review", wait: makeWait() }),
        content,
        contentReview: null,
      }),
    );
    expect(html).toContain('data-testid="v4-images-blocked-hint"');
    expect(html).toContain("这张图片暂时不能使用，请补充清晰产品参考图后重新检查。");
    expect(html).toContain("无法确认是不是同一个商品");
    expect(html).not.toContain("已批准使用");
    expect(html).not.toContain("已批准");
  });

  it("renders an honest 尚未生成 listing card when content data is absent", () => {
    const html = renderToStaticMarkup(
      createElement(ListingTab, {
        run: makeRun({ status: "running", currentNode: "content_review" }),
        content: null,
        contentReview: null,
      }),
    );
    expect(html).toContain('data-testid="v4-listing-empty"');
    expect(html).toContain("Listing 尚未生成");
  });
});

describe("RunConsoleView — 操作记录", () => {
  it("shows only the mapped user events (no raw node/event enums)", () => {
    const events = [
      makeEvent({ seq: 1, type: "run_created", node: "load_context" }),
      makeEvent({ seq: 2, type: "node_entered", node: "load_context" }),
      makeEvent({ seq: 3, type: "evidence_merged", node: "merge_evidence" }),
      makeEvent({ seq: 4, type: "waiting_human", node: "gate_a" }),
      makeEvent({ seq: 5, type: "fact_confirmed" as ResearchRunEvent["type"], node: "product_fact_gate" }),
      makeEvent({ seq: 6, type: "completed", node: "complete" }),
      makeEvent({ seq: 7, type: "failed", node: "fail" }),
      makeEvent({ seq: 8, type: "cancelled", node: "cancel" }),
    ];
    const html = renderToStaticMarkup(createElement(ActivityTab, { events }));
    expect(html).toContain("开始研究");
    expect(html).toContain("找到市场数据");
    expect(html).toContain("等待确认");
    expect(html).toContain("已确认商品信息");
    expect(html).toContain("已完成研究");
    expect(html).toContain("研究遇到问题");
    expect(html).toContain("已取消");
    // 原始节点/事件不进入操作记录主区
    expect(html).not.toContain("node_entered");
    expect(html).not.toContain("load_context");
    expect(html).not.toContain("plan_created");
  });

  it("shows an honest empty state when there are no user events", () => {
    const html = renderToStaticMarkup(
      createElement(ActivityTab, { events: [makeEvent({ seq: 1, type: "node_entered", node: "load_context" })] }),
    );
    expect(html).toContain("还没有操作记录");
  });
});

describe("RunConsoleView — 市场与评论", () => {
  it("shows market sections, conflicts, unknowns and evidence origins with user-language source labels", () => {
    const html = renderToStaticMarkup(createElement(MarketTab, { report }));
    expect(html).toContain("市场研究报告");
    expect(html).toContain("市场需求");
    expect(html).toContain("需求稳定");
    expect(html).toContain("发现的数据不一致");
    expect(html).toContain("暂未获得数据");
    expect(html).toContain("证据来源");
    // 不泄漏英文源名（sellersprite → 卖家精灵数据）
    expect(html).not.toContain("sellersprite");
  });

  it("renders honest 尚未生成 when report is absent", () => {
    const html = renderToStaticMarkup(createElement(MarketTab, { report: null }));
    expect(html).toContain("市场研究报告尚未生成");
  });
});
