import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CONFLICT_NOTICE_TEXT,
  SUCCESS_NOTICE_TEXT,
  prefillManualValues,
  changedManualFacts,
  runCreativeHandoffCreate,
  type HandoffNotice,
} from "./ListingFactSupplementPanel";
import { ListingFactSupplementPanel } from "@/components/studio/ListingFactSupplementPanel";
import { HandoffApiRequestError } from "@/components/creative-handoff/useCreativeHandoffApi";
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
      existingFacts: [
        { field: "brand", label: "品牌", value: "Owala", usageScopes: ["listing"], sourceKind: "candidate_snapshot" },
        { field: "capacity", label: "容量", value: "24 oz", usageScopes: ["listing"], sourceKind: "candidate_snapshot" },
      ],
    }));

    expect(html).toContain("商品事实");
    expect(html).toContain("补充商品事实");
    expect(html).toContain("这里填写的是你已经核实过的商品真实信息");
    expect(html).toContain("来自商品标题/来源资料，需人工核实");
    expect(html).toContain("Water Bottle");
    expect(html).toContain("Stainless Steel");
    expect(html).toContain("24 oz");
    // market_signal 候选（category / price_usd）不进入可勾选列表
    expect(html).not.toContain("Sports & Outdoors");
    expect(html).not.toContain("29.99");
    expect(html).toContain("我已核对，这是商品真实信息");
    // 有来源候选时，人工填写仍与候选并存，而不是二选一。
    expect(html).toContain("人工填写已核实事实");
    expect(html).toContain("可补充商品尺寸");
    expect(html).toContain("可补充商品重量");
  });

  it("无候选时显示手工补充输入（不必全部填写）", () => {
    const html = renderToStaticMarkup(createElement(ListingFactSupplementPanel, {
      taskId: "sandbox-task-2",
      preview: previewWith([]),
      create: async () => ({}),
      refresh: async () => ({}),
      onCommitted: undefined,
      existingFacts: [],
    }));

    expect(html).toContain("当前来源资料没有可直接核实的商品事实候选");
    expect(html).toContain("不必全部填写");
    // 手工输入字段（品牌/类型/系列/材质/容量/颜色/包装/其他）
    for (const label of ["品牌", "商品类型", "系列/型号", "材质", "容量", "颜色/款式", "数量/包装", "其他确定商品事实"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("我已核对，这是商品真实信息");
  });
});


describe("轮 20 创作资料回填与版本冲突（保存过重开消失）", () => {
  const saved = [
    { field: "usage", label: "使用场景", value: "办公场所，家庭", sourceKind: "user_confirmation" as const },
    { field: "material", label: "材质", value: "Stainless Steel", sourceKind: "user_confirmation" as const },
  ];
  it("prefillManualValues：重新打开时已保存事实回填到对应手动字段", () => {
    const pre = prefillManualValues(saved as never);
    expect(pre.usage).toBe("办公场所，家庭");
    expect(pre.material).toBe("Stainless Steel");
    expect(pre.construction).toBeUndefined();
    expect(pre.compatibility).toBeUndefined();
  });
  it("changedManualFacts：与已保存值完全相同的提交被过滤（避免重复写/歧义）", () => {
    const changed = changedManualFacts(
      [{ field: "usage", value: "办公场所，家庭" }, { field: "construction", value: "不锈钢焊接工艺" }],
      saved as never,
    );
    expect(changed).toEqual([{ field: "construction", value: "不锈钢焊接工艺" }]);
  });
});

describe("行为级：409 冲突通知时序（runCreativeHandoffCreate，真实执行 create→onConflict→抛错→refresh→通知）", () => {
  const err409 = { status: 409, code: "concurrent_update", message: "研究数据已更新，请刷新后重新确认。" };

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  }

  function payload() {
    return {
      requestId: "req-1",
      selectedFactCandidateIds: [] as string[],
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-10T00:00:00.000Z" },
      expectedResearchRevision: 2,
      expectedCurrentHandoffRevision: 1,
    };
  }

  it("刷新完成前不显示成功提示；refresh 完成后稳定显示精确冲突文案；create/refresh 各一次；无自动重试；无成功提示；再等一个事件循环不被覆盖", async () => {
    const d = deferred();
    const emitted: HandoffNotice[] = [];
    const create = vi.fn(async (opts: { onConflict?: (e: { status: number; code: string; message: string }) => void }) => {
      // 模拟真实 API hook 行为：调用传入的 onConflict（如果实现仍传），随后抛出 409
      opts.onConflict?.(err409);
      throw new HandoffApiRequestError(err409);
    });
    const refresh = vi.fn(() => d.promise);
    const onSuccess = vi.fn();
    const run = runCreativeHandoffCreate({
      create: create as never,
      refresh,
      requestPayload: payload(),
      onSuccess,
      emit: (n) => emitted.push(n),
    });
    // 刷新完成前：不得显示成功提示
    await Promise.resolve();
    await Promise.resolve();
    expect(emitted.some((n) => n?.text === SUCCESS_NOTICE_TEXT)).toBe(false);
    // 完成刷新
    d.resolve();
    await run;
    // create / refresh 各恰好一次；无自动重试 create
    expect(create).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    // 最终稳定显示精确冲突文案
    const last = emitted[emitted.length - 1];
    expect(last).toEqual({ tone: "error", text: CONFLICT_NOTICE_TEXT });
    // 不得显示成功提示
    expect(emitted.some((n) => n?.text === SUCCESS_NOTICE_TEXT)).toBe(false);
    // 再等待事件循环：冲突提示仍存在（未被 catch 覆盖）
    await Promise.resolve();
    await Promise.resolve();
    expect(emitted[emitted.length - 1]?.text).toBe(CONFLICT_NOTICE_TEXT);
    expect(emitted[emitted.length - 1]?.tone).toBe("error");
  });
});
