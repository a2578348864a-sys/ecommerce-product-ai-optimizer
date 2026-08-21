import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunConsoleView } from "./RunConsoleView";
import { makeEvent, makeRun, makeWait } from "./fixtures";

function render(
  run: ReturnType<typeof makeRun>,
  events: ReturnType<typeof makeEvent>[] = [],
  props: { onRefresh?: () => void; onRetry?: () => void } = {},
) {
  return renderToStaticMarkup(createElement(RunConsoleView, { run, events, ...props }));
}

describe("RunConsoleView — state rendering", () => {
  it("renders the running state with badge, flow, budget and cancel", () => {
    const html = render(makeRun({ status: "running", currentNode: "dispatch_tool", wait: null, lastError: null }));
    expect(html).toContain('data-testid="run-console-view"');
    expect(html).toContain('data-testid="run-status-badge"');
    expect(html).toContain("运行中");
    expect(html).toContain('data-testid="plan-summary"');
    expect(html).toContain('data-testid="node-flow"');
    expect(html).toContain('data-testid="budget-meter"');
    expect(html).toContain('data-testid="cancel-run-button"');
    expect(html).not.toContain('data-testid="interrupt-panel"');
    expect(html).not.toContain('data-testid="error-panel"');
  });

  it("renders the waiting_human state with the interrupt panel and decision buttons", () => {
    const html = render(
      makeRun({ status: "waiting_human", wait: makeWait(), currentNode: "gate_a" }),
      [makeEvent({ seq: 1, type: "waiting_human", node: "gate_a" })],
    );
    expect(html).toContain('data-testid="interrupt-panel"');
    expect(html).toContain("等待人工处理");
    expect(html).toContain('data-testid="interrupt-continue"');
    expect(html).toContain('data-testid="interrupt-stop"');
    expect(html).toContain('data-testid="event-stream"');
  });

  it("renders the failed_recoverable state with the error panel and retry", () => {
    const html = render(
      makeRun({
        status: "failed_recoverable",
        lastError: { code: "TIMEOUT", recoverable: true, safeMessage: "请求超时", occurredAt: "2026-01-01T00:00:00.000Z" },
      }),
      [],
      { onRetry: () => undefined },
    );
    expect(html).toContain('data-testid="error-panel"');
    expect(html).toContain("可恢复");
    expect(html).toContain('data-testid="error-retry-button"');
    expect(html).toContain("重试");
  });

  it("renders the cancelled terminal state with disabled controls", () => {
    const html = render(makeRun({ status: "cancelled", currentNode: "cancel", wait: null, lastError: null }));
    expect(html).toContain('data-terminal="true"');
    expect(html).toContain("该运行已结束，不能继续操作");
    expect(html).not.toContain('data-testid="cancel-run-button"');
  });

  it("renders the completed terminal state", () => {
    const html = render(makeRun({ status: "completed", currentNode: "complete", completedAt: "2026-01-01T00:05:00.000Z" }));
    expect(html).toContain("已完成");
    expect(html).toContain("该运行已结束，不能继续操作");
  });

  it("renders the stage overview with a next-step hint", () => {
    const html = render(makeRun({ status: "running", currentNode: "dispatch_tool", wait: null, lastError: null }));
    expect(html).toContain('data-testid="v4-run-stage-nav"');
    expect(html).toContain("阶段总览");
    expect(html).toContain("下一步需要谁做什么");
    expect(html).toContain("自动推进中");
  });

  it("renders the evidence origins block from the report", () => {
    const report = {
      reportId: "rep_1",
      summary: "市场摘要",
      sections: [{ title: "需求", sentences: [{ text: "s", evidenceRefs: ["e1"], kind: "factual" }] }],
      gaps: [{ question: "q", reason: "r" }],
      conflicts: [{ evidenceA: "a", evidenceB: "b", field: "f" }],
      unknowns: ["u"],
      planRevision: 1,
      evidence: [{ type: "sellersprite", entity: "供应商A", fields: { offerIdentity: "o1" } }],
    };
    const html = renderToStaticMarkup(
      createElement(RunConsoleView, {
        run: makeRun(),
        events: [],
        report,
      }),
    );
    expect(html).toContain('data-testid="v4-evidence-origins"');
    expect(html).toContain("证据来源");
    expect(html).toContain("sellersprite");
    expect(html).toContain("供应商A");
  });

  it("shows an honest report-pending card while in-progress but report absent", () => {
    const html = render(makeRun({ status: "running", currentNode: "dispatch_tool", wait: null, lastError: null }));
    expect(html).toContain('data-testid="v4-report-pending"');
    expect(html).toContain("市场报告");
    expect(html).toContain("尚未生成");
  });

  it("does not show any pending card for a completed run (no coexist contradiction)", () => {
    const html = render(makeRun({ status: "completed", currentNode: "complete", completedAt: "2026-01-01T00:05:00.000Z" }));
    expect(html).not.toContain('data-testid="v4-report-pending"');
    expect(html).not.toContain('data-testid="v4-facts-pending"');
    expect(html).not.toContain('data-testid="v4-commercial-pending"');
    expect(html).not.toContain('data-testid="v4-content-pending"');
  });

  it("shows facts-pending at product_fact_gate when facts are missing", () => {
    const html = render(makeRun({ status: "waiting_human", currentNode: "product_fact_gate", wait: makeWait() }));
    expect(html).toContain('data-testid="v4-facts-pending"');
    expect(html).toContain("产品事实");
  });

  it("shows the product fact gate panel when facts are present", () => {
    const html = renderToStaticMarkup(
      createElement(RunConsoleView, {
        run: makeRun({ status: "waiting_human", currentNode: "product_fact_gate", wait: makeWait() }),
        events: [],
        facts: [{ key: "f1", variantKey: "v1", field: "material", value: "304" }],
        factCallbacks: { onConfirm: () => undefined, onReject: () => undefined, onUnknown: () => undefined, onConflict: () => undefined, onRevoke: () => undefined },
      }),
    );
    expect(html).toContain('data-testid="fact-gate-panel"');
    expect(html).not.toContain('data-testid="v4-facts-pending"');
  });

  it("shows commercial-pending at commercial_check when computation is absent", () => {
    const html = render(makeRun({ status: "running", currentNode: "commercial_check", wait: null, lastError: null }));
    expect(html).toContain('data-testid="v4-commercial-pending"');
    expect(html).toContain("商业评估");
  });

  it("shows content-pending at content_review when review is absent", () => {
    const html = render(makeRun({ status: "waiting_human", currentNode: "content_review", wait: makeWait() }));
    expect(html).toContain('data-testid="v4-content-pending"');
    expect(html).toContain("内容人工审核");
  });

  it("shows a recovery action for a recoverable failure", () => {
    const html = render(
      makeRun({ status: "failed_recoverable", currentNode: "fail", lastError: { code: "TIMEOUT", recoverable: true, safeMessage: "请求超时", occurredAt: "2026-01-01T00:00:00.000Z" } }),
      [],
      { onRetry: () => undefined },
    );
    expect(html).toContain('data-testid="error-panel"');
    expect(html).toContain('data-testid="error-retry-button"');
    expect(html).toContain('data-testid="primary-action"');
  });
});
