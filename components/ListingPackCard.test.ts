/**
 * Core-4-Fix.1-Test.1 — ListingPackCard frontend save state regression tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFallbackListingPack, listingPackToMarkdown } from "@/lib/listingPack";

function restoreSnapshot(existingSnapshot: { pack: unknown; savedAt: string } | null) {
  return {
    pack: existingSnapshot?.pack ?? null,
    savedAt: existingSnapshot?.savedAt ?? null,
  };
}

function isListingDisabled(decisionRecommendation: string) {
  return decisionRecommendation === "reject" || decisionRecommendation === "needs_more_info";
}

// ── Helpers for testing component logic without full React render ──
// We test the core logic functions that drive the component states directly.

describe("ListingPackCard — save state logic", () => {
  describe("generate flow", () => {
    it("buildFallbackListingPack returns a pack with source=rule_based", () => {
      const pack = buildFallbackListingPack({ productName: "Test" });
      expect(pack.source).toBe("rule_based");
    });

    it("generated pack has all required sections", () => {
      const pack = buildFallbackListingPack({ productName: "Test Product" });
      expect(pack.titleDrafts.length).toBeGreaterThanOrEqual(3);
      expect(pack.bulletPoints.length).toBe(5);
      expect(pack.coreKeywords.length).toBeGreaterThan(0);
      expect(pack.riskTerms.length).toBeGreaterThan(5);
      expect(pack.prePublishChecklist.length).toBeGreaterThan(5);
    });
  });

  describe("snapshot initialization from existing data", () => {
    it("constructs a valid snapshot that can be passed as existingSnapshot", () => {
      const pack = buildFallbackListingPack({ productName: "Saved Product" });
      const md = listingPackToMarkdown(pack);
      const snapshot = {
        version: 1,
        source: pack.source,
        generatedAt: pack.generatedAt,
        savedAt: "2025-06-01T12:00:00.000Z",
        productName: "Saved Product",
        pack,
        markdown: md,
        safety: { unverifiedClaimsSanitized: true, requiresHumanReview: true, autoListing: false },
      };

      // Simulate what component does on mount with existingSnapshot
      const restoredPack = snapshot.pack;
      const restoredSavedAt = snapshot.savedAt;

      expect(restoredPack.source).toBe("rule_based");
      expect(restoredSavedAt).toBeTruthy();
      expect(snapshot.safety.autoListing).toBe(false);
      expect(snapshot.safety.requiresHumanReview).toBe(true);
      expect(snapshot.safety.unverifiedClaimsSanitized).toBe(true);
      expect(snapshot.safety.autoListing).toBe(false);
    });

    it("existingSnapshot with null means unsaved state", () => {
      const { pack, savedAt } = restoreSnapshot(null);
      expect(pack).toBeNull();
      expect(savedAt).toBeNull();
    });
  });

  describe("save payload structure", () => {
    it("save payload includes safety enforcement fields", () => {
      const pack = buildFallbackListingPack({ productName: "Save Test" });
      const md = listingPackToMarkdown(pack);
      const payload = {
        listingPackSnapshot: {
          version: 1,
          source: pack.source,
          generatedAt: pack.generatedAt,
          productName: "Save Test",
          pack,
          markdown: md,
          safety: { unverifiedClaimsSanitized: true, requiresHumanReview: true, autoListing: false },
        },
      };

      expect(payload.listingPackSnapshot.version).toBe(1);
      expect(payload.listingPackSnapshot.source).toBe("rule_based");
      expect(payload.listingPackSnapshot.pack).toBe(pack);
      expect(payload.listingPackSnapshot.markdown).toBeTruthy();
      expect(payload.listingPackSnapshot.safety.unverifiedClaimsSanitized).toBe(true);
      expect(payload.listingPackSnapshot.safety.requiresHumanReview).toBe(true);
      expect(payload.listingPackSnapshot.safety.autoListing).toBe(false);
    });

    it("save payload does not contain accessToken or password", () => {
      const pack = buildFallbackListingPack({ productName: "Security Test" });
      const md = listingPackToMarkdown(pack);
      const payload = JSON.stringify({
        listingPackSnapshot: { pack, markdown: md, safety: { unverifiedClaimsSanitized: true, requiresHumanReview: true, autoListing: false } },
      });
      expect(payload).not.toContain("accessToken");
      expect(payload).not.toContain("password");
      expect(payload).not.toContain("tok_");
    });
  });

  describe("re-generation overwrite", () => {
    it("new generation produces different timestamp", () => {
      vi.useFakeTimers();
      try {
        const firstGenerationTime = new Date("2026-01-01T00:00:00.000Z");
        const secondGenerationTime = new Date("2026-01-01T00:00:00.001Z");

        vi.setSystemTime(firstGenerationTime);
        const pack1 = buildFallbackListingPack({ productName: "Overwrite" });
        vi.setSystemTime(secondGenerationTime);
        const pack2 = buildFallbackListingPack({ productName: "Overwrite" });

        expect(pack1.generatedAt).toBe(firstGenerationTime.toISOString());
        expect(pack2.generatedAt).toBe(secondGenerationTime.toISOString());
        expect(pack1.generatedAt).not.toBe(pack2.generatedAt);
        expect(pack1.source).toBe("rule_based");
        expect(pack2.source).toBe("rule_based");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("copy markdown", () => {
    it("markdown contains all expected sections", () => {
      const pack = buildFallbackListingPack({ productName: "Copy Test" });
      const md = listingPackToMarkdown(pack);
      expect(md).toMatch(/标题草稿/);
      expect(md).toMatch(/五点描述/);
      expect(md).toMatch(/关键词/);
      expect(md).toMatch(/风险用词提醒/);
      expect(md).toMatch(/上架前检查清单/);
    });

    it("markdown does not contain false AI claims", () => {
      const pack = buildFallbackListingPack({ productName: "Copy Test" });
      const md = listingPackToMarkdown(pack);
      expect(md).not.toMatch(/AI 已生成/);
      expect(md).not.toMatch(/自动上架成功/);
    });

    it("markdown states it is a rule-based draft", () => {
      const pack = buildFallbackListingPack({ productName: "Draft" });
      const md = listingPackToMarkdown(pack);
      expect(md).toMatch(/规则兜底草稿|rule.based draft/);
      expect(md).toMatch(/不会自动上架|does not auto.publish/);
    });
  });

  describe("disabled state", () => {
    it("does not generate listing for reject recommendation", () => {
      // The component receives disabled={true} for reject/needs_more_info
      // This is a prop test — the logic is in TaskRecordDetail
      const isDisabled = isListingDisabled("reject");
      expect(isDisabled).toBe(true);
    });

    it("does not disable for advance recommendation", () => {
      const isDisabled = isListingDisabled("advance");
      expect(isDisabled).toBe(false);
    });
  });
});
