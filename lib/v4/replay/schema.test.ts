import { describe, expect, it } from "vitest";
import { canonicalBundleWithoutHash, parseBundle, verifyBundleHash, type ReplayBundle } from "@/lib/v4/replay/schema";

const bundle: ReplayBundle = {
  schemaVersion: "replay-bundle.v1",
  bundleId: "b-1",
  sourceRunId: "r-1",
  exportedAt: "2026-08-21T00:00:00.000Z",
  capturedAt: "2026-08-20T00:00:00.000Z",
  mode: "replay",
  allowlistVersion: "v1",
  manifest: { files: [{ path: "data.json", sha256: "a".repeat(64) }], bundleSha256: "b".repeat(64) },
  redactionReport: { entries: [], scannedAt: "2026-08-21T00:00:00.000Z", scanOk: true },
  data: { candidate: { name: "x" } },
};

describe("replay schema (P6-C fixes)", () => {
  it("parseBundle accepts valid replay-bundle.v1", () => {
    const r = parseBundle(JSON.stringify(bundle));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.bundleId).toBe("b-1");
  });

  it("parseBundle rejects unsupported major (v2)", () => {
    const r = parseBundle(JSON.stringify({ ...bundle, schemaVersion: "replay-bundle.v2" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCHEMA_UNSUPPORTED");
  });

  it("parseBundle rejects invalid structure fail-closed", () => {
    expect(parseBundle(JSON.stringify({ schemaVersion: "replay-bundle.v1" })).ok).toBe(false);
    expect(parseBundle("not json").ok).toBe(false);
    expect(parseBundle("null").ok).toBe(false);
  });

  it("verifyBundleHash recomputes content hash (tamper fails)", () => {
    const fakeHash = (s: string) => {
      // 确定性伪 hash：内容摘要 → 真实 sha256
      const { createHash } = require("node:crypto");
      return createHash("sha256").update(s).digest("hex");
    };
    const good = { ...bundle, manifest: { ...bundle.manifest, bundleSha256: fakeHash(canonicalBundleWithoutHash(bundle)) } };
    expect(verifyBundleHash(good, fakeHash)).toBe(true);
    const tampered = { ...good, data: { ...good.data, candidate: { name: "tampered" } } };
    expect(verifyBundleHash(tampered, fakeHash)).toBe(false);
  });
});
