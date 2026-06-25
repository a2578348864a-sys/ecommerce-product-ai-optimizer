import { describe, expect, it } from "vitest";
import {
  evaluateCandidateQuality,
  evaluateCandidatesQuality,
  type CandidateQualityInput,
} from "@/lib/candidateQuality";

// ── Helpers ─────────────────────────────────────

function q(input: CandidateQualityInput) {
  return evaluateCandidateQuality(input);
}

// ── Recommended ─────────────────────────────────

describe("recommended — beginner friendly goods", () => {
  it("桌面收纳盒 → recommended", () => {
    const r = q({ title: "桌面收纳盒 Desk Organizer" });
    expect(r.level).toBe("recommended");
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.shouldShowInPreview).toBe(true);
    expect(r.shouldAllowImport).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("桌面手机支架 → recommended", () => {
    const r = q({ name: "桌面手机支架" });
    expect(r.level).toBe("recommended");
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.shouldAllowImport).toBe(true);
  });

  it("cable organizer → recommended", () => {
    const r = q({ title: "Cable Organizer Box" });
    expect(r.level).toBe("recommended");
    expect(r.shouldAllowImport).toBe(true);
  });

  it("pen holder → recommended", () => {
    const r = q({ title: "Wooden Pen Holder" });
    expect(r.level).toBe("recommended");
    expect(r.shouldAllowImport).toBe(true);
  });

  it("jewelry organizer → recommended", () => {
    const r = q({ title: "Jewelry Organizer Box" });
    expect(r.level).toBe("recommended");
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("charging station → recommended", () => {
    const r = q({ title: "Desktop Charging Station" });
    expect(r.level).toBe("recommended");
    expect(r.shouldAllowImport).toBe(true);
  });

  it("default neutral → recommended (default pass)", () => {
    const r = q({ title: "Generic Product Stand" });
    expect(r.level).toBe("recommended");
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.shouldShowInPreview).toBe(true);
    expect(r.shouldAllowImport).toBe(true);
  });
});

// ── Caution ─────────────────────────────────────

describe("caution — goods needing manual review", () => {
  it("LED 台灯 → caution", () => {
    const r = q({ title: "LED Desk Lamp" });
    expect(r.level).toBe("caution");
    expect(r.shouldShowInPreview).toBe(true);
    expect(r.shouldAllowImport).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("power bank → caution", () => {
    const r = q({ title: "Portable Power Bank 10000mAh" });
    expect(r.level).toBe("caution");
    expect(r.shouldAllowImport).toBe(true);
    expect(r.flags).toContain("electronic");
  });

  it("baby product → caution", () => {
    const r = q({ title: "Baby Silicone Bib" });
    expect(r.level).toBe("caution");
    expect(r.flags).toContain("children");
  });

  it("food container → caution", () => {
    const r = q({ title: "Glass Food Container Set" });
    expect(r.level).toBe("caution");
    expect(r.flags).toContain("food_contact");
  });

  it("water bottle → caution", () => {
    const r = q({ title: "Stainless Steel Water Bottle" });
    expect(r.level).toBe("caution");
    expect(r.flags).toContain("food_contact");
  });

  it("kids toy → caution", () => {
    const r = q({ title: "Kids Building Blocks" });
    expect(r.level).toBe("caution");
    expect(r.flags).toContain("children");
  });

  it("cosmetic → caution", () => {
    const r = q({ title: "Natural Skin Care Cream" });
    expect(r.level).toBe("caution");
    expect(r.flags).toContain("cosmetic");
  });

  it("ceramic mug → caution", () => {
    const r = q({ title: "Handmade Ceramic Coffee Mug" });
    expect(r.level).toBe("caution");
    expect(r.flags).toContain("fragile");
  });
});

// ── Rejected: High Risk ─────────────────────────

describe("rejected — high risk / regulated goods", () => {
  it("防狼喷雾 → rejected", () => {
    const r = q({ title: "防狼喷雾 Pepper Spray" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
    expect(r.shouldShowInPreview).toBe(false);
    expect(r.flags).toContain("high_risk_goods");
  });

  it("pepper spray → rejected", () => {
    const r = q({ title: "Pepper Spray Keychain" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("tactical knife → rejected", () => {
    const r = q({ title: "Tactical Knife Survival" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("vape → rejected", () => {
    const r = q({ title: "Vape Pen Kit" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("CBD gummies → rejected", () => {
    const r = q({ title: "CBD Gummies" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("medical device → rejected", () => {
    const r = q({ title: "Portable Medical Device" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("pesticide → rejected", () => {
    const r = q({ title: "Garden Pesticide Spray" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("adult toy → rejected", () => {
    const r = q({ title: "成人用品 Adult Toy" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("fireworks → rejected", () => {
    const r = q({ title: "Party Fireworks" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("stun gun → rejected", () => {
    const r = q({ title: "Stun Gun Flashlight" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });
});

// ── Rejected: Error Pages ───────────────────────

describe("rejected — error / invalid pages", () => {
  it("Error Page | eBay → rejected", () => {
    const r = q({ title: "Error Page | eBay" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
    expect(r.shouldShowInPreview).toBe(false);
    expect(r.flags).toContain("error_page");
  });

  it("outOfService → rejected", () => {
    const r = q({ title: "outOfService" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("service unavailable → rejected", () => {
    const r = q({ title: "Service Unavailable" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("404 not found → rejected", () => {
    const r = q({ title: "404 Not Found" });
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("error_page");
  });

  it("403 page → rejected", () => {
    const r = q({ title: "403 Forbidden" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("500 error → rejected", () => {
    const r = q({ title: "500 Internal Server Error" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("empty title → rejected", () => {
    const r = q({ title: "" });
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("empty_title");
  });

  it("null title → rejected", () => {
    const r = q({ title: null });
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("empty_title");
  });

  it("very short title → rejected", () => {
    const r = q({ title: "A" });
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("empty_title");
  });
});

// ── Rejected / Not Recommended: Non-Product Pages ──

describe("non-product pages", () => {
  it("京东首页 → not_recommended or rejected", () => {
    const r = q({ title: "京东首页", url: "https://www.jd.com/" });
    expect(["not_recommended", "rejected"]).toContain(r.level);
    expect(r.shouldAllowImport).toBe(false);
  });

  it("Amazon homepage → rejected or not_recommended", () => {
    const r = q({ title: "Amazon.com", url: "https://www.amazon.com/" });
    expect(["rejected", "not_recommended"]).toContain(r.level);
    expect(r.shouldAllowImport).toBe(false);
  });

  it("search results page → not_recommended", () => {
    const r = q({ title: "Search results for desk organizer" });
    expect(r.level).toBe("not_recommended");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("category page → not_recommended", () => {
    const r = q({ title: "Category: Home & Kitchen" });
    expect(r.level).toBe("not_recommended");
  });
});

// ── Brand Risk ──────────────────────────────────

describe("brand / IP risk", () => {
  it("Disney cup → rejected", () => {
    const r = q({ title: "Disney Mickey Mouse Cup" });
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("brand_risk");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("Pokemon toy → rejected", () => {
    const r = q({ title: "Pokémon Pikachu Plush Toy" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("Apple compatible case → caution", () => {
    const r = q({ title: "Apple Compatible Phone Case" });
    expect(r.level).toBe("caution");
    expect(r.shouldAllowImport).toBe(true);
    expect(r.flags).toContain("brand_compatible");
  });

  it("replica sneaker → rejected", () => {
    const r = q({ title: "Replica Nike Sneaker" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("knockoff bag → rejected", () => {
    const r = q({ title: "Knockoff Designer Bag" });
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("counterfeit");
  });

  it("LEGO set → rejected", () => {
    const r = q({ title: "LEGO Star Wars Set" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });
});

// ── Output Structure ────────────────────────────

describe("output structure", () => {
  it("result has all required fields", () => {
    const r = q({ title: "Test Product" });
    expect(r).toHaveProperty("level");
    expect(r).toHaveProperty("score");
    expect(r).toHaveProperty("label");
    expect(r).toHaveProperty("reasons");
    expect(r).toHaveProperty("flags");
    expect(r).toHaveProperty("shouldShowInPreview");
    expect(r).toHaveProperty("shouldAllowImport");
    expect(r).toHaveProperty("suggestedAction");
  });

  it("score is within 0-100", () => {
    for (const title of ["桌面收纳盒", "LED 台灯", "防狼喷雾", "Error Page", "Generic Item"]) {
      const r = q({ title });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("reasons is non-empty array", () => {
    for (const title of ["桌面收纳盒", "LED 台灯", "防狼喷雾", "Error Page", "Generic Item"]) {
      const r = q({ title });
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("suggestedAction is non-empty string", () => {
    for (const title of ["桌面收纳盒", "LED 台灯", "防狼喷雾", "Error Page"]) {
      const r = q({ title });
      expect(r.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it("rejected items have shouldAllowImport=false", () => {
    const r = q({ title: "防狼喷雾" });
    expect(r.level).toBe("rejected");
    expect(r.shouldAllowImport).toBe(false);
  });

  it("recommended items have shouldAllowImport=true", () => {
    const r = q({ title: "桌面收纳盒" });
    expect(r.level).toBe("recommended");
    expect(r.shouldAllowImport).toBe(true);
  });
});

// ── Batch Evaluation ────────────────────────────

describe("evaluateCandidatesQuality batch", () => {
  it("evaluates multiple candidates and returns summary", () => {
    const inputs: CandidateQualityInput[] = [
      { title: "桌面收纳盒" },
      { title: "LED 台灯" },
      { title: "防狼喷雾" },
      { title: "Error Page" },
      { title: "Power Bank" },
      { title: "Cable Organizer" },
      { title: "Disney Cup" },
      { title: "Generic Widget" },
    ];
    const { results, summary } = evaluateCandidatesQuality(inputs);
    expect(results).toHaveLength(8);
    expect(summary.total).toBe(8);
    expect(summary.recommended).toBeGreaterThanOrEqual(2);
    expect(summary.caution).toBeGreaterThanOrEqual(1);
    expect(summary.rejected).toBeGreaterThanOrEqual(3);
    expect(summary.shouldAllowImport).toBeLessThan(8);
  });
});

// ── Edge Cases ──────────────────────────────────

describe("edge cases", () => {
  it("handles undefined input gracefully", () => {
    const r = q({});
    // Empty title → rejected
    expect(r.level).toBe("rejected");
    expect(r.flags).toContain("empty_title");
  });

  it("handles name field as title fallback", () => {
    const r = q({ name: "桌面手机支架" });
    expect(r.level).toBe("recommended");
  });

  it("handles sourceTitle field as title fallback", () => {
    const r = q({ sourceTitle: "防狼喷雾" });
    expect(r.level).toBe("rejected");
  });

  it("snippet can trigger high risk detection", () => {
    const r = q({ title: "Keychain Accessory", snippet: "pepper spray self defense" });
    expect(r.level).toBe("rejected");
  });

  it("snippet can trigger caution", () => {
    const r = q({ title: "Container", snippet: "food storage box" });
    expect(r.level).toBe("caution");
  });
});

// ── No Dangerous Copy in Output ─────────────────

describe("no dangerous promises in output", () => {
  const dangerous = [
    "安全可卖", "无侵权风险", "已通过合规", "平台允许销售",
    "自动合规审核完成", "无需人工确认", "100% 安全", "全自动合规",
    "AI 已确认可卖", "可直接发布", "无需修改即可上架", "无人值守全自动",
  ];

  const testTitles = [
    "桌面收纳盒", "LED 台灯", "防狼喷雾", "Error Page", "Power Bank",
    "Disney Cup", "Replica Bag", "Generic Widget",
  ];

  for (const title of testTitles) {
    it(`output for "${title}" contains no dangerous promises`, () => {
      const r = q({ title });
      const allText = JSON.stringify(r);
      for (const d of dangerous) {
        expect(allText).not.toContain(d);
      }
    });
  }
});
