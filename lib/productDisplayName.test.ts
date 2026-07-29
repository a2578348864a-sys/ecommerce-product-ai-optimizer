import { describe, expect, it } from "vitest";
import {
  normalizeProductDisplayName,
  resolveTaskProductDisplayName,
} from "./productDisplayName";

describe("product display name", () => {
  it("removes only the system-added task suffix", () => {
    expect(normalizeProductDisplayName("桌面收纳盒 一键分析")).toBe("桌面收纳盒");
    expect(normalizeProductDisplayName("Foldable Desk Stand 一键分析")).toBe("Foldable Desk Stand");
  });

  it("keeps ordinary titles and analysis wording unchanged", () => {
    expect(normalizeProductDisplayName("桌面收纳盒")).toBe("桌面收纳盒");
    expect(normalizeProductDisplayName("市场分析仪")).toBe("市场分析仪");
    expect(normalizeProductDisplayName("AI 一键分析仪")).toBe("AI 一键分析仪");
    expect(normalizeProductDisplayName("Analysis Notebook")).toBe("Analysis Notebook");
  });

  it("prefers the authoritative result product name without rewriting it", () => {
    expect(resolveTaskProductDisplayName({
      resultProductName: "商品名中保留一键分析",
      taskTitle: "旧标题 一键分析",
      materialText: "旧材料",
    })).toBe("商品名中保留一键分析");
  });

  it("falls back safely for legacy and malformed values", () => {
    expect(resolveTaskProductDisplayName({
      taskTitle: "旧商品 一键分析",
      materialText: "旧商品",
    })).toBe("旧商品");
    expect(resolveTaskProductDisplayName({
      taskTitle: null,
      materialText: "Fallback Product",
    })).toBe("Fallback Product");
    expect(resolveTaskProductDisplayName({
      taskTitle: 42,
      materialText: null,
      fallback: "未命名商品",
    })).toBe("未命名商品");
  });
});
