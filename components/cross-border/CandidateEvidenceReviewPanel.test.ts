import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateEvidenceReviewPanel } from "@/components/cross-border/CandidateEvidenceReviewPanel";
import type { CandidateEvidenceReviewV1 } from "@/lib/candidateEvidenceReview";

const verifiedReview: CandidateEvidenceReviewV1 = {
  version: "candidate-evidence-review-v1",
  integrity: "verified_public",
  facts: {
    capturedAt: "2026-07-12T01:00:00.000Z",
    sourceHost: "example.com",
    sourceType: "html",
    sourceRelation: "document",
    documentUrl: "https://example.com/product",
    candidateUrl: "https://example.com/product",
    openUrl: "https://example.com/product",
    httpStatus: 200,
    contentType: "text/html",
    robots: "allowed",
    redirectCount: 0,
    title: "Product",
    categoryHint: null,
    signalText: "Product signal",
    priceText: "$10",
    hasImage: true,
    extractionSignals: ["product_page"],
  },
  assessment: {
    algorithm: "radar-score-v1",
    computedAt: "2026-07-12T01:01:00.000Z",
    candidateType: "product_candidate",
    scores: { demandSignal: 70, supplyEase: 70, risk: 30, beginnerFit: 70, final: 70 },
    riskFlags: ["manual_price_check"],
    reasons: ["价格仍需人工核对"],
    queueSuggestion: "review",
  },
};

describe("CandidateEvidenceReviewPanel", () => {
  it("separates source facts, rule assessment and limitations without overstating verification", () => {
    const html = renderToStaticMarkup(createElement(CandidateEvidenceReviewPanel, {
      review: verifiedReview,
    }));

    expect(html).toContain("来源事实");
    expect(html).toContain("规则判断");
    expect(html).toContain("来源文档 URL");
    expect(html).toContain("商品 URL");
    expect(html).toContain("Content-Type");
    expect(html).toContain("robots.txt 允许");
    expect(html).toContain("代码规则计算，不是市场事实");
    expect(html).toContain("来源证据链已验证");
    expect(html).toContain("不代表商品真实性、市场需求或页面当前状态");
    expect(html).not.toContain("商品已验证");
    expect(html).not.toContain("需求已验证");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.com/product"');
  });

  it("renders unverified data as a manual-review clue rather than verified facts", () => {
    const html = renderToStaticMarkup(createElement(CandidateEvidenceReviewPanel, {
      review: {
        version: "candidate-evidence-review-v1",
        integrity: "unverified",
        reason: "legacy_or_invalid",
      },
    }));

    expect(html).toContain("没有可验证的公开来源证据链");
    expect(html).toContain("待人工核对的线索");
    expect(html).not.toContain("打开来源");
  });
});
