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
    expect(skill).toContain("不代表亚马逊后台订单或实际店铺成交记录");
    expect(skill).not.toContain(["Amazon", "真实订单"].join(" "));
  });

  it("summarizes Ranking v2 in Chinese without re-sorting by the conditional score", () => {
    expect(skill).toContain("市场信号 Top3");
    expect(skill).toContain("市场信号分");
    expect(skill).toContain("证据覆盖度");
    expect(skill).toContain("研究优先级");
    expect(skill).toContain("正向理由");
    expect(skill).toContain("主要反向信号");
    expect(skill).toContain("未排名数量和原因");
    expect(skill).toContain("家族研究分组数量");
    expect(skill).toContain("不得基于 `conditionalSignalScore` 重新排序");
    expect(skill).not.toContain("`provisionalDisposition` 分布");
    expect(skill).not.toContain("SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS");
    expect(skill).not.toContain("SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS");
  });
});
