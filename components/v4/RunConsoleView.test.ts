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
});
