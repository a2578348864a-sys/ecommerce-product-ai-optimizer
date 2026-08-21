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

  it("shows the next human action when a wait is present", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({
            runId: "run_wait",
            status: "waiting_human",
            currentNode: "gate_a",
            wait: { kind: "human_decision", reasonCode: "GATE_A_REQUIRED", instructions: "请确认是否继续。", requestedAt: "2026-01-01T00:02:00.000Z" },
          }),
        ],
      }),
    );
    expect(html).toContain('data-testid="run-list-next-action"');
    expect(html).toContain("人工决策");
    expect(html).toContain("GATE_A_REQUIRED");
  });

  it("shows status semantics by dual encoding when there is no wait", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({ runId: "run_done", status: "completed", currentNode: "complete" }),
          makeRunSummary({ runId: "run_failed", status: "failed_recoverable", currentNode: "fail" }),
        ],
      }),
    );
    expect(html).toContain("已结束 · 完成");
    expect(html).toContain("可恢复失败 · 需重试");
    expect(html).toContain("已用成本");
  });

  it("prioritizes terminal status semantics over a stale wait", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({
            runId: "run_x",
            status: "completed",
            currentNode: "complete",
            wait: { kind: "human_decision", reasonCode: "GATE_A_REQUIRED", instructions: "x", requestedAt: "2026-01-01T00:02:00.000Z" },
          }),
        ],
      }),
    );
    expect(html).toContain("已结束 · 完成");
    expect(html).not.toContain("人工决策 · GATE_A_REQUIRED");
  });
});
