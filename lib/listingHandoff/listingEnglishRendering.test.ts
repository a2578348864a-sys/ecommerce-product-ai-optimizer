/**
 * Listing English Rendering — 批量合同测试（中文事实关闭）
 *
 * 核心合同（本任务）：
 * - 多中文事实首次英文化仅一次批量 renderer 调用（禁止逐事实循环调用）；
 * - 相同 facts fingerprint 二次调用增量为 0（进程内缓存）；
 * - 全英文事实调用为 0（无需外部渲染）；
 * - 注入式 renderer 仍兼容（既有 setEnglishRendererForTests 契约不破坏）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEnglishRenderingPack,
  clearRenderingCache,
  setEnglishBatchRendererForTests,
  setEnglishRendererForTests,
} from "@/lib/listingHandoff/listingEnglishRendering";

const RENDERER = { callCount: 0 };

const CN_FACT_ENGLISH: Record<string, string> = {
  capacity: "stores about 40 to 50 pieces of cutlery",
  usage: "suitable for daily kitchen storage and carrying",
  care: "rinse with clean water and wipe dry",
  construction: "built with stainless steel and plastic structure",
  operation: "one key open and close lid for easy access",
  compatibility: "compatible with most cutlery sizes",
};

async function batchRenderer(input: Array<{ factId: string; field: string; sourceValue: string }>): Promise<Array<{ factId: string; english: string } | null>> {
  RENDERER.callCount += 1;
  return input.map((f) => ({
    factId: f.factId,
    field: f.field,
    english: CN_FACT_ENGLISH[f.factId] ?? ("translated " + f.sourceValue),
  }));
}

const CN_FACTS = [
  { factId: "capacity", field: "capacity", sourceValue: "可收纳约 40–50 件常用餐具" },
  { factId: "usage", field: "usage", sourceValue: "适合日常厨房收纳与外出携带" },
  { factId: "care", field: "care", sourceValue: "可用清水冲洗并擦干" },
  { factId: "construction", field: "construction", sourceValue: "采用不锈钢与塑料组合结构" },
  { factId: "operation", field: "operation", sourceValue: "一键开合盖子方便取放" },
  { factId: "compatibility", field: "compatibility", sourceValue: "兼容市面上多数餐具尺寸" },
];

beforeEach(() => {
  RENDERER.callCount = 0;
  clearRenderingCache();
});

afterEach(() => {
  setEnglishRendererForTests(null);
  setEnglishBatchRendererForTests(null);
});

describe("中文事实批量英文化（单次批量调用合同）", () => {
  it("6 条中文事实首次调用只触发 1 次批量 renderer 调用", async () => {
    setEnglishBatchRendererForTests(batchRenderer);
    const result = await buildEnglishRenderingPack({ facts: CN_FACTS });
    expect(result.ok).toBe(true);
    expect(RENDERER.callCount).toBe(1);
    if (result.ok) {
      expect(result.pack.renderings.length).toBe(CN_FACTS.length);
      for (const r of result.pack.renderings) {
        expect(r.english).toBe(CN_FACT_ENGLISH[r.factId]);
        expect(/[一-鿿]/.test(r.english)).toBe(false);
      }
    }
  });

  it("相同 facts fingerprint 第二次调用增量为 0（缓存复用）", async () => {
    setEnglishBatchRendererForTests(batchRenderer);
    await buildEnglishRenderingPack({ facts: CN_FACTS });
    const before = RENDERER.callCount;
    await buildEnglishRenderingPack({ facts: CN_FACTS });
    expect(RENDERER.callCount).toBe(before);
    expect(RENDERER.callCount).toBe(1);
  });

  it("全英文事实调用为 0（无需外部渲染）", async () => {
    setEnglishBatchRendererForTests(batchRenderer);
    const result = await buildEnglishRenderingPack({
      facts: [
        { factId: "brand", field: "brand", sourceValue: "YETI" },
        { factId: "material", field: "material", sourceValue: "Stainless Steel" },
        { factId: "capacity", field: "capacity", sourceValue: "12 ounces" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(RENDERER.callCount).toBe(0);
    if (result.ok) expect(result.pack.renderings.length).toBe(3);
  });
});
