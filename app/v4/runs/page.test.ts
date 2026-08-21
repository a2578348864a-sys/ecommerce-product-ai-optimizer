import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => null,
  WorkspaceMobileNav: () => null,
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: string; className?: string; "data-testid"?: string; children?: React.ReactNode }) =>
      React.createElement("a", { href: props.href, className: props.className, "data-testid": props["data-testid"] }, props.children),
  };
});

import V4RunsPage from "./page";

const FLAG = "QX_V4_GRAPH_ENABLED";

describe("V4 runs list page (C 端)", () => {
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("renders the disabled placeholder when the flag is off", () => {
    delete process.env[FLAG];
    const html = renderToStaticMarkup(createElement(V4RunsPage));
    expect(html).toContain('data-testid="v4-disabled-placeholder"');
  });

  it("renders a C 端 header with title, subtitle and a start-research CTA", () => {
    delete process.env[FLAG];
    const html = renderToStaticMarkup(createElement(V4RunsPage));
    expect(html).toContain("研究记录");
    expect(html).toContain("每次研究的状态与下一步都在这里。");
    expect(html).toContain("开始商品研究");
    expect(html).toContain('href="/opportunity-candidates"');
  });

  it("renders the run list client (loading) when the flag is on", () => {
    process.env[FLAG] = "1";
    const html = renderToStaticMarkup(createElement(V4RunsPage));
    expect(html).toContain('data-testid="run-list-loading"');
    expect(html).not.toContain('data-testid="v4-disabled-placeholder"');
  });
});