/**
 * Fact Authority — Human Confirmed Facts（研究侧）唯一权威源 语义测试。
 *
 * 背景：Creative Handoff confirmedFacts 降级为「当次创作实际使用快照」，
 * 不再作为当前商品事实第二权威源参与覆盖竞争。旧版本快照值（如 30 oz）
 * 不得阻止/覆盖研究侧最新人工确认值（如 40 oz）。
 */
import { describe, expect, it } from "vitest";
import {
  resolveAuthoritativeFactSnapshot,
  buildReferenceConflicts,
  authorityCounts,
  FactAuthorityError,
} from "@/lib/productCreativeHandoffFactAuthority";
import type { ProductCreativeHandoffConfirmedFact } from "@/lib/productCreativeHandoff";

function makeFact(
  field: string,
  label: string,
  value: string | number | boolean | string[],
  confirmedAt = "2026-09-01T00:00:00.000Z",
): ProductCreativeHandoffConfirmedFact {
  return {
    factId: "00000000-0000-4000-8000-000000000001",
    field,
    label,
    value,
    evidenceTier: "human_confirmed",
    usageScopes: ["internal", "listing", "image"],
    sourceRef: {
      sourceKind: "user_confirmation",
      sourceField: field,
      confirmedBy: { mode: "owner", subjectFingerprint: "0000000000000000" },
      confirmedAt,
      confirmationReference: "test-fixture",
    },
    confirmedAt,
    confirmedBy: { mode: "owner", subjectFingerprint: "0000000000000000" },
  };
}

const research40 = makeFact("capacity", "容量", "40 oz", "2026-09-02T00:00:00.000Z");
const snapshot30 = makeFact("capacity", "容量", "30 oz", "2026-09-01T00:00:00.000Z");
const selected30 = makeFact("capacity", "容量", "30 oz", "2026-09-03T00:00:00.000Z");
const manualCapacity = makeFact("capacity", "容量", "99 oz", "2026-09-03T00:00:00.000Z");
const careFact = makeFact("care", "清洁保养", "Wipe dry", "2026-09-01T00:00:00.000Z");

describe("resolveAuthoritativeFactSnapshot — 研究侧唯一权威", () => {
  it("接受2: 研究=40oz、历史快照=30oz → 不抛错，快照采用 40oz（旧值被权威覆盖）", () => {
    const { facts, droppedOverrides } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [snapshot30],
      research: [research40],
      selected: [],
      manual: [],
    });
    expect(droppedOverrides.some((d) => d.field === "capacity")).toBe(true);
    const capacity = facts.find((f) => f.field === "capacity");
    expect(capacity).toBeDefined();
    expect(String(capacity!.value)).toBe("40 oz");
  });

  it("接受3: 研究=40oz、本轮勾选了来源快照 30oz → 30oz 不进入事实层（dropped），40oz 保留，不抛 409", () => {
    const { facts, droppedOverrides } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [],
      research: [research40],
      selected: [selected30],
      manual: [],
    });
    expect(droppedOverrides).toHaveLength(1);
    const capacity = facts.find((f) => f.field === "capacity");
    expect(String(capacity!.value)).toBe("40 oz");
    expect(facts.some((f) => String(f.value) === "30 oz")).toBe(false);
  });

  it("接受4: 新快照保存当前研究权威值（40oz）", () => {
    const { facts } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [snapshot30],
      research: [research40],
      selected: [],
      manual: [],
    });
    expect(facts.filter((f) => f.field === "capacity")).toHaveLength(1);
    expect(String(facts.find((f) => f.field === "capacity")!.value)).toBe("40 oz");
  });

  it("接受5: 纯函数不改输入 — 旧历史快照 30oz 原样保留（不篡改历史）", () => {
    const previous = [snapshot30];
    resolveAuthoritativeFactSnapshot({ previousSnapshot: previous, research: [research40], selected: [], manual: [] });
    expect(String(previous[0].value)).toBe("30 oz");
  });

  it("接受1: 无冲突 → 研究事实 + 本轮新确认稳定事实（研究未覆盖 field）并存", () => {
    const materialFact = makeFact("material", "材质", "Stainless Steel");
    const { facts, droppedOverrides } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [],
      research: [research40],
      selected: [materialFact],
      manual: [],
    });
    expect(droppedOverrides).toHaveLength(0);
    expect(facts.map((f) => f.field).sort()).toEqual(["capacity", "material"].sort());
  });

  it("视觉参考独立确认：仅传 previousSnapshot+research（无勾选/manual）→ 40oz 快照、不抛错", () => {
    expect(() =>
      resolveAuthoritativeFactSnapshot({
        previousSnapshot: [snapshot30, careFact],
        research: [research40],
        selected: [],
        manual: [],
      }),
    ).not.toThrow();
    const { facts } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [snapshot30, careFact],
      research: [research40],
      selected: [],
      manual: [],
    });
    // research 未覆盖的 care 保留（防止丢 Listing/Image 手工补充事实 → #12 不回归）
    expect(facts.find((f) => f.field === "care")).toBeDefined();
  });

  it("接受8: manual 撞研究已确认 field → 抛 manual_fact_research_authority（禁止覆盖，回研究修改）", () => {
    expect(() =>
      resolveAuthoritativeFactSnapshot({
        previousSnapshot: [],
        research: [research40],
        selected: [],
        manual: [manualCapacity],
      }),
    ).toThrowError(FactAuthorityError);
    try {
      resolveAuthoritativeFactSnapshot({
        previousSnapshot: [],
        research: [research40],
        selected: [],
        manual: [manualCapacity],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FactAuthorityError);
      expect((error as FactAuthorityError).code).toBe("manual_fact_research_authority");
    }
  });

  it("接受9: 研究再次重确认(45oz) → 直接采用最新 45oz，无需第二次覆盖确认", () => {
    const research45 = makeFact("capacity", "容量", "45 oz", "2026-09-03T12:00:00.000Z");
    const { facts } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [snapshot30],
      research: [research45],
      selected: [],
      manual: [],
    });
    expect(String(facts.find((f) => f.field === "capacity")!.value)).toBe("45 oz");
  });

  it("manual 补充研究未覆盖 field → 允许作为新人工确认事实", () => {
    const manualCare = makeFact("care", "清洁保养", "Hand wash only");
    const { facts } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [],
      research: [research40],
      selected: [],
      manual: [manualCare],
    });
    expect(facts.find((f) => f.field === "care")).toBeDefined();
  });
});

describe("buildReferenceConflicts — 软提示", () => {
  it("接受6: 参考资料 30oz vs 权威 40oz → 明确差异行 resolution=use_confirmed_fact", () => {
    const conflicts = buildReferenceConflicts({
      authority: [{ field: "capacity", label: "容量", value: "40 oz" }],
      references: [
        { field: "capacity", label: "容量", value: "30 oz", sourceKind: "candidate_fallback" },
      ],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      field: "capacity",
      label: "容量",
      confirmedValue: "40 oz",
      referenceValue: "30 oz",
      resolution: "use_confirmed_fact",
    });
  });

  it("无冲突 → 空数组", () => {
    const conflicts = buildReferenceConflicts({
      authority: [{ field: "capacity", label: "容量", value: "40 oz" }],
      references: [{ field: "capacity", label: "容量", value: "40 oz", sourceKind: "candidate_fallback" }],
    });
    expect(conflicts).toHaveLength(0);
  });
});

// ── V4R: Studio 补充事实 provenance 硬化 + 权威统计口径 ─────────────
describe("V4R — previousSnapshot 继承仅限 Studio supplemental（user_confirmation provenance）", () => {
  function factWith(
    field: string,
    value: string,
    sourceKind: "user_confirmation" | "research_result" | "candidate_snapshot",
  ): ProductCreativeHandoffConfirmedFact {
    const base = makeFact(field, "字段", value);
    return {
      ...base,
      sourceRef: {
        sourceKind,
        sourceField: field,
        confirmedBy: { mode: "owner", subjectFingerprint: "0000000000000000" },
        confirmedAt: base.confirmedAt,
        confirmationReference: sourceKind === "user_confirmation" ? "test-supplement" : "fact-candidates:legacy",
      },
    } as ProductCreativeHandoffConfirmedFact;
  }

  it("research 无 field + 旧快照 user_confirmation → 可继承（Studio supplemental）", () => {
    const oldCare = factWith("care", "Wipe dry", "user_confirmation");
    const { facts } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [oldCare],
      research: [research40],
      selected: [],
      manual: [],
    });
    expect(facts.find((f) => f.field === "care")).toBeDefined();
    expect(String(facts.find((f) => f.field === "care")!.value)).toBe("Wipe dry");
  });

  it("research 无 field + 旧快照无 user_confirmation → 不继承（禁止自动升级）", () => {
    const legacyResearch = factWith("care", "Wipe dry", "research_result");
    const snapshot = factWith("care", "Wipe dry", "candidate_snapshot");
    for (const old of [legacyResearch, snapshot]) {
      const { facts } = resolveAuthoritativeFactSnapshot({
        previousSnapshot: [old],
        research: [research40],
        selected: [],
        manual: [],
      });
      expect(facts.find((f) => f.field === "care")).toBeUndefined();
    }
  });

  it("research 后来新增同 field → old studio 值退出当前创作输入（不冲突不409）", () => {
    const oldStudioCare = factWith("care", "Wipe dry", "user_confirmation");
    const researchCare = makeFact("care", "清洁保养", "Hand wash only", "2026-09-03T00:00:00.000Z");
    const { facts } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [oldStudioCare],
      research: [researchCare],
      selected: [],
      manual: [],
    });
    const care = facts.find((f) => f.field === "care");
    expect(String(care!.value)).toBe("Hand wash only");
    expect(facts.some((f) => f.field === "care" && String(f.value) === "Wipe dry")).toBe(false);
  });

  it("research 有 field → research 胜出（不受 previousSnapshot 影响）", () => {
    const { facts, droppedOverrides } = resolveAuthoritativeFactSnapshot({
      previousSnapshot: [snapshot30],
      research: [research40],
      selected: [],
      manual: [],
    });
    expect(String(facts.find((f) => f.field === "capacity")!.value)).toBe("40 oz");
    expect(droppedOverrides.some((d) => d.field === "capacity")).toBe(true);
  });
});

describe("authorityCounts — 唯一权威统计口径", () => {
  it("currentConfirmedFacts=15 / confirmable=0 → {15,0}", () => {
    const confirmed = Array.from({ length: 15 }, (_, i) => ({ field: `f${i}` }));
    expect(authorityCounts({ currentConfirmedFacts: confirmed, confirmableFactCandidates: [] })).toEqual({
      confirmedFacts: 15,
      confirmableCandidates: 0,
    });
  });

  it("缺省/null-safe → {0,0}", () => {
    expect(authorityCounts({})).toEqual({ confirmedFacts: 0, confirmableCandidates: 0 });
  });
});
