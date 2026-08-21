import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: string; className?: string; "data-testid"?: string; children?: React.ReactNode }) =>
      React.createElement("a", { href: props.href, className: props.className, "data-testid": props["data-testid"] }, props.children),
  };
});

import { RunListTable } from "./RunListTable";
import { makeRunSummary } from "./fixtures";

describe("RunListTable (C 端)", () => {
  it("renders the honest empty state", () => {
    const html = renderToStaticMarkup(createElement(RunListTable, { runs: [] }));
    expect(html).toContain('data-testid="run-list-empty"');
    expect(html).toContain("还没有研究记录。点击上方开始商品研究。");
  });

  it("renders a C 端 card: product name, keyword, marketplace, Chinese status and a next-step button", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({
            runId: "run_1",
            candidateLabel: "蓝牙耳机",
            keyword: "wireless earbuds",
            marketplace: "US",
            status: "running",
          }),
        ],
      }),
    );

    expect(html).toContain('data-testid="run-list-table"');
    expect(html).toContain("蓝牙耳机");
    expect(html).toContain("主关键词：wireless earbuds");
    expect(html).toContain("Amazon 市场：US");
    // 状态为中文，而非内部英文枚举
    expect(html).toContain("进行中");
    expect(html).toContain('data-testid="run-list-first-gap"');
    expect(html).toContain("当前缺口：暂无缺口");
    // 第 1 个字符占位块
    expect(html).toContain("蓝牙");

    // 主视区链接可见文本是商品名，而非 runId（runId 只出现在 href 与调试折叠）
    expect(html).toMatch(/<a href="\/v4\/runs\/run_1"[^>]*>蓝牙耳机<\/a>/);

    // 内部工程字段不进主视区（只出现在 <details> 调试折叠里）
    const beforeDebug = html.slice(0, html.indexOf('data-testid="run-list-debug"'));
    expect(beforeDebug).not.toContain("dispatch_tool");
    expect(beforeDebug).not.toContain("rev.");
    expect(beforeDebug).not.toContain("已用成本");

    expect(html).toContain("调试详情");
    expect(html).toContain("run_1"); // 调试折叠里有运行 id
  });

  it("derives the label 补充关键词数据 when the most important gap mentions 关键词", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({
            runId: "run_kw",
            candidateLabel: "保温杯",
            status: "waiting_human",
            wait: { kind: "human_decision", reasonCode: "GATE_A_REQUIRED", instructions: "x", requestedAt: "2026-01-01T00:02:00.000Z" },
            firstGap: "主关键词数据不足，需要补充核心关键词。",
          }),
        ],
      }),
    );
    expect(html).toContain('data-testid="run-list-next-action"');
    expect(html).toContain("补充关键词数据");
    expect(html).not.toContain("去确认");
  });

  it("derives the label 填写采购成本 when the most important gap mentions 成本", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({
            runId: "run_cost",
            candidateLabel: "车载支架",
            status: "waiting_human",
            wait: { kind: "human_decision", reasonCode: "GATE_A_REQUIRED", instructions: "x", requestedAt: "2026-01-01T00:02:00.000Z" },
            firstGap: "采购成本与售价尚未填写，请补充。",
          }),
        ],
      }),
    );
    expect(html).toContain("填写采购成本");
  });

  it("derives 去确认 for a plain human wait and 补充资料 for an input wait", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({ runId: "r1", candidateLabel: "A", status: "waiting_human", wait: { kind: "human_decision", reasonCode: "GATE_A_REQUIRED", instructions: "x", requestedAt: "2026-01-01T00:02:00.000Z" } }),
          makeRunSummary({ runId: "r2", candidateLabel: "B", status: "waiting_input", wait: { kind: "input", reasonCode: "INPUT_NEEDED", instructions: "x", requestedAt: "2026-01-01T00:02:00.000Z" } }),
        ],
      }),
    );
    expect(html).toContain("去确认");
    expect(html).toContain("补充资料");
  });

  it("derives terminal action labels by status", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({ runId: "r_done", candidateLabel: "A", status: "completed" }),
          makeRunSummary({ runId: "r_retry", candidateLabel: "B", status: "failed_recoverable" }),
          makeRunSummary({ runId: "r_term", candidateLabel: "C", status: "failed_terminal" }),
          makeRunSummary({ runId: "r_cancel", candidateLabel: "D", status: "cancelled" }),
        ],
      }),
    );
    expect(html).toContain("查看结论");
    expect(html).toContain("重试");
    expect(html).toContain("查看详情");
    expect(html).not.toContain("补充资料");
  });

  it("prioritizes a terminal status over a stale wait", () => {
    const html = renderToStaticMarkup(
      createElement(RunListTable, {
        runs: [
          makeRunSummary({
            runId: "r_x",
            candidateLabel: "A",
            status: "completed",
            wait: { kind: "human_decision", reasonCode: "GATE_A_REQUIRED", instructions: "x", requestedAt: "2026-01-01T00:02:00.000Z" },
            firstGap: "采购成本与售价尚未填写，请补充。",
          }),
        ],
      }),
    );
    expect(html).toContain("查看结论");
    expect(html).not.toContain("填写采购成本");
    expect(html).not.toContain("去确认");
  });
});