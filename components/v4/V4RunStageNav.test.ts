import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { V4RunStageNav } from "./V4RunStageNav";
import { makeRun, makeWait } from "./fixtures";

function render(run: ReturnType<typeof makeRun>) {
  return renderToStaticMarkup(createElement(V4RunStageNav, { run }));
}

describe("V4RunStageNav — stage overview", () => {
  it("renders the full main-chain stage labels", () => {
    const html = render(makeRun({ status: "running", currentNode: "dispatch_tool" }));
    expect(html).toContain('data-testid="v4-run-stage-nav"');
    for (const label of [
      "研究计划",
      "市场证据",
      "Gate A",
      "供应链",
      "Product Fact Gate",
      "商业评估",
      "Gate B",
      "Listing / Image",
      "Content Review",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("marks the reached stage as current and the earlier ones as done", () => {
    const html = render(makeRun({ status: "running", currentNode: "gate_a" }));
    expect(html).toMatch(/data-stage="gate_a"[^>]*data-phase="current"/);
    expect(html).toMatch(/data-stage="plan"[^>]*data-phase="done"/);
    expect(html).toMatch(/data-stage="market"[^>]*data-phase="done"/);
    expect(html).toMatch(/data-stage="supply"[^>]*data-phase="todo"/);
  });

  it("shows the next human action hint when waiting", () => {
    const html = render(makeRun({ status: "waiting_human", currentNode: "gate_a", wait: makeWait() }));
    expect(html).toContain('data-testid="v4-next-step"');
    expect(html).toContain("下一步需要谁做什么");
    expect(html).toContain("你");
    expect(html).toContain("人工决策");
    expect(html).toContain("GATE_A_REQUIRED");
  });

  it("shows the AI auto-advance hint when running without a wait", () => {
    const html = render(makeRun({ status: "running", currentNode: "synthesize_market", wait: null }));
    expect(html).toContain('data-testid="v4-next-step"');
    expect(html).toContain("AI");
    expect(html).toContain("自动推进中 · 市场综合分析");
  });

  it("marks all stages done when completed and hints the terminal", () => {
    const html = render(makeRun({ status: "completed", currentNode: "complete", completedAt: "2026-01-01T00:05:00.000Z" }));
    expect(html).not.toMatch(/data-phase="current"/);
    expect(html).toMatch(/data-stage="review"[^>]*data-phase="done"/);
    expect(html).toContain("任务已完成");
  });

  it("prioritizes terminal status over a stale wait", () => {
    const html = render(makeRun({ status: "completed", currentNode: "complete", wait: makeWait(), completedAt: "2026-01-01T00:05:00.000Z" }));
    expect(html).toContain("任务已完成");
    expect(html).not.toContain("人工决策（GATE_A_REQUIRED）");
  });

  it("gives a recovery hint for a recoverable failure", () => {
    const html = render(makeRun({ status: "failed_recoverable", currentNode: "fail", lastError: { code: "TIMEOUT", recoverable: true, safeMessage: "请求超时", occurredAt: "2026-01-01T00:00:00.000Z" } }));
    expect(html).toContain("重试以恢复流程");
  });
});
