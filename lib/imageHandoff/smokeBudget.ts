/**
 * Smoke Budget Guard（Incident Closure）
 *
 * 2026-08-18 事故：授权 MAX=1 实际 3 次真实 Provider 调用（UI count=2 触发 2 次 + 误判后 API 1 次）。
 *
 * 本模块只约束「测试/Smoke 执行预算」，不改变产品能力：
 * - 正式产品多图能力（1/2 张）保持不变（generation service 的 requestedCount 计算不动）；
 * - 不做全局 provider 1-call gate、不动 quota/billing；
 * - 只用于 owner-local / test-only 的 Smoke 执行前检查（不进入公网页面 bundle）。
 *
 * 关键规则（与 generation service 实际 contract 一致）：
 * - requestedCount = count === 2 ? 2 : 1（count 只支持 1/2；其余归一 1）
 * - expectedProviderCalls = requestedCount（每张一次真实 images.edit / generate）
 * - expectedProviderCalls > authorizedBudget → ABORT（不得点击生成/发出请求）
 * - 调用一旦可能已发出且状态不明（CALL_OUTCOME=UNKNOWN）→ 预算视为已消耗，禁止再次调用
 */

export function calculateExpectedProviderCalls(requestedCount: number): number {
  // 与 imageGenerationService.requestedCount 完全一致（1/2 支持；其余归一 1）
  return requestedCount === 2 ? 2 : 1;
}

export type SmokeBudgetPreflight =
  | { ok: true; expectedProviderCalls: number; authorizedBudget: number }
  | { ok: false; expectedProviderCalls: number; authorizedBudget: number; reason: "budget_exceeded" | "invalid_budget" };

export function assertSmokeBudget(
  requestedCount: number,
  authorizedBudget: number,
): SmokeBudgetPreflight {
  if (!Number.isSafeInteger(authorizedBudget) || authorizedBudget < 1) {
    return { ok: false, expectedProviderCalls: calculateExpectedProviderCalls(requestedCount), authorizedBudget, reason: "invalid_budget" };
  }
  const expectedProviderCalls = calculateExpectedProviderCalls(requestedCount);
  if (expectedProviderCalls > authorizedBudget) {
    return { ok: false, expectedProviderCalls, authorizedBudget, reason: "budget_exceeded" };
  }
  return { ok: true, expectedProviderCalls, authorizedBudget };
}

/** UI 刷新后 count 恢复校验（事故根因之一：F5 后 select 恢复为 2） */
export function assertUiCountMatchesRequest(countAfterRefresh: number, expectedRequestedCount: number): boolean {
  return countAfterRefresh === expectedRequestedCount;
}

export type CallOutcome = "SUCCESS" | "FAIL" | "TIMEOUT_UNKNOWN";

/** 未知结果防重试：状态不明即视为预算已消耗 */
export function isRetryAllowed(outcome: CallOutcome): boolean {
  return outcome === "FAIL"; // SUCCESS 无需重试；TIMEOUT_UNKNOWN 禁止重试（预算视为已消耗）
}
