import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  new URL("./SKILL.md", import.meta.url),
  "utf8",
);

describe("Amazon Product Research Skill (amazon-product-research.v1)", () => {
  it("covers the eight-step business flow in order", () => {
    const steps = [
      "1. **身份确认**",
      "2. **市场需求**",
      "3. **竞争**",
      "4. **关键词**",
      "5. **VOC（用户之声）**",
      "6. **货源**",
      "7. **Missing / Conflict**",
      "8. **Human Decision required**",
    ];
    let cursor = 0;
    for (const step of steps) {
      const index = skill.indexOf(step);
      expect(index, `step missing: ${step}`).toBeGreaterThan(-1);
      expect(index, `steps out of order near ${step}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("outputs only the whitelisted sections", () => {
    for (const section of ["当前研究阶段", "已有证据", "缺失证据", "风险", "冲突", "建议下一步"]) {
      expect(skill).toContain(section);
    }
  });

  it("explicitly forbids overall scores, verdicts, and purchase advice in the forbidden-scope section", () => {
    const forbidden = skill.slice(skill.indexOf("## 禁止推断范围"));
    for (const item of ["商品总评分", "综合推荐指数", "值得卖 / 不值得卖", "爆款概率", "盈利预测", "采购建议", "上架建议"]) {
      expect(forbidden).toContain(item);
    }
    // 输出结构区不得出现任何"值得卖"式结论句式
    const outputSection = skill.slice(skill.indexOf("## 输出结构"), skill.indexOf("## 禁止推断范围"));
    expect(outputSection).not.toMatch(/值得卖|不值得卖|一定可以|建议采购/);
  });

  it("enforces identity gate and unknown handling", () => {
    expect(skill).toContain("身份不确定");
    expect(skill).toContain("停止");
    expect(skill).toContain("不猜测");
    expect(skill).toContain("不跨商品补值");
  });

  it("keeps VOC and sourcing as uncollected evidence without inventing data", () => {
    expect(skill).toContain("VOC 证据未收集");
    expect(skill).toContain("货源证据未收集");
    expect(skill).toContain("禁止从评论数字或标题推测卖点/痛点");
    expect(skill).toContain("禁止编造采购价、供应商、MOQ");
  });

  it("reads VOC evidence when available without changing decisions or scoring", () => {
    expect(skill).toContain("reviewEvidence");
    expect(skill).toContain("vocAnalysis");
    expect(skill).toContain("只读识别");
    expect(skill).toMatch(/不得[^\n]*根据 VOC 自动改变 Decision/);
    expect(skill).toMatch(/不得[^\n]*把 VOC 变成评分或推荐依据/);
    expect(skill).toContain("评论是用户观点证据，不是商品事实");
  });

  it("does not duplicate internal parsing/hash/ranking logic", () => {
    expect(skill).toContain("不复制解析、哈希、评分或存储逻辑");
    expect(skill).not.toContain("createHash(");
    expect(skill).not.toContain("parseInt(");
    expect(skill).not.toContain("hasSearchRankColumn");
    expect(skill).not.toContain("conditionalSignalScore");
  });

  it("records version discipline and invalidation conditions", () => {
    expect(skill).toContain("amazon-product-research.v1");
    expect(skill).toContain("版本纪律");
    expect(skill).toContain("失效条件");
    expect(skill).toContain("验收样本");
    expect(skill).toContain("禁止静默改历史语义");
  });

  it("never writes data, runs AI, or browses", () => {
    expect(skill).toContain("不写任何数据");
    expect(skill).not.toMatch(/调用真实 AI/);
  });
});

describe("Amazon Product Research Skill discovery bridge", () => {
  it("points to the authoritative skill file only", () => {
    const bridge = readFileSync(
      new URL("../../.agents/skills/amazon-product-research/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(bridge).toContain("../../../skills/amazon-product-research/SKILL.md");
    expect(bridge).toContain("唯一权威");
    expect(bridge).toContain("立即停止");
  });
});
