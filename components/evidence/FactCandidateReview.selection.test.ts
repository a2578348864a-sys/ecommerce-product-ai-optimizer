/**
 * V3 Final HWF — Fact Candidate Review Selection Preservation（纯函数行为测试）
 * 覆盖任务书 §12 Selection Preservation / §21.7 SELECTION_PRESERVED。
 * V3R — 契约⑥ FACT_SELECTION：Select All = visible/selectable/validated/unconfirmed/not blocked/not conflicted + indeterminate。
 */
import { describe, expect, it } from "vitest";
import {
  preserveSelectionAfterConfirm,
  pruneSelectionToAlive,
  selectableCandidateIds,
  selectAllState,
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

// ── V3R 契约⑥ FACT_SELECTION：Select All ──

describe("FactCandidateReview Select All（契约⑥）", () => {
  const candidates = [
    { candidateId: "brand" },
    { candidateId: "capacity" },
    { candidateId: "price" },
  ];

  it("selectable = 全部候选（已验证/未确认/未阻断/无冲突，服务端保证）", () => {
    expect([...selectableCandidateIds(candidates)].sort()).toEqual(["brand", "capacity", "price"]);
  });

  it("selectAllState：全选 → all；部分 → some（indeterminate）；未选 → none", () => {
    expect(selectAllState(new Set(["brand", "capacity", "price"]), selectableCandidateIds(candidates))).toBe("all");
    expect(selectAllState(new Set(["brand"]), selectableCandidateIds(candidates))).toBe("some");
    expect(selectAllState(new Set(), selectableCandidateIds(candidates))).toBe("none");
  });

  it("selectAllState：已确认项（不在候选）不参与全选判定", () => {
    const selectable = selectableCandidateIds(candidates);
    // 用户勾选了候选之外的历史勾选（refresh 后本应清理，但防御性处理）
    // 候选内 2/3 选中 → some（外部勾选不计入 selectable 命中）
    expect(selectAllState(new Set(["brand", "price", "stale_old"]), selectable)).toBe("some");
    // 候选内 3/3 选中（外部勾选多余但无害）→ all
    expect(selectAllState(new Set(["brand", "capacity", "price", "stale_old"]), selectable)).toBe("all");
  });

  it("selectAllState：无可选项 → none（空列表不误报 all）", () => {
    expect(selectAllState(new Set(), new Set())).toBe("none");
  });
});


// ── LISTING_FINAL_CLOSURE：高风险候选不得被一键全选自动选中 ──
describe("FactCandidateReview 高风险候选全选排除（契约收口）", () => {
  const candidates = [
    { candidateId: "brand", field: "brand" },
    { candidateId: "material", field: "material" },
    { candidateId: "capacity", field: "capacity" },
    { candidateId: "functional_feature", field: "functional_feature" },
    { candidateId: "care", field: "care" },
    { candidateId: "construction", field: "construction" },
    { candidateId: "insulation", field: "insulation" },
    { candidateId: "certification", field: "certification" },
  ];

  it("红：selectable 排除高风险字段（functional_feature/care/insulation/认证）→ 全选不自动选中", () => {
    const selectable = selectableCandidateIds(candidates as never);
    expect(selectable.has("functional_feature")).toBe(false);
    expect(selectable.has("care")).toBe(false);
    expect(selectable.has("insulation")).toBe(false);
    expect(selectable.has("certification")).toBe(false);
    // 普通身份/规格事实保持可选
    expect(selectable.has("brand")).toBe(true);
    expect(selectable.has("material")).toBe(true);
    expect(selectable.has("capacity")).toBe(true);
    // 全选状态：仅普通项为 all
    const ordinary = ["brand", "material", "capacity"];
    expect(selectAllState(new Set(ordinary), selectable)).toBe("all");
    expect(selectAllState(new Set(["brand"]), selectable)).toBe("some");
  });
});
