/**
 * V4.1 P4 — Replay 链路统计（动态派生）与摘要层渲染测试。
 *
 * 使用当前发布的脱敏 bundle（data/replay-bundles/replay-b39aa5cccec5d45f2e74.json），
 * 断言 resolveReplayMetrics 对真实 bundle 动态派生出
 * { events: 74, gates: 5, checks: 11, scanOk: true, redactionEntries: 2 }，
 * 并验证 ReplayView 的「回放链路概览」摘要层渲染出这些统计（信息层级在时间线之前）。
 * 禁止把 74/5/11 当作通用数据硬编码——仅作为该真实 bundle 的动态统计回归。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseBundle, type ReplayBundle } from "@/lib/v4/replay/schema";
import {
  ReplayView,
  resolveContentChecks,
  resolveGates,
  resolveReplayMetrics,
  resolveTimelineSteps,
} from "./ReplayView";

const raw = readFileSync(
  resolve(process.cwd(), "data/replay-bundles/replay-b39aa5cccec5d45f2e74.json"),
  "utf8",
);
const parsed = parseBundle(raw);
if (!parsed.ok) throw new Error("published bundle must parse: " + parsed.code);
const bundle: ReplayBundle = parsed.bundle;

const NOW = new Date("2026-08-22T00:00:00.000Z");

/** 提取摘要层某个统计卡 <dd> 内的文本（无正则反斜杠，稳健）。 */
function cellValue(html: string, testid: string): string {
  const start = html.indexOf('data-testid="' + testid + '"');
  if (start < 0) return "";
  const ddStart = html.indexOf("<dd", start);
  if (ddStart < 0) return "";
  const ddOpen = html.indexOf(">", ddStart);
  const ddEnd = html.indexOf("</dd>", ddOpen);
  if (ddOpen < 0 || ddEnd < 0) return "";
  return html.slice(ddOpen + 1, ddEnd).trim();
}

describe("V4 Replay — 链路统计（resolveReplayMetrics）真实 bundle 动态派生", () => {
  it("真实发布 bundle 的动态统计 = { events:74, gates:5, checks:11, scanOk:true, redactionEntries:2 }", () => {
    const m = resolveReplayMetrics(bundle);
    expect(m.events).toBe(74);
    expect(m.gates).toBe(5);
    expect(m.checks).toBe(11);
    expect(m.scanOk).toBe(true);
    expect(m.redactionEntries).toBe(2);
    // hash 与解析器一致：不硬编码，取自真实 manifest。
    expect(m.bundleSha256).toBe(bundle.manifest.bundleSha256);
    expect(m.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("统计与各派生解析器（resolveTimelineSteps/resolveGates/resolveContentChecks）一致", () => {
    const m = resolveReplayMetrics(bundle);
    expect(m.events).toBe(resolveTimelineSteps(bundle).length);
    expect(m.gates).toBe(resolveGates(bundle).length);
    expect(m.checks).toBe(resolveContentChecks(bundle).length);
  });

  it("摘要层渲染真实统计：事件步骤 / 人工决策 / Content Guard / 脱敏字段 / 扫描 / hash 前缀", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    // 摘要层存在，且位于时间线之前（信息层级：先完整链路概览，再时间线）。
    const summaryIdx = html.indexOf('data-testid="replay-summary"');
    const timelineIdx = html.indexOf('data-testid="replay-timeline"');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(timelineIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeLessThan(timelineIdx);

    const prefix = bundle.manifest.bundleSha256.slice(0, 12);
    expect(cellValue(html, "replay-metric-events")).toBe("74");
    expect(cellValue(html, "replay-metric-gates")).toBe("5");
    expect(cellValue(html, "replay-metric-checks")).toBe("11");
    expect(cellValue(html, "replay-metric-redaction")).toBe("2");
    expect(cellValue(html, "replay-metric-scan")).toBe("通过");
    expect(cellValue(html, "replay-metric-hash")).toBe(prefix + "…");
  });

  it("摘要层为只读展示：不含任何表单控件 / 提交按钮", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    const summary = html.slice(html.indexOf('data-testid="replay-summary"'), html.indexOf('data-testid="replay-redaction"'));
    expect(summary).not.toContain("<input");
    expect(summary).not.toContain('type="submit"');
    expect(summary).not.toContain('role="progressbar"');
  });
});
