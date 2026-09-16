import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * prisma 在 `new PrismaClient()`（模块求值时）就解析 DATABASE_URL，
 * 而 vitest 不会加载 Next.js 的 .env.local —— 必须在导入被测模块**之前**补齐，
 * 所以用 vi.hoisted（早于所有 import 执行）。
 * 取值与 prisma schema 的默认一致：相对 prisma/ 目录的 file:./dev.db。
 */
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "file:./dev.db";
});

import { buildMarketSignalSet, emptyMarketSignalSet, stripSignalHtmlTags, type MarketSignalDraft } from "@/lib/marketSignal";
import {
  PROVIDER_MIN_TASK_SCORE,
  PROVIDER_PER_TASK_LIMITS,
  cleanReviewText,
  collectMarketSignals,
  describeProviderOutcome,
  extractSignalDrafts,
  isNoisyReviewText,
  scoreEvidenceTask,
  tokenizeDirection,
  type EvidenceTaskSnapshot,
} from "@/lib/server/marketSignalProvider";

/* ── 测试用合成证据（结构对齐真实 resultJson 命名空间） ── */

function buildResultJson(overrides: {
  painPoints?: Array<{ label: string; summary: string; reviewCount: number; strength: string }>;
  recurringRequests?: Array<{ label: string; summary: string; reviewCount: number; strength: string }>;
  reviews?: Array<{ reviewText: string; rating: number | null; productAsin: string; capturedAt: string }>;
  keywords?: Array<{ keyword: string; keywordTranslation: string | null; searches: number | null }>;
  competitors?: Array<{ asin: string; note: string }>;
} = {}): string {
  const reviews = overrides.reviews ?? [
    {
      reviewText: '<img src="https://example.com/a.png" alt="" /> 卡扣太紧，装了三次才装上，手指都被磨红了',
      rating: 2,
      productAsin: "B000TEST01",
      capturedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      reviewText: "整体还不错，折叠收纳之后后备箱空间省了不少，装车也顺手",
      rating: 5,
      productAsin: "B000TEST01",
      capturedAt: "2026-09-02T00:00:00.000Z",
    },
    {
      reviewText: "ok",
      rating: 3,
      productAsin: "B000TEST01",
      capturedAt: "2026-09-03T00:00:00.000Z",
    },
  ];

  return JSON.stringify({
    reviewEvidence: {
      schema: "review-evidence.v1",
      version: 1,
      candidateId: null,
      dataset: { reviews, stats: {}, sampling: {}, updatedAt: "2026-09-10T00:00:00.000Z" },
    },
    vocAnalysis: {
      schema: "voc-analysis.v1",
      version: 1,
      updatedAt: "2026-09-11T00:00:00.000Z",
      themes: {
        painPointThemes: overrides.painPoints ?? [
          { label: "卡扣过紧", summary: "有评论反映卡扣需要反复尝试才能装上。", reviewCount: 1, strength: "isolated" },
        ],
        recurringRequests: overrides.recurringRequests ?? [],
        usageScenarios: [],
        positiveThemes: [],
        conflicts: [],
        weakSignals: [],
      },
    },
    keywordEvidence: {
      schema: "seller-sprite-keyword-evidence.v1",
      capturedAt: "2026-09-12T00:00:00.000Z",
      rows: (overrides.keywords ?? [
        { keyword: "insulated water bottle", keywordTranslation: "保温水杯", searches: 4471241 },
        { keyword: "owala", keywordTranslation: null, searches: 4471241 },
      ]).map((row, index) => ({
        rowNumber: index + 1,
        keyword: row.keyword,
        keywordTranslation: row.keywordTranslation,
        // searches 为 null 时不下发 monthlySearches 字段，模拟「平台未提供」的真实情况。
        fields: row.searches === null
          ? {}
          : { monthlySearches: { raw: String(row.searches), normalized: row.searches } },
      })),
    },
    competitorEvidence: {
      schema: "competitor-evidence.v1",
      candidateId: null,
      updatedAt: "2026-09-13T00:00:00.000Z",
      asins: (overrides.competitors ?? [{ asin: "B08NCNLL3Q", note: "竞品保温杯 32oz" }]).map((row) => ({
        asin: row.asin,
        note: row.note,
        sourceKind: "browser_use",
      })),
    },
  });
}

function buildTask(overrides: Partial<EvidenceTaskSnapshot> = {}): EvidenceTaskSnapshot {
  return {
    taskId: "task-1",
    title: "Owala FreeSip Insulated Water Bottle 24 oz",
    materialText: "Owala FreeSip Insulated Water Bottle 24 oz, Denim",
    updatedAt: "2026-09-15T00:00:00.000Z",
    resultJson: buildResultJson(),
    ...overrides,
  };
}

/* ── 分词 ── */

describe("marketSignalProvider 分词", () => {
  it("拉丁文按词切分并去掉停止词", () => {
    expect(tokenizeDirection("Insulated Water Bottle for the Home")).toEqual([
      "insulated", "water", "bottle", "home",
    ]);
  });

  it("中文整段 + 二字词都参与匹配", () => {
    const tokens = tokenizeDirection("户外露营用品");
    expect(tokens).toContain("户外露营用品");
    expect(tokens).toContain("露营");
    expect(tokens).toContain("用品");
  });

  it("空输入与纯停止词返回空数组", () => {
    expect(tokenizeDirection("")).toEqual([]);
    expect(tokenizeDirection("   ")).toEqual([]);
    expect(tokenizeDirection("the and of 的 了")).toEqual([]);
  });

  it("词数有上限，避免把 SQL 条件撑爆", () => {
    const tokens = tokenizeDirection(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi",
    );
    expect(tokens.length).toBeLessThanOrEqual(12);
  });
});

/* ── 打分门禁 ── */

describe("marketSignalProvider 任务匹配门禁", () => {
  const tokens = tokenizeDirection("insulated water bottle");

  it("标题命中 → 通过，并记录命中的词与字段面", () => {
    const match = scoreEvidenceTask(buildTask(), tokens);
    expect(match).not.toBeNull();
    expect(match!.score).toBeGreaterThanOrEqual(PROVIDER_MIN_TASK_SCORE);
    expect(match!.matchedTokens).toContain("water");
    expect(match!.matchedTokens).toContain("bottle");
    expect(match!.matchedSurfaces).toContain("标题/商品名");
    expect(match!.reviewCount).toBe(3);
  });

  it("无关任务 → 返回 null（宁可不给信号，也不给错信号）", () => {
    const task = buildTask({
      title: "TERRO Liquid Ant Killer Bait Stations",
      materialText: "TERRO Liquid Ant Killer Bait Stations, Indoor Ant Traps",
      resultJson: buildResultJson({
        keywords: [{ keyword: "ant traps indoor", keywordTranslation: "室内蚂蚁陷阱", searches: 528693 }],
        reviews: [],
        painPoints: [],
        competitors: [],
      }),
    });
    expect(scoreEvidenceTask(task, tokens)).toBeNull();
  });

  it("关键词翻译命中也能通过（中文方向 → 英文关键词表）", () => {
    const task = buildTask({
      title: "THERMOS FUNTAINER Kids Food Jar with Spoon",
      materialText: "THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink",
      resultJson: buildResultJson({
        keywords: [{ keyword: "lunch box", keywordTranslation: "午餐盒", searches: 2131025 }],
      }),
    });
    const match = scoreEvidenceTask(task, tokenizeDirection("午餐盒"));
    expect(match).not.toBeNull();
    expect(match!.matchedSurfaces).toContain("关键词翻译");
  });

  it("空 token 列表 → 不匹配任何任务", () => {
    expect(scoreEvidenceTask(buildTask(), [])).toBeNull();
  });
});

/* ── 证据 → 信号 ── */

describe("marketSignalProvider 证据提取", () => {
  it("按 痛点 → 高频需求 → 评论 → 关键词 → 竞品 的顺序产出，且每条都带 source", () => {
    const task = buildTask({
      resultJson: buildResultJson({
        painPoints: [{ label: "卡扣过紧", summary: "有评论反映卡扣需要反复尝试。", reviewCount: 2, strength: "weak" }],
        recurringRequests: [{ label: "想要更轻", summary: "多条评论希望减轻重量。", reviewCount: 3, strength: "weak" }],
      }),
    });
    const drafts = extractSignalDrafts(task);

    expect(drafts[0].kind).toBe("pain_point");
    expect(drafts[0].text).toContain("卡扣过紧");
    expect(drafts[0].text).toContain("2 条评论少量提及");
    expect(drafts[1].kind).toBe("pain_point");
    expect(drafts[1].text).toContain("想要更轻");

    for (const draft of drafts) {
      expect(draft.source, `信号缺少来源：${draft.text}`).toBeTruthy();
      expect(draft.source).toContain("已有研究任务");
    }
    const kinds = drafts.map((draft) => draft.kind);
    expect(kinds.indexOf("review")).toBeGreaterThan(kinds.indexOf("pain_point"));
    expect(kinds).toContain("keyword");
    expect(kinds).toContain("competitor");
  });

  it("评论去 HTML 标签，过短的评论被丢弃，低分评论优先", () => {
    const drafts = extractSignalDrafts(buildTask());
    const reviews = drafts.filter((draft) => draft.kind === "review");

    expect(reviews).toHaveLength(2); // "ok" 只有 2 字符 → 丢弃
    expect(reviews[0].text).not.toContain("<img");
    expect(reviews[0].text).toContain("卡扣太紧");
    expect(reviews[0].rating).toBe(2); // 低分优先
    expect(reviews[1].rating).toBe(5);
  });

  it("竞品只有 ASIN、没有商品名时不产出信号", () => {
    const drafts = extractSignalDrafts(
      buildTask({ resultJson: buildResultJson({ competitors: [{ asin: "B000NONAME", note: "" }] }) }),
    );
    expect(drafts.filter((draft) => draft.kind === "competitor")).toHaveLength(0);
  });

  it("关键词带翻译与搜索量，且缺失搜索量时不编造数字", () => {
    const drafts = extractSignalDrafts(
      buildTask({
        resultJson: buildResultJson({
          keywords: [
            { keyword: "insulated water bottle", keywordTranslation: "保温水杯", searches: 12345 },
            { keyword: "owala", keywordTranslation: null, searches: null },
          ],
        }),
      }),
    );
    const keywords = drafts.filter((draft) => draft.kind === "keyword");

    expect(keywords[0].text).toContain("insulated water bottle");
    expect(keywords[0].text).toContain("保温水杯");
    expect(keywords[0].text).toContain("12,345");
    expect(keywords[1].text).not.toContain("月搜索量");
  });

  it("每类证据的取用上限生效", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      reviewText: `这是一条足够长的真实评论内容，编号 ${index + 1}，用于验证上限。`,
      rating: 5,
      productAsin: "B000TEST01",
      capturedAt: "2026-09-01T00:00:00.000Z",
    }));
    const drafts = extractSignalDrafts(buildTask({ resultJson: buildResultJson({ reviews: many }) }));
    expect(drafts.filter((draft) => draft.kind === "review")).toHaveLength(PROVIDER_PER_TASK_LIMITS.review);
  });

  it("resultJson 损坏时不抛异常，只返回空", () => {
    expect(extractSignalDrafts(buildTask({ resultJson: "{ not json" }))).toEqual([]);
    expect(extractSignalDrafts(buildTask({ resultJson: "[]" }))).toEqual([]);
  });
});

/* ── 信号质量门禁 ── */

describe("marketSignalProvider 信号质量门禁", () => {
  it("剥掉抓取附加的规格尾巴，保留用户观点", () => {
    expect(cleanReviewText("Best water bottle ever Color: Dreamy FieldSize: 32 Ounces"))
      .toBe("Best water bottle ever");
    expect(cleanReviewText("Great for School Lunches Without a Microwave Color: PurpleSize: 10 Ounce"))
      .toBe("Great for School Lunches Without a Microwave");
    expect(cleanReviewText('<img src="x.png" alt="" /> 杯盖发霉了，很难清洗 Color: PinkSize: 40 Ounces'))
      .toBe("杯盖发霉了，很难清洗");
  });

  it("只有 Size 而没有 Color 时不动原文（避免误杀正常提到尺寸的评论）", () => {
    expect(cleanReviewText("I love the size: it fits my car perfectly"))
      .toBe("I love the size: it fits my car perfectly");
  });

  it("剥掉规格尾巴后过短的评论会被丢弃，不再进入信号", () => {
    const drafts = extractSignalDrafts(
      buildTask({
        resultJson: buildResultJson({
          reviews: [
            { reviewText: "The best!! Color: Off RoadSize: 24 Ounces", rating: 5, productAsin: "B1", capturedAt: "2026-09-01T00:00:00.000Z" },
            { reviewText: "杯盖内出现黑色霉斑，用了两周就发霉，很难清洗干净", rating: 2, productAsin: "B1", capturedAt: "2026-09-02T00:00:00.000Z" },
          ],
        }),
      }),
    );
    const reviews = drafts.filter((draft) => draft.kind === "review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].text).toContain("杯盖内出现黑色霉斑");
  });

  it("页面框架文本被识别并整条丢弃", () => {
    expect(isNoisyReviewText("C5 星（最高 5 星）Loved it2025年12月15日在日本发布评论颜色: 非常暗")).toBe(true);
    expect(isNoisyReviewText("名無し5 星（最高 5 星）使いやすい2025年3月6日在日本发布评论")).toBe(true);
    expect(isNoisyReviewText("Best water bottle ever, keeps drinks cold all day")).toBe(false);
  });

  it("抓取残留的评论不会出现在信号里", () => {
    const drafts = extractSignalDrafts(
      buildTask({
        resultJson: buildResultJson({
          reviews: [
            {
              reviewText: "C5 星（最高 5 星）Loved it2025年12月15日在日本发布评论颜色: 非常暗尺寸: 24-Ounce已确认购买",
              rating: null,
              productAsin: "B085DTZQNZ",
              capturedAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        }),
      }),
    );
    expect(drafts.filter((draft) => draft.kind === "review")).toHaveLength(0);
  });
});

/* ── 与共享构建器配合 ── */

describe("marketSignalProvider 与 V1 构建器配合", () => {
  it("自动信号经共享构建器编号后，来源被保留且可追溯", () => {
    const drafts: MarketSignalDraft[] = extractSignalDrafts(buildTask());
    const set = buildMarketSignalSet(drafts);

    expect(set.provided).toBe(true);
    expect(set.items[0].ref).toBe("S1");
    expect(set.items.every((item) => item.ref.startsWith("S"))).toBe(true);
    expect(set.items.every((item) => Boolean(item.source))).toBe(true);
    expect(set.stats.acceptedItems).toBe(set.items.length);
  });

  it("stripSignalHtmlTags 只去标签，不改语义", () => {
    expect(stripSignalHtmlTags('<img src="x.png"/> 卡扣太紧 &amp; 难装')).toBe("  卡扣太紧 & 难装");
    expect(stripSignalHtmlTags("正常文本，无标签")).toBe("正常文本，无标签");
  });
});

/* ── 结果说明文案 ── */

describe("marketSignalProvider 说明文案", () => {
  it("未匹配时如实说明检索范围，不含编造", () => {
    const text = describeProviderOutcome({
      set: emptyMarketSignalSet(),
      sources: [],
      reason: "no_match",
      scannedTaskCount: 11,
      totalTaskCount: 11,
      matchedTaskCount: 0,
      tokens: ["露营桌"],
    });
    expect(text).toContain("11 个已有研究任务");
    expect(text).toContain("没有找到");
  });

  it("命中时的条数取自去重后的信号集，不是草稿条数", () => {
    const set = buildMarketSignalSet([
      { kind: "pain_point", text: "杯盖发霉：有评论反映杯盖内出现黑色霉斑。" },
      { kind: "pain_point", text: "杯盖发霉：有评论反映杯盖内出现黑色霉斑。" },
    ]);
    const text = describeProviderOutcome({
      set,
      sources: [{ taskId: "t", title: "T", matchedTokens: [], matchedSurfaces: [], score: 3, signalCount: 1, reviewCount: 13 }],
      reason: "ok",
      scannedTaskCount: 11,
      totalTaskCount: 11,
      matchedTaskCount: 1,
      tokens: ["water"],
    });
    expect(text).toContain("1 个已有研究任务");
    expect(text).toContain("1 条真实信号");
    expect(text).toContain("去重 1 条");
  });
});

/* ── 真实库集成（仅本机；CI 无 dev.db 自动跳过） ── */

const DEV_DB_PATH = path.resolve(process.cwd(), "prisma", "dev.db");
const hasDevDb = existsSync(DEV_DB_PATH);

/**
 * vitest 不加载 Next.js 的 .env.local，DATABASE_URL 由文件顶部的 vi.hoisted 补齐。
 */
describe.skipIf(!hasDevDb)("marketSignalProvider 真实库集成（本机 dev.db）", () => {
  it("按真实商品方向自动取到带来源的信号", async () => {
    const outcome = await collectMarketSignals({ direction: "insulated water bottle" });

    expect(outcome.reason).toBe("ok");
    expect(outcome.set.items.length).toBeGreaterThan(0);
    expect(outcome.sources.length).toBeGreaterThan(0);
    expect(outcome.set.items.every((item) => Boolean(item.source))).toBe(true);
    expect(outcome.totalTaskCount).toBeGreaterThan(0);
  }, 30_000);

  it("无关方向不硬凑：返回 no_match 而不是编造信号", async () => {
    const outcome = await collectMarketSignals({ direction: "zzzz-not-a-real-direction-zzzz" });

    expect(outcome.reason).toBe("no_match");
    expect(outcome.set.items).toEqual([]);
    expect(outcome.totalTaskCount).toBeGreaterThan(0);
  }, 30_000);

  it("空方向直接返回 no_direction，不查库", async () => {
    const outcome = await collectMarketSignals({ direction: "   " });
    expect(outcome.reason).toBe("no_direction");
    expect(outcome.set.items).toEqual([]);
  });
});
