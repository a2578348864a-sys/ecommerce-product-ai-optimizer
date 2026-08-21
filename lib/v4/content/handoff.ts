/**
 * V4 P5 — ContentHandoff 契约（Lead 冻结，D1）。
 * 冻结 factRevision + policyPackVersion；fact/policy 变化 → handoff stale。
 */
import "server-only";

export const CONTENT_HANDOFF_SCHEMA = "content-handoff.v1" as const;

export type ContentHandoff = {
  schemaVersion: typeof CONTENT_HANDOFF_SCHEMA;
  runId: string;
  candidateId: string;
  variant: string;
  marketplace: string;
  category: string;
  locale: string;
  factRevision: number;
  policyPackVersion: string;
  keywordRefs: string[];
  vocRefs: string[];
  referenceImages: string[];
  brandStyle?: string | null;
  forbidden: string[];
  createdAt: string;
};

export function validateHandoff(h: ContentHandoff): { ok: true } | { ok: false; reason: string } {
  if (h.schemaVersion !== CONTENT_HANDOFF_SCHEMA) return { ok: false, reason: "schema_version" };
  if (!h.runId || !h.candidateId || !h.variant || !h.marketplace || !h.category || !h.locale) return { ok: false, reason: "identity_missing" };
  if (typeof h.factRevision !== "number" || h.factRevision < 0) return { ok: false, reason: "fact_revision_invalid" };
  if (!h.policyPackVersion) return { ok: false, reason: "policy_pack_missing" };
  return { ok: true };
}

export type HandoffStaleCheck = { factRevision: number; policyPackVersion: string };
export function isHandoffStale(h: ContentHandoff, current: HandoffStaleCheck): boolean {
  return h.factRevision !== current.factRevision || h.policyPackVersion !== current.policyPackVersion;
}
