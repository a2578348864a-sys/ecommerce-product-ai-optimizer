import { describe, it, expect } from "vitest";
import {
  filterReferenceMaterials,
  checkValueRisk,
} from "./referenceMaterialFilter";
import {
  generateReferenceListingDraft,
  generateReferenceTitle,
  generateReferenceBullets,
  generateReferenceDescription,
  validateDraftContent,
} from "./referenceDraftGenerator";

describe("Reference Material Filter (小白名单与高风险值拦截)", () => {
  it("场景 A：当前商品有合格来源资料，人工确认数为 0 时，能成功提取并标记待复核", () => {
    const rawResult = {
      productName: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack",
      asin: "B0EXAMPLE1",
      sourceMeta: {
        productBatchSnapshot: {
          asin: "B0EXAMPLE1",
          marketplace: "US",
          productFacts: {
            brand: "pickpiff",
            productTitle: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack",
          },
        },
      },
      browserEvidence: {
        snapshots: [
          {
            asin: "B0EXAMPLE1",
            fields: {
              title: { value: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack" },
              price: { value: "11.99" },
              rating: { value: "4.5" },
              reviewCount: { value: "2900" },
              bsr: { value: "120" },
            },
            productInfo: {
              canonicalFacts: {
                color_or_variant: "Matte Black",
                quantity_or_pack_size: "4-Pack",
                dimensions: "1.77 x 1.77 x 1.18 inches",
              },
            },
          },
        ],
      },
    };

    const readiness = filterReferenceMaterials({
      resultJson: rawResult,
      taskContext: { title: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack" },
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.adoptedCount).toBeGreaterThanOrEqual(3);

    const fields = readiness.adoptedMaterials.map((m) => m.field);
    expect(fields).toContain("color_or_variant");
    expect(fields).toContain("quantity_or_pack_size");
    expect(fields).toContain("dimensions");

    // 人工确认标记为 false，全部处于“来源有记载，待复核”
    for (const m of readiness.adoptedMaterials) {
      expect(m.isConfirmed).toBe(false);
    }

    // 市场观察字段（价格、评分、评论、BSR）必须被排除
    const excludedFields = readiness.excludedMaterials.map((e) => e.field);
    expect(excludedFields).toContain("price");
    expect(excludedFields).toContain("rating");
    expect(excludedFields).toContain("reviews");
    expect(excludedFields).toContain("bsr");
  });

  it("场景 B：资料只能支撑 1~2 条时，不凑五条，输出对应数量卖点", () => {
    const rawResult = {
      productName: "Simple Organizer",
      sourceMeta: {
        candidateSnapshot: { productName: "Simple Organizer" },
      },
      browserEvidence: {
        snapshots: [
          {
            productInfo: {
              canonicalFacts: {
                color_or_variant: "Silver",
                product_type: "Organizer",
                dimensions: "12 x 8 inches",
              },
            },
          },
        ],
      },
    };

    const readiness = filterReferenceMaterials({ resultJson: rawResult });
    expect(readiness.status).toBe("ready");
    expect(readiness.adoptedCount).toBe(3);

    const draft = generateReferenceListingDraft(readiness, "task-b");
    expect(draft.status).toBe("ready");
    // 只有两项实质规格（颜色、尺寸），身份信息（Organizer）不作卖点，卖点精准为 2 条！
    expect(draft.bullets.length).toBe(2);
    expect(draft.bullets[0]).toContain("Silver");
    expect(draft.bullets[1]).toContain("12 x 8 inches");
  });

  it("场景 C：字段名合法但值包含未核实的高风险声明时，严密拦截并不进入初稿", () => {
    // 比如 product_type 里混入了“承重 13LB、防水认证、304不锈钢、永不脱落”
    expect(checkValueRisk("13LB load capacity")).toBe("包含未核实的高风险承重声明");
    expect(checkValueRisk("waterproof and leak-proof")).toBe("包含未核实的高风险防水/防漏声明");
    expect(checkValueRisk("BPA-Free Food Grade certification")).toBe("包含未核实的食品安全/医疗/认证声明");
    expect(checkValueRisk("Made of 304 Stainless Steel")).toBe("包含未核实的材料等级声明");
    expect(checkValueRisk("Dishwasher Safe and rustproof")).toBe("包含未核实的防锈/耐热/洗碗机兼容性声明");
    expect(checkValueRisk("Never fall off with lifetime guarantee")).toBe("包含绝对化或未核实的品质保证声明");
    expect(checkValueRisk("Premium Quality Durable finish")).toBe("包含空泛营销词，不作为客观规格");

    const rawResult = {
      productName: "High Risk Hook",
      browserEvidence: {
        snapshots: [
          {
            productInfo: {
              canonicalFacts: {
                product_type: "Hook with 13LB Heavy Duty load",
                color_or_variant: "Matte Black",
              },
            },
          },
        ],
      },
    };

    const readiness = filterReferenceMaterials({ resultJson: rawResult });
    const adoptedFields = readiness.adoptedMaterials.map((m) => m.field);
    expect(adoptedFields).not.toContain("product_type");
    expect(adoptedFields).toContain("color_or_variant");

    const excluded = readiness.excludedMaterials.find((e) => e.field === "product_type");
    expect(excluded).toBeDefined();
    expect(excluded?.reason).toContain("包含未核实的高风险承重声明");
  });

  it("场景 D：多源冲突时隔离受影响字段，其他合格字段正常采纳", () => {
    // 例如 Amazon 页面与 SellerSprite 发生颜色冲突
    const rawResult = {
      productName: "Drawer Tray",
      browserEvidence: {
        snapshots: [
          {
            productInfo: {
              canonicalFacts: {
                color_or_variant: "Black",
                quantity_or_pack_size: "1-Pack",
              },
            },
          },
        ],
      },
      factCandidates: {
        schema: "fact-candidates.v1",
        version: 1,
        confirmed: [
          {
            candidateId: "seller_sprite:color_or_variant",
            field: "color_or_variant",
            label: "颜色/款式",
            value: "Silver",
            sourceKind: "seller_sprite_product_facts",
            sourceRef: "seller_sprite.color",
            confirmedAt: "2026-08-01T00:00:00Z",
            confirmedBy: "human",
            humanConfirmationRequired: true,
          },
        ],
      },
    };

    const readiness = filterReferenceMaterials({ resultJson: rawResult });
    const adoptedFields = readiness.adoptedMaterials.map((m) => m.field);
    // 冲突的 color_or_variant 不得采纳
    expect(adoptedFields).not.toContain("color_or_variant");
    // 未冲突的 quantity_or_pack_size 正常采纳
    expect(adoptedFields).toContain("quantity_or_pack_size");

    const conflictRecord = readiness.excludedMaterials.find((e) => e.field === "color_or_variant");
    expect(conflictRecord).toBeDefined();
    expect(conflictRecord?.reason).toContain("存在多源值冲突");
  });

  it("场景 E：只有商品名称而无任何有效规格时，返回准确的 insufficient 说明，不生成假草稿", () => {
    const rawResult = {
      productName: "Unknown Item",
    };
    const readiness = filterReferenceMaterials({ resultJson: rawResult });
    expect(readiness.status).toBe("insufficient");
    expect(readiness.adoptedCount).toBe(0);

    const draft = generateReferenceListingDraft(readiness, "task-e");
    expect(draft.status).toBe("insufficient");
    expect(draft.bullets.length).toBe(0);
    expect(draft.title).toBe("");
  });

  it("场景 G & H：零费用本地规则生成与严格声明校验", () => {
    const readiness = {
      status: "ready" as const,
      productName: "pickpiff Self-Adhesive Hooks",
      market: "Amazon 美国站",
      asin: "B0EXAMPLE1",
      adoptedCount: 3,
      excludedCount: 2,
      adoptedMaterials: [
        {
          id: "1",
          field: "brand",
          label: "品牌",
          value: "pickpiff",
          sourceKind: "product_title" as const,
          sourceLabel: "Amazon 页面已保存标题",
          isConfirmed: false,
        },
        {
          id: "2",
          field: "product_type",
          label: "商品类型",
          value: "Self-Adhesive Hooks",
          sourceKind: "product_title" as const,
          sourceLabel: "Amazon 页面已保存标题",
          isConfirmed: false,
        },
        {
          id: "3",
          field: "color_or_variant",
          label: "颜色/款式",
          value: "Matte Black",
          sourceKind: "amazon_browser_evidence" as const,
          sourceLabel: "Amazon 页面规格快照",
          isConfirmed: false,
        },
        {
          id: "4",
          field: "quantity_or_pack_size",
          label: "数量/包装",
          value: "4-Pack",
          sourceKind: "amazon_browser_evidence" as const,
          sourceLabel: "Amazon 页面规格快照",
          isConfirmed: false,
        },
      ],
      excludedMaterials: [],
      sourceFingerprint: "fingerprint-123",
    };

    const draft = generateReferenceListingDraft(readiness, "task-gh");
    expect(draft.status).toBe("ready");
    expect(draft.generatedBy).toBe("local_rules");
    expect(draft.humanReviewRequired).toBe(true);
    expect(draft.badgeLabel).toBe("研究对象参考初稿 · 基于采集资料，待人工复核");

    // Title 包含品牌、产品类型、颜色、包装
    expect(draft.title).toContain("pickpiff");
    expect(draft.title).toContain("Self-Adhesive Hooks");
    expect(draft.title).toContain("Matte Black");
    expect(draft.title).toContain("4-Pack");

    // Bullets 数量严格匹配（仅实质规格：4-Pack 与 Matte Black 2条）
    expect(draft.bullets.length).toBe(2);
    expect(draft.bullets[0]).toContain("4-Pack");
    expect(draft.bullets[1]).toContain("Matte Black");

    // 检查是否有敏感高风险词泄露
    const validation = validateDraftContent(draft, readiness.adoptedMaterials);
    expect(validation.valid).toBe(true);
  });

  it("场景 G（THERMOS 真实规格）：人工确认的客观规格（material, care, weight, functional_feature, operation, capacity=10oz等）全部安全放行，市场观察与外部研报被排除且去重", () => {
    const rawResult = {
      productName: "THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink",
      asin: "B08NCVT244",
      factCandidates: {
        confirmed: [
          { field: "brand", value: "THERMOS", label: "品牌" },
          { field: "category", value: "Kitchen & Dining", label: "类目" },
          { field: "price", value: "13.46", label: "参考价格" },
          { field: "rating", value: "4.7", label: "评分" },
          { field: "reviews", value: "48559", label: "评论数" },
          { field: "bsr", value: "9", label: "大类 BSR" },
          { field: "capacity", value: "10oz", label: "容量" },
          { field: "product_type", value: "THERMOS", label: "商品类型" },
          { field: "color_or_variant", value: "Pink", label: "颜色/款式" },
          { field: "material", value: "Stainless Steel", label: "材质" },
          { field: "dimensions", value: '3.5"L x 3.5"W x 5.3"H', label: "尺寸" },
          { field: "weight", value: "4 ounces", label: "重量" },
          { field: "quantity_or_pack_size", value: "1 Count", label: "数量/包装" },
          { field: "included_components", value: "food jar with unfolding spoon", label: "随附组件" },
          { field: "care", value: "Dishwasher Safe", label: "清洁保养" },
          { field: "functional_feature", value: "Vacuum Insulated", label: "功能特性" },
          { field: "operation", value: "Latch", label: "操作方式" },
        ],
      },
      reviewEvidence: { total: 100 },
      competitorEvidence: { count: 3 },
      sourcingEvidence: { candidateCount: 2 },
    };

    const readiness = filterReferenceMaterials({
      resultJson: rawResult,
      taskContext: { title: "THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink" },
    });

    expect(readiness.status).toBe("ready");

    const adoptedFields = readiness.adoptedMaterials.map((m) => m.field);
    expect(adoptedFields).toContain("brand");
    expect(adoptedFields).toContain("capacity");
    expect(adoptedFields).toContain("product_type");
    expect(adoptedFields).toContain("color_or_variant");
    expect(adoptedFields).toContain("material");
    expect(adoptedFields).toContain("dimensions");
    expect(adoptedFields).toContain("weight");
    expect(adoptedFields).toContain("quantity_or_pack_size");
    expect(adoptedFields).toContain("included_components");
    expect(adoptedFields).toContain("care");
    expect(adoptedFields).toContain("functional_feature");
    expect(adoptedFields).toContain("operation");

    expect(readiness.adoptedMaterials.find((m) => m.field === "material")?.value).toBe("Stainless Steel");
    expect(readiness.adoptedMaterials.find((m) => m.field === "care")?.value).toBe("Dishwasher Safe");
    expect(readiness.adoptedMaterials.find((m) => m.field === "functional_feature")?.value).toBe("Vacuum Insulated");
    expect(readiness.adoptedMaterials.find((m) => m.field === "operation")?.value).toBe("Latch");
    expect(readiness.adoptedMaterials.find((m) => m.field === "capacity")?.value).toBe("10oz");

    // 市场观察数据与研报必须被排除
    const excludedFields = readiness.excludedMaterials.map((e) => e.field);
    expect(excludedFields).toContain("category");
    expect(excludedFields).toContain("price");
    expect(excludedFields).toContain("rating");
    expect(excludedFields).toContain("reviews");
    expect(excludedFields).toContain("bsr");
    expect(excludedFields).toContain("voc");
    expect(excludedFields).toContain("competitor");
    expect(excludedFields).toContain("sourcing");

    // 验证排除项没有重复
    const keys = readiness.excludedMaterials.map((e) => `${e.field}:${e.value}:${e.reason}`);
    expect(new Set(keys).size).toBe(readiness.excludedMaterials.length);
  });
});
