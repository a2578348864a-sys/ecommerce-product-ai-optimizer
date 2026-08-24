import { resolveVocAsinInput, noReviewsEmptyMessage } from "./VocEvidenceSection";
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
    expect(html).toContain("抽样分析（共采集 10 条）");
    expect(html).toContain("本次分析使用 2 条评论");
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

describe("商品身份锁定（轮 12）", () => {
  it("当前商品模式：ASIN 只读且绑定服务端 taskAsin；竞品模式才可编辑", () => {
    const current = resolveVocAsinInput("current_candidate", "B08NCVT244", "B0OTHER123");
    expect(current.editable).toBe(false);
    expect(current.value).toBe("B08NCVT244");
    const competitor = resolveVocAsinInput("competitor", "B08NCVT244", "B0OTHER123");
    expect(competitor.editable).toBe(true);
    expect(competitor.value).toBe("B0OTHER123");
  });

  it("当前商品未采到评论时不再诱导换商品：文案为「可重试或粘贴该商品评论」，不含「换一个 ASIN」", () => {
    expect(noReviewsEmptyMessage()).toBe("当前商品暂未采到公开评论，可重试或粘贴该商品评论。");
  });
});
});

describe("R6 VOC 收口：历史英文分析诚实降级 + 技术噪声移除", () => {
  const enAnalysis = () => (analysisFixture() as unknown as { schema: string; version: number; runId: string; candidateId: string | null; model: string; promptVersion: string; inputEvidenceHash: string; datasetSnapshot: { totalReviews: number; reviewsUsed: number; sampledReviews: string[] }; startedAt: string; finishedAt: string; tokenUsage: { completionTokens: number | null; reasoningTokens: number | null } | null; gateResult: "pass" | "fail"; themes: { positiveThemes: Array<{ themeId: string; label: string; summary: string; evidenceRefs: string[]; sourceProductRoles: Array<"current_candidate" | "competitor">; reviewCount: number; coverage: number; strength: "isolated" | "weak" | "recurring"; limitations: string | null }>; painPointThemes: Array<{ themeId: string; label: string; summary: string; evidenceRefs: string[]; sourceProductRoles: Array<"current_candidate" | "competitor">; reviewCount: number; coverage: number; strength: "isolated" | "weak" | "recurring"; limitations: string | null }>; usageScenarios: Array<any>; recurringRequests: Array<any>; conflicts: Array<any>; weakSignals: Array<any> }; unknowns: string[]; nextResearchSteps: string[]; unverified: Array<any>; humanReviewResult: null; updatedAt: string });
  function renderWith(analysis: unknown, evidence: unknown) {
    // 复用组件：需要构造 evidence view 与 analysis view
    const evView = parseVocEvidenceView(evidence as never);
    const anView = parseVocAnalysisView(analysis as never);
    return renderToStaticMarkup(createElement(VocEvidenceSection, {
      taskId: "task-x",
      taskAsin: "B0A1B2C3D4",
      evidence: evView,
      analysis: anView,
      storageVersion: null,
      capability: null,
      onChanged: () => undefined,
      onDataChanged: () => undefined,
    } as never));
  }
  it("历史英文分析默认不直接展示英文段落，显示中文历史提示", () => {
    const a = enAnalysis();
    // 把 label/summary/unknowns/next 全部改为英文（模拟历史英文分析）
    a.themes.positiveThemes[0].label = "Great build quality";
    a.themes.positiveThemes[0].summary = "Users love the solid construction.";
    a.unknowns = ["Sample cannot prove durability."];
    a.nextResearchSteps = ["Need more reviews."];
    const html = renderWith(a, evidenceFixture());
    // 默认主页面不出现整段英文结论
    expect(html).not.toContain("Great build quality");
    expect(html).not.toContain("Users love the solid construction.");
    // 出现中文历史提示
    expect(html).toContain("这份历史分析使用英文生成，重新分析后可查看中文结论");
  });
  it("主题引用评论在「查看原始评论（原文）」折叠内，且经清洁函数（无 <img>/HTML 代码）", () => {
    const a = enAnalysis();
    // 中文分析（默认主题分支）；评论文本含 HTML 头像污染
    const dirtyEvidence = evidenceFixture();
    dirtyEvidence.dataset.reviews[0].reviewText = '<img src="https://example.com/avatar.png">Very sturdy, love it.';
    const html = renderWith(a, dirtyEvidence);
    expect(html).toContain("查看原始评论（原文）");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("avatar.png");
    // 清理后文字（注释保留隐私，此处仅验证未渲染 HTML 代码）
    expect(html).toContain("Very sturdy, love it.");
  });
  it("运行 trace 不出现：run/model/voc-analysis/promptVersion/哈希 等内部信息", () => {
    const html = renderWith(enAnalysis(), evidenceFixture());
    expect(html).not.toContain("run ");
    expect(html).not.toContain("deepseek");
    expect(html).not.toContain("voc-analysis");
    expect(html).not.toContain("inputEvidenceHash");
    expect(html).not.toContain("promptVersion");
    expect(html).not.toContain("hash123");
  });
  it("引用数量/身份/星级/ASIN 仍然存在", () => {
    const html = renderWith(enAnalysis(), evidenceFixture());
    expect(html).toContain("引用");
    expect(html).toContain("当前商品");
    expect(html).toContain("ASIN");
    expect(html).toContain("星");
  });
  it("单条评论不展示为普遍结论（主题引用数仍为1/有限）", () => {
    const a = enAnalysis();
    a.themes.positiveThemes[0].evidenceRefs = ["ev-00000001"];
    const html = renderWith(a, evidenceFixture());
    expect(html).toContain("引用 1 条");
    // 清理 HTML 后不含 img 原文
    expect(html).not.toContain("<img");
  });
});

describe("R6 修复：历史英文识别覆盖全部默认可见业务字段（组件级）", () => {
  type LooseTheme = { themeId: string; label: string; summary: string; limitations: string | null };
  type LooseConflict = { label: string; summary: string; note: string | null };
  type LooseAnalysis = {
    themes: {
      positiveThemes: LooseTheme[];
      painPointThemes: LooseTheme[];
      usageScenarios: LooseTheme[];
      recurringRequests: LooseTheme[];
      weakSignals: LooseTheme[];
      conflicts: LooseConflict[];
    };
    unknowns: string[];
    nextResearchSteps: string[];
  };
  function chineseFixture(): LooseAnalysis {
    return analysisFixture() as unknown as LooseAnalysis;
  }
  function renderAnalysis(fixture: unknown) {
    const analysis = parseVocAnalysisView(fixture as never);
    const evidence = parseVocEvidenceView(evidenceFixture() as never);
    const element = createElement(VocEvidenceSection, {
      taskId: "task-x",
      taskAsin: "B0A1B2C3D4",
      evidence,
      analysis,
      storageVersion: null,
      capability: null,
      onChanged: () => undefined,
    } as never);
    return renderToStaticMarkup(element);
  }
  it("基线：全中文分析正文默认渲染（不降级）", () => {
    const html = renderAnalysis(chineseFixture());
    expect(html).toContain("做工扎实");
    expect(html).toContain("用户认可做工。");
    expect(html).not.toContain("这份历史分析使用英文生成");
  });
  it("中文 label + 英文 summary → 默认不渲染英文正文，显示中文提示与查看按钮", () => {
    const a = chineseFixture();
    a.themes.positiveThemes[0].summary = "Users love the solid construction.";
    const html = renderAnalysis(a);
    expect(html).not.toContain("Users love the solid construction.");
    expect(html).toContain("这份历史分析使用英文生成，重新分析后可查看中文结论");
    expect(html).toContain("查看历史英文分析");
  });
  it("英文 limitations → 降级", () => {
    const a = chineseFixture();
    a.themes.positiveThemes[0].limitations = "Only one review; may not be representative.";
    const html = renderAnalysis(a);
    expect(html).not.toContain("Only one review; may not be representative.");
    expect(html).toContain("这份历史分析使用英文生成");
  });
  it("英文 conflict summary / note → 降级", () => {
    const a1 = chineseFixture();
    a1.themes.conflicts[0].summary = "Some say it is solid; others say it is heavy.";
    expect(renderAnalysis(a1)).not.toContain("Some say it is solid; others say it is heavy.");
    const a2 = chineseFixture();
    a2.themes.conflicts[0].note = "The negative review is a single instance.";
    expect(renderAnalysis(a2)).not.toContain("The negative review is a single instance.");
  });
  it("英文 unknowns / nextResearchSteps → 降级", () => {
    const a = chineseFixture();
    a.unknowns = ["Sample cannot prove durability."];
    a.nextResearchSteps = ["Need more reviews to confirm."];
    const html = renderAnalysis(a);
    expect(html).not.toContain("Sample cannot prove durability.");
    expect(html).not.toContain("Need more reviews to confirm.");
  });
  it("usageScenarios / recurringRequests / weakSignals 英文 label → 降级", () => {
    const a = chineseFixture();
    a.themes.usageScenarios = [{ ...a.themes.positiveThemes[0], themeId: "t-usage-1", label: "School lunches", summary: "用于学校午餐。" }];
    expect(renderAnalysis(a)).not.toContain("School lunches");
    const b = chineseFixture();
    b.themes.recurringRequests = [{ ...b.themes.positiveThemes[0], themeId: "t-req-1", label: "Preheat with hot water", summary: "建议预热。" }];
    expect(renderAnalysis(b)).not.toContain("Preheat with hot water");
    const c = chineseFixture();
    c.themes.weakSignals = [{ ...c.themes.positiveThemes[0], themeId: "t-weak-1", label: "Leak proof", summary: "个别提到。" }];
    expect(renderAnalysis(c)).not.toContain("Leak proof");
  });
  it("中文业务句中夹带品牌/ASIN/单位 → 不降级，正文照常渲染", () => {
    const a = chineseFixture();
    a.themes.positiveThemes[0].summary = "THERMOS（B08NCVT244，10 oz）的保温效果好。";
    const html = renderAnalysis(a);
    expect(html).not.toContain("这份历史分析使用英文生成");
    expect(html).toContain("用户喜欢什么");
    expect(html).toContain("THERMOS（B08NCVT244，10 oz）的保温效果好。");
  });
  it("原始评论/商品身份/ASIN/星级/采集时间/引用数量在降级后展开时仍在（清洁保留身份字段）", () => {
    const a = chineseFixture();
    const html = renderAnalysis(a);
    expect(html).toContain("当前商品");
    expect(html).toContain("ASIN B0A1B2C3D4");
    expect(html).toContain("5 星");
    expect(html).toContain("采集 2026-08-05");
    expect(html).toContain("引用 1 条");
  });
});

describe("R6 修复：评论标题/来源/冲突卡空态统一清洁（组件级）", () => {
  type LooseEvidence = {
    dataset: { reviews: Array<{ evidenceId: string; reviewTitle: string | null; reviewText: string; sourceRef: string | null }> };
  };
  function renderWithEvidence(evidence: unknown, fixture: unknown) {
    const analysis = parseVocAnalysisView(fixture as never);
    const ev = parseVocEvidenceView(evidence as never);
    const element = createElement(VocEvidenceSection, {
      taskId: "task-x",
      taskAsin: "B0A1B2C3D4",
      evidence: ev,
      analysis,
      storageVersion: null,
      capability: null,
      onChanged: () => undefined,
    } as never);
    return renderToStaticMarkup(element);
  }
  it("reviewTitle / sourceRef 通过同一清洁边界（含 img 标记被移除，空则整段不渲染）", () => {
    const ev = evidenceFixture() as unknown as LooseEvidence;
    ev.dataset.reviews[0].reviewTitle = "<img src=\"boom.png\">Sturdy lid";
    ev.dataset.reviews[0].sourceRef = "<img src=\"refboom.png\">";
    ev.dataset.reviews[1].reviewTitle = "<img src=\"empty.png\"/>";
    ev.dataset.reviews[1].sourceRef = "<img src=\"refempty.png\"/>";
    const html = renderWithEvidence(ev, analysisFixture());
    expect(html).toContain("Sturdy lid");
    expect(html).not.toContain("boom.png");
    expect(html).not.toContain("refboom.png");
    expect(html).not.toContain("empty.png");
    expect(html).not.toContain("refempty.png");
  });
  it("ConflictCard 与 ThemeCard 共用空态：干净后为空统一显示占位文案（不含悬空「· 」）", () => {
    const ev = evidenceFixture() as unknown as LooseEvidence;
    ev.dataset.reviews[0].reviewText = '<img src="only.png"/>';
    const html = renderWithEvidence(ev, analysisFixture());
    expect(html).not.toContain("only.png");
    expect(html).not.toContain("<img");
    const placeholderCount = (html.match(/该条评论没有可展示的文字内容/g) || []).length;
    expect(placeholderCount).toBeGreaterThanOrEqual(2);
  });
  it("非空评论不显示空态占位（主题卡与冲突卡）", () => {
    const html = renderWithEvidence(evidenceFixture(), analysisFixture());
    expect(html).not.toContain("该条评论没有可展示的文字内容");
    expect(html).toContain("Very sturdy, love it.");
  });
});
