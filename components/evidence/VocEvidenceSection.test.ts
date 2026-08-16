import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  VocEvidenceSection,
  parseVocAnalysisView,
  parseVocEvidenceView,
} from "@/components/evidence/VocEvidenceSection";

function evidenceFixture() {
  return {
    schema: "review-evidence.v1",
    version: 1,
    candidateId: "candidate-voc-test",
    dataset: {
      reviews: [
        {
          evidenceId: "ev-00000001",
          reviewId: "R1",
          productAsin: "B0A1B2C3D4",
          sourceProductRole: "current_candidate",
          sourceType: "manual_import",
          sourceSite: null,
          sourceUrl: null,
          sourceRef: "manual:R1",
          reviewTitle: null,
          reviewText: "Very sturdy, love it.",
          rating: 5,
          reviewDate: "2026-07-01",
          verifiedPurchase: null,
          locale: "en_US",
          language: "en",
          capturedAt: "2026-08-05T00:00:00.000Z",
          importerVersion: "review-importer.v1",
          collectorVersion: null,
          entityBindingProof: { asin: "B0A1B2C3D4", sourceProductRole: "current_candidate", binding: "manual_confirmed", note: null },
          contentHash: "a".repeat(64),
          duplicateKey: "rid:R1",
          nature: "review_observation",
        },
        {
          evidenceId: "ev-00000002",
          reviewId: "R2",
          productAsin: "B0E5F6G7H8",
          sourceProductRole: "competitor",
          sourceType: "manual_import",
          sourceSite: null,
          sourceUrl: null,
          sourceRef: "manual:R2",
          reviewTitle: null,
          reviewText: "Too flimsy, feels cheap.",
          rating: 2,
          reviewDate: "2026-07-03",
          verifiedPurchase: null,
          locale: "en_US",
          language: "en",
          capturedAt: "2026-08-05T00:00:00.000Z",
          importerVersion: "review-importer.v1",
          collectorVersion: null,
          entityBindingProof: { asin: "B0E5F6G7H8", sourceProductRole: "competitor", binding: "manual_confirmed", note: null },
          contentHash: "b".repeat(64),
          duplicateKey: "rid:R2",
          nature: "review_observation",
        },
      ],
      stats: {
        totalReviews: 2,
        reviewsUsed: 2,
        positiveCount: 1,
        negativeCount: 1,
        neutralCount: 0,
        ratingDistribution: [{ rating: 5, count: 1 }, { rating: 2, count: 1 }],
        capturePeriod: { from: "2026-07-01", to: "2026-07-03" },
        sourceProductCount: 2,
        currentCandidateCount: 1,
        competitorCount: 1,
      },
      sampling: { method: "manual_selected", note: null, reviewsAvailable: null },
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
  };
}

function analysisFixture() {
  return {
    schema: "voc-analysis.v1",
    version: 1,
    runId: "run-abc123",
    candidateId: "candidate-voc-test",
    model: "mock",
    promptVersion: "voc-analysis.v1",
    inputEvidenceHash: "hash123",
    datasetSnapshot: { totalReviews: 2, reviewsUsed: 2, sampledReviews: ["ev-00000001", "ev-00000002"] },
    startedAt: "2026-08-05T00:00:00.000Z",
    finishedAt: "2026-08-05T00:00:30.000Z",
    tokenUsage: { completionTokens: 100, reasoningTokens: 0 },
    gateResult: "pass",
    themes: {
      positiveThemes: [
        {
          themeId: "t-pos-1",
          label: "做工扎实",
          summary: "用户认可做工。",
          evidenceRefs: ["ev-00000001"],
          sourceProductRoles: ["current_candidate"],
          reviewCount: 1,
          coverage: 0.5,
          strength: "isolated",
          limitations: null,
        },
      ],
      painPointThemes: [
        {
          themeId: "t-pain-1",
          label: "材质显廉价",
          summary: "竞品评论提到材质问题。",
          evidenceRefs: ["ev-00000002"],
          sourceProductRoles: ["competitor"],
          reviewCount: 1,
          coverage: 0.5,
          strength: "isolated",
          limitations: "仅竞品评论。",
        },
      ],
      usageScenarios: [],
      recurringRequests: [],
      conflicts: [
        {
          themeId: "t-conf-1",
          label: "重量感知相反",
          summary: "有人认为扎实，有人认为笨重。",
          positive: { evidenceRefs: ["ev-00000001"], reviewCount: 1 },
          negative: { evidenceRefs: ["ev-00000002"], reviewCount: 1 },
          note: "不判断哪边更真实。",
        },
      ],
      weakSignals: [],
    },
    unknowns: ["样本仅 2 条，无法证明普遍性。"],
    nextResearchSteps: ["补充更多评论后重跑。"],
    unverified: [],
    humanReviewResult: null,
    updatedAt: "2026-08-05T00:00:30.000Z",
  };
}

const storageVersion = { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-05T00:00:00.000Z" };

describe("parseVocEvidenceView / parseVocAnalysisView (frontend projection)", () => {
  it("parses evidence with stats and reviews", () => {
    const parsed = parseVocEvidenceView(evidenceFixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.dataset.reviews).toHaveLength(2);
    expect(parsed!.dataset.stats).toMatchObject({
      totalReviews: 2,
      positiveCount: 1,
      negativeCount: 1,
      sourceProductCount: 2,
      currentCandidateCount: 1,
      competitorCount: 1,
    });
  });

  it("rejects malformed evidence documents", () => {
    expect(parseVocEvidenceView({ schema: "review-evidence.v2", version: 1, dataset: { reviews: [] } })).toBeNull();
    expect(parseVocEvidenceView(null)).toBeNull();
  });

  it("parses analysis with themes and conflicts", () => {
    const parsed = parseVocAnalysisView(analysisFixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.themes.positiveThemes).toHaveLength(1);
    expect(parsed!.themes.painPointThemes[0].sourceProductRoles).toEqual(["competitor"]);
    expect(parsed!.themes.conflicts).toHaveLength(1);
    expect(parsed!.themes.conflicts[0].positive.reviewCount).toBe(1);
    expect(parsed!.unknowns).toContain("样本仅 2 条，无法证明普遍性。");
  });
});

describe("VocEvidenceSection rendering (novice comprehension)", () => {
  it("renders empty state with import entry", () => {
    const element = createElement(VocEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: null,
      analysis: null,
      storageVersion,
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-testid="workbench-voc"');
    expect(html).toContain("粘贴导入");
    expect(html).toContain("采集评论");
    expect(html).toContain("还没有评论证据");
  });

  it("renders the six novice sections with theme counts and roles", () => {
    const evidence = parseVocEvidenceView(evidenceFixture());
    const analysis = parseVocAnalysisView(analysisFixture());
    const element = createElement(VocEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence,
      analysis,
      storageVersion,
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    // 六区标题
    expect(html).toContain("用户喜欢什么");
    expect(html).toContain("用户反复抱怨什么");
    expect(html).toContain("用户在什么场景下使用");
    expect(html).toContain("零散信号");
    expect(html).toContain("仍然不知道什么");
    expect(html).toContain("下一步最值得研究什么");
    expect(html).toContain("观点冲突");
    // 主题数量 deterministic 展示 + 角色区分
    expect(html).toContain("引用 1 条");
    expect(html).toContain("个例（1 条）");
    expect(html).toContain("当前商品评论");
    expect(html).toContain("竞品评论");
    // 冲突正负计数
    expect(html).toContain("正面观点（1 条）");
    expect(html).toContain("负面观点（1 条）");
    // 样本量显式
    expect(html).toContain("样本：2 条");
    expect(html).toContain("商品 2 个");
    // 原文可回看
    expect(html).toContain("Very sturdy, love it.");
    expect(html).toContain("Too flimsy, feels cheap.");
    // 无 score / 无"值得卖"
    expect(html).not.toContain("值得卖");
    expect(html).not.toContain("score");
  });

  it("never claims all reviews were analyzed unless they were", () => {
    const fixture = analysisFixture();
    fixture.datasetSnapshot = { totalReviews: 10, reviewsUsed: 2, sampledReviews: ["ev-00000001", "ev-00000002"] };
    const analysis = parseVocAnalysisView(fixture);
    const evidence = parseVocEvidenceView(evidenceFixture());
    const element = createElement(VocEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence,
      analysis,
      storageVersion,
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("仅使用 2/10 条（采样）");
    expect(html).not.toContain("分析了全部用户评论");
  });

  it("flags one-sided (negative-only) samples explicitly", () => {
    const fixture = evidenceFixture();
    fixture.dataset.stats.positiveCount = 0;
    fixture.dataset.reviews[0].rating = 1;
    fixture.dataset.stats.ratingDistribution = [{ rating: 1, count: 1 }, { rating: 2, count: 1 }];
    const evidence = parseVocEvidenceView(fixture);
    const element = createElement(VocEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence,
      analysis: null,
      storageVersion,
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("当前样本为低星评论集合");
  });
});
