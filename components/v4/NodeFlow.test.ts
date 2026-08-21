import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodeFlow } from "./NodeFlow";

describe("NodeFlow", () => {
  it("marks prior nodes done and current node current", () => {
    const html = renderToStaticMarkup(createElement(NodeFlow, { currentNode: "dispatch_tool" }));
    expect(html).toContain('data-testid="node-flow"');
    expect(html).toContain('data-node="load_context"');
    expect(html).toContain('data-phase="done"');
    expect(html).toContain('data-node="dispatch_tool"');
    expect(html).toContain('data-phase="current"');
  });

  it("marks gate_a as current", () => {
    const html = renderToStaticMarkup(createElement(NodeFlow, { currentNode: "gate_a" }));
    expect(html).toContain('data-node="gate_a"');
    expect(html).toContain('data-phase="current"');
  });

  it("handles terminal node not in the flow", () => {
    const html = renderToStaticMarkup(createElement(NodeFlow, { currentNode: "fail" }));
    expect(html).toContain("已到达终态节点");
  });
});
