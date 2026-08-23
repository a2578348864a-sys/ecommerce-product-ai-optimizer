import { describe, expect, it } from "vitest";
import { isCompletedForInputs, parseCommercialInputs } from "@/lib/server/commercialInputs";

describe("商业输入校验（轮 6）", () => {
  it("部分保存：单字段也可保存；0 为合法值（不得当空值）", () => {
    expect(parseCommercialInputs({ moq: 50 })).toEqual({ ok: true, inputs: { moq: 50 } });
    expect(parseCommercialInputs({ purchasePrice: { value: 0, currency: "CNY" } })).toEqual({
      ok: true, inputs: { purchasePrice: { value: 0, currency: "CNY" } },
    });
    expect(parseCommercialInputs({ logisticsCost: { value: 12.5, currency: "USD" } })).toEqual({
      ok: true, inputs: { logisticsCost: { value: 12.5, currency: "USD" } },
    });
  });

  it("MOQ 必须正整数（0/小数/负数/字符串拒绝）", () => {
    for (const bad of [0, -1, 1.5, "5", null, undefined]) {
      const r = parseCommercialInputs({ moq: bad });
      if (bad === undefined) { /* empty→empty error */ }
      expect(r.ok).toBe(false);
    }
    expect(parseCommercialInputs({ moq: 1 })).toEqual({ ok: true, inputs: { moq: 1 } });
  });

  it("未知字段拒绝；备注超长拒绝；货币/合规枚举拒绝；空提交拒绝", () => {
    expect(parseCommercialInputs({ hacker: 1 })).toEqual({ ok: false, error: "unknown_field:hacker" });
    expect(parseCommercialInputs({ compliance: { status: "reviewed_ok", note: "x".repeat(501) } })).toEqual({ ok: false, error: "compliance_note_too_long" });
    expect(parseCommercialInputs({ purchasePrice: { value: 1, currency: "JPY" } })).toEqual({ ok: false, error: "purchasePrice_invalid" });
    expect(parseCommercialInputs({ compliance: { status: "maybe" } })).toEqual({ ok: false, error: "compliance_status_invalid" });
    expect(parseCommercialInputs({})).toEqual({ ok: false, error: "commercial_inputs_empty" });
    expect(parseCommercialInputs({ purchasePrice: { value: -1, currency: "CNY" } })).toEqual({ ok: false, error: "purchasePrice_invalid" });
  });

  it("已完成研究：写入商业输入视为对已完成研究的改动（沿用重新确认机制，不允许直接覆盖）", () => {
    expect(isCompletedForInputs({ researchCompletion: { schema: "research-completion.v1", status: "completed" } })).toBe(true);
    expect(isCompletedForInputs({ researchCompletion: { schema: "research-completion.v1", status: "abandoned" } })).toBe(false);
    expect(isCompletedForInputs({})).toBe(false);
  });
});
