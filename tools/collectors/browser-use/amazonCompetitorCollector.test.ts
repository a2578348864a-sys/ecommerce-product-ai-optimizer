import { describe, expect, it } from "vitest";
import {
  amazonSearchUrl,
  isAllowedAmazonSourceUrl,
  buildAmazonCompetitorScript,
  parseAmazonCompetitorObservation,
  normalizeAmazonCompetitorCandidates,
  amazonCompetitorObservationToPreview,
  runAmazonCompetitorCollection,
  type AmazonCompetitorCollectionInput,
} from "./amazonCompetitorCollector";

describe("Amazon 竞品发现采集器（轮 10）", () => {
  const input: AmazonCompetitorCollectionInput = {
    seedAsin: "B08NCVT244", marketplaceTld: "com", keyword: "lunch box",
  };

  const rawCards = [
    { asin: "B0TEST0001", title: "Competitor One", sourceUrl: "https://www.amazon.com/dp/B0TEST0001", imageUrl: "https://m.media-amazon.com/images/I/61abc.jpg", price: 12.99, rating: 4.6, reviews: 1234, sponsored: false },
    { asin: "B0TEST0002", title: "Advertised", sourceUrl: "https://www.amazon.com/dp/B0TEST0002", imageUrl: null, price: null, rating: null, reviews: null, sponsored: true },
    { asin: "B08NCVT244", title: "Seed itself", sourceUrl: "https://www.amazon.com/dp/B08NCVT244", imageUrl: null, price: null, rating: null, reviews: null, sponsored: false },
    { asin: "B0TEST0001", title: "Duplicate", sourceUrl: "https://www.amazon.com/dp/B0TEST0001", imageUrl: null, price: null, rating: null, reviews: null, sponsored: false },
    { asin: "BAD", title: "Invalid asin", sourceUrl: "https://www.amazon.com/dp/BAD", imageUrl: null, price: null, rating: null, reviews: null, sponsored: false },
    { asin: "B0TEST0003", title: "Evil host", sourceUrl: "https://amazon.evil.example/dp/B0TEST0003", imageUrl: null, price: null, rating: null, reviews: null, sponsored: false },
    { asin: "B0TEST0004", title: "External img", sourceUrl: "https://www.amazon.com/dp/B0TEST0004", imageUrl: "https://evil.example/img.jpg", price: null, rating: null, reviews: null, sponsored: false },
  ];

  it("搜索 URL：https + 精确 amazon 域名 allowlist；拒绝 evil/用户信息段/非 https", () => {
    expect(amazonSearchUrl({ ...input, marketplaceTld: "com" })).toBe("https://www.amazon.com/s?k=lunch%20box");
    expect(isAllowedAmazonSourceUrl("https://www.amazon.com/dp/B0TEST0001")).toBe(true);
    expect(isAllowedAmazonSourceUrl("https://www.amazon.co.uk/dp/B0TEST0001")).toBe(true);
    expect(isAllowedAmazonSourceUrl("https://amazon.evil.example/dp/X")).toBe(false);
    expect(isAllowedAmazonSourceUrl("https://www.amazon.com.attacker.org/dp/X")).toBe(false);
    expect(isAllowedAmazonSourceUrl("https://user:pass@www.amazon.com/dp/X")).toBe(false);
    expect(isAllowedAmazonSourceUrl("http://www.amazon.com/dp/X")).toBe(false);
  });

  it("脚本：包含 /s?k= 搜索、data-asin 与 m.media-amazon.com 图片约束；不含硬编码竞品", () => {
    const script = buildAmazonCompetitorScript(input);
    expect(script).toContain("https://www.amazon.com/s?k=lunch%20box");
    expect(script).toContain("data-asin");
    expect(script).toContain("BU_COLLECT_OUTPUT");
    expect(script).not.toContain("B0TEST0001");
  });

  it("规范化：排除 seed/广告/重复/非法 ASIN/外站 URL；外站图片置 null；最多 5 条", () => {
    const result = normalizeAmazonCompetitorCandidates(rawCards, "B08NCVT244");
    expect(result.competitors).toHaveLength(2); // B0TEST0004 保留（外站图片→null）
    expect(result.competitors.map((c) => c.asin)).toEqual(["B0TEST0001", "B0TEST0004"]);
    expect(result.competitors[1].imageUrl).toBeNull();
    const many = normalizeAmazonCompetitorCandidates(Array.from({ length: 9 }, (_, i) => ({ asin: "B0TEST000" + i, title: "t", sourceUrl: "https://www.amazon.com/dp/B0TEST000" + i, sponsored: false })), "SEEDASIN00");
    expect(many.competitors.length).toBeLessThanOrEqual(5);
  });

  it("失败原因明确：验证码/登录墙/无结果/结构变化/畸形输出 → 各自 distinct，不冒充无竞品", () => {
    const captcha = parseAmazonCompetitorObservation(JSON.stringify({ schema: "amazon-search-observation.v1", url: "u", title: "t", bodyText: "Enter the characters you see below", cards: [], observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(captcha?.failureReason).toBe("captcha_required");
    const noResults = parseAmazonCompetitorObservation(JSON.stringify({ schema: "amazon-search-observation.v1", url: "u", title: "t", bodyText: "No results for", cards: [], observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(noResults?.failureReason).toBe("no_results");
    const struct = parseAmazonCompetitorObservation(JSON.stringify({ schema: "amazon-search-observation.v1", url: "u", title: "t", bodyText: "ordinary", cards: [], observedAt: "2026-08-14T02:00:00.000Z", parsedCards: 12, structureChanged: true }));
    expect(struct?.failureReason).toBe("structure_changed");
    expect(parseAmazonCompetitorObservation("garbage")).toBeNull();
  });

  it("观察 → 严格 Preview：kind=competitor、seed/来源 URL、结果（缺字段 null）、缺失项", () => {
    const obs = parseAmazonCompetitorObservation(JSON.stringify({ schema: "amazon-search-observation.v1", url: "https://www.amazon.com/s?k=lunch%20box", title: "t", bodyText: "ok", cards: rawCards.slice(0, 2), observedAt: "2026-08-14T02:00:00.000Z" })) as NonNullable<ReturnType<typeof parseAmazonCompetitorObservation>>;
    const preview = amazonCompetitorObservationToPreview(input, obs, "0.1.9");
    expect(preview.kind).toBe("competitor");
    expect(preview.seedAsin).toBe("B08NCVT244");
    expect(preview.sourceUrl).toBe("https://www.amazon.com/s?k=lunch%20box");
    expect(preview.results.length).toBeGreaterThan(0);
    const first = preview.results[0] as Record<string, unknown>;
    expect(first.asin).toBeTruthy();
    expect(first.sourceUrl).toBeTruthy();
    expect(first.capturedAt).toBeTruthy();
  });

  it("运行：spawn 边界可注入；空/畸形输出 → collect_failed；正常 → 观察", async () => {
    const ok = await runAmazonCompetitorCollection(input, async () => ({ stdout: JSON.stringify({ schema: "amazon-search-observation.v1", url: "u", title: "t", bodyText: "ok", cards: [], observedAt: "2026-08-14T02:00:00.000Z" }), stderr: "", code: 0 }));
    expect(ok.ok).toBe(true);
    const bad = await runAmazonCompetitorCollection(input, async () => { throw new Error("boom"); });
    expect(bad).toMatchObject({ ok: false, failureReason: "collector_unavailable" });
    const malformed = await runAmazonCompetitorCollection(input, async () => ({ stdout: "zzz", stderr: "", code: 0 }));
    expect(malformed).toMatchObject({ ok: false, failureReason: "collect_failed" });
  });
});