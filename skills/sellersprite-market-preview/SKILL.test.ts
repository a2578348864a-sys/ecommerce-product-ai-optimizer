import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  new URL("./SKILL.md", import.meta.url),
  "utf8",
);

describe("SellerSprite market preview authoritative Skill", () => {
  it("collects type-specific inputs and delegates both report types to the CLI", () => {
    expect(skill).toContain("这是关键词搜索报表，还是类目当前商品报表？");
    expect(skill).toContain("--report-type search-results");
    expect(skill).toContain("--report-type category-current");
    expect(skill).toContain("Category Current 不询问、不补造也不接受虚假 `query`");
  });

  it("does not duplicate report detection, BSR parsing, hashes, or production decisions", () => {
    expect(skill).toContain("只编排项目已有 CLI");
    expect(skill).not.toContain("hasSearchRankColumn");
    expect(skill).not.toContain("hasRootCategoryBsrColumn");
    expect(skill).not.toContain("parseInt(");
    expect(skill).not.toContain("createHash(");
    expect(skill).toContain("调用正式 Stage 1、自动晋级商品或改变评分规则");
    expect(skill).toContain("不代表 Amazon 后台真实订单");
  });
});
