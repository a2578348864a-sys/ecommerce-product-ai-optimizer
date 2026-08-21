import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => null,
  WorkspaceMobileNav: () => null,
}));

import V4RunDetailPage from "./page";

const FLAG = "QX_V4_GRAPH_ENABLED";

describe("V4 run detail page", () => {
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("renders the disabled placeholder when the flag is off", async () => {
    delete process.env[FLAG];
    const el = await V4RunDetailPage({ params: Promise.resolve({ runId: "run_1" }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('data-testid="v4-disabled-placeholder"');
    expect(html).toContain("V4 研究图未启用");
  });

  it("renders the run console client (loading) when the flag is on", async () => {
    process.env[FLAG] = "1";
    const el = await V4RunDetailPage({ params: Promise.resolve({ runId: "run_1" }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('data-testid="run-console-loading"');
    expect(html).not.toContain('data-testid="v4-disabled-placeholder"');
  });
});
