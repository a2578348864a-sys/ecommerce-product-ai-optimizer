import { describe, expect, it } from "vitest";
import {
  classifyImageDraft,
  isFinalSelectableDraft,
  HISTORICAL_INVALID_IDENTITY_DRAFT_IDS,
  HISTORICAL_COMPOSITION_CONCEPT_DRAFT_IDS,
} from "@/lib/imageHandoff/historicalDraftClassification";

describe("classifyImageDraft", () => {
  it("新格式 product_visual_draft 按 handoffMode 分类且可正式选择", () => {
    const item = { id: "1f342066-99a3-434b-86ca-4f98cdb0628a", handoffMode: "product_visual_draft" };
    expect(classifyImageDraft(item)).toBe("product_visual_draft");
    expect(isFinalSelectableDraft(classifyImageDraft(item))).toBe(true);
  });

  it("新格式 composition_concept 分类为构图概念且不可正式选择", () => {
    const item = { id: "x", handoffMode: "composition_concept" };
    expect(classifyImageDraft(item)).toBe("composition_concept");
    expect(isFinalSelectableDraft(classifyImageDraft(item))).toBe(false);
  });

  it("历史 Vitamin C 草稿（白名单）分类为 invalid_product_identity 且不可正式选择", () => {
    for (const id of HISTORICAL_INVALID_IDENTITY_DRAFT_IDS) {
      expect(classifyImageDraft({ id })).toBe("invalid_product_identity");
      expect(isFinalSelectableDraft(classifyImageDraft({ id }))).toBe(false);
    }
  });

  it("历史灰色 Water Bottle 草稿（白名单）分类为 composition_concept 且不可正式选择", () => {
    for (const id of HISTORICAL_COMPOSITION_CONCEPT_DRAFT_IDS) {
      expect(classifyImageDraft({ id })).toBe("composition_concept");
      expect(isFinalSelectableDraft(classifyImageDraft({ id }))).toBe(false);
    }
  });

  it("旧格式且不在白名单 → legacy_unclassified（fail-closed 不可正式选择）", () => {
    expect(classifyImageDraft({ id: "unknown-old-draft-id" })).toBe("legacy_unclassified");
    expect(isFinalSelectableDraft("legacy_unclassified")).toBe(false);
  });

  it("非对象输入 → legacy_unclassified（fail-closed）", () => {
    expect(classifyImageDraft(null)).toBe("legacy_unclassified");
    expect(classifyImageDraft("str")).toBe("legacy_unclassified");
    expect(classifyImageDraft(undefined)).toBe("legacy_unclassified");
  });

  it("白名单判定优先于旧格式回退（无 handoffMode 的已知 incident id）", () => {
    const item = { id: "baa8bd0d-824c-47fd-8b00-3092bfa27597", generationBasis: { productName: "composition concept" } };
    expect(classifyImageDraft(item)).toBe("invalid_product_identity");
  });
});
