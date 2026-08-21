/**
 * V4 P6 / v4.0.1 — 真实发布 bundle 回归测试（hydrate 时区 / Gate 事件映射 / Content Guard 映射）。
 *
 * 直接使用当前发布的脱敏 bundle（data/replay-bundles/replay-b39aa5cccec5d45f2e74.json），
 * 禁止只用理想化 fixture：时间线步数、hash/脱敏元数据、human_decision → Gate、
 * content.images.checks / content.listing → Content Guard 均以真实数据断言。
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
  resolveTimelineSteps,
} from "./ReplayView";
import { formatDateTime } from "./labels";

const raw = readFileSync(
  resolve(process.cwd(), "data/replay-bundles/replay-b39aa5cccec5d45f2e74.json"),
  "utf8",
);
const parsed = parseBundle(raw);
if (!parsed.ok) throw new Error("published bundle must parse: " + parsed.code);
const bundle: ReplayBundle = parsed.bundle;

const NOW = new Date("2026-08-22T00:00:00.000Z");

describe("V4 Replay — 真实发布 bundle 回归（v4.0.1）", () => {
  it("时间线 74 步，hash / 脱敏元数据与发布时一致", () => {
    const steps = resolveTimelineSteps(bundle);
    expect(steps.length).toBe(74);
    expect(bundle.redactionReport.scanOk).toBe(true);
    expect(bundle.manifest.files.length).toBe(5);
    expect(bundle.manifest.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Gate 决策区从实际 events 映射出 5 条 human_decision（含内容审核批准导出）", () => {
    const gates = resolveGates(bundle);
    expect(gates.length).toBe(5);
    const decisions = gates.map((g) => g.decision);
    expect(decisions).toEqual(expect.arrayContaining(["continue_sourcing", "content_ready", "approve_export"]));
    const review = gates.find((g) => g.gate === "content_review");
    expect(review).toBeDefined();
    expect(review?.decidedAt).toBeTruthy();
  });

  it("Content Guard 显示 blocked 与具体检查项（identity 失败）与 Listing 守卫", () => {
    const checks = resolveContentChecks(bundle);
    const blocked = checks.find((c) => c.status === "blocked");
    expect(blocked).toBeDefined();
    expect(checks.some((c) => c.title.includes("identity"))).toBe(true);
    const listing = checks.find((c) => c.title.includes("Listing"));
    expect(listing).toBeDefined();
    expect(listing?.status).toBe("通过");
  });

  it("固定时区（Asia/Shanghai）格式化：SSR/客户端一致，不随进程时区漂移", () => {
    // 2026-08-21T15:31:51.166Z（UTC）= 2026-08-21 23:31（Asia/Shanghai）
    expect(formatDateTime(bundle.capturedAt)).toBe("2026年8月21日 23:31");
    expect(formatDateTime(bundle.exportedAt)).toBe("2026年8月22日 00:02");
  });

  it("渲染无崩溃：标识 / 步数指示 / 决策 / 守卫文案齐备", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    expect(html).toContain("真实脱敏历史案例回放");
    expect(html).toContain("第 1 / 74 步");
    expect(html).toContain("继续研究（continue_sourcing）");
    expect(html).toContain("批准导出（approve_export）");
    expect(html).toContain("blocked");
    expect(html).toContain("视觉检查 · identity");
    expect(html).toContain("Listing 内容守卫");
  });
});

