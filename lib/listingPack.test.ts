/**
 * Acceptance-Fix.1-Test — Unverified Listing Claim Sanitization Regression Tests
 */
import { describe, expect, it } from "vitest";
import { buildFallbackListingPack, listingPackToMarkdown } from "@/lib/listingPack";

// ── Test 1: Titles must NOT output unverified claims ──
describe("buildFallbackListingPack — title sanitization", () => {
  const bannedClaims = [
    "PFOA-Free", "PFOS-Free", "PFOA Free", "PFOS Free",
    "BPA-Free", "BPA Free",
    "FDA Approved", "FDA Certified", "FDA Cleared",
    "LFGB Certified", "LFGB Approved",
    "CE Certified", "FCC Certified", "RoHS Certified", "UL Certified",
    "Medical Grade", "Food Grade",
    "100% Safe", "100% Non-toxic", "Completely Safe",
    "Official", "Authentic", "Authorized", "Genuine",
    "Guaranteed", "Warranty Guaranteed",
    "Best", "No.1", "Top Rated",
    "Cure", "Treatment",
    "Hypoallergenic", "Dermatologist Tested",
  ];

  const safeTerms = [
    "supplier verification required",
    "pending supplier confirmation",
    "requires verification",
    "certification pending review",
    "supplier documents required",
  ];

  it("strips unverified claims from titles for non-stick pan product", () => {
    const pack = buildFallbackListingPack({ productName: "Non-Stick Frying Pan" });
    const allTitles = pack.titleDrafts.join(" ");
    for (const claim of bannedClaims) {
      expect(allTitles).not.toMatch(new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i"));
    }
    // At least one safe term should appear
    const hasSafe = safeTerms.some(t => allTitles.toLowerCase().includes(t.toLowerCase()));
    expect(hasSafe).toBe(true);
  });

  it("strips unverified claims from titles for cookware with explicit risk terms in name", () => {
    const pack = buildFallbackListingPack({ productName: "PFOA-Free Non-Stick Fry Pan" });
    const allTitles = pack.titleDrafts.join(" ");
    expect(allTitles).not.toMatch(/PFOA-Free/i);
    expect(allTitles).not.toMatch(/PFOA Free/i);
    const hasSafe = safeTerms.some(t => allTitles.toLowerCase().includes(t.toLowerCase()));
    expect(hasSafe).toBe(true);
  });

  it("generates at least 3 title drafts", () => {
    const pack = buildFallbackListingPack({ productName: "Desktop Phone Stand" });
    expect(pack.titleDrafts.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Test 2: Keywords must NOT contain unverified certification/health claims ──
describe("buildFallbackListingPack — keyword sanitization", () => {
  it("strips unverified claims from all keyword layers for risky product", () => {
    const pack = buildFallbackListingPack({ productName: "BPA-Free FDA Approved Water Bottle" });
    const allKws = [
      ...pack.coreKeywords,
      ...pack.longTailKeywords,
      ...pack.scenarioKeywords,
      ...pack.featureKeywords,
      ...pack.audienceKeywords,
    ].map(k => k.keyword).join(" ").toLowerCase();

    expect(allKws).not.toMatch(/bpa-free/i);
    expect(allKws).not.toMatch(/fda approved/i);
    expect(allKws).not.toMatch(/fda certified/i);
    expect(allKws).not.toMatch(/lfgb/i);
    expect(allKws).not.toMatch(/medical grade/i);
    expect(allKws).not.toMatch(/100% safe/i);
    expect(allKws).not.toMatch(/official/i);
    expect(allKws).not.toMatch(/authentic/i);
    expect(allKws).not.toMatch(/guaranteed/i);
  });

  it("preserves normal product keywords without over-sanitizing", () => {
    const pack = buildFallbackListingPack({ productName: "Desktop Phone Stand" });
    const allKws = [
      ...pack.coreKeywords,
      ...pack.longTailKeywords,
    ].map(k => k.keyword);

    // Should still have meaningful keywords, not just "supplier verification required"
    const meaningfulCount = allKws.filter(k => !k.includes("supplier verification") && !k.includes("pending")).length;
    expect(meaningfulCount).toBeGreaterThan(0);
  });
});

// ── Test 3: Bullet points must NOT promise unverified material safety ──
describe("buildFallbackListingPack — bullet point sanitization", () => {
  it("strips unverified material/safety claims from bullet points", () => {
    const pack = buildFallbackListingPack({ productName: "Non-Stick Frying Pan" });
    const allBullets = pack.bulletPoints.join(" ").toLowerCase();
    expect(allBullets).not.toMatch(/pfoa-free/i);
    expect(allBullets).not.toMatch(/pfos-free/i);
    expect(allBullets).not.toMatch(/fda approved/i);
    expect(allBullets).not.toMatch(/lfgb certified/i);
    expect(allBullets).not.toMatch(/100% safe/i);
    expect(allBullets).not.toMatch(/guaranteed safe/i);
    expect(allBullets).not.toMatch(/medical grade/i);

    // Should include safety-appropriate language
    const hasSafe = /supplier|verification|pending|documents|certification/i.test(allBullets);
    expect(hasSafe).toBe(true);
  });
});

// ── Test 4: Markdown export must be clean ──
describe("listingPackToMarkdown — sanitization in export", () => {
  it("strips unverified claims from markdown output", () => {
    const pack = buildFallbackListingPack({ productName: "PFOA-Free LFGB Certified Pan" });
    const md = listingPackToMarkdown(pack).toLowerCase();
    // Check only generated content sections — disclaimer may mention "authenticity" in review context
    const contentOnly = md.split("## 风险用词提醒")[0];

    expect(contentOnly).not.toMatch(/pfoa-free/i);
    expect(contentOnly).not.toMatch(/lfgb certified/i);
    expect(contentOnly).not.toMatch(/fda approved/i);
    expect(contentOnly).not.toMatch(/100% safe/i);
    expect(contentOnly).not.toMatch(/medical grade/i);
    // "guaranteed" and "authentic" may appear in disclaimer as review/verification context
  });

  it("includes safety disclaimer in markdown", () => {
    const pack = buildFallbackListingPack({ productName: "Test Product" });
    const md = listingPackToMarkdown(pack);
    expect(md).toMatch(/人工复核|不会自动上架|supplier|verify|review/i);
  });
});

// ── Test 5: Normal product is NOT over-sanitized ──
describe("buildFallbackListingPack — normal product regression", () => {
  it("generates usable listing for normal product", () => {
    const pack = buildFallbackListingPack({ productName: "Desktop Phone Stand" });
    // Should generate titles
    expect(pack.titleDrafts.length).toBeGreaterThanOrEqual(3);
    // Should generate bullet points
    expect(pack.bulletPoints.length).toBeGreaterThanOrEqual(5);
    // Should have keywords
    expect(pack.coreKeywords.length).toBeGreaterThanOrEqual(3);
    expect(pack.longTailKeywords.length).toBeGreaterThanOrEqual(2);
    expect(pack.scenarioKeywords.length).toBeGreaterThanOrEqual(2);
    expect(pack.featureKeywords.length).toBeGreaterThanOrEqual(2);
    // Should have image requirements
    expect(pack.imageRequirements.length).toBeGreaterThanOrEqual(5);
    // Should have risk terms
    expect(pack.riskTerms.length).toBeGreaterThanOrEqual(5);
    // Should have checklist
    expect(pack.prePublishChecklist.length).toBeGreaterThanOrEqual(5);

    // Should NOT be over-sanitized — titles should still mention the product
    const allTitles = pack.titleDrafts.join(" ");
    expect(allTitles).toMatch(/Phone Stand/i);

    // Keywords should still reflect the product
    const allKws = pack.coreKeywords.map(k => k.keyword).join(" ");
    expect(allKws.length).toBeGreaterThan(10);
  });
});

// ── Test 6: Rule-based source is preserved ──
describe("buildFallbackListingPack — source metadata", () => {
  it("marks source as rule_based not ai", () => {
    const pack = buildFallbackListingPack({ productName: "Test" });
    expect(pack.source).toBe("rule_based");
  });

  it("disclaimer mentions human review and no auto-publish", () => {
    const pack = buildFallbackListingPack({ productName: "Test" });
    expect(pack.disclaimer).toMatch(/does NOT auto-publish|不会自动上架|does not auto[- ]?publish/i);
    expect(pack.disclaimer).toMatch(/review|reviewed|复核/i);
  });
});

// ── Test 7: No false commercialization claims in generated content ──
describe("buildFallbackListingPack — no false promises in generated content", () => {
  const falseClaims = ["稳赚", "爆款必出", "保证盈利", "自动上架成功", "automatically publish"];

  it("does not output false claims in titles, bullets, keywords, or selling points", () => {
    const pack = buildFallbackListingPack({ productName: "Test Product" });
    // Only check generated content — risk terms intentionally list dangerous terms as warnings
    const generatedContent = [
      ...pack.titleDrafts,
      ...pack.bulletPoints,
      ...pack.coreKeywords.map(k => k.keyword),
      ...pack.longTailKeywords.map(k => k.keyword),
      ...pack.sellingPoints,
      ...pack.targetAudience,
      pack.priceSuggestion,
    ].join(" ").toLowerCase();
    for (const claim of falseClaims) {
      expect(generatedContent).not.toContain(claim.toLowerCase());
    }
  });

  it("markdown generated sections do not contain false claims", () => {
    const pack = buildFallbackListingPack({ productName: "Test Product" });
    const md = listingPackToMarkdown(pack);
    // Extract only the generated content sections (before the risk terms)
    const sections = md.split("## 风险用词提醒")[0].toLowerCase();
    for (const claim of falseClaims) {
      expect(sections).not.toContain(claim.toLowerCase());
    }
  });
});
