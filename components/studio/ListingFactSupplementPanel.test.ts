import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListingFactSupplementPanel } from "@/components/studio/ListingFactSupplementPanel";
import type { CreativeHandoffPreview } from "@/components/creative-handoff/types";

function previewWith(candidates: Array<{ field: string; value: string; scopes: string[] }>): CreativeHandoffPreview {
  return {
    eligibility: "eligible",
    confirmableFactCandidates: candidates.map((c, i) => ({
      selectionId: `confirm:c-${i}`,
      canonicalField: c.field,
      displayValue: c.value,
      sourceKindSummary: "candidate_snapshot",
      capturedAt: "2026-08-10T00:00:00.000Z",
      allowedUsageScopes: c.scopes,
      humanConfirmationRequired: true,
      provenanceSummary: "来源快照，需人工确认。",
    })),
    expectedResearchRevision: 2,
    expectedCurrentHandoffRevision: 1,
    storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-10T00:00:00.000Z" },
  };
}

describe("ListingFactSupplementPanel", () => {
  it("listing-eligible 候选展示且标记需人工核实；market_signal 候选被过滤", () => {
    const html = renderToStaticMarkup(createElement(ListingFactSupplementPanel, {
      taskId: "sandbox-task-1",
      preview: previewWith([
        { field: "product_type", value: "Water Bottle", scopes: ["internal", "listing"] },
        { field: "material", value: "Stainless Steel", scopes: ["internal", "listing"] },
        { field: "capacity", value: "24 oz", scopes: ["internal", "listing"] },
        { field: "category", value: "Sports & Outdoors", scopes: ["internal"] },
        { field: "price_usd", value: "29.99", scopes: ["internal"] },
      ]),
      create: async () => ({}),
      refresh: async () => ({}),
      onCommitted: undefined,
    }));

    expect(html).toContain("补充并确认商品事实");
    expect(html).toContain("来自商品标题/来源资料，需人工核实");
    expect(html).toContain("Water Bottle");
    expect(html).toContain("Stainless Steel");
    expect(html).toContain("24 oz");
    // market_signal 候选（category / price_usd）不进入可勾选列表
    expect(html).not.toContain("Sports & Outdoors");
    expect(html).not.toContain("29.99");
    expect(html).toContain("我已核实以上勾选/填写的信息，可用于 Listing 草稿。");
  });

  it("无候选时显示手工补充输入（不必全部填写）", () => {
    const html = renderToStaticMarkup(createElement(ListingFactSupplementPanel, {
      taskId: "sandbox-task-2",
      preview: previewWith([]),
      create: async () => ({}),
      refresh: async () => ({}),
      onCommitted: undefined,
    }));

    expect(html).toContain("当前来源资料没有可直接核实的商品事实候选");
    expect(html).toContain("不必全部填写");
    // 手工输入字段（品牌/类型/系列/材质/容量/颜色/包装/其他）
    for (const label of ["品牌", "商品类型", "系列/型号", "材质", "容量", "颜色/款式", "数量/包装", "其他确定商品事实"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("我已核实以上勾选/填写的信息，可用于 Listing 草稿。");
  });
});
