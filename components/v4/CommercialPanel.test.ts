/**
 * V4 P4 — CommercialPanel 展示测试（三情景 / 未知缺失 / stale / 公式展开 / 无月赚金额）。
 *
 * 遵循本仓库测试约定：vitest 环境为 node，使用 react-dom/server 的 renderToStaticMarkup
 * 做静态渲染断言（无 DOM / 无 testing-library），纯断言 HTML 与 data-testid。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalcOutput, CalcStatus } from "@/lib/v4/calculator/contract";
import { CommercialPanel, SCENARIO_ORDER, formatBreakEven } from "@/components/v4/CommercialPanel";

function okOutput(): CalcOutput {
  return {
    schemaVersion: "calc-commercial.v1",
    scenarios: {
      optimistic: { landedCostPerUnit: 60, preAdContributionMargin: 40, marginRate: 0.4, breakEvenUnits: 25, moqCapital: 6000 },
      baseline: { landedCostPerUnit: 65, preAdContributionMargin: 35, marginRate: 0.35, breakEvenUnits: 30, moqCapital: 6500 },
      pessimistic: { landedCostPerUnit: 80, preAdContributionMargin: 20, marginRate: 0.2, breakEvenUnits: null, moqCapital: 8000 },
    },
    sensitiveVariables: [
      { name: "基础头程", deltaImpact: 0.06, direction: "up" },
      { name: "采购价", deltaImpact: 0.04, direction: "down" },
    ],
    unknowns: ["商品尺寸未提供（体积重未知）", "当地清关税率未提供"],
    uncoveredCosts: ["关税/税费", "广告获客", "仓储"],
    rules: {
      version: "calc-commercial.v1",
      marketplace: "Amazon US",
      category: "家居用品",
      reviewedAt: "2026-07-01T00:00:00Z",
      sourceUrl: "https://sellercentral.amazon.com/fee-calculator",
      stale: false,
    },
    generatedAt: "2026-08-21T00:00:00Z",
  };
}

const okStatus: CalcStatus = { ok: true, output: okOutput() };

function staleOutput(): CalcOutput {
  return {
    ...okOutput(),
    rules: {
      ...okOutput().rules,
      stale: true,
      reviewedAt: "2026-01-01T00:00:00Z",
      staleReason: "reviewedAt 距今超过 90 天",
    },
  };
}

const staleStatus: CalcStatus = { ok: true, output: staleOutput() };

const blockedStatus: CalcStatus = {
  ok: false,
  code: "BLOCKED_MISSING_INPUT",
  missing: ["尺寸/重量", "平台佣金率"],
  message: "缺少必要输入，无法计算。",
};

function render(status: CalcStatus, currency = "USD"): string {
  return renderToStaticMarkup(createElement(CommercialPanel, { status, currency }));
}

describe("CommercialPanel", () => {
  it("renders the three scenario cards with landed cost / margin / marginRate / break-even / MOQ capital", () => {
    const html = render(okStatus);
    expect(html).toContain('data-testid="commercial-panel"');
    for (const key of SCENARIO_ORDER) {
      expect(html).toContain('data-testid="commercial-scenario-' + key + '"');
    }
    // baseline 三情景数值（确定性格式化）
    expect(html).toContain("$65.00"); // 单件落地成本
    expect(html).toContain("$35.00"); // 每件广告前贡献
    expect(html).toContain("35%"); // margin rate
    expect(html).toContain("30 件"); // break-even
    expect(html).toContain("$6500.00"); // MOQ 占款
    // 悲观情景无盈亏平衡点
    expect(html).toContain("—（无盈亏平衡点）");
    expect(html).toContain("乐观情景");
    expect(html).toContain("基准情景");
    expect(html).toContain("悲观情景");
  });

  it("renders sensitive variables, unknowns, uncovered costs and rules meta", () => {
    const html = render(okStatus);
    expect(html).toContain('data-testid="commercial-sensitive-vars"');
    expect(html).toContain("基础头程");
    expect(html).toContain("最敏感变量");
    expect(html).toContain('data-testid="commercial-unknowns"');
    expect(html).toContain("商品尺寸未提供（体积重未知）");
    expect(html).toContain('data-testid="commercial-uncovered-costs"');
    expect(html).toContain("关税/税费");
    expect(html).toContain('data-testid="commercial-rules-meta"');
    expect(html).toContain("calc-commercial.v1");
    expect(html).toContain("Amazon US");
  });

  it("renders a collapsible formula expansion with formula structure and scenario assumptions", () => {
    const html = render(okStatus);
    expect(html).toContain('data-testid="commercial-formula"');
    expect(html).toContain("公式展开");
    expect(html).toContain("单件落地成本");
    expect(html).toContain("盈亏平衡销量");
    expect(html).toContain("头程 ×1.3");
  });

  it("shows a blocking state listing missing inputs when the calc result is not ok", () => {
    const html = render(blockedStatus);
    expect(html).toContain('data-testid="commercial-panel"');
    expect(html).toContain('data-testid="commercial-blocked"');
    expect(html).toContain("缺少必要输入");
    expect(html).toContain("尺寸/重量");
    expect(html).toContain("平台佣金率");
    expect(html).toContain("缺少必要输入，无法计算。");
  });

  it("shows a stale warning when rules are stale", () => {
    const html = render(staleStatus);
    expect(html).toContain('data-testid="commercial-stale-warning"');
    expect(html).toContain("规则已过时");
    expect(html).toContain("超过 90 天");
  });

  it("never renders a monthly-earnings amount (D8)", () => {
    const html = render(okStatus);
    expect(html).not.toContain("月赚");
    expect(html).not.toContain("月利润");
    expect(html).not.toContain("月收入");
    expect(html).not.toContain("每月");
  });

  it("formats break-even units and the no-break-even case", () => {
    expect(formatBreakEven(30)).toBe("30 件");
    expect(formatBreakEven(null)).toBe("—（无盈亏平衡点）");
  });
});
