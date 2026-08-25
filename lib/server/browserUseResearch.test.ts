import { pickBestKeyword, scoreKeywordRelevance, classifyCompetitorRelation } from "@/lib/research/researchInputQuality";
import { describe, expect, it } from "vitest";
import {
  assertBrowserUseOwnerOnly,
  isAllowedCollectorSourceUrl,
  selectReliableSearchKeyword,
  parseBrowserUseResearchPreview,
  resolveBrowserUseSeed,
  storeBrowserUsePreview,
  takeBrowserUsePreview,
  type BrowserUseResearchPreviewV1,
} from "./browserUseResearch";

const BATCH_CAC = {
  version: "candidate-analysis-context-v1",
  integrity: "verified_product_batch",
  facts: {
    capturedAt: "2026-08-14T02:00:00.000Z",
    originKind: "seller_sprite_product_batch",
    productBatchId: "batch-1",
    productBatchItemId: "item-1",
    productName: "Closet organizer",
    marketplace: "US",
    asin: "B0SAMPLE12",
    reportType: "search_results",
  },
  assessment: { researchMode: "market_research_only", promotionEligible: false },
};

describe("browserUseResearch 合同与门禁（轮 9）", () => {
  it("种子只从服务端任务身份解析：verified_product_batch → marketplace/asin/URL，缺身份 fail-closed", () => {
    const seed = resolveBrowserUseSeed({ type: "workflow", candidateAnalysisContext: BATCH_CAC });
    expect(seed).toEqual({ marketplace: "US", asin: "B0SAMPLE12", productUrl: null, productName: "Closet organizer" });
    expect(resolveBrowserUseSeed({ candidateAnalysisContext: { integrity: "unverified" } })).toBeNull();
    expect(resolveBrowserUseSeed({ candidateAnalysisContext: { integrity: "verified_product_batch", facts: { marketplace: "US", asin: null } } })).toBeNull();
  });

  it("种子从 verified_seller_sprite 读取（含 productUrl）；错误 ASIN/市场 一律 null", () => {
    const seed = resolveBrowserUseSeed({ candidateAnalysisContext: {
      version: "candidate-analysis-context-v1", integrity: "verified_seller_sprite",
      facts: { marketplace: "Amazon US", asin: "B0SAMPLE12", productUrl: "https://www.amazon.com/dp/B0SAMPLE12", title: "T" },
      assessment: { researchMode: "market_research_only" },
    } });
    expect(seed as Record<string, unknown>).toMatchObject({ marketplace: "Amazon US", asin: "B0SAMPLE12", productUrl: "https://www.amazon.com/dp/B0SAMPLE12" });
    expect(resolveBrowserUseSeed({ candidateAnalysisContext: { integrity: "verified_product_batch", facts: { marketplace: "US", asin: "too-short" } } })).toBeNull();
  });

  it("访客/Sandbox 默认拒绝（local owner only）", () => {
        try {
          assertBrowserUseOwnerOnly({ mode: "demo", demoAccessId: "v1", isActive: true, isExpired: false, remainingAiCalls: 1 } as never);
          throw new Error("should have thrown");
        } catch (error) {
          expect((error as Error).name).toBe("BrowserUseResearchError");
          expect((error as { code?: string }).code).toBe("browser_use_local_owner_only");
          expect((error as Error).message).toContain("仅限本机 Owner");
        }
  });

  it("严格 Preview 解析：上限（竞品 5 / 关键词 100）、字段不猜（null=页面缺失）、失败原因白名单", () => {
    const valid: BrowserUseResearchPreviewV1 = {
      schema: "browser-use-research-preview.v1", version: 1, kind: "competitor",
      seedAsin: "B0SAMPLE12", marketplace: "US", seedProductUrl: null,
      sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12", capturedAt: "2026-08-14T02:00:00.000Z",
      results: [{ asin: "B0COMP0002", title: "Thermo 40oz", imageUrl: null, price: 24.99, rating: 4.5, reviews: 120, bsr: 12700, sourceUrl: "https://www.amazon.com/dp/B0COMP0002", capturedAt: "2026-08-14T02:00:00.000Z" }],
      missing: ["brand"], failureReason: null,
      collector: { tool: "browser-use", version: "0.1.9" },
    };
    const parsed = parseBrowserUseResearchPreview(valid);
    expect(parsed).not.toBeNull();
    expect((parsed as BrowserUseResearchPreviewV1).results).toHaveLength(1);
    expect(parseBrowserUseResearchPreview({ ...valid, kind: "competitor", results: Array.from({ length: 6 }, (_, i) => ({ ...valid.results[0], asin: "B0COMP000" + i })) })).toBeNull();
    const manyKeywords: BrowserUseResearchPreviewV1 = { ...valid, kind: "keyword", results: Array.from({ length: 101 }, (_, i) => ({ keyword: "kw" + i, keywordTranslation: null, searchVolume: i, relevance: null, competition: null, capturedAt: "2026-08-14T02:00:00.000Z" })) as never };
    expect(parseBrowserUseResearchPreview(manyKeywords)).toBeNull();
    expect(parseBrowserUseResearchPreview({ ...valid, failureReason: "collector_unavailable" })).not.toBeNull();
    expect(parseBrowserUseResearchPreview({ ...valid, failureReason: "made_up_reason" })).toBeNull();
    expect(parseBrowserUseResearchPreview({ ...valid, failureReason: "login_required", results: [] })).not.toBeNull();
  });

  it("Preview 服务端缓存：存在→取出一次；不存在→取 null（不信任客户端字段）", () => {
    const id = storeBrowserUsePreview(validPreview());
    expect(id).toMatch(/^bup_preview_/);
    const taken = takeBrowserUsePreview(id);
    expect(taken).toEqual(validPreview());
    expect(takeBrowserUsePreview(id)).toBeNull();
    expect(takeBrowserUsePreview("bup_preview_missing")).toBeNull();
  });

  it("采集来源 URL 校验：Amazon 官方域名放行；外站/空格/协议相对拒绝", () => {
    expect(isAllowedCollectorSourceUrl("https://www.amazon.com/dp/B0SAMPLE12")).toBe(true);
    expect(isAllowedCollectorSourceUrl("http://amazon.co.uk/dp/X")).toBe(true);
    expect(isAllowedCollectorSourceUrl("https://evil.example/dp/B0SAMPLE12")).toBe(false);
    expect(isAllowedCollectorSourceUrl("//evil.example/x")).toBe(false);
    expect(isAllowedCollectorSourceUrl("https://www.amazon.com/dp/B0 EVIL")).toBe(false);
  });

  it("采集来源 URL 校验：域名后缀欺骗/用户信息/非 HTTP(S) 一律拒绝（P1-2 红灯）", () => {
    expect(isAllowedCollectorSourceUrl("https://amazon.com.evil.com/dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl("https://www.amazon.com.attacker.tld/dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl("https://amazon.com@evil.com/dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl("ftp://amazon.com/dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl("https://amazonevil.com/dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl("https://amazon.com./dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl(" https://amazon.com/dp/X")).toBe(false);
    expect(isAllowedCollectorSourceUrl("https://amazon.com.evil.com")).toBe(false);
    expect(isAllowedCollectorSourceUrl("not a url")).toBe(false);
    // 合法站点仍放行（已有站点集 + www；不扩新 marketplace）
    expect(isAllowedCollectorSourceUrl("https://www.amazon.com/dp/B0SAMPLE12")).toBe(true);
    expect(isAllowedCollectorSourceUrl("http://amazon.co.uk/dp/X")).toBe(true);
    expect(isAllowedCollectorSourceUrl("https://amazon.de/dp/X")).toBe(true);
    expect(isAllowedCollectorSourceUrl("https://www.amazon.co.jp/dp/X")).toBe(true);
    expect(isAllowedCollectorSourceUrl("https://amazon.ca/dp/X")).toBe(true);
  });

  it("可靠搜索关键词：跳过品牌词（owala/owala）与空值；取第一个非品牌词；全品牌→null", () => {
    const items = [
      { keyword: "", keywordTranslation: null, capturedAt: "x" } as never,
      { keyword: "owala", keywordTranslation: "owala", capturedAt: "x" } as never,
      { keyword: "lunch box", keywordTranslation: "\u5348\u9910\u76d2", capturedAt: "x" } as never,
      { keyword: "bento", keywordTranslation: "\u4fbf\u5f53", capturedAt: "x" } as never,
    ];
    expect(selectReliableSearchKeyword(items as never)).toBe("lunch box");
    expect(selectReliableSearchKeyword([{ keyword: "owala", keywordTranslation: "owala", capturedAt: "x" }] as never)).toBeNull();
  });
});

function validPreview(): BrowserUseResearchPreviewV1 {
  return {
    schema: "browser-use-research-preview.v1", version: 1, kind: "competitor",
    seedAsin: "B0SAMPLE12", marketplace: "US", seedProductUrl: null,
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12", capturedAt: "2026-08-14T02:00:00.000Z",
    results: [{ asin: "B0COMP0002", title: "Thermo 40oz", imageUrl: null, price: 24.99, rating: 4.5, reviews: 120, bsr: 12700, sourceUrl: "https://www.amazon.com/dp/B0COMP0002", capturedAt: "2026-08-14T02:00:00.000Z" }],
    missing: [], failureReason: null,
    collector: { tool: "browser-use", version: "0.1.9" },
  };
}
describe("selectReliableSearchKeyword with productName（与 Brief 推荐同一算法）", () => {
  const items = [
    { keyword: "lunch box", keywordTranslation: "午餐盒", searchVolume: 1_481_183, capturedAt: "x" } as never,
    { keyword: "thermos for hot food kids", keywordTranslation: "热食保温罐", searchVolume: 54_915, capturedAt: "x" } as never,
  ];
  it("传权威商品名 → 抛弃首行宽词，选相关词（THERMOS 夹具）", () => {
    expect(selectReliableSearchKeyword(items as never, "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink")).toBe("thermos for hot food kids");
  });
  it("无相关词 → null（fail-closed，不从标题编造）", () => {
    expect(selectReliableSearchKeyword([{ keyword: "kitchen towels", keywordTranslation: "厨巾", searchVolume: 1, capturedAt: "x" }] as never, "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink")).toBeNull();
  });
});
