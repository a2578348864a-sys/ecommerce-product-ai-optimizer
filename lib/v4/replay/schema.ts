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
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    return { ok: false, code: "INVALID" };
  }
  if (!b || typeof b !== "object") return { ok: false, code: "INVALID" };
  const rec = b as Record<string, unknown>;
  // P6-C C1 修复：主版本从 "replay-bundle.v<N>" 前缀提取；结构缺失 fail-closed（C3）
  const m = typeof rec.schemaVersion === "string" ? rec.schemaVersion.match(/^replay-bundle\.v(\d+)/) : null;
  if (!m) return { ok: false, code: "INVALID" };
  const major = Number(m[1]);
  if (major !== REPLAY_BUNDLE_MAJOR) return { ok: false, code: "SCHEMA_UNSUPPORTED" };
  if (typeof rec.manifest !== "object" || rec.manifest === null) return { ok: false, code: "INVALID" };
  const manifest = rec.manifest as Record<string, unknown>;
  if (!Array.isArray(manifest.files) || typeof manifest.bundleSha256 !== "string") return { ok: false, code: "INVALID" };
  if (typeof rec.data !== "object" || rec.data === null) return { ok: false, code: "INVALID" };
  return { ok: true, bundle: rec as unknown as ReplayBundle };
}

/** P6-C C2 修复：bundle hash 必须对内容复算一致（canonical JSON，排除自身字段）。 */
function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => deepSortKeys(v));
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) out[k] = deepSortKeys(rec[k]);
    return out;
  }
  return value;
}

export function canonicalBundleWithoutHash(bundle: ReplayBundle): string {
  const clone: Record<string, unknown> = { ...bundle };
  clone.manifest = { ...bundle.manifest, bundleSha256: "" };
  return JSON.stringify(deepSortKeys(clone));
}

export function verifyBundleHash(bundle: ReplayBundle, hashFn: (input: string) => string): boolean {
  if (!bundle.manifest || !Array.isArray(bundle.manifest.files)) return false;
  for (const f of bundle.manifest.files) {
    if (typeof f.path !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) return false;
  }
  const expected = hashFn(canonicalBundleWithoutHash(bundle));
  return expected === bundle.manifest.bundleSha256;
}

export const REPLAY_DATA_ALLOWLIST = [
  "candidate", "report", "facts", "commercial", "content", "events", "gates", "timeline", "evidenceRefs",
] as const;
