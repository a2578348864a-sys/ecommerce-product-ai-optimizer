import { describe, expect, it } from "vitest";
import {
  assertSmokeBudget,
  assertUiCountMatchesRequest,
  calculateExpectedProviderCalls,
  isRetryAllowed,
} from "@/lib/imageHandoff/smokeBudget";

describe("calculateExpectedProviderCalls（与 generation service contract 一致）", () => {
  it("count=1 → 1 次；count=2 → 2 次；count=4（超出产品上限）→ 归一 1", () => {
    expect(calculateExpectedProviderCalls(1)).toBe(1);
    expect(calculateExpectedProviderCalls(2)).toBe(2);
    expect(calculateExpectedProviderCalls(4)).toBe(1);
    expect(calculateExpectedProviderCalls(0)).toBe(1);
  });
});

describe("assertSmokeBudget（调用前 preflight）", () => {
  it("授权 1、请求 count=1 → 放行", () => {
    const result = assertSmokeBudget(1, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expectedProviderCalls).toBe(1);
  });

  it("授权 1、请求 count=2（expected=2 > 1）→ ABORT（budget_exceeded）——事故场景", () => {
    const result = assertSmokeBudget(2, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("budget_exceeded");
      expect(result.expectedProviderCalls).toBe(2);
    }
  });

  it("授权 2、请求 count=2 → 放行（正式多图能力保持）", () => {
    const result = assertSmokeBudget(2, 2);
    expect(result.ok).toBe(true);
  });

  it("授权 0 或负数 → invalid_budget", () => {
    expect(assertSmokeBudget(1, 0).ok).toBe(false);
    expect(assertSmokeBudget(1, -1).ok).toBe(false);
  });
});

describe("UI count after refresh assert（事故根因：F5 后 count 恢复 2）", () => {
  it("刷新后 count 与请求一致 → 通过", () => {
    expect(assertUiCountMatchesRequest(1, 1)).toBe(true);
  });
  it("刷新后 count=2 但请求假设 1 → 不通过（必须先修正 count）", () => {
    expect(assertUiCountMatchesRequest(2, 1)).toBe(false);
  });
});

describe("unknown outcome no-retry（未知结果防重试）", () => {
  it("TIMEOUT_UNKNOWN → 禁止重试（预算视为已消耗）", () => {
    expect(isRetryAllowed("TIMEOUT_UNKNOWN")).toBe(false);
  });
  it("FAIL（已确认未发出/明确失败）→ 允许重试（按预算重新 preflight）", () => {
    expect(isRetryAllowed("FAIL")).toBe(true);
  });
  it("SUCCESS → 无需重试", () => {
    expect(isRetryAllowed("SUCCESS")).toBe(false);
  });
});
