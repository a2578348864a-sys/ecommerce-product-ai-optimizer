/**
 * V4 P4 — Gate B 四选项（Lead 冻结，D6）。只由人提交。
 */
import "server-only";

import type { GateBOption } from "@/lib/v4/calculator/contract";

export const GATE_B_OPTIONS: GateBOption[] = ["proceed", "get_more_info", "modify_product", "stop"];

export function validateGateB(input: { option: string; reason?: string; revision: number; actor: string }): { ok: true } | { ok: false; reason: string } {
  if (!GATE_B_OPTIONS.includes(input.option as GateBOption)) return { ok: false, reason: "invalid_option" };
  if (typeof input.revision !== "number" || input.revision < 0) return { ok: false, reason: "invalid_revision" };
  if (!input.actor) return { ok: false, reason: "actor_required" };
  if (input.option === "stop" && !input.reason) return { ok: false, reason: "stop_requires_reason" };
  return { ok: true };
}
