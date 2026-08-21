/**
 * V4 P6 — ReplayBundle 导出器测试（P6-A 所有权，D1-D3）。
 */
import { describe, expect, it } from "vitest";

import { parseBundle, verifyBundleHash, type ReplayBundle, type RedactionEntry } from "./schema";
import { exportReplayBundle, verifyBundleIntegrity } from "./exporter";
import {
  cleanData,
  contactData,
  costData,
  exifData,
  pathData,
  piiData,
  secretData,
  unlicensedData,
} from "./fixtures/leakCases";

const NOW = "2026-08-21T12:00:00.000Z";
const BASE = {
  sourceRunId: "run_001",
  runStatus: "completed",
  capturedAt: "2026-08-01T00:00:00.000Z",
};

function run(data: Record<string, unknown>, overrides: Record<string, unknown> = {}, now: string = NOW) {
  return exportReplayBundle({ ...BASE, data, ...overrides }, now);
}

function hasEntry(bundle: ReplayBundle, kind: RedactionEntry["kind"], action: RedactionEntry["action"]): boolean {
  return bundle.redactionReport.entries.some((e) => e.kind === kind && e.action === action);
}

const ALLOWLIST = [
  "candidate", "report", "facts", "commercial", "content", "events", "gates", "timeline", "evidenceRefs",
];

describe("V4 P6 exporter — status & allowlist gating", () => {
  it("exports a publishable, hash-verified bundle for a completed run", () => {
    const res = run(cleanData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(bundle.schemaVersion).toBe("replay-bundle.v1");
    expect(bundle.mode).toBe("replay");
    expect(bundle.sourceRunId).toBe("run_001");
    expect(bundle.capturedAt).toBe(BASE.capturedAt);
    expect(bundle.redactionReport.scanOk).toBe(true);
    expect(bundle.redactionReport.entries).toEqual([]);

    // Allowlist 键全部出现，非 Allowlist 键被移除。
    for (const key of ALLOWLIST) {
      expect(Object.prototype.hasOwnProperty.call(bundle.data, key)).toBe(true);
    }
    expect(Object.prototype.hasOwnProperty.call(bundle.data, "budget")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(bundle.data, "ownerScope")).toBe(false);

    // manifest 逐文件 hash + bundleHash 均为 64 hex。
    expect(bundle.manifest.files.map((f) => f.path)).toEqual(ALLOWLIST);
    for (const f of bundle.manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(bundle.manifest.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyBundleHash(bundle)).toBe(true);
    expect(verifyBundleIntegrity(bundle)).toBe(true);
  });

  it("refuses a run whose status is not completed (fail-closed)", () => {
    for (const status of ["draft", "running", "cancelled", "failed_terminal", "waiting_human"]) {
      const res = run(cleanData, { runStatus: status });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("NOT_COMPLETED");
    }
  });

  it("returns EMPTY_DATA when the data contains no allowlist key", () => {
    const res = run({ foo: 1, bar: { baz: 2 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("EMPTY_DATA");
  });
});

describe("V4 P6 exporter — redaction scanning", () => {
  it("redacts/removes secret leaks and stays publishable", () => {
    const res = run(secretData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(hasEntry(bundle, "secret", "redacted")).toBe(true);
    expect(hasEntry(bundle, "secret", "removed")).toBe(true);
    const candidate = bundle.data.candidate as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(candidate, "password")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(candidate, "apiKey")).toBe(false);
    const summary = (bundle.data.report as Record<string, unknown>).summary as string;
    expect(summary).toContain("***");
    expect(summary).not.toContain("password=pass123");
    expect(summary).not.toContain("sk-test");
    const events = bundle.data.events as { payloadJson: string }[];
    expect(events[0].payloadJson).toContain("***");
    expect(events[0].payloadJson).not.toContain("sk-event-1111222233334444");
  });

  it("redacts/removes PII (email/phone/id) and stays publishable", () => {
    const res = run(piiData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(hasEntry(bundle, "pii", "redacted")).toBe(true);
    expect(hasEntry(bundle, "pii", "removed")).toBe(true);
    const candidate = bundle.data.candidate as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(candidate, "email")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(candidate, "phone")).toBe(false);
    const report = bundle.data.report as Record<string, unknown>;
    const summary = report.summary as string;
    expect(summary).toContain("***");
    expect(summary).not.toContain("me@example.com");
    expect(summary).not.toContain("13800001111");
    expect(summary).not.toContain("110101199001011234");
    const factsStr = JSON.stringify(bundle.data.facts);
    expect(factsStr).not.toContain("vip@corp.com");
  });

  it("removes contact subtree and redacts embedded phone", () => {
    const res = run(contactData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(hasEntry(bundle, "contact", "removed")).toBe(true);
    const commercial = bundle.data.commercial as Record<string, unknown>;
    const supplier = commercial.supplier as Record<string, unknown>;
    expect(supplier).toBeDefined();
    expect(supplier.name).toBe("深圳供应商");
    expect(Object.prototype.hasOwnProperty.call(supplier, "contact")).toBe(false);
    const summary = (bundle.data.report as Record<string, unknown>).summary as string;
    expect(summary).toContain("***");
    expect(summary).not.toContain("+8613900000000");
  });

  it("removes Owner private cost keys and keeps public pricing", () => {
    const res = run(costData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(hasEntry(bundle, "cost", "removed")).toBe(true);
    const commercial = bundle.data.commercial as Record<string, unknown>;
    expect(commercial.suggestedPrice).toBe(29.99);
    for (const key of ["purchasePrice", "unitCost", "landedCost", "profitMargin", "moq"]) {
      expect(Object.prototype.hasOwnProperty.call(commercial, key)).toBe(false);
    }
  });

  it("redacts local paths (Windows drive + POSIX) and stays publishable", () => {
    const res = run(pathData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(hasEntry(bundle, "path", "redacted")).toBe(true);
    const summary = (bundle.data.report as Record<string, unknown>).summary as string;
    expect(summary).toContain("***");
    expect(summary).not.toContain("D:\secret\purchase.xlsx");
    expect(summary).not.toContain("C:\data\cost.txt");
    const content = bundle.data.content as Record<string, unknown>;
    expect(content.assetPath).toBe("***");
  });

  it("removes EXIF-tainted images and stays publishable", () => {
    const res = run(exifData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(true);
    expect(hasEntry(bundle, "exif", "removed")).toBe(true);
    const content = bundle.data.content as Record<string, unknown>;
    const imagePlan = content.imagePlan as { images: { ref: string }[] };
    expect(imagePlan.images.length).toBe(1);
    expect(imagePlan.images[0].ref).toBe("https://img.example.com/ok.jpg");
  });

  it("blocks export when an unlicensed image is present (scanOk=false, not publishable)", () => {
    const res = run(unlicensedData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(res.publishable).toBe(false);
    expect(bundle.redactionReport.scanOk).toBe(false);
    expect(hasEntry(bundle, "unlicensed", "blocked")).toBe(true);
    // 结构仍可通过 format 校验，但不可发布。
    expect(verifyBundleHash(bundle)).toBe(true);
    expect(bundle.schemaVersion).toBe("replay-bundle.v1");
    expect(bundle.data.content).toBeDefined();
  });
});

describe("V4 P6 exporter — determinism & integrity", () => {
  it("is deterministic for identical input + injected now", () => {
    const a = run(cleanData);
    const b = run(cleanData);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.bundle.bundleId).toBe(b.bundle.bundleId);
    expect(a.bundle.manifest.bundleSha256).toBe(b.bundle.manifest.bundleSha256);
    expect(a.bundle.manifest.files).toEqual(b.bundle.manifest.files);
    expect(a.bundle.data).toEqual(b.bundle.data);
  });

  it("keeps per-file hashes stable across different now but changes bundle hash", () => {
    const a = run(cleanData, {}, NOW);
    const b = run(cleanData, {}, "2026-08-22T08:00:00.000Z");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.bundle.manifest.files).toEqual(b.bundle.manifest.files);
    expect(a.bundle.manifest.bundleSha256).not.toBe(b.bundle.manifest.bundleSha256);
  });

  it("detects data tampering via recompute (verifyBundleIntegrity)", () => {
    const res = run(cleanData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    expect(verifyBundleIntegrity(bundle)).toBe(true);

    const tampered: ReplayBundle = JSON.parse(JSON.stringify(bundle));
    (tampered.data.report as Record<string, unknown>).summary = "helloworld tampered";
    expect(verifyBundleIntegrity(tampered)).toBe(false);
  });

  it("schema.verifyBundleHash rejects malformed manifest hashes", () => {
    const res = run(cleanData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { bundle } = res;
    const malformed: ReplayBundle = {
      ...bundle,
      manifest: { ...bundle.manifest, bundleSha256: "not-a-hex" },
    };
    expect(verifyBundleHash(malformed)).toBe(false);
  });

  it("schema.parseBundle gates the schema major version (frozen-note)", () => {
    // 冻结 schema.parseBundle 存在缺陷：对 "replay-bundle.v1" 计算 major 时，
    // split(".")[0] = "replay-bundle"，随后 replace("replay-bundle.v","") 不命中 →
    // Number("replay-bundle") = NaN → 对 v1 也返回 SCHEMA_UNSUPPORTED。
    // 该函数由 Lead 冻结（P6-A 不得修改），此处按实际行为断言并作为风险上报。
    const res = run(cleanData);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const raw = JSON.stringify(res.bundle);
    expect(res.bundle.schemaVersion).toBe("replay-bundle.v1");
    expect(parseBundle(raw)).toEqual({ ok: false, code: "SCHEMA_UNSUPPORTED" });
    // 非 JSON → INVALID。
    expect(parseBundle("not json")).toEqual({ ok: false, code: "INVALID" });
  });
});
