/**
 * V4 P3/P4 — Gate A 选项（书内权威：human-decision.schema.json gate_a choice）。
 */
import "server-only";

export const GATE_A_OPTIONS = ["continue_sourcing", "needs_information", "abandon"] as const;
export type GateAChoice = (typeof GATE_A_OPTIONS)[number];

export type GateADecisionInput = { decision: GateAChoice; reason?: string; revision: number; actor: string };
export type GateADecisionRecord = GateADecisionInput & { decidedAt: string };

export function validateGateADecision(input: GateADecisionInput): { ok: true } | { ok: false; reason: string } {
  if (!(GATE_A_OPTIONS as readonly string[]).includes(input.decision)) return { ok: false, reason: "invalid_decision" };
  if (typeof input.revision !== "number" || input.revision < 0) return { ok: false, reason: "invalid_revision" };
  if (!input.actor) return { ok: false, reason: "actor_required" };
  return { ok: true };
}
