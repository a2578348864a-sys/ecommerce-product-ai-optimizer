import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InterruptPanel } from "./InterruptPanel";
import { makeRun, makeWait } from "./fixtures";

describe("InterruptPanel", () => {
  it("shows wait info and continue/stop buttons for human_decision", () => {
    const run = makeRun({ status: "waiting_human", wait: makeWait() });
    const html = renderToStaticMarkup(createElement(InterruptPanel, { run }));
    expect(html).toContain('data-testid="interrupt-panel"');
    expect(html).toContain('data-wait-kind="human_decision"');
    expect(html).toContain("等待人工处理");
    expect(html).toContain("GATE_A_REQUIRED");
    expect(html).toContain("请确认是否继续供应链验证。");
    expect(html).toContain('data-testid="interrupt-continue"');
    expect(html).toContain('data-testid="interrupt-stop"');
  });

  it("renders input field for input kind", () => {
    const run = makeRun({ status: "waiting_input", wait: makeWait({ kind: "input" }) });
    const html = renderToStaticMarkup(createElement(InterruptPanel, { run }));
    expect(html).toContain('data-testid="interrupt-input"');
    expect(html).toContain('data-testid="interrupt-submit"');
  });

  it("renders nothing when there is no wait", () => {
    const run = makeRun({ status: "running", wait: null });
    const html = renderToStaticMarkup(createElement(InterruptPanel, { run }));
    expect(html).toBe("");
  });
});
