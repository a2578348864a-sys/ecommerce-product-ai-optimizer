import { describe, expect, it } from "vitest";
import { deriveTitleProductFacts } from "./titleDerivedProductFacts";

describe("V2.1.3 title-derived product facts", () => {
  describe("Owala Golden Case", () => {
    const result = deriveTitleProductFacts({
      title: "Owala FreeSip Stainless Steel Water Bottle 24 oz Out of the Blue",
      brand: "Owala",
      category: "Sports & Outdoors:Sports & Outdoor Recreation Accessories:Sports Water Bottles",
    });

    it("product_type = Water Bottle", () => {
      const f = result.facts.find((x) => x.field === "product_type");
      expect(f?.value).toBe("Water Bottle");
    });

    it("series_or_model = FreeSip（不含材质词）", () => {
      const f = result.facts.find((x) => x.field === "series_or_model");
      expect(f?.value).toBe("FreeSip");
    });

    it("material = Stainless Steel", () => {
      const f = result.facts.find((x) => x.field === "material");
      expect(f?.value).toBe("Stainless Steel");
    });

    it("capacity = 24 oz", () => {
      const f = result.facts.find((x) => x.field === "capacity");
      expect(f?.value).toBe("24 oz");
    });

    it("color_or_variant = Out of the Blue（完整短语）", () => {
      const f = result.facts.find((x) => x.field === "color_or_variant");
      expect(f?.value).toBe("Out of the Blue");
    });

    it("所有事实 source=product_title + humanConfirmationRequired=true", () => {
      for (const f of result.facts) {
        expect(f.source).toBe("product_title");
        expect(f.humanConfirmationRequired).toBe(true);
      }
    });

    it("不制造第二个 brand（无 brand 字段）", () => {
      const fields = result.facts.map((f) => f.field);
      expect(fields).not.toContain("brand");
    });
  });

  describe("Panini quantity case（不硬造 material/color）", () => {
    const result = deriveTitleProductFacts({
      title: "2026 Panini FIFA World Cup Sticker Collection Box – 50 Sticker Packs",
      brand: "Panini",
      category: "Toys & Games:Collectibles",
    });

    it("product_type = Sticker Pack（不被 World Cup 的 cup 干扰）", () => {
      const f = result.facts.find((x) => x.field === "product_type");
      expect(f?.value).toBe("Sticker Pack");
    });

    it("quantity_or_pack_size = 50 Sticker Packs", () => {
      const f = result.facts.find((x) => x.field === "quantity_or_pack_size");
      expect(f?.value).toBe("50 Sticker Packs");
    });

    it("不硬造 material / color", () => {
      expect(result.facts.find((x) => x.field === "material")).toBeUndefined();
      expect(result.facts.find((x) => x.field === "color_or_variant")).toBeUndefined();
    });

    it("不把 FIFA World Cup 当 series", () => {
      const series = result.facts.find((x) => x.field === "series_or_model");
      expect(series).toBeUndefined();
    });
  });

  describe("Treadmill sparse case（无法确定则不输出）", () => {
    const result = deriveTitleProductFacts({
      title: "Walking Pad Treadmill for Home - Folding Treadmills with Handle Bar",
      brand: null,
      category: "Sports & Outdoors:Exercise & Fitness:Treadmills",
    });

    it("product_type = Walking Pad", () => {
      const f = result.facts.find((x) => x.field === "product_type");
      expect(f?.value).toBe("Walking Pad");
    });

    it("不硬造 series / material / capacity", () => {
      expect(result.facts.find((x) => x.field === "series_or_model")).toBeUndefined();
      expect(result.facts.find((x) => x.field === "material")).toBeUndefined();
      expect(result.facts.find((x) => x.field === "capacity")).toBeUndefined();
    });
  });

  describe("Ambiguous title（不把普通形容词当属性）", () => {
    const result = deriveTitleProductFacts({
      title: "Google Fitbit Air - Screenless Activity Tracker",
      brand: "Google",
      category: "Electronics:Activity Trackers",
    });

    it("product_type = Activity Tracker（长词优先）", () => {
      const f = result.facts.find((x) => x.field === "product_type");
      expect(f?.value).toBe("Activity Tracker");
    });

    it("不把 Fitbit Air 当 series（Fitbit 是已知品牌）", () => {
      expect(result.facts.find((x) => x.field === "series_or_model")).toBeUndefined();
    });

    it("不把 Screenless 当 material", () => {
      expect(result.facts.find((x) => x.field === "material")).toBeUndefined();
    });
  });

  describe("Empty / short title（不报错，输出空）", () => {
    it("空标题返回空候选", () => {
      expect(deriveTitleProductFacts({ title: "" }).facts).toHaveLength(0);
    });

    it("极短标题返回空候选", () => {
      expect(deriveTitleProductFacts({ title: "A" }).facts).toHaveLength(0);
    });
  });
});
