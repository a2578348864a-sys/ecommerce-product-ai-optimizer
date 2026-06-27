import { describe, expect, it } from "vitest";
import { buildMockAiListingDraft } from "@/lib/aiListingDraft";
import { containsListingBannedClaim, filterListingClaims } from "@/lib/listingClaimFilter";

describe("listingClaimFilter", () => {
  it("blocks high-risk English listing claims", () => {
    const draft = {
      ...buildMockAiListingDraft({ productName: "Pan" }),
      titles: ["FDA Approved PFOA-Free Pan"],
      bullets: ["100% Safe Medical Grade material for daily use."],
      description: "LFGB Certified and BPA Free product.",
      keywords: ["Non-toxic", "Eco-friendly", "Food grade"],
      sellingPoints: ["Child safe", "Health certified"],
    };

    const result = filterListingClaims(draft);
    const visibleText = [
      ...result.cleaned.titles,
      ...result.cleaned.bullets,
      result.cleaned.description,
      ...result.cleaned.keywords,
      ...result.cleaned.sellingPoints,
    ].join(" ");

    expect(result.blockedClaims).toEqual(expect.arrayContaining([
      "FDA Approved",
      "PFOA-Free",
      "100% Safe",
      "Medical Grade",
      "LFGB Certified",
      "BPA Free",
      "Non-toxic",
      "Eco-friendly",
      "Food grade",
      "Child safe",
      "Health certified",
    ]));
    expect(containsListingBannedClaim(visibleText)).toBe(false);
    expect(result.cleaned.complianceWarnings.join(" ")).toMatch(/Human review is required/);
  });

  it("blocks false Chinese commercialization claims", () => {
    const draft = {
      ...buildMockAiListingDraft({ productName: "测试商品" }),
      titles: ["测试商品 自动上架成功"],
      bullets: ["稳赚，爆款必出，保证盈利。"],
      description: "一键上架，平台认证已通过。",
      keywords: ["稳赚", "爆款必出"],
      sellingPoints: ["保证盈利"],
    };

    const result = filterListingClaims(draft);
    const visibleText = [
      ...result.cleaned.titles,
      ...result.cleaned.bullets,
      result.cleaned.description,
      ...result.cleaned.keywords,
      ...result.cleaned.sellingPoints,
    ].join(" ");

    expect(result.blockedClaims).toEqual(expect.arrayContaining([
      "自动上架成功",
      "稳赚",
      "爆款必出",
      "保证盈利",
      "一键上架",
      "平台认证已通过",
    ]));
    expect(visibleText).not.toMatch(/自动上架成功|稳赚|爆款必出|保证盈利|一键上架|平台认证已通过/);
  });

  it("does not remove normal selling points", () => {
    const draft = {
      ...buildMockAiListingDraft({ productName: "Desktop Stand" }),
      sellingPoints: ["Adjustable angle", "Compact desktop storage"],
    };

    const result = filterListingClaims(draft);

    expect(result.blockedClaims).toEqual([]);
    expect(result.cleaned.sellingPoints).toContain("Adjustable angle");
    expect(result.cleaned.sellingPoints).toContain("Compact desktop storage");
  });
});
