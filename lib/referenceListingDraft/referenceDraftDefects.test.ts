import { describe, it, expect } from "vitest";
import {
  checkValueRisk,
  filterReferenceMaterials,
} from "./referenceMaterialFilter";
import {
  generateReferenceListingDraft,
  generateReferenceTitle,
  generateReferenceBullets,
  generateReferenceDescription,
  validateDraftContent,
} from "./referenceDraftGenerator";
import type { ReferenceDraftReadiness } from "./referenceDraftContract";

describe("复现已发现的质量缺陷 (Reproduction Test Suite)", () => {
  describe("缺陷 1：中文风险词在 \\b 边界下漏检", () => {
    it("纯中文风险词必须被准确检出，不能因为 \\b 边界导致漏检", () => {
      expect(checkValueRisk("防水")).toBe("包含未核实的高风险防水/防漏声明");
      expect(checkValueRisk("食品级")).toBe("包含未核实的食品安全/医疗/认证声明");
      expect(checkValueRisk("永不脱落")).toBe("包含绝对化或未核实的品质保证声明");
      expect(checkValueRisk("不锈钢")).toBe("包含未核实的材料等级声明");
    });
  });

  describe("缺陷 2：子串包含判定导致 4-Pack 与 14-Pack、12 与 312 错误合并", () => {
    it("4-Pack 与 14-Pack 数量不同，绝不能当作相同或细化采纳", () => {
      const resultJson = {
        productName: "Test Hook",
        asin: "B0TEST1234",
        browserEvidence: {
          snapshots: [
            {
              asin: "B0TEST1234",
              productInfo: {
                canonicalFacts: {
                  quantity_or_pack_size: "14-Pack",
                },
              },
            },
          ],
        },
        // 候选事实里有 4-Pack
        factCandidates: {
          candidates: [
            {
              field: "quantity_or_pack_size",
              value: "4-Pack",
              sourceKind: "product_title",
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({ resultJson });
      const packItem = readiness.adoptedMaterials.find((m) => m.field === "quantity_or_pack_size");
      // 数量不一致必须隔离为冲突，不能合并采纳
      expect(packItem).toBeUndefined();
      const conflict = readiness.excludedMaterials.find((m) => m.field === "quantity_or_pack_size");
      expect(conflict).toBeDefined();
      expect(conflict?.reason).toContain("冲突");
    });

    it("12 与 312 尺寸数字不同，不能因子串包含而合并", () => {
      const resultJson = {
        productName: "Test Hook",
        asin: "B0TEST1234",
        factCandidates: {
          confirmed: [
            {
              field: "dimensions",
              value: "12",
              sourceKind: "confirmed_fact",
            },
          ],
          candidates: [
            {
              field: "dimensions",
              value: "312",
              sourceKind: "amazon_browser_evidence",
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({ resultJson });
      // 12 与 312 冲突，不能合并
      const dimItem = readiness.adoptedMaterials.find((m) => m.field === "dimensions");
      expect(dimItem).toBeUndefined();
    });
  });

  describe("缺陷 3：错 ASIN 的快照不能被采纳", () => {
    it("快照 ASIN 与当前商品 ASIN 不一致时，必须拒绝采纳该快照的属性", () => {
      const resultJson = {
        productName: "Current Product",
        asin: "B0CURRENT01",
        browserEvidence: {
          snapshots: [
            {
              asin: "B0WRONGASIN", // 错 ASIN 快照
              productInfo: {
                canonicalFacts: {
                  color_or_variant: "Silver",
                },
              },
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({ resultJson });
      const color = readiness.adoptedMaterials.find((m) => m.field === "color_or_variant");
      expect(color).toBeUndefined();
    });
  });

  describe("缺陷 4：无依据的扩写和套话（空间效率、开箱即用、设计归属等）", () => {
    it("文案中不得出现输入资料未支持的用途、安装便利、空间效率、设计归属等扩写", () => {
      const readiness: ReferenceDraftReadiness = {
        status: "ready",
        productName: "Generic Hook",
        market: "Amazon 美国站",
        asin: "B0TEST1234",
        adoptedCount: 4,
        excludedCount: 0,
        adoptedMaterials: [
          {
            id: "1",
            field: "brand",
            label: "品牌",
            value: "MyBrand",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
          {
            id: "2",
            field: "color_or_variant",
            label: "颜色/款式",
            value: "Black",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
          {
            id: "3",
            field: "quantity_or_pack_size",
            label: "数量/包装",
            value: "4-Pack",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
          {
            id: "4",
            field: "dimensions",
            label: "尺寸",
            value: "3 x 2 x 1 inches",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
        ],
        excludedMaterials: [],
        sourceFingerprint: "fp123",
      };

      const bullets = generateReferenceBullets(readiness);
      const desc = generateReferenceDescription(readiness);
      const allText = [...bullets, desc].join(" ");

      // 验证无依据扩写被彻底删除
      expect(allText).not.toContain("suitable for versatile home");
      expect(allText).not.toContain("coordinates easily with various");
      expect(allText).not.toContain("compact storage and space efficiency");
      expect(allText).not.toContain("Designed by");
      expect(allText).not.toContain("ready out of the box");
      expect(allText).not.toContain("approximately");
      expect(allText).not.toContain("verified catalog records");
      expect(allText).not.toContain("provides a practical solution for everyday household needs");
    });

    it("只有身份信息（如品牌、型号）而无实质规格属性时，必须返回 insufficient，不凑虚假卖点", () => {
      const readiness: ReferenceDraftReadiness = {
        status: "ready",
        productName: "Brand Only Product",
        market: "Amazon 美国站",
        asin: "B0TEST1234",
        adoptedCount: 2,
        excludedCount: 0,
        adoptedMaterials: [
          {
            id: "1",
            field: "brand",
            label: "品牌",
            value: "MyBrand",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
          {
            id: "2",
            field: "series_or_model",
            label: "系列/型号",
            value: "ModelX",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
        ],
        excludedMaterials: [],
        sourceFingerprint: "fp123",
      };

      const draft = generateReferenceListingDraft(readiness, "task-123");
      expect(draft.status).toBe("insufficient");
      expect(draft.bullets.length).toBe(0);
    });

    it("固定回归样例：brand + series + included_components 只能生成 1 条卖点，不把品牌型号当卖点", () => {
      const readiness: ReferenceDraftReadiness = {
        status: "ready",
        productName: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack",
        market: "Amazon 美国站",
        asin: "B0EXAMPLE1",
        adoptedCount: 3,
        excludedCount: 0,
        adoptedMaterials: [
          {
            id: "1",
            field: "brand",
            label: "品牌",
            value: "pickpiff",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
          {
            id: "2",
            field: "series_or_model",
            label: "系列/型号",
            value: "Self Adhesive Coat Hooks for Hanging",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
          {
            id: "3",
            field: "included_components",
            label: "随附组件",
            value: "Accessories, Hooks",
            sourceKind: "confirmed_fact",
            sourceLabel: "人工已确认事实",
            isConfirmed: true,
          },
        ],
        excludedMaterials: [],
        sourceFingerprint: "fp-fixed",
      };

      const bullets = generateReferenceBullets(readiness);
      expect(bullets.length).toBe(1);
      expect(bullets[0]).toContain("Accessories, Hooks");
      expect(bullets[0]).not.toContain("Series model");
      expect(bullets[0]).not.toContain("Brand: pickpiff");

      const desc = generateReferenceDescription(readiness);
      expect(desc).not.toContain("Recorded from existing catalog specifications");
      expect(desc).not.toContain("as an initial reference draft for review");
      expect(desc).toContain("Accessories, Hooks");
    });

    it("文案校验：未采纳的篡改数值（4 改 14、Black 改 White）即便无风险词也必须被拦截", () => {
      const adopted = [
        {
          id: "1",
          field: "color_or_variant",
          label: "颜色/款式",
          value: "Black",
          sourceKind: "confirmed_fact" as const,
          sourceLabel: "人工已确认事实",
          isConfirmed: true,
        },
        {
          id: "2",
          field: "quantity_or_pack_size",
          label: "数量/包装",
          value: "4-Pack",
          sourceKind: "confirmed_fact" as const,
          sourceLabel: "人工已确认事实",
          isConfirmed: true,
        },
      ];

      // 篡改成 14-Pack
      const tamperedPack = validateDraftContent(
        {
          title: "My Product, Black, 14-Pack",
          bullets: ["Package includes 14-Pack.", "Color: Black."],
          description: "This product comes in Black with 14-Pack.",
        },
        adopted,
      );
      expect(tamperedPack.valid).toBe(false);
      expect(tamperedPack.violations.some((v) => v.includes("14") || v.includes("包装") || v.includes("未采纳"))).toBe(true);

      // 篡改成 White
      const tamperedColor = validateDraftContent(
        {
          title: "My Product, White, 4-Pack",
          bullets: ["Package includes 4-Pack.", "Color: White."],
          description: "This product comes in White with 4-Pack.",
        },
        adopted,
      );
      expect(tamperedColor.valid).toBe(false);
      expect(tamperedColor.violations.some((v) => v.includes("White") || v.includes("颜色") || v.includes("未采纳"))).toBe(true);
    });
  });

  describe("第三节：关闭错误快照和未知来源的回流入口", () => {
    it("A：正确快照 A 与错误 ASIN 快照 B 同时存在：B 独有属性不能进入初稿", () => {
      const resultJson = {
        productName: "Current Product",
        asin: "B0CURRENT01",
        marketplace: "US",
        browserEvidence: {
          snapshots: [
            {
              asin: "B0CURRENT01",
              marketplace: "US",
              productInfo: {
                canonicalFacts: {
                  color_or_variant: "Black",
                },
              },
            },
            {
              asin: "B0WRONGASIN",
              marketplace: "US",
              productInfo: {
                canonicalFacts: {
                  dimensions: "99 x 99 inches",
                },
              },
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({ resultJson });
      expect(readiness.adoptedMaterials.find((m) => m.field === "color_or_variant")?.value).toBe("Black");
      expect(readiness.adoptedMaterials.find((m) => m.field === "dimensions")).toBeUndefined();
      expect(readiness.excludedMaterials.some((e) => e.field === "snapshot_asin_mismatch" && e.value === "B0WRONGASIN")).toBe(true);
    });

    it("B：B 的属性出现在 candidates 和 alternateSources 中时，仍不能进入初稿", () => {
      const resultJson = {
        productName: "Current Product",
        asin: "B0CURRENT01",
        marketplace: "US",
        browserEvidence: {
          snapshots: [
            {
              asin: "B0CURRENT01",
              marketplace: "US",
              productInfo: {
                canonicalFacts: {
                  color_or_variant: "Black",
                },
              },
            },
            {
              asin: "B0WRONGASIN",
              marketplace: "US",
              productInfo: {
                canonicalFacts: {
                  dimensions: "99 x 99 inches",
                },
              },
            },
          ],
        },
        factCandidates: {
          candidates: [
            {
              field: "dimensions",
              value: "99 x 99 inches",
              sourceKind: "amazon_product_info",
              sourceRef: "browserEvidence.snapshots[1].productInfo.dimensions",
              alternateSources: [
                {
                  sourceKind: "amazon_product_info",
                  sourceRef: "browserEvidence.snapshots[1].productInfo.dimensions",
                  value: "99 x 99 inches",
                },
              ],
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({ resultJson });
      expect(readiness.adoptedMaterials.find((m) => m.field === "dimensions")).toBeUndefined();
    });

    it("C：ASIN 相同但站点不匹配（如任务为 US 但快照为 UK）：错站点资料不能采用", () => {
      const resultJson = {
        productName: "US Product",
        asin: "B0CURRENT01",
        marketplace: "US",
        browserEvidence: {
          snapshots: [
            {
              asin: "B0CURRENT01",
              marketplace: "UK", // 错站点
              productInfo: {
                canonicalFacts: {
                  color_or_variant: "British Racing Green",
                },
              },
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({
        resultJson,
        taskContext: { platform: "amazon.com" },
      });
      expect(readiness.adoptedMaterials.find((m) => m.field === "color_or_variant")).toBeUndefined();
      expect(readiness.excludedMaterials.some((e) => e.reason.includes("站点") || e.field === "snapshot_market_mismatch")).toBe(true);
    });

    it("D：来源类型或归属未知时：不被包装成 Amazon 标题事实，直接排除", () => {
      const resultJson = {
        productName: "Mystery Product",
        asin: "B0MYSTERY",
        factCandidates: {
          candidates: [
            {
              field: "color_or_variant",
              value: "Gold",
              sourceKind: "unknown_crawler",
              sourceRef: "http://unknown-domain.com/item",
            },
          ],
        },
      };

      const readiness = filterReferenceMaterials({ resultJson });
      expect(readiness.adoptedMaterials.find((m) => m.field === "color_or_variant")).toBeUndefined();
      expect(readiness.excludedMaterials.some((e) => e.field === "color_or_variant" && e.reason.includes("未知"))).toBe(true);
    });
  });
});
