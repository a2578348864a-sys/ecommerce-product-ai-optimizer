import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => null,
  WorkspaceMobileNav: () => null,
}));

import V4RunsPage from "./page";

const FLAG = "QX_V4_GRAPH_ENABLED";

describe("V4 runs list page", () => {
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("renders the disabled placeholder when the flag is off", () => {
    delete process.env[FLAG];
    const html = renderToStaticMarkup(createElement(V4RunsPage));
    expect(html).toContain('data-testid="v4-disabled-placeholder"');
    expect(html).toContain("V4 研究图未启用");
  });

  it("renders the run list client (loading) when the flag is on", () => {
    process.env[FLAG] = "1";
    const html = renderToStaticMarkup(createElement(V4RunsPage));
    expect(html).toContain('data-testid="run-list-loading"');
    expect(html).not.toContain('data-testid="v4-disabled-placeholder"');
  });
});
