/**
 * V3.1 Phase 2 — Release Invariant Gates（§25-26 / §12）
 *
 * PUBLIC_RELEASE 必须显式满足：
 *   1) QX_RUNTIME_MODE 显式 = public_showcase（env missing 不得通过；§26）；
 *   2) PUBLIC_SHOWCASE_NODE_INSTANCES = 1（fork_mode 单实例；instances>1 或 cluster → BLOCKED，§12）。
 *
 * 缺省（env missing）= v3.0.1 legacy/passworded 语义 = migration/rollback safety fallback，
 * 不是第三个 Runtime Mode（§25）。
 */
import "server-only";
import { RUNTIME_MODE_ENV } from "@/lib/server/runtimeMode";

/** PUBLIC_RELEASE 要求显式 public_showcase（§26）。 */
export function isExplicitPublicShowcaseRelease(): boolean {
  return (process.env[RUNTIME_MODE_ENV] || "").trim().toLowerCase() === "public_showcase";
}

/** 显式 local_owner（无认证回环信任仅显式启用）。 */
export function isExplicitLocalOwner(): boolean {
  return (process.env[RUNTIME_MODE_ENV] || "").trim().toLowerCase() === "local_owner";
}

/** 单实例不变量（§12）：fork_mode 且 instances === 1。 */
export function isPublicShowcaseNodeInstancesOne(instances: number | undefined, execMode: string | undefined): boolean {
  return execMode === "fork_mode" && instances === 1;
}

export interface ReleaseGateResult {
  pass: boolean;
  reasons: string[];
}

/** 组合门禁（供部署脚本与测试共用）。 */
export function evaluatePublicShowcaseReleaseGate(input: {
  instances?: number;
  execMode?: string;
}): ReleaseGateResult {
  const reasons: string[] = [];
  if (!isExplicitPublicShowcaseRelease()) {
    reasons.push("QX_RUNTIME_MODE 必须显式设置为 public_showcase（env missing 不允许通过 Release Gate）");
  }
  if (!isPublicShowcaseNodeInstancesOne(input.instances, input.execMode)) {
    reasons.push("PUBLIC_SHOWCASE 必须 fork_mode 单实例（instances=1）；多实例需 CROSS_PROCESS_ATOMICITY=PASS");
  }
  return { pass: reasons.length === 0, reasons };
}