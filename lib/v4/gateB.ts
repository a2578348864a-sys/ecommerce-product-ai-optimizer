/**
 * V4 P4 — Gate B 四选项（书内权威：human-decision.schema.json gate_b choice）。
 */
import "server-only";

export const GATE_B_OPTIONS = ["content_ready", "revise_product", "needs_information", "abandon"] as const;
export type GateBChoice = (typeof GATE_B_OPTIONS)[number];

export function validateGateB(input: { option: string; reason?: string; revision: number; actor: string }): { ok: true } | { ok: false; reason: string } {
  if (!(GATE_B_OPTIONS as readonly string[]).includes(input.option)) return { ok: false, reason: "invalid_option" };
  if (typeof input.revision !== "number" || input.revision < 0) return { ok: false, reason: "invalid_revision" };
  if (!input.actor) return { ok: false, reason: "actor_required" };
  if (input.option === "abandon" && !input.reason) return { ok: false, reason: "abandon_requires_reason" };
  return { ok: true };
}
