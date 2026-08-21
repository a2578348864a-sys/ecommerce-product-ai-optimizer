import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunStatusBadge } from "./RunStatusBadge";

describe("RunStatusBadge", () => {
  it("renders 运行中 for running", () => {
    const html = renderToStaticMarkup(createElement(RunStatusBadge, { status: "running" }));
    expect(html).toContain('data-testid="run-status-badge"');
    expect(html).toContain('data-status="running"');
    expect(html).toContain("运行中");
  });

  it("renders 等待人工 for waiting_human", () => {
    const html = renderToStaticMarkup(createElement(RunStatusBadge, { status: "waiting_human" }));
    expect(html).toContain("等待人工");
  });

  it("renders 已取消 for cancelled", () => {
    const html = renderToStaticMarkup(createElement(RunStatusBadge, { status: "cancelled" }));
    expect(html).toContain("已取消");
  });

  it("renders 已完成 for completed", () => {
    const html = renderToStaticMarkup(createElement(RunStatusBadge, { status: "completed" }));
    expect(html).toContain("已完成");
  });
});
