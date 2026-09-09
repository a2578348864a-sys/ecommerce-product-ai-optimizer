import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");

describe("Listing Studio 交付结果页面化布局契约 (LISTING_STUDIO_DELIVERY_V1)", () => {
  it("包含顶部快捷交付工具条与独立复制按钮", () => {
    expect(source).toContain("Listing 交付结果");
    expect(source).toContain("复制完整 Listing");
    expect(source).toContain("复制标题");
    expect(source).toContain("复制五点描述");
    expect(source).toContain("复制商品描述");
    expect(source).toContain("复制关键词");
  });

  it("4 大核心成果独立卡片包含就近指标统计与卡头复制", () => {
    // 标题卡片：指标与就近复制
    expect(source).toContain("Listing标题 Title");
    expect(source).toContain("{draft.titles[0].length} 字符");

    // 五点描述卡片：指标与就近复制
    expect(source).toContain("五点描述 Bullet Points");
    expect(source).toContain("{draft.bullets.length} 条要点");

    // 商品描述卡片：指标与就近复制
    expect(source).toContain("商品描述 Product Description");
    expect(source).toContain("{draft.description.length} 字符");

    // 搜索关键词卡片：指标与就近复制
    expect(source).toContain("搜索关键词 Keywords");
    expect(source).toContain("{draft.keywords.length} 个词");
  });

  it("正文视觉连续：五点描述紧随标题卡片，Quality Policy 移至正文之后", () => {
    const titleIdx = source.indexOf("Listing标题 Title");
    const bulletsIdx = source.indexOf("五点描述 Bullet Points");
    const descIdx = source.indexOf("商品描述 Product Description");
    const kwIdx = source.indexOf("搜索关键词 Keywords");
    const qualityIdx = source.indexOf("data-testid=\"listing-quality-report\"");

    expect(titleIdx).toBeGreaterThan(0);
    expect(bulletsIdx).toBeGreaterThan(titleIdx);
    expect(descIdx).toBeGreaterThan(bulletsIdx);
    expect(kwIdx).toBeGreaterThan(descIdx);
    // Quality Policy 必须在搜索关键词之后，不打断正文阅读流
    expect(qualityIdx).toBeGreaterThan(kwIdx);
  });

  it("Quality Policy 提供用户友好总结，技术指标与问题明细折叠收纳", () => {
    expect(source).toContain("发布质量检查 Quality Policy");
    expect(source).toContain("✓ 满足发布标准");
    expect(source).toContain("需人工复核");
    expect(source).toContain("综合 {qualityReport.overallScore}/100");
    expect(source).toContain("查看分项评分与质检明细");
  });

  it("保留事实状态摘要栏与完整契约", () => {
    expect(source).toContain("data-testid=\"task-listing-fact-counts\"");
    expect(source).toContain("已确认事实：{factSummary.confirmedFacts}");
    expect(source).toContain("可用于 Listing：{factSummary.listingEligibleFacts}");
    expect(source).toContain("禁止声明：{factSummary.prohibitedClaims}");
  });

  it("策略区域标题文案对齐（AI研究依据 · AI文案规划 · Listing生成规划）", () => {
    const miSource = readFileSync(resolve(process.cwd(), "components/listing-handoff/MarketingIntelligencePanel.tsx"), "utf8");
    const csSource = readFileSync(resolve(process.cwd(), "components/listing-handoff/CopyStrategyPanel.tsx"), "utf8");
    const psSource = readFileSync(resolve(process.cwd(), "components/listing-handoff/CopyStrategyPlannerSuggestionPanel.tsx"), "utf8");
    const prepSource = readFileSync(resolve(process.cwd(), "components/studio/TaskStudioPreparation.tsx"), "utf8");

    expect(miSource).toContain("AI研究依据");
    expect(csSource).toContain("AI文案规划");
    expect(psSource).toContain("Listing生成规划");
    expect(prepSource).toContain("AI研究依据 · AI文案规划 · Listing生成规划");
  });

  it("遵循 LISTING_STUDIO_UI_CLOSURE_V1 契约", () => {
    // 1. 图片创作建议不再渲染
    expect(source).not.toContain("图片创作建议");
    expect(source).not.toContain("image-creation-suggestions");

    // 2. Listing 结果 Title/Bullets/Description/Keywords 都存在
    expect(source).toContain("Listing标题 Title");
    expect(source).toContain("五点描述 Bullet Points");
    expect(source).toContain("商品描述 Product Description");
    expect(source).toContain("搜索关键词 Keywords");

    // 3. 生成与审核详情默认 closed
    expect(source).toContain('data-testid="listing-review-details"');
    expect(source).not.toMatch(/<details[^>]*data-testid="listing-review-details"[^>]*open/);

    // 5, 6, 7. 风险、依据、卖点在折叠区域内部
    const reviewDetailsIdx = source.indexOf('data-testid="listing-review-details"');
    const riskIdx = source.indexOf('data-testid="listing-risk-details"');
    const evidenceIdx = source.indexOf('data-testid="listing-basis-details"');
    const strategyIdx = source.indexOf('data-testid="listing-selling-points-wrapper"');
    expect(reviewDetailsIdx).toBeGreaterThan(0);
    expect(riskIdx).toBeGreaterThan(reviewDetailsIdx);
    expect(evidenceIdx).toBeGreaterThan(riskIdx);
    expect(strategyIdx).toBeGreaterThan(evidenceIdx);

    // 8. 重新生成按钮只有一个
    const regenMatches = source.match(/data-testid="regenerate-listing-draft"/g);
    expect(regenMatches?.length).toBe(1);

    // 9. 复制按钮保留
    expect(source).toContain("复制完整 Listing");
  });
});
