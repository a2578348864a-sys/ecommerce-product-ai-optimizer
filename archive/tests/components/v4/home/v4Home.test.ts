/**
 * V4.1 — 首页 V4 展示组件与 Featured Replay loader 测试。
 *
 * 遵循本仓库约定：vitest 环境为 node，react-dom/server renderToStaticMarkup 静态断言。
 * 校验：模式 Badge / CTA 矩阵（契约 §3）随 runtime 派生；7 阶段 + 3 闸门；4 价值卡；
 * Featured Replay 统计由真实 bundle 动态派生（74 步 / 5 人工决策 / 11 Guard），禁止硬编码。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBundle, type ReplayBundle } from "@/lib/v4/replay/schema";
import {
  deriveHeroCtas,
  v4ModeBadgeLabel,
  type FeaturedReplay,
  type HomeRuntime,
} from "./heroLogic";
import { V4Hero } from "./V4Hero";
import { V4Workflow, V4_WORKFLOW_STAGES, V4_WORKFLOW_GATES } from "./V4Workflow";
import { V4_VALUE_CARDS, V4ValueCards } from "./V4ValueCards";
import { V4FeaturedReplayCard } from "./V4FeaturedReplayCard";
import { V4BoundaryNotice } from "./V4BoundaryNotice";
import { resolveReplayMetrics } from "@/components/v4/replay-featured";

const PUBLIC: HomeRuntime = { mode: "public_showcase", noAuthOwner: false, v4Graph: false };
const LOCAL_LIVE: HomeRuntime = { mode: "local_owner", noAuthOwner: true, v4Graph: true };
const LOCAL_OFF: HomeRuntime = { mode: "local_owner", noAuthOwner: false, v4Graph: false };

const FEATURED: FeaturedReplay = {
  bundleId: "replay-b39aa5cccec5d45f2e74",
  candidateName: "便携保温杯",
  keyword: "stainless steel 保温杯",
  market: "US",
  link: "https://example.com/product/1",
  riskLevel: "未见明显风险",
  summary: "市场研究报告：证据充分，商品事实已确认。",
  thumbnail: { src: "https://example.com/img/1.jpg", alt: "脱敏案例缩略图" },
  capturedAt: "2026-08-21T15:31:51.166Z",
  exportedAt: "2026-08-21T16:02:08.309Z",
  scanOk: true,
  redactionEntries: 2,
  filesCount: 5,
  bundleSha256Short: "4826f6357e43",
  timelineSteps: 74,
  humanDecisions: 5,
  guardItems: 11,
};

describe("V4 home mode badge + CTA matrix", () => {
  it("derives the mode badge from runtime (public / local live / local off)", () => {
    expect(v4ModeBadgeLabel(PUBLIC)).toBe("Public Replay · 只读脱敏案例");
    expect(v4ModeBadgeLabel(LOCAL_LIVE)).toBe("Local Live · 可执行研究流程");
    expect(v4ModeBadgeLabel(LOCAL_OFF)).toBe("本地模式 · V4 未启用");
  });

  it("derives the CTA matrix per contract §3", () => {
    const pub = deriveHeroCtas(PUBLIC);
    expect(pub.primary).toEqual({ label: "查看真实脱敏案例", href: "/replay", primary: true });
    expect(pub.secondary).toEqual({ label: "了解研究流程", href: "#workflow", primary: false });

    const live = deriveHeroCtas(LOCAL_LIVE);
    expect(live.primary).toEqual({ label: "开始商品研究", href: "/v4/runs", primary: true });
    expect(live.secondary).toEqual({ label: "查看研究任务", href: "/v4/runs", primary: false });

    const off = deriveHeroCtas(LOCAL_OFF);
    expect(off.primary).toEqual({ label: "案例回放", href: "/replay", primary: true });
    // Local flag OFF：绝不渲染 Live CTA。
    expect(off.secondary).toBeNull();
  });
});

describe("V4Hero", () => {
  it("renders contract title, Evidence-first label and honest boundary", () => {
    const html = renderToStaticMarkup(createElement(V4Hero, { runtime: PUBLIC }));
    expect(html).toContain("Evidence-first · Human-in-the-loop");
    expect(html).toContain("AI 跨境商品研究与上架准备工作台");
    expect(html).toContain("从市场机会、证据、产品事实到 Listing / Image");
    expect(html).toContain("不预测爆款，不承诺盈利");
  });

  it("renders the Public mode badge and replay CTA", () => {
    const html = renderToStaticMarkup(createElement(V4Hero, { runtime: PUBLIC }));
    expect(html).toContain("Public Replay · 只读脱敏案例");
    expect(html).toContain('href="/replay"');
    expect(html).toContain("查看真实脱敏案例");
  });

  it("renders Local Live badge and /v4/runs CTAs when v4Graph on", () => {
    const html = renderToStaticMarkup(createElement(V4Hero, { runtime: LOCAL_LIVE }));
    expect(html).toContain("Local Live · 可执行研究流程");
    expect(html).toContain("开始商品研究");
    expect(html).toContain('href="/v4/runs"');
    expect(html).toContain("查看研究任务");
  });

  it("hides Live CTA when v4Graph is off", () => {
    const html = renderToStaticMarkup(createElement(V4Hero, { runtime: LOCAL_OFF }));
    expect(html).toContain("本地模式 · V4 未启用");
    expect(html).toContain("案例回放");
    expect(html).not.toContain("/v4/runs");
    expect(html).not.toContain("开始商品研究");
  });
});

describe("V4Workflow", () => {
  it("renders 7 stages and 3 gates", () => {
    expect(V4_WORKFLOW_STAGES).toHaveLength(7);
    expect(V4_WORKFLOW_GATES).toEqual(["Evidence Gate", "Product Fact Gate", "Human Decision"]);
    const html = renderToStaticMarkup(createElement(V4Workflow, {}));
    expect(html).toContain("Opportunity");
    expect(html).toContain("Content Preparation");
    expect(html).toContain("Human Decision");
    expect(html).toContain("Evidence Gate");
    expect(html).toContain("Product Fact Gate");
  });
});

describe("V4ValueCards", () => {
  it("renders 4 value cards with honest copy", () => {
    expect(V4_VALUE_CARDS).toHaveLength(4);
    const html = renderToStaticMarkup(createElement(V4ValueCards, {}));
    expect(html).toContain("Evidence，而不是无来源答案");
    expect(html).toContain("SupplierClaim 不自动成为产品事实");
    expect(html).toContain("AI 提建议，人做商业决策");
    expect(html).toContain("Listing/Image 只能读取已确认事实");
  });
});

describe("V4FeaturedReplayCard", () => {
  it("renders business fields, derived stats and replay CTA from real metrics", () => {
    const html = renderToStaticMarkup(createElement(V4FeaturedReplayCard, { featured: FEATURED }));
    expect(html).toContain("真实脱敏历史案例回放");
    expect(html).toContain("便携保温杯"); // 候选名为主标题，而非 UUID
    expect(html).toContain("报告结论摘要");
    expect(html).toContain("候选名");
    expect(html).toContain("关键词");
    expect(html).toContain("市场");
    expect(html).toContain("风险等级");
    expect(html).toContain("时间线步数");
    expect(html).toContain("人工决策");
    expect(html).toContain("Content Guard 项");
    expect(html).toContain("查看完整研究回放");
    expect(html).toContain("/replay/replay-b39aa5cccec5d45f2e74");
    expect(html).toContain("https://example.com/img/1.jpg");
  });

  it("renders honest empty states for absent business fields (no UUID title)", () => {
    const html = renderToStaticMarkup(createElement(V4FeaturedReplayCard, {
      featured: { ...FEATURED, candidateName: null, keyword: null, market: null, summary: null, riskLevel: null, link: null, thumbnail: null },
    }));
    expect(html).toContain("真实脱敏案例回放");
    expect(html).toContain("未记录");
    expect(html).toContain("无缩略图");
  });

  it("renders an honest empty state when no bundle is available", () => {
    const html = renderToStaticMarkup(createElement(V4FeaturedReplayCard, { featured: null }));
    expect(html).toContain("暂无可展示的真实脱敏案例回放");
    expect(html).not.toContain("查看完整研究回放");
  });
});

describe("V4BoundaryNotice", () => {
  it("adds the public-only real-time scraping disclaimer on public mode", () => {
    const pub = renderToStaticMarkup(createElement(V4BoundaryNotice, { runtime: PUBLIC }));
    expect(pub).toContain("不预测爆款，不保证销量或利润");
    expect(pub).toContain("公网不会实时抓取 Amazon / 1688");
  });

  it("omits the public-only line on local mode", () => {
    const local = renderToStaticMarkup(createElement(V4BoundaryNotice, { runtime: LOCAL_LIVE }));
    expect(local).toContain("不预测爆款，不保证销量或利润");
    expect(local).not.toContain("公网不会实时抓取");
  });
});

describe("Featured Replay loader — real bundle", () => {
  const raw = readFileSync(
    resolve(process.cwd(), "data/replay-bundles/replay-b39aa5cccec5d45f2e74.json"),
    "utf8",
  );
  const parsed = parseBundle(raw);
  if (!parsed.ok) throw new Error("published bundle must parse: " + parsed.code);
  const bundle: ReplayBundle = parsed.bundle;

  it("derives 74 steps / 5 human decisions / 11 Guard items from the real bundle", () => {
    const m = resolveReplayMetrics(bundle);
    expect(m.timelineSteps).toBe(74);
    expect(m.humanDecisions).toBe(5);
    expect(m.guardItems).toBe(11);
  });

  it("avoids UUID as candidate title and derives business fields honestly", () => {
    const m = resolveReplayMetrics(bundle);
    expect(m.bundleId).toBe("replay-b39aa5cccec5d45f2e74");
    expect(m.candidateName).toBeNull(); // candidate 仅有 id，不作为业务标题
    expect(m.keyword).toBeNull();
    expect(m.link).toBeNull();
    expect(m.thumbnail).toBeNull();
    expect(m.market).toBe("US");
    expect(m.summary).toBe("市场研究报告（1 条已验证证据，1 项缺口）。");
    expect(m.riskLevel).toBe("存在信息缺口");
    expect(m.scanOk).toBe(true);
    expect(m.redactionEntries).toBe(2);
    expect(m.filesCount).toBe(5);
    expect(m.bundleSha256Short).toMatch(/^[0-9a-f]{12}$/);
  });
});