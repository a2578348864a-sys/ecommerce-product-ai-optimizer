import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: string; children?: React.ReactNode }) =>
      React.createElement("a", { href: props.href }, props.children),
  };
});

import { RunListTable } from "./RunListTable";
import { makeRunSummary } from "./fixtures";

describe("RunListTable", () => {
  it("renders the empty state", () => {
    const html = renderToStaticMarkup(createElement(RunListTable, { runs: [] }));
    expect(html).toContain('data-testid="run-list-empty"');
    expect(html).toContain("暂无 V4 研究运行记录");
  });

  it("renders run rows with status, node, revision and a detail link", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({ runId: "run_1", status: "running", currentNode: "dispatch_tool" }),
          makeRunSummary({ runId: "run_2", status: "cancelled", currentNode: "cancel" }),
        ],
      }),
    );
    expect(html).toContain('data-testid="run-list-table"');
    expect(html).toContain("run_1");
    expect(html).toContain("运行中");
    expect(html).toContain("调用工具");
    expect(html).toContain("已取消");
    expect(html).toContain("href=\"/v4/runs/run_1\"");
    expect(html).toContain("href=\"/v4/runs/run_2\"");
  });
});
