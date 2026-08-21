import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DebugView } from "@/components/v4/DebugView";
import { makeEvent, makeRun, makeWait } from "@/components/v4/fixtures";

describe("RunDebugPage — 开发调试详情", () => {
  it("renders the loading state", () => {
    const html = renderToStaticMarkup(createElement(DebugView, { run: null, events: [], loading: true, error: null }));
    expect(html).toContain('data-testid="debug-loading"');
  });

  it("renders the raw run info, budget detail and the full event stream", () => {
    const html = renderToStaticMarkup(
      createElement(DebugView, {
        run: makeRun({ status: "completed", currentNode: "complete", revision: 3 }),
        events: [makeEvent({ seq: 1, type: "run_created", node: "load_context" })],
        loading: false,
        error: null,
      }),
    );
    expect(html).toContain('data-testid="debug-view"');
    expect(html).toContain("开发调试详情（研究后台）");
    expect(html).toContain("completed");
    expect(html).toContain("rev.3");
    expect(html).toContain('data-testid="debug-run-raw"');
    expect(html).toContain('data-testid="debug-budget-raw"');
    expect(html).toContain('data-testid="debug-budget-raw"');
    expect(html).toContain('data-testid="debug-events-raw"');
    expect(html).toContain("run_created");
    expect(html).toContain("load_context");
    expect(html).toContain('data-testid="node-flow"');
    expect(html).toContain('data-testid="event-stream"');
  });

  it("renders raw wait / error codes when present", () => {
    const html = renderToStaticMarkup(
      createElement(DebugView, {
        run: makeRun({ status: "waiting_human", currentNode: "gate_a", wait: makeWait() }),
        events: [],
        loading: false,
        error: null,
      }),
    );
    expect(html).toContain('data-testid="debug-wait"');
    expect(html).toContain("human_decision");
    expect(html).toContain("GATE_A_REQUIRED");
  });

  it("renders an honest error state when the run is absent", () => {
    const html = renderToStaticMarkup(createElement(DebugView, { run: null, events: [], loading: false, error: "加载失败" }));
    expect(html).toContain('data-testid="debug-error"');
    expect(html).toContain("无法加载调试详情");
    expect(html).toContain("加载失败");
  });
});
