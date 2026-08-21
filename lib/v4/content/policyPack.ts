/**
 * V4 P5 — Policy pack（Lead 冻结，D2）。
 * versioned 规则；非永久常量；过期 → 阻断或要求确认。
 */
import "server-only";

export const POLICY_PACK_SCHEMA = "policy-pack.v1" as const;

export type PolicyRule = {
  id: string;
  kind: "field_allowlist" | "length_limit" | "charset" | "banned_terms" | "trademark_terms" | "absolute_terms";
  field?: string;
  maxLength?: number;
  pattern?: string;
  terms?: string[];
  severity: "error" | "warning";
  sourceUrl?: string;
};

export type PolicyPack = {
  schemaVersion: typeof POLICY_PACK_SCHEMA;
  version: string;
  marketplace: string;
  category: string;
  locale: string;
  effectiveAt: string;
  reviewedAt: string;
  sourceUrl: string;
  rules: PolicyRule[];
};

export type PolicyPackStatus = { ok: true; pack: PolicyPack } | { ok: false; code: "PACK_STALE" | "PACK_UNKNOWN"; message: string };

/** 过期判定：无 effectiveAt → 未知；reviewedAt 超 180 天（now 注入）→ stale。 */
export function checkPolicyPack(pack: PolicyPack | null, now: string): PolicyPackStatus {
  if (!pack) return { ok: false, code: "PACK_UNKNOWN", message: "policy pack 不存在" };
  if (!pack.effectiveAt) return { ok: false, code: "PACK_STALE", message: "policy pack 缺少 effectiveAt" };
  const effective = Date.parse(pack.effectiveAt);
  const reviewed = Date.parse(pack.reviewedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(effective)) return { ok: false, code: "PACK_STALE", message: "effectiveAt 无效" };
  if (effective > nowMs) return { ok: false, code: "PACK_STALE", message: "policy pack 尚未生效（effectiveAt=" + pack.effectiveAt + "）" };
  if (Number.isNaN(reviewed) || reviewed > nowMs) return { ok: false, code: "PACK_STALE", message: "reviewedAt 无效或为未来日期" };
  const days = (nowMs - reviewed) / 86400000;
  if (days > 180) {
    return { ok: false, code: "PACK_STALE", message: "policy pack 超过 180 天未复核（reviewedAt=" + pack.reviewedAt + "）" };
  }
  return { ok: true, pack };
}
