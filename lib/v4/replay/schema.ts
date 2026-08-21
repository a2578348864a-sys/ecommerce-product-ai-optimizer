/**
 * V4 P6 — ReplayBundle 契约（Lead 冻结，D1-D3）。
 */
import "server-only";

export const REPLAY_BUNDLE_SCHEMA = "replay-bundle.v1" as const;
export const REPLAY_BUNDLE_MAJOR = 1;

export type ReplayManifestFile = { path: string; sha256: string };

export type ReplayManifest = {
  files: ReplayManifestFile[];
  bundleSha256: string;
};

export type RedactionEntry = { field: string; kind: "secret" | "pii" | "contact" | "cost" | "path" | "exif" | "unlicensed"; action: "redacted" | "removed" | "blocked" };

export type RedactionReport = { entries: RedactionEntry[]; scannedAt: string; scanOk: boolean };

export type ReplayBundle = {
  schemaVersion: typeof REPLAY_BUNDLE_SCHEMA;
  bundleId: string;
  sourceRunId: string;
  exportedAt: string;
  capturedAt: string;
  mode: "replay";
  allowlistVersion: string;
  manifest: ReplayManifest;
  redactionReport: RedactionReport;
  data: Record<string, unknown>;
};

export function parseBundle(raw: string): { ok: true; bundle: ReplayBundle } | { ok: false; code: "SCHEMA_UNSUPPORTED" | "INVALID" } {
  try {
    const b = JSON.parse(raw) as ReplayBundle;
    if (!b || typeof b !== "object") return { ok: false, code: "INVALID" };
    const major = Number(String(b.schemaVersion).split(".")[0].replace("replay-bundle.v", ""));
    if (major !== REPLAY_BUNDLE_MAJOR) return { ok: false, code: "SCHEMA_UNSUPPORTED" };
    return { ok: true, bundle: b };
  } catch {
    return { ok: false, code: "INVALID" };
  }
}

export function verifyBundleHash(bundle: ReplayBundle): boolean {
  const h = /^[0-9a-f]{64}$/.test(bundle.manifest.bundleSha256);
  if (!h) return false;
  return bundle.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256));
}

export const REPLAY_DATA_ALLOWLIST = [
  "candidate", "report", "facts", "commercial", "content", "events", "gates", "timeline", "evidenceRefs",
] as const;
