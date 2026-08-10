import { describe, expect, it } from "vitest";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { collectKeywordProvenanceEntries, deriveUsedKeywordIds, keywordAppearsInCopy, normalizeKeywordText } from "@/lib/listingHandoff/listingKeywordProvenance";

const NOW = "2026-08-10T00:00:00.000Z";

function brief(overrides: { primaryKeyword?: string; supportingKeywords?: string[]; backendSearchTerms?: string[] } = {}) {
  const built = buildListingKeywordBrief({
    primaryKeyword: overrides.primaryKeyword ?? "insulated water bottle",
    supportingKeywords: overrides.supportingKeywords ?? ["stainless steel bottle", "24 oz bottle"],
    backendSearchTerms: overrides.backendSearchTerms ?? ["vacuum flask", "carry water bottle"],
    source: "synthetic",
    capturedAt: NOW,
  });
  if (!built.ok) throw new Error("brief build failed");
  return built.brief;
}

function copy(title: string, bullets: string[], description: string, backend: string[]) {
  return { title, bullets, description, backendSearchTerms: backend };
}

describe("normalizeKeywordText / keywordAppearsInCopy", () => {
  it("NFC + lowercase + trim + collapse whitespace", () => {
    expect(normalizeKeywordText("  Insulated   Water Bottle  ")).toBe("insulated water bottle");
    expect(normalizeKeywordText("Å".normalize("NFC") + "  B")).toBe("å b".replace("å", "å"));
  });

  it("大小写/空格差异归一化后正确匹配", () => {
    expect(keywordAppearsInCopy("Insulated  Water   Bottle", "This INSULATED WATER BOTTLE keeps drinks cold.")).toBe(true);
    expect(keywordAppearsInCopy("insulated water bottle", "insulated water bottle")).toBe(true);
  });

  it("substring 不误命中（mat ≠ material）", () => {
    expect(keywordAppearsInCopy("mat", "This is a durable material bottle.")).toBe(false);
    expect(keywordAppearsInCopy("material", "This is a durable material bottle.")).toBe(true);
  });

  it("短语边界：词首/词尾/标点后均正确", () => {
    expect(keywordAppearsInCopy("water bottle", "the water bottle is here")).toBe(true);
    expect(keywordAppearsInCopy("water bottle", "the water bottle.")).toBe(true);
    expect(keywordAppearsInCopy("water bottle", "water bottle, ideal for")).toBe(true);
    expect(keywordAppearsInCopy("water bottle", "water bottlecarry")).toBe(false);
    expect(keywordAppearsInCopy("water bottle", "a water bottle")).toBe(true);
  });

  it("空串不匹配", () => {
    expect(keywordAppearsInCopy("", "anything")).toBe(false);
    expect(keywordAppearsInCopy("water", "")).toBe(false);
  });
});

describe("collectKeywordProvenanceEntries", () => {
  it("生成稳定 id：kw:primary / kw:i / kw:backend:j，文本来自 Brief", () => {
    const entries = collectKeywordProvenanceEntries(brief());
    expect(entries.map((e) => e.id)).toEqual(["kw:primary", "kw:0", "kw:1", "kw:backend:0", "kw:backend:1"]);
    expect(entries.find((e) => e.id === "kw:primary")!.text).toBe("insulated water bottle");
    expect(entries.find((e) => e.id === "kw:0")!.text).toBe("stainless steel bottle");
  });

  it("重复关键词只保留首个 id（归一化去重）", () => {
    const entries = collectKeywordProvenanceEntries(brief({ supportingKeywords: ["Insulated Water Bottle"], backendSearchTerms: ["stainless steel bottle"] }));
    expect(entries.map((e) => e.id)).toEqual(["kw:primary", "kw:backend:0"]);
  });
});

describe("deriveUsedKeywordIds", () => {
  it("文案使用 primary → kw:primary 派生", () => {
    const result = deriveUsedKeywordIds({
      ...copy("Insulated Water Bottle for everyday carry", ["Use it for everyday carry."], "The insulated water bottle keeps drinks cold.", ["vacuum flask"]),
      keywordBrief: brief(),
    });
    expect(result).toContain("kw:primary");
  });

  it("Brief K1/K2/K3，文案只用 K1、K3 → 只派生 K1、K3", () => {
    const result = deriveUsedKeywordIds({
      ...copy("Insulated Water Bottle", ["24 oz bottle for travel."], "The 24 oz bottle with vacuum flask keeps drinks cold.", ["vacuum flask"]),
      keywordBrief: brief({ supportingKeywords: ["stainless steel bottle", "24 oz bottle"], backendSearchTerms: ["vacuum flask"] }),
    });
    expect(result).toEqual(["kw:primary", "kw:1", "kw:backend:0"]);
  });

  it("AI 未使用 primaryKeyword → 不谎报 kw:primary", () => {
    const result = deriveUsedKeywordIds({
      ...copy("Stainless Steel Bottle 24 oz", ["24 oz bottle for daily use."], "The 24 oz bottle is convenient.", []),
      keywordBrief: brief(),
    });
    expect(result).not.toContain("kw:primary");
    expect(result).toEqual(["kw:0", "kw:1"]);
  });

  it("AI 生成 Brief 之外的新词 → 无新 id（不会创建 kw:999）", () => {
    const result = deriveUsedKeywordIds({
      ...copy("Fancy Thermos Flask", ["New fancy term in copy."], "A fancy thermos flask for everyone.", []),
      keywordBrief: brief(),
    });
    expect(result).toEqual([]);
    expect(result.some((id) => id.includes("999") || id.includes("fancy"))).toBe(false);
  });

  it("substring 不误命中：mat 不作为 material 使用证据", () => {
    const result = deriveUsedKeywordIds({
      ...copy("Stainless Steel Bottle", ["Made of durable material."], "The material is stainless steel.", []),
      keywordBrief: brief({ supportingKeywords: ["mat"], backendSearchTerms: [] }),
    });
    expect(result).not.toContain("kw:0");
  });

  it("backend 命中不产生 brief 外 id；Brief 为 null → 空", () => {
    expect(deriveUsedKeywordIds({ title: "x", bullets: ["y"], description: "z", backendSearchTerms: [], keywordBrief: null })).toEqual([]);
  });
});
