/**
 * V4.1 — Replay 业务字段 / 业务阶段 / 证据来源（真实 bundle 派生 + 渲染）测试。
 *
 * 使用当前发布的脱敏 bundle（data/replay-bundles/replay-b39aa5cccec5d45f2e74.json）：
 *   - 业务字段：商品名/关键词/市场/结论/风险/缩略图（无 → 诚实空态，不以 UUID 为主标题）；
 *   - 业务阶段：默认展示 8 阶段（市场证据→Gate A→供应商→产品事实→商业→Gate B→Listing/Image→Content Review）；
 *   - 证据来源：来自 data.report.evidence[] 的真实字段（来源类型/实体/时间/原始定位），非仅引用数量。
 * 全部数字与字段由真实 bundle 动态派生，不硬编码。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseBundle, type ReplayBundle } from "@/lib/v4/replay/schema";
import {
  BUSINESS_STAGE_ORDER,
  ReplayView,
  resolveBusinessFields,
  resolveBusinessStages,
  resolveEvidenceItems,
} from "./ReplayView";

const raw = readFileSync(
  resolve(process.cwd(), "data/replay-bundles/replay-b39aa5cccec5d45f2e74.json"),
  "utf8",
);
const parsed = parseBundle(raw);
if (!parsed.ok) throw new Error("published bundle must parse: " + parsed.code);
const bundle: ReplayBundle = parsed.bundle;

const NOW = new Date("2026-08-22T00:00:00.000Z");
const CANDIDATE_UUID = "91a60705-3cbd-46ff-888a-9a111eeaf64d";

describe("V4 Replay — 业务字段（真实 bundle）", () => {
  it("商品名/关键词/缩略图/链接为诚实空态（候选只有内部 UUID），市场/结论/风险来自真实字段", () => {
    const f = resolveBusinessFields(bundle);
    // 候选仅有内部 UUID：不得成为业务名/主标题。
    expect(f.productName).toBe("");
    expect(f.keyword).toBe("");
    expect(f.thumbnail).toBe("");
    expect(f.link).toBe("");
    // 市场与结论来自报告；风险来自真实信号聚合。
    expect(f.market).toBe("US");
    expect(f.conclusion).toContain("市场研究报告");
    expect(f.risk).toContain("图片视觉事实检查未通过（blocked）");
    expect(f.riskLevel).toBe("");
  });
});

describe("V4 Replay — 业务阶段（真实 bundle，默认展示顺序）", () => {
  it("返回 BUSINESS_STAGE_ORDER 的 8 个阶段（key 与 label）", () => {
    const stages = resolveBusinessStages(bundle);
    expect(stages.map((s) => s.key)).toEqual(BUSINESS_STAGE_ORDER.map((s) => s.key));
    expect(stages).toHaveLength(8);
    expect(stages.map((s) => s.label)).toContain("市场证据");
    expect(stages.map((s) => s.label)).toContain("Content Review");
  });

  it("各阶段读取真实数据：Gate A 继续研究 / 供应商信息缺口 / 商业 baseline / Listing-Image blocked", () => {
    const stages = resolveBusinessStages(bundle);
    const gateA = stages.find((s) => s.key === "gate_a");
    expect(gateA?.badge).toContain("continue_sourcing");
    const supplier = stages.find((s) => s.key === "supplier");
    expect(supplier?.status).toBe("信息缺口");
    expect(supplier?.summary).toContain("no_results");
    const commercial = stages.find((s) => s.key === "commercial");
    expect(commercial?.badge).toBe("baseline");
    const listingImage = stages.find((s) => s.key === "listing_image");
    expect(listingImage?.status).toBe("blocked");
    expect(listingImage?.badge).toContain("blocked");
  });
});

describe("V4 Replay — 证据来源（真实 bundle）", () => {
  it("从 data.report.evidence[] 读取真实字段（来源类型/实体/时间/原始定位），非仅引用数量", () => {
    const items = resolveEvidenceItems(bundle);
    expect(items).toHaveLength(1);
    const ev = items[0];
    expect(ev.type).toBe("sellersprite");
    expect(ev.entity).toBe("Kitchen Storage");
    expect(ev.observedAt).toBeTruthy();
    expect(ev.sourceRef).toBe("candidateProfiles:evidence_sufficient");
    expect(ev.warnings).toEqual([]);
    expect(ev.conflicts).toEqual([]);
  });
});

describe("V4 Replay — 渲染（业务信息/业务阶段/证据/高级详情）", () => {
  it("主标题为业务名或诚实空态，绝不把候选 UUID 当主标题", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    expect(html).toContain("案例回放：未命名案例");
    expect(html).not.toContain("案例回放：" + CANDIDATE_UUID);
  });

  it("渲染业务信息卡（商品名/关键词/市场/风险/缩略图）、业务阶段、证据来源与高级详情", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    expect(html).toContain('data-testid="replay-business"');
    expect(html).toContain('data-testid="replay-business-market"');
    expect(html).toContain('data-testid="replay-business-thumbnail"');
    expect(html).toContain("暂无缩略图");
    expect(html).toContain('data-testid="replay-stages"');
    expect(html).toContain('data-testid="replay-stage-market_evidence"');
    expect(html).toContain('data-testid="replay-stage-listing_image"');
    expect(html).toContain('data-testid="replay-evidence"');
    expect(html).toContain('data-testid="replay-evidence-item"');
    expect(html).toContain('data-testid="replay-advanced-details"');
  });

  it("信息层级：业务阶段在原始时间线之前（高级详情折叠区里保留时间线）", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    const stagesIdx = html.indexOf('data-testid="replay-stages"');
    const timelineIdx = html.indexOf('data-testid="replay-timeline"');
    expect(stagesIdx).toBeGreaterThan(-1);
    expect(timelineIdx).toBeGreaterThan(-1);
    expect(stagesIdx).toBeLessThan(timelineIdx);
  });

  it("整体仍为只读：业务/阶段/证据部分不含任何表单控件或提交按钮", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { bundle, now: NOW }));
    const main = html.slice(html.indexOf('data-testid="replay-business"'), html.indexOf('data-testid="replay-advanced-details"'));
    expect(main).not.toContain("<input");
    expect(main).not.toContain('type="submit"');
    expect(main).not.toContain("<select");
    expect(main).not.toContain('role="progressbar"');
  });
});
