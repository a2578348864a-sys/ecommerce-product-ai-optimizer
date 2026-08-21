import "server-only";

/**
 * V4 P1 — Research Graph feature flag (D4 in P1_CONTRACT).
 *
 * Gate: QX_V4_GRAPH_ENABLED (env, "1"/"true" enables; default off).
 * When off, V4 graph code must not participate in any V3.1 request path:
 * API routes return 404 and pages show a placeholder.
 */
export const V4_GRAPH_FEATURE_FLAG = "QX_V4_GRAPH_ENABLED";

export function isV4GraphEnabled(): boolean {
  const raw = process.env[V4_GRAPH_FEATURE_FLAG];
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function requireV4GraphEnabled(): { ok: true } | { ok: false; code: "v4_graph_disabled" } {
  return isV4GraphEnabled() ? { ok: true } : { ok: false, code: "v4_graph_disabled" };
}
