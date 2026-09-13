import { describe, expect, it } from "vitest";
import { buildVisualAssetPlan } from "./visualAssetPlan";

describe("buildVisualAssetPlan", () => {
  it("无参考图且无事实时，整体为 concept，白底主图与特写图 blocked", () => {
    const plan = buildVisualAssetPlan({
      hasApprovedVisualReference: false,
      confirmedFacts: [],
    });

    expect(plan.version).toBe("visual-asset-plan.v1");
    expect(plan.overallLevel).toBe("concept");
    expect(plan.hasApprovedReference).toBe(false);

    const mainSlot = plan.slots.find((s) => s.slotId === "slot-main");
    expect(mainSlot?.readiness).toBe("blocked_needs_visual_reference");

    const dimSlot = plan.slots.find((s) => s.slotId === "slot-dimension-specs");
    expect(dimSlot?.readiness).toBe("blocked_needs_facts");

    const lifeSlot = plan.slots.find((s) => s.slotId === "slot-lifestyle-scene");
    expect(lifeSlot?.readiness).toBe("ready");
  });

  it("有参考图且有尺寸事实时，尺寸图与主图变为 ready", () => {
    const plan = buildVisualAssetPlan({
      hasApprovedVisualReference: true,
      confirmedFacts: [
        { field: "dimensions", label: "尺寸", value: "3.5\"L x 3.5\"W x 5.3\"H" },
        { field: "material", label: "材质", value: "Stainless Steel" },
        { field: "functional_feature", label: "功能", value: "Vacuum Insulated" },
      ],
    });

    expect(plan.hasApprovedReference).toBe(true);

    const mainSlot = plan.slots.find((s) => s.slotId === "slot-main");
    expect(mainSlot?.readiness).toBe("ready");

    const dimSlot = plan.slots.find((s) => s.slotId === "slot-dimension-specs");
    expect(dimSlot?.readiness).toBe("ready");

    const sellSlot = plan.slots.find((s) => s.slotId === "slot-selling-points");
    expect(sellSlot?.readiness).toBe("ready");

    const detailSlot = plan.slots.find((s) => s.slotId === "slot-detail-closeup");
    expect(detailSlot?.readiness).toBe("ready");

    // 缺少包装事实
    const packSlot = plan.slots.find((s) => s.slotId === "slot-packaging-bundle");
    expect(packSlot?.readiness).toBe("blocked_needs_facts");
  });

  it("事实齐全时触发全部可用槽位与 final 分级", () => {
    const plan = buildVisualAssetPlan({
      hasApprovedVisualReference: true,
      confirmedFacts: [
        { field: "dimensions", label: "尺寸", value: "10 x 5 x 2 cm" },
        { field: "material", label: "材质", value: "Ceramic" },
        { field: "functional_feature", label: "功能", value: "Microwave Safe" },
        { field: "packaging", label: "包装", value: "Box of 4" },
        { field: "operation", label: "使用方式", value: "Push button to open" },
      ],
    });

    expect(plan.overallLevel).toBe("final");
    expect(plan.readyCount).toBe(7);
    expect(plan.totalCount).toBe(7);

    const usageSlot = plan.slots.find((s) => s.slotId === "slot-usage-steps");
    expect(usageSlot).toBeDefined();
    expect(usageSlot?.readiness).toBe("ready");
  });
});
