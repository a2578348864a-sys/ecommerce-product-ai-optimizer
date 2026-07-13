/**
 * Phase 4-D.8 — Source Import Labels helper tests.
 * Pure function tests — no network, no DB, no AI.
 */
import { describe, it, expect } from "vitest";
import {
  getCandidateTypeLabel,
  getCandidateTypeBadgeClass,
  getFailureReasonLabel,
  extractFailureReason,
  SOURCE_IMPORT_TIERS,
  SOURCE_IMPORT_HINT,
} from "./sourceImportLabels";

describe("getCandidateTypeLabel", () => {
  it('returns "商品候选" for product_candidate', () => {
    const r = getCandidateTypeLabel("product_candidate");
    expect(r.label).toBe("商品候选");
    expect(r.isEffectiveCandidate).toBe(true);
    expect(r.tone).toBe("green");
  });

  it('returns "类目提示" for category_hint', () => {
    const r = getCandidateTypeLabel("category_hint");
    expect(r.label).toBe("类目提示");
    expect(r.isEffectiveCandidate).toBe(false);
    expect(r.tone).toBe("amber");
  });

  it('returns "趋势信号" for trend_signal', () => {
    const r = getCandidateTypeLabel("trend_signal");
    expect(r.label).toBe("趋势信号");
    expect(r.isEffectiveCandidate).toBe(false);
    expect(r.tone).toBe("blue");
  });

  it('returns "已过滤" for rejected', () => {
    const r = getCandidateTypeLabel("rejected");
    expect(r.label).toBe("已过滤");
    expect(r.isEffectiveCandidate).toBe(false);
  });

  it('returns "待复核" for undefined (fallback)', () => {
    const r = getCandidateTypeLabel(undefined);
    expect(r.label).toBe("待复核");
    expect(r.isEffectiveCandidate).toBe(false);
    expect(r.type).toBe("unknown");
  });

  it("returns fallback for unknown string without error", () => {
    const r = getCandidateTypeLabel("garbage_type_123");
    expect(r.label).toBe("待复核");
    expect(r.type).toBe("unknown");
  });

  it("returns fallback for null", () => {
    const r = getCandidateTypeLabel(null);
    expect(r.label).toBe("待复核");
  });

  it("returns fallback for number input", () => {
    const r = getCandidateTypeLabel(42);
    expect(r.label).toBe("待复核");
  });
});

describe("getCandidateTypeBadgeClass", () => {
  it("returns green classes for green tone", () => {
    expect(getCandidateTypeBadgeClass("green")).toContain("emerald");
  });
  it("returns amber classes for amber tone", () => {
    expect(getCandidateTypeBadgeClass("amber")).toContain("amber");
  });
  it("returns blue classes for blue tone", () => {
    expect(getCandidateTypeBadgeClass("blue")).toContain("blue");
  });
  it("returns gray classes for unknown tone", () => {
    expect(getCandidateTypeBadgeClass("unknown")).toContain("slate");
  });
});

describe("getFailureReasonLabel", () => {
  it('returns "请求超时" for timeout', () => {
    const r = getFailureReasonLabel("timeout");
    expect(r.title).toBe("请求超时");
    expect(r.description).toBeTruthy();
    expect(r.recommendation).toBeTruthy();
  });

  it('returns "页面内容过大" for response_too_large', () => {
    const r = getFailureReasonLabel("response_too_large");
    expect(r.title).toBe("页面内容过大");
  });

  it('returns "请求失败" for fetch_failed', () => {
    const r = getFailureReasonLabel("fetch_failed");
    expect(r.title).toBe("请求失败");
  });

  it('returns JS render label for js_rendered_source_not_supported', () => {
    const r = getFailureReasonLabel("js_rendered_source_not_supported");
    expect(r.title).toBe("依赖浏览器渲染");
    expect(r.description).toContain("JavaScript");
  });

  it('returns anti-bot label for anti_bot_challenge', () => {
    const r = getFailureReasonLabel("anti_bot_challenge");
    expect(r.title).toBe("检测到验证挑战");
    expect(r.description).toContain("不会绕过");
  });

  it('returns robots label for robots_disallowed', () => {
    const r = getFailureReasonLabel("robots_disallowed");
    expect(r.title).toBe("robots.txt 受限");
  });

  it('returns SSRF label for ssrf_blocked', () => {
    const r = getFailureReasonLabel("ssrf_blocked");
    expect(r.title).toBe("安全限制");
  });

  it.each([
    ["batch_timeout", "批次超时"],
    ["http_error", "来源返回错误"],
    ["unsupported_content_type", "内容类型不支持"],
    ["unsupported_content_encoding", "压缩格式不支持"],
    ["redirect_invalid", "重定向被阻止"],
    ["robots_unavailable", "robots.txt 无法确认"],
  ])("returns a specific label for %s", (reason, title) => {
    expect(getFailureReasonLabel(reason).title).toBe(title);
  });

  it("returns fallback for unknown reason without error", () => {
    const r = getFailureReasonLabel("nonexistent_reason");
    expect(r.reason).toBe("nonexistent_reason");
    expect(r.title).toBeTruthy();
  });

  it("returns fallback for undefined", () => {
    const r = getFailureReasonLabel(undefined);
    expect(r.reason).toBe("unknown");
    expect(r.title).toBe("未知原因");
  });
});

describe("extractFailureReason", () => {
  it("extracts [timeout] from warning string", () => {
    expect(extractFailureReason("https://example.com: timeout [timeout]")).toBe("timeout");
  });
  it("extracts [response_too_large]", () => {
    expect(extractFailureReason("url: too large [response_too_large]")).toBe("response_too_large");
  });
  it("returns null when no tag present", () => {
    expect(extractFailureReason("just a warning message")).toBeNull();
  });
  it("handles empty string", () => {
    expect(extractFailureReason("")).toBeNull();
  });
});

describe("SOURCE_IMPORT_TIERS", () => {
  it("has 4 tiers", () => {
    expect(SOURCE_IMPORT_TIERS).toHaveLength(4);
  });

  it("recommended tier includes Shopify Blog", () => {
    const rec = SOURCE_IMPORT_TIERS.find((t) => t.key === "recommended");
    expect(rec).toBeDefined();
    expect(rec!.examples.some((e) => e.label.includes("Shopify"))).toBe(true);
  });

  it("partial tier includes Amazon", () => {
    const partial = SOURCE_IMPORT_TIERS.find((t) => t.key === "partial");
    expect(partial).toBeDefined();
    expect(partial!.examples.some((e) => e.label.includes("Amazon"))).toBe(true);
  });

  it("unsupported tier includes Product Hunt, AliExpress, Reddit", () => {
    const unsup = SOURCE_IMPORT_TIERS.find((t) => t.key === "unsupported");
    expect(unsup).toBeDefined();
    const labels = unsup!.examples.map((e) => e.label).join(" ");
    expect(labels).toContain("Product Hunt");
    expect(labels).toContain("AliExpress");
    expect(labels).toContain("Reddit");
  });

  it("every tier has name, description, and recommendation", () => {
    for (const tier of SOURCE_IMPORT_TIERS) {
      expect(tier.name).toBeTruthy();
      expect(tier.description).toBeTruthy();
      expect(tier.recommendation).toBeTruthy();
    }
  });
});

describe("SOURCE_IMPORT_HINT", () => {
  it("is a non-empty string mentioning Shopify", () => {
    expect(typeof SOURCE_IMPORT_HINT).toBe("string");
    expect(SOURCE_IMPORT_HINT.length).toBeGreaterThan(10);
    expect(SOURCE_IMPORT_HINT).toContain("Shopify");
  });
});
