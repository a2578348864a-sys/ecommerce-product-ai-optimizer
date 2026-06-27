import { describe, expect, it } from "vitest";
import { buildMockAiListingDraft } from "@/lib/aiListingDraft";
import {
  buildAiListingPackSaveResult,
  parseTaskResultJson,
  sanitizeAiListingPackForSave,
} from "@/lib/aiListingSnapshot";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    ...buildMockAiListingDraft({
      productName: "Desktop Phone Stand",
      category: "phone accessory",
      sellingPoints: ["Adjustable angle", "Compact desktop use"],
    }),
    ...overrides,
  };
}

describe("parseTaskResultJson", () => {
  it("treats empty resultJson as an empty object", () => {
    expect(parseTaskResultJson("").ok).toBe(true);
    expect(parseTaskResultJson(null).ok).toBe(true);
  });

  it("parses object and JSON string resultJson", () => {
    expect(parseTaskResultJson({ keep: true })).toEqual({ ok: true, data: { keep: true } });
    expect(parseTaskResultJson('{"keep":true}')).toEqual({ ok: true, data: { keep: true } });
  });

  it("rejects invalid JSON strings and non-object JSON", () => {
    expect(parseTaskResultJson("{bad").ok).toBe(false);
    expect(parseTaskResultJson("[]").ok).toBe(false);
  });
});

describe("sanitizeAiListingPackForSave", () => {
  it("filters banned claims before validation", () => {
    const result = sanitizeAiListingPackForSave(draft({
      titles: ["FDA Approved Desktop Phone Stand"],
      bullets: ["100% Safe Medical Grade accessory."],
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const visible = [
        ...result.data.titles,
        ...result.data.bullets,
        result.data.description,
        ...result.data.keywords,
        ...result.data.sellingPoints,
      ].join(" ");
      expect(visible).not.toMatch(/FDA Approved|100% Safe|Medical Grade|稳赚|爆款必出|保证盈利/);
      expect(result.data.blockedClaims).toEqual(expect.arrayContaining(["FDA Approved", "100% Safe", "Medical Grade"]));
      expect(result.data.humanReviewRequired).toBe(true);
    }
  });

  it("rejects malformed drafts", () => {
    expect(sanitizeAiListingPackForSave({ ...draft(), titles: "bad" }).ok).toBe(false);
    expect(sanitizeAiListingPackForSave({ ...draft(), humanReviewRequired: false }).ok).toBe(false);
  });

  it("allows future real AI drafts through the same save sanitization boundary", () => {
    const result = sanitizeAiListingPackForSave(draft({
      source: "real_ai_draft",
      model: "deepseek-chat",
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("real_ai_draft");
      expect(result.data.model).toBe("deepseek-chat");
      expect(result.data.humanReviewRequired).toBe(true);
    }
  });
});

describe("buildAiListingPackSaveResult", () => {
  it("preserves existing resultJson fields and adds aiListingPackSnapshot", () => {
    const result = buildAiListingPackSaveResult({
      resultJson: {
        existingField: "keep-me",
        listingPackSnapshot: { source: "rule_based" },
        riskReviewSnapshot: { ok: true },
      },
      listingPack: draft(),
      savedAt: "2026-06-27T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resultJson.existingField).toBe("keep-me");
      expect(result.resultJson.listingPackSnapshot).toEqual({ source: "rule_based" });
      expect(result.resultJson.riskReviewSnapshot).toEqual({ ok: true });
      expect(result.snapshot.snapshotType).toBe("ai_listing_pack");
      expect(result.snapshot.savedBy).toBe("owner");
      expect(result.snapshot.savedAt).toBe("2026-06-27T10:00:00.000Z");
      expect(result.snapshot.humanReviewRequired).toBe(true);
    }
  });

  it("prevents silent overwrite when aiListingPackSnapshot already exists", () => {
    const result = buildAiListingPackSaveResult({
      resultJson: { aiListingPackSnapshot: { version: 3 } },
      listingPack: draft(),
      savedAt: "2026-06-27T10:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ai_listing_pack_already_exists");
  });

  it("allows explicit overwrite and increments version", () => {
    const result = buildAiListingPackSaveResult({
      resultJson: { aiListingPackSnapshot: { version: 3, keepOld: false } },
      listingPack: draft(),
      overwrite: true,
      savedAt: "2026-06-27T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.version).toBe(4);
      expect(result.resultJson.aiListingPackSnapshot).toEqual(result.snapshot);
    }
  });

  it("rejects invalid task resultJson without overwriting data", () => {
    const result = buildAiListingPackSaveResult({
      resultJson: "{bad",
      listingPack: draft(),
      savedAt: "2026-06-27T10:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_result_json");
  });
});
