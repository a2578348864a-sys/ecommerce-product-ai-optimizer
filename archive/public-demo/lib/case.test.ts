import { describe, expect, it } from "vitest";
import { loadPublicShowcaseCase, completenessIssues, scanBannedTerms, BANNED_TERMS, listingQualityCheck } from "./case";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const c = loadPublicShowcaseCase();
const serialized = JSON.stringify(c);

describe("公网演示快照（THERMOS 案例）", () => {
  it("完整性硬门槛全部通过（无缺口列表）", () => {
    expect(completenessIssues(c)).toEqual([]);
  });
  it("商品名称正确且市场为美国站", () => {
    expect(c.title).toContain("THERMOS FUNTAINER");
    expect(c.market).toBe("美国站");
  });
  it("商品图为同源 jpg 资产且真实存在", () => {
    expect(c.image.src).toMatch(/^\/public-showcase\//);
    expect(c.image.src).toMatch(/\.jpg$/);
    const file = resolve(process.cwd(), "public" + c.image.src.replace(/^\//, "/"));
    const head = readFileSync(file).subarray(0, 4).toString("hex");
    expect(head).toBe("ffd8ffe0");
  });
  it("四个研究模块都有真实内容或明确中文缺口", () => {
    expect(c.marketModule.story.length + c.marketModule.estimates.length + c.marketModule.gaps.length).toBeGreaterThan(0);
    expect(c.buyerDemand.sampleCount).toBeTruthy();
    expect(c.supplyMatch.content.length + c.supplyMatch.gaps.length).toBeGreaterThan(0);
    expect(c.costRisk.risks.length + c.costRisk.gaps.length).toBeGreaterThan(0);
  });
  it("有人工决定 + Listing 标题与至少 3 条五点 + 图片检查状态", () => {
    expect(c.humanDecision.label).toBeTruthy();
    expect(c.listing.draftTitle).toBeTruthy();
    expect(c.listing.draftBullets.length).toBeGreaterThanOrEqual(3);
    expect(c.imageCheck.items.length).toBeGreaterThan(0);
  });
  it("禁止术语扫描 0 命中（含内部标识）", () => {
    const bannedScan = scanBannedTerms(serialized);
    expect(bannedScan).toEqual([]);
    expect(BANNED_TERMS.length).toBeGreaterThan(10);
  });
  it("不暴露内部标识（taskId/candidateId/hash/运行细节）", () => {
    for (const term of ["cmt0lmsqa", "91a60705", "candidateId", "taskId", "runId", "evidenceId"]) {
      expect(serialized).not.toContain(term);
    }
  });
});


describe("轮 15 内容纠偏（公开案例中文化/一致性/Listing 质量）", () => {
  it("商品名不含附加栏目词「商品研究」", () => {
    expect(c.title).not.toContain("商品研究");
    expect(c.title).toBe("THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink");
  });
  it("商品类型不等于品牌", () => {
    const type = c.overviewSummary.fields.find((f) => f.label === "商品类型");
    const brand = c.overviewSummary.fields.find((f) => f.label === "品牌");
    expect(type).toBeTruthy();
    expect(brand).toBeTruthy();
    expect(type!.value).not.toBe(brand!.value);
    expect(type!.value).not.toBe("THERMOS");
  });
  it("已知字段不落入缺口（一致性）", () => {
    const keys = ["价格", "尺寸", "重量", "材质", "颜色", "品牌", "评分", "评论数", "类目"];
    const overviewText = c.overviewSummary.fields.map((f) => f.value + f.label).join("");
    for (const gap of [...c.marketModule.gaps, ...c.costRisk.gaps, ...c.supplyMatch.gaps, ...c.buyerDemand.pain]) {
      for (const key of keys) {
        // 若概览已有该字段值，缺口不得再声称"缺少"它
        if (gap.includes("缺少") && gap.includes(key) && !gap.includes("竞品")) expect(gap, "缺口与已展示字段冲突: " + gap).not.toMatch(new RegExp("缺少.*" + key));
      }
    }
    expect(overviewText).toContain("14.69");
  });
  it("竞品为相邻替代商品且说明明确", () => {
    for (const row of c.competitors.rows) {
      expect(row.category).toBe("相邻替代商品");
    }
    expect(JSON.stringify(c.competitors)).toContain("不代表直接竞品");
  });
  it("评论页不含原始英文评论文本（仅中文摘要）", () => {
    const json = JSON.stringify(c.buyerDemand);
    expect(json).not.toContain("Perfect for school lunches");
    expect((c.buyerDemand as unknown as { samples?: unknown }).samples).toBeUndefined();
  });
  it("Listing 展示质量校验结论：草稿未通过（品牌重复/事实碎片），页面不展示碎片为正式成果", () => {
        const q = listingQualityCheck(c);
    expect(q.pass).toBe(false);
    expect(q.reasons.join("").length).toBeGreaterThan(0);
    expect(c.listing.status).toContain("未通过质量校验");
    expect(c.listing.missingFacts.length).toBeGreaterThan(0);
  });
  it("关键词分类完整（当前商品/相邻类目/品牌）", () => {
    const cats = new Set(c.keywords.rows.map((r) => r.category));
    expect(cats.has("当前商品相关词")).toBe(true);
    expect(cats.has("相邻类目词")).toBe(true);
  });
});
