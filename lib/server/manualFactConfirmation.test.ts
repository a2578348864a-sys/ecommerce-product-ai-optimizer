import { describe, expect, it } from "vitest";
import {
  confirmManualProductFacts,
  isManualFactField,
  normalizeManualFactValue,
} from "@/lib/server/manualFactConfirmation";

const actor = { mode: "visitor" as const, subjectFingerprint: `visitor:${"f".repeat(16)}` };
const CONFIRMED_AT = "2026-08-10T00:00:00.000Z";
const REF = "confirm:abc123";

describe("confirmManualProductFacts", () => {
  it("合法手工事实构造 human_confirmed / user_confirmation / listing scope", () => {
    const out = confirmManualProductFacts({
      facts: [
        { field: "brand", value: "Owala" },
        { field: "material", value: "Stainless Steel" },
      ],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.rejected).toHaveLength(0);
    expect(out.confirmedFacts).toHaveLength(2);
    const brand = out.confirmedFacts.find((f) => f.field === "brand")!;
    expect(brand.value).toBe("Owala");
    expect(brand.evidenceTier).toBe("human_confirmed");
    expect(brand.usageScopes).toEqual(["internal", "listing", "image"]);
    expect(brand.sourceRef.sourceKind).toBe("user_confirmation");
    expect(brand.confirmedBy).toEqual(actor);
    expect(brand.factId).toBeTruthy();
  });

  it("market_signal 字段（category/price/rating）不在白名单，拒绝", () => {
    const out = confirmManualProductFacts({
      facts: [
        { field: "category" as never, value: "Sports & Outdoors" },
        { field: "price_usd" as never, value: "29.99" },
      ],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.confirmedFacts).toHaveLength(0);
    expect(out.rejected.length).toBe(2);
    for (const r of out.rejected) expect(r.code).toBe("invalid_field");
  });

  it("空 value 拒绝；重复 field 拒绝", () => {
    const out = confirmManualProductFacts({
      facts: [
        { field: "brand" as const, value: "   " },
        { field: "material" as const, value: "Steel" },
        { field: "material" as const, value: "Aluminum" },
      ],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.confirmedFacts).toHaveLength(1);
    expect(out.rejected.map((r) => r.code)).toEqual(expect.arrayContaining(["empty_value", "duplicate_field"]));
  });

  it("value 规范化（trim + 压缩空白 + 限长）", () => {
    const longValue = "x".repeat(300);
    const out = confirmManualProductFacts({
      facts: [{ field: "other" as const, value: `  ${longValue}  ` }],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.confirmedFacts[0].value).toBe("x".repeat(200));
    expect(normalizeManualFactValue("  a   b  ")).toBe("a b");
  });

  it("factId 确定性派生（同输入同输出）", () => {
    const input = {
      facts: [{ field: "capacity" as const, value: "24 oz" }],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    };
    const a = confirmManualProductFacts(input);
    const b = confirmManualProductFacts(input);
    expect(a.confirmedFacts[0].factId).toBe(b.confirmedFacts[0].factId);
  });

  it("isManualFactField 只接受白名单", () => {
    expect(isManualFactField("brand")).toBe(true);
    expect(isManualFactField("other")).toBe(true);
    expect(isManualFactField("category")).toBe(false);
    expect(isManualFactField("price_usd")).toBe(false);
    expect(isManualFactField("resultJson")).toBe(false);
  });

  it("R3 支持尺寸与重量，并保持 human_confirmed 来源合同", () => {
    const out = confirmManualProductFacts({
      facts: [
        { field: "dimensions" as never, value: "10 × 3 in" },
        { field: "weight" as never, value: "12 oz" },
      ],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.rejected).toEqual([]);
    expect(out.confirmedFacts.map((fact) => fact.field)).toEqual(["dimensions", "weight"]);
    for (const fact of out.confirmedFacts) {
      expect(fact.evidenceTier).toBe("human_confirmed");
      expect(fact.sourceRef.sourceKind).toBe("user_confirmation");
      expect(fact.usageScopes).toContain("listing");
    }
  });
});

describe("other 字段边界", () => {
  it("other 与受控字段同合同：human_confirmed/user_confirmation/listing scope，不绕过", () => {
    const out = confirmManualProductFacts({
      facts: [{ field: "other", value: "含替换吸管" }],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.rejected).toHaveLength(0);
    const fact = out.confirmedFacts[0];
    expect(fact.field).toBe("other");
    expect(fact.evidenceTier).toBe("human_confirmed");
    expect(fact.usageScopes).toEqual(["internal", "listing", "image"]);
    expect(fact.sourceRef.sourceKind).toBe("user_confirmation");
    // 不是 market_signal 分类：白名单外字段（category/price）仍拒绝
    expect(isManualFactField("category")).toBe(false);
    expect(isManualFactField("price_usd")).toBe(false);
    expect(isManualFactField("resultJson")).toBe(false);
    expect(isManualFactField("sourceRef")).toBe(false);
    expect(isManualFactField("createdBy")).toBe(false);
  });

  it("other 值不进入 prohibitedClaims 分类（仍是 confirmedFact，禁止词由生成过滤器拦截）", () => {
    const out = confirmManualProductFacts({
      facts: [{ field: "other", value: "best seller guaranteed" }],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.confirmedFacts).toHaveLength(1);
    // 值保留在 confirmedFacts；prohibitedClaims 分类不因 other 被污染
    expect(out.confirmedFacts[0].value).toBe("best seller guaranteed");
    expect(out.confirmedFacts[0].field).toBe("other");
  });
});

describe("Quality.1 功能字段边界", () => {
  it("功能字段（functional_feature/construction/care）是独立 field，可同时确认", () => {
    const out = confirmManualProductFacts({
      facts: [
        { field: "functional_feature", value: "straw lid with push-open mechanism" },
        { field: "construction", value: "double-wall vacuum insulation" },
        { field: "care", value: "dishwasher-safe removable parts" },
      ],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.rejected).toHaveLength(0);
    expect(out.confirmedFacts).toHaveLength(3);
    const fields = out.confirmedFacts.map((f) => f.field);
    expect(new Set(fields).size).toBe(3);
    for (const f of out.confirmedFacts) {
      expect(f.evidenceTier).toBe("human_confirmed");
      expect(f.usageScopes).toEqual(["internal", "listing", "image"]);
    }
  });

  it("other 字段允许多值（功能/其他事实），按值去重", () => {
    const out = confirmManualProductFacts({
      facts: [
        { field: "other", value: "含替换吸管" },
        { field: "other", value: "含收纳袋" },
        { field: "other", value: "含替换吸管" },
      ],
      actor,
      confirmedAt: CONFIRMED_AT,
      confirmationReference: REF,
      candidateId: "candidate-1",
    });
    expect(out.confirmedFacts).toHaveLength(2);
    expect(out.rejected.some((r) => r.code === "duplicate_value")).toBe(true);
  });
});
