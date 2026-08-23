import { describe, expect, it } from "vitest";
import {
  parseAmazonCompetitorDetailObservation,
  normalizeAmazonCompetitorDetailBullets,
  AMAZON_DETAIL_OBSERVATION_SCHEMA,
  amazonDetailUrl,
} from "./amazonCompetitorCollector";

describe("轮 15：竞品详情页五点采集（红灯先验）", () => {
  it("详情 URL：正确构造 amazon.com/dp/ASIN", () => {
    expect(amazonDetailUrl({ asin: "B0TEST1234", marketplaceTld: "com" })).toBe("https://www.amazon.com/dp/B0TEST1234");
    expect(amazonDetailUrl({ asin: "B0TEST1234", marketplaceTld: "co.uk" })).toBe("https://www.amazon.co.uk/dp/B0TEST1234");
  });

  it("解析五点：每条 5 条、去空、按 li 顺序", () => {
    const raw = JSON.stringify({
      schema: AMAZON_DETAIL_OBSERVATION_SCHEMA,
      url: "https://www.amazon.com/dp/B0TEST1234",
      title: "Test Product",
      bodyText: "About this item",
      asin: "B0TEST1234",
      bulletTexts: ["Full width slots", "Removable crumb tray", "", "Compact design", "Easy to clean", "Sync clock"],
      parsedBullets: 7,
      observedAt: "2026-08-23T00:00:00.000Z",
    });
    const obs = parseAmazonCompetitorDetailObservation(raw);
    expect(obs).not.toBeNull();
    expect(obs!.bulletTexts).toEqual(["Full width slots", "Removable crumb tray", "Compact design", "Easy to clean", "Sync clock"]);
  });

  it("ASIN 不匹配 fail-closed：观察页 ASIN 与请求不一致 → null", () => {
    const raw = JSON.stringify({
      schema: AMAZON_DETAIL_OBSERVATION_SCHEMA,
      url: "https://www.amazon.com/dp/B0OTHER999",
      title: "Mismatch",
      bodyText: "x",
      asin: "B0OTHER999",
      bulletTexts: ["a", "b"],
      parsedBullets: 2,
      observedAt: "2026-08-23T00:00:00.000Z",
    });
    const obs = parseAmazonCompetitorDetailObservation(raw, "B0TEST1234");
    expect(obs).not.toBeNull();
    expect(obs!.failureReason).toBe("asin_mismatch");
    // normalize 同样拒绝错配条目（fail-closed）
    const norm = normalizeAmazonCompetitorDetailBullets([
      { asin: "B0OTHER999", url: "https://www.amazon.com/dp/B0OTHER999", bullets: ["x"], capturedAt: "2026-08-23T00:00:00.000Z" },
    ], "B0TEST1234");
    expect(norm).toHaveLength(0);
  });

  it("验证码/登录墙 fail-closed：bodyText 含 captcha → failureReason", () => {
    const raw = JSON.stringify({
      schema: AMAZON_DETAIL_OBSERVATION_SCHEMA,
      url: "https://www.amazon.com/dp/B0TEST1234",
      title: "Captcha",
      bodyText: "Enter the characters you see below",
      asin: "B0TEST1234",
      bulletTexts: [],
      parsedBullets: 0,
      observedAt: "2026-08-23T00:00:00.000Z",
    });
    const obs = parseAmazonCompetitorDetailObservation(raw, "B0TEST1234");
    expect(obs).not.toBeNull();
    expect(obs!.failureReason).toBe("captcha_required");
  });

  it("外站 URL / 最多 5 条 / 恶意字段（1000 段长文本）→ 拒绝", () => {
    const norm = normalizeAmazonCompetitorDetailBullets([
      { asin: "B0TEST1234", url: "https://evil.example.com/dp/B0TEST1234", bullets: ["a"], capturedAt: "2026-08-23T00:00:00.000Z" },
      { asin: "B0BAD", url: "https://www.amazon.com/dp/B0BAD", bullets: ["x"], capturedAt: "2026-08-23T00:00:00.000Z" },
    ], "B0TEST1234");
    expect(norm).toHaveLength(0);
    const long = normalizeAmazonCompetitorDetailBullets([
      { asin: "B0TEST1234", url: "https://www.amazon.com/dp/B0TEST1234", bullets: ["a".repeat(700), "b".repeat(700), "c".repeat(700), "d".repeat(700), "e".repeat(700), "f".repeat(700), "g".repeat(700)], capturedAt: "2026-08-23T00:00:00.000Z" },
    ], "B0TEST1234");
    expect(long[0].bullets.length).toBeLessThanOrEqual(5);
    expect(long[0].bullets.every((b) => b.length <= 500)).toBe(true);
  });
});
