import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AiEvidenceSummarySection } from "./AiEvidenceSummarySection";

/**
 * 轮 13：AI 研究摘要区 用户语言收口（business language）。
 * 断言用户可见文案不得出现 Evidence / EvidenceRef / 证据总结（内部词），
 * 并显示业务用语「引用校验通过」「AI 研究摘要」。
 */

const base = {
  runId: "run-abc12345",
  model: "deepseek-test",
  gateResult: "pass",
  evidenceRefCoverage: { total: 21, withRefs: 15 },
  startedAt: "2026-08-14T02:00:00.000Z",
  finishedAt: "2026-08-14T02:01:00.000Z",
  summary: {
    facts: [{ id: "f1", type: "fact", text: "这是一个事实", evidenceRefs: ["e1"] }],
    estimates: [],
    signals: [],
    risks: [],
    conflicts: [],
    missing: [],
    nextSteps: [],
  },
  noviceExplanation: {
    whatWeKnow: "知道",
    whatWeDontKnow: "不知道",
    biggestRisk: "风险",
    why: "原因",
    nextToResearch: "下一步",
  },
  unverified: [],
  updatedAt: "2026-08-14T02:01:00.000Z",
};

function renderWith(summary: unknown) {
  return renderToStaticMarkup(createElement(AiEvidenceSummarySection, {
    taskId: "task-x",
    summary: summary as never,
    businessModules: null,
    storageVersion: null,
    onChanged: () => undefined,
  } as never));
}

describe("AiEvidenceSummarySection 用户语言（R5 安全状态）", () => {
  it("有摘要：显示安全说明与重新生成按钮，不出现 EvidenceRef/Evidence/证据总结/原始 gateResult", () => {
    const html = renderWith(true);
    expect(html).toContain("已基于采集证据生成研究摘要");
    expect(html).toContain("重新生成");
    expect(html).not.toContain("EvidenceRef");
    expect(html).not.toContain("Evidence");
    expect(html).not.toContain("证据总结");
    expect(html).not.toContain("引用校验通过");
    expect(html).not.toContain("gateResult");
  });
  it("无摘要：按钮显示「生成 AI 研究摘要」，空态不出现 Evidence/证据总结", () => {
    const html = renderWith(false);
    expect(html).toContain("生成 AI 研究摘要");
    expect(html).not.toContain("Evidence");
    expect(html).not.toContain("证据总结");
    expect(html).not.toContain("EvidenceRef");
  });
});

describe("R2 契约：前端无第二套模块分类器（服务端唯一口径）", () => {
  it("组件模块不得存在 projectModulesFromSummary / moduleKeyOf（改由 businessModules prop 驱动）", () => {
    // 服务端是唯一分类实现；客户端残留第二套函数即失败
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const source = readFileSync(resolve(process.cwd(), "components/evidence/AiEvidenceSummarySection.tsx"), "utf8");
    expect(source).not.toContain("projectModulesFromSummary");
    expect(source).not.toContain("moduleKeyOf");
  });
  it("组件接收 businessModules（服务端投影结果）并拒绝自行归纳 summary", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const source = readFileSync(resolve(process.cwd(), "components/evidence/AiEvidenceSummarySection.tsx"), "utf8");
    expect(source).toContain("businessModules");
  });
});
