import { describe, expect, it } from "vitest";

import { deriveListingV5SafetyDisplay, isGateRefusalCode } from "./listingV5SafetyDisplay";

/**
 * 审计回归：绿色「安全检查通过」必须由后端真实状态决定。
 * 任何 BLOCK / REPAIRABLE / stale / 门禁拒绝 / 无结论的情况都不得显示通过。
 */

const passed = (input: Parameters<typeof deriveListingV5SafetyDisplay>[0]) =>
  deriveListingV5SafetyDisplay(input).safeToCallPassed;

describe("deriveListingV5SafetyDisplay", () => {
  it("只有 listing + validation.status=PASS + 未过期 才算通过", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "PASS", stale: false });
    expect(display.tone).toBe("pass");
    expect(display.badge).toBe("安全检查通过");
    expect(display.safeToCallPassed).toBe(true);
    // 通过也不等于可以发布：文案必须保留人工复核边界。
    expect(display.detail).toContain("人工复核");
  });

  it("stale 数据不得显示通过，且必须给出明确提示", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "PASS", stale: true });
    expect(display.safeToCallPassed).toBe(false);
    expect(display.tone).toBe("stale");
    expect(display.badge).toContain("重新生成");
    expect(display.detail).toContain("旧版研究依据");
  });

  it("BLOCK 数据不得显示通过", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "BLOCK", stale: false });
    expect(display.safeToCallPassed).toBe(false);
    expect(display.tone).toBe("blocked");
    expect(display.badge).toBe("安全检查未通过");
    expect(display.detail).toContain("BLOCK");
  });

  it("REPAIRABLE 数据不得显示通过，且只有真的跑过修复才说已修复", () => {
    const notRepaired = deriveListingV5SafetyDisplay({
      hasListing: true,
      validationStatus: "REPAIRABLE",
      stale: false,
      provider: { repairAttempted: false },
    });
    expect(notRepaired.safeToCallPassed).toBe(false);
    expect(notRepaired.badge).not.toContain("已自动修复");
    expect(notRepaired.detail).toContain("没有执行修复");

    const repaired = deriveListingV5SafetyDisplay({
      hasListing: true,
      validationStatus: "REPAIRABLE",
      stale: false,
      provider: { repairAttempted: true },
    });
    expect(repaired.safeToCallPassed).toBe(false);
    expect(repaired.badge).toContain("已自动修复");
    expect(repaired.detail).toContain("仍未被判定为 PASS");
  });

  it("没有草稿时是未校验，不是通过", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: false });
    expect(display.tone).toBe("unverified");
    expect(display.safeToCallPassed).toBe(false);
    expect(display.badge).toBe("尚未生成草稿");
  });

  it("草稿存在但没有校验结论时也不得显示通过", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: null, stale: false });
    expect(display.tone).toBe("unverified");
    expect(display.safeToCallPassed).toBe(false);
    expect(display.badge).toBe("缺少校验结论");
  });

  it("NOT_RUN 等未知状态按未通过处理", () => {
    for (const status of ["NOT_RUN", "UNKNOWN", "pending"]) {
      const display = deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: status, stale: false });
      expect(display.safeToCallPassed).toBe(false);
      expect(display.tone).toBe("blocked");
    }
  });

  it("服务端门禁拒绝时优先报告门禁原因，且绝不显示通过", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "PASS", errorCode: "no_confirmed_facts" });
    expect(display.tone).toBe("blocked");
    expect(display.safeToCallPassed).toBe(false);
    expect(display.detail).toContain("已确认事实");
    // 该 reason 只可能在研究完成后出现：文案必须给出"完成创作资料确认"这一步，而不是说没有事实
    expect(display.detail).toContain("创作资料");
    expect(display.detail).not.toContain("还没有可用于 Listing 的已确认事实");

    const unknown = deriveListingV5SafetyDisplay({ hasListing: false, errorCode: "some_new_reason" });
    expect(unknown.safeToCallPassed).toBe(false);
    expect(unknown.detail).toContain("some_new_reason");
  });

  it("stale 优先于 PASS，门禁拒绝优先于 stale", () => {
    expect(passed({ hasListing: true, validationStatus: "PASS", stale: true })).toBe(false);
    expect(passed({ hasListing: true, validationStatus: "PASS", stale: true, errorCode: "handoff_required" })).toBe(false);
    expect(
      deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "PASS", stale: true, errorCode: "handoff_required" }).detail,
    ).toContain("交接版本");
  });

  it("研究未完成的任务显示「先完成研究」而不是「旧版任务」", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: false, errorCode: "research_not_completed" });
    expect(display.tone).toBe("blocked");
    expect(display.gateBlocked).toBe(true);
    expect(display.safeToCallPassed).toBe(false);
    expect(display.detail).toContain("完成研究");
    expect(display.detail).not.toContain("旧版");
  });

  it("不存在的任务说明任务不存在，不回落到「旧版研究流程」", () => {
    const display = deriveListingV5SafetyDisplay({ hasListing: false, errorCode: "task_not_found" });
    expect(display.gateBlocked).toBe(true);
    expect(display.detail).toContain("任务不存在");
    expect(display.detail).not.toContain("旧版");
  });

  it("只有登记过的门禁拒绝码才锁定生成按钮（额度/网络类仍可重试）", () => {
    expect(isGateRefusalCode("research_not_completed")).toBe(true);
    expect(isGateRefusalCode("task_not_found")).toBe(true);
    expect(isGateRefusalCode("legacy_not_supported")).toBe(true);
    expect(isGateRefusalCode("quota_exceeded")).toBe(false);
    expect(isGateRefusalCode("provider_error")).toBe(false);
    expect(isGateRefusalCode("")).toBe(false);
    expect(isGateRefusalCode(null)).toBe(false);
    expect(deriveListingV5SafetyDisplay({ hasListing: false, errorCode: "quota_exceeded" }).gateBlocked).toBe(false);
  });

  it("非门禁路径一律不锁定生成按钮", () => {
    const displays = [
      deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "PASS", stale: false }),
      deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "PASS", stale: true }),
      deriveListingV5SafetyDisplay({ hasListing: true, validationStatus: "BLOCK", stale: false }),
      deriveListingV5SafetyDisplay({ hasListing: false }),
    ];
    for (const display of displays) expect(display.gateBlocked).toBe(false);
  });
});
