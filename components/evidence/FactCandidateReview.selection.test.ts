/**
 * V3 Final HWF — Fact Candidate Review Selection Preservation（纯函数行为测试）
 * 覆盖任务书 §12 Selection Preservation / §21.7 SELECTION_PRESERVED。
 */
import { describe, expect, it } from "vitest";
import {
  preserveSelectionAfterConfirm,
  pruneSelectionToAlive,
} from "./FactCandidateReview";

describe("FactCandidateReview Selection Preservation", () => {
  it("批量确认后：只移除成功确认项，冲突项保留勾选待复核（不整批清空）", () => {
    const selected = new Set(["a", "b", "c", "d"]);
    const conflicts = new Set(["d"]);
    const next = preserveSelectionAfterConfirm(selected, conflicts);
    expect([...next]).toEqual(["d"]);
  });

  it("全部成功（无冲突）→ 清空全部勾选", () => {
    const selected = new Set(["a", "b"]);
    const next = preserveSelectionAfterConfirm(selected, new Set());
    expect(next.size).toBe(0);
  });

  it("全部冲突 → 保留全部勾选（用户检查最新内容后重新确认）", () => {
    const selected = new Set(["a", "b"]);
    const next = preserveSelectionAfterConfirm(selected, new Set(["a", "b"]));
    expect([...next].sort()).toEqual(["a", "b"]);
  });

  it("刷新后：候选/已确认中不存在的勾选清理，仍存在的保留（candidate_missing 场景）", () => {
    const selected = new Set(["brand", "gone", "price"]);
    const alive = new Set(["brand", "price"]);
    const next = pruneSelectionToAlive(selected, alive);
    expect([...next].sort()).toEqual(["brand", "price"]);
  });

  it("刷新后：全部勾选仍存在 → 全部保留（无关更新不破坏用户选择）", () => {
    const selected = new Set(["brand", "price"]);
    const alive = new Set(["brand", "price", "capacity"]);
    const next = pruneSelectionToAlive(selected, alive);
    expect([...next].sort()).toEqual(["brand", "price"]);
  });
});
