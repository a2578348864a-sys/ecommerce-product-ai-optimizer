/**
 * V4 P3 — Gate A 决策载荷（Lead 冻结，D5）。
 * Gate A 只能由人工决定；decision=continue_sourcing | stop | revise；记录 reason + revision。
 */
import "server-only";

export type GateADecision = "continue_sourcing" | "stop" | "revise";

export type GateADecisionInput = {
  decision: GateADecision;
  reason?: string;
  revision: number;
  actor: string;
};

export type GateADecisionRecord = GateADecisionInput & { decidedAt: string };

export function validateGateADecision(input: GateADecisionInput): { ok: true } | { ok: false; reason: string } {
  if (!["continue_sourcing", "stop", "revise"].includes(input.decision)) {
    return { ok: false, reason: "invalid_decision" };
  }
  if (typeof input.revision !== "number" || input.revision < 0) {
    return { ok: false, reason: "invalid_revision" };
  }
  if (!input.actor) return { ok: false, reason: "actor_required" };
  return { ok: true };
}
