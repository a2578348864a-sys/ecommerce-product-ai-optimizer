/**
 * V4 P6 — ReplayView 测试（标识文案 / capturedAt 时效 / Gate 决策历史 / Content Guard /
 * 无虚假进度 / 空态 / 数据解析）。
 *
 * 遵循本仓库测试约定：vitest 环境为 node，react-dom/server renderToStaticMarkup 静态断言。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReplayBundle } from "@/lib/v4/replay/schema";
import {
  isReplayStale,
  ReplayView,
  resolveContentChecks,
  resolveDisplayTitle,
  resolveGates,
  resolveTimelineSteps,
} from "./ReplayView";

const SHA = (c: string) => c.repeat(64);

function makeBundle(overrides: Record<string, unknown> = {}): ReplayBundle {
  return {
    schemaVersion: "replay-bundle.v1",
    bundleId: "bundle_1",
    sourceRunId: "run_1",
    exportedAt: "2026-08-21T00:00:00.000Z",
    capturedAt: "2026-08-20T00:00:00.000Z",
    mode: "replay",
    allowlistVersion: "replay.allowlist.v1",
    manifest: {
      files: [{ path: "data/run.json", sha256: SHA("a") }],
      bundleSha256: SHA("b"),
    },
    redactionReport: {
      entries: [
        { field: "email", kind: "pii", action: "redacted" },
        { field: "C:\local\path", kind: "path", action: "removed" },
      ],
      scannedAt: "2026-08-21T00:00:00.000Z",
      scanOk: true,
    },
    data: {
      candidate: { name: "便携保温杯" },
      timeline: [
        { id: "s1", at: "2026-08-20T00:00:01.000Z", title: "加载上下文" },
        { id: "s2", at: "2026-08-20T00:00:02.000Z", title: "市场综合分析", kind: "synthesize_market" },
      ],
      events: [{ seq: 1, type: "node_entered", node: "load_context", payloadJson: "{}", createdAt: "2026-08-20T00:00:01.000Z" }],
      evidenceRefs: [
        { id: "rev-1", label: "评论样本", summary: "用户反馈：便携、耐用。", sourceUrl: "https://example.com/review/1", capturedAt: "2026-08-20T00:00:00.000Z" },
      ],
      gates: [
        { gate: "gate_a", decision: "proceed", reason: "信息充分，进入供应商验证", actor: "owner", decidedAt: "2026-08-20T00:02:00.000Z" },
      ],
      content: {
        guards: [
          { title: "禁用词", status: "阻断", findings: ["夸大功效"] },
          { title: "事实一致性", status: "通过" },
        ],
      },
    },
    ...overrides,
  } as ReplayBundle;
}

const NOW = new Date("2026-08-21T00:00:00.000Z");

describe("ReplayView", () => {
  it("renders the 真实脱敏历史案例回放 badge and capturedAt/export/source metadata", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle: makeBundle(), now: NOW }));
    expect(html).toContain("真实脱敏历史案例回放");
    expect(html).toContain('data-testid="replay-kind-badge"');
    expect(html).toContain('data-testid="replay-captured-at"');
    expect(html).toContain("回放时点：");
    expect(html).toContain("导出于：");
    expect(html).toContain("来源 Run：run_1");
    expect(html).toContain("案例回放：便携保温杯");
  });

  it("never renders a fake progress bar/percentage or a monthly-earnings claim", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle: makeBundle(), now: NOW }));
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("<progress");
    expect(html).not.toContain("月赚");
    expect(html).not.toContain("月利润");
    expect(html).not.toContain("月收入");
  });

  it("renders Gate decision records as read-only history (no inputs or submit buttons)", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle: makeBundle(), now: NOW }));
    expect(html).toContain('data-testid="replay-gates"');
    expect(html).toContain("Gate 决策记录（历史，不可修改）");
    expect(html).toContain('data-testid="replay-gate-record"');
  expect(html).toContain("门禁 A");
    expect(html).toContain("proceed");
    expect(html).toContain("信息充分，进入供应商验证");
    expect(html).toContain("owner");
    expect(html).not.toContain("<input");
    expect(html).not.toContain('type="submit"');
  });

  it("renders Content Guard results as read-only history", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle: makeBundle(), now: NOW }));
    expect(html).toContain('data-testid="replay-content-guard"');
    expect(html).toContain('data-testid="replay-content-check"');
    expect(html).toContain("禁用词");
    expect(html).toContain("阻断");
    expect(html).toContain("夸大功效");
    expect(html).toContain("事实一致性");
  });

  it("shows a stale/时效 warning when capturedAt is older than the threshold", () => {
    const staleBundle = makeBundle({ capturedAt: "2020-01-01T00:00:00.000Z" });
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle: staleBundle, now: NOW }));
    expect(html).toContain('data-testid="replay-stale-warning"');
    expect(html).toContain("可能已过时效");
  });

  it("shows empty states for gates and content when absent", () => {
    const empty = makeBundle({ data: { candidate: { name: "无门禁案例" }, timeline: [] } });
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle: empty, now: NOW }));
    expect(html).toContain("无 Gate 决策记录");
    expect(html).toContain("无内容守卫记录");
    expect(html).toContain("暂无回放步骤记录");
  });
});

describe("ReplayView resolvers", () => {
  it("resolves timeline steps from data.timeline, and falls back to events", () => {
    const steps = resolveTimelineSteps(makeBundle());
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].title).toBe("加载上下文");

    const fromEvents = resolveTimelineSteps(
      makeBundle({ data: { events: [{ seq: 1, type: "node_entered", node: "load_context", payloadJson: "{}", createdAt: "2026-08-20T00:00:01.000Z" }] } }),
    );
    expect(fromEvents.length).toBe(1);
    expect(fromEvents[0].id).toBe("ev-1");
  });

  it("resolves gate decisions and content checks defensively", () => {
    expect(resolveGates(makeBundle()).length).toBe(1);
    expect(resolveGates(makeBundle()).map((g) => g.gate)).toEqual(["gate_a"]);
    expect(resolveContentChecks(makeBundle()).map((c) => c.title)).toEqual(["禁用词", "事实一致性"]);
  });

  it("resolves a display title from candidate business name, falling back to honest empty state", () => {
    expect(resolveDisplayTitle(makeBundle())).toBe("便携保温杯");
    // 无业务名时不回退为 bundle id / 候选 UUID（硬门禁：不得以 UUID 为主标题）。
    expect(resolveDisplayTitle(makeBundle({ data: {} }))).toBe("未命名案例");
    expect(resolveDisplayTitle(makeBundle({ data: { candidate: { id: "91a60705-3cbd-46ff-888a-9a111eeaf64d" } } }))).toBe("未命名案例");
  });

  it("detects replay staleness only when capturedAt is old", () => {
    expect(isReplayStale("2026-08-20T00:00:00.000Z", NOW, 30)).toBe(false);
    expect(isReplayStale("2020-01-01T00:00:00.000Z", NOW, 30)).toBe(true);
    expect(isReplayStale("", NOW, 30)).toBe(false);
  });
});
