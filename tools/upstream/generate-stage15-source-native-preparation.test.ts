import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const artifactWriteHook = vi.hoisted(() => ({ current: undefined as undefined | (() => void) }));
vi.mock("./artifact-set-writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./artifact-set-writer")>();
  return { ...actual, writeArtifactSetAtomically: (...args: Parameters<typeof actual.writeArtifactSetAtomically>) => {
    artifactWriteHook.current?.();
    return actual.writeArtifactSetAtomically(...args);
  } };
});

import { stableHash } from "../../lib/upstream/pipeline";
import type { SourceNativeAccessLogEntry, SourceNativeAuthorization } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { buildStage15SourceNativeBatch } from "./stage15-source-native-batch";
import { buildSourceNativeSamplingFrame, lockSourceNativeSample } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";
import { PREPARATION_ARTIFACT_PATHS, assertPathAnchorUnchanged, assertStage15SourceNativePreparation, capturePathAnchor, generateStage15SourceNativePreparation } from "./generate-stage15-source-native-preparation";

function hashed<T extends Record<string, unknown>, K extends string>(body: T, key: K): T & Record<K, string> { return { ...body, [key]: stableHash(body) } as T & Record<K, string>; }
export function sourceNativeBatch(records = SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS) {
  const brief = hashed({ schemaVersion: "stage15-source-native-selection-brief.v1" as const, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, market: "US", language: "en-US", currency: "USD", category: "desk-accessories", targetUseCase: "novice-market-screening", priceRange: { min: 15, max: 45 }, exclusions: { terms: ["hazardous"], categories: ["regulated"], variants: ["mixed"], compliance: ["unverified"] }, sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "task9" }, stage1RuleFileHash: "1".repeat(64), stage15RuleFileHash: "2".repeat(64), weightsHash: "3".repeat(64), implementationVersion: "stage15-source-native-v1", imagePolicy: "external_https_only_no_download" as const, requestedSampleSize: 20 as const }, "selectionBriefHash");
  const policy = { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] }; const budget = { maxApiRequests: 3, maxReviewPages: 3, maxPaidAmountUsd: 0 };
  const request = hashed({ schemaVersion: "stage15-source-native-access-request.v1" as const, requestId: "task9", qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, requestedActions: ["api_request"] as Array<"api_request">, policy, budget }, "requestHash");
  const authorization = hashed({ schemaVersion: "stage15-source-native-authorization.v1" as const, requestHash: request.requestHash, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, approvedTextSha256: hashSourceNativeApprovalText(request), approvedActions: ["api_request"], approvedPolicy: policy, approvedBudget: budget, maxAutomaticRetries: 0 as const, approvedLedgerHeadHash: null }, "authorizationHash") as SourceNativeAuthorization;
  const accessLog = [hashed({ schemaVersion: "stage15-source-native-access-log-entry.v1" as const, requestHash: request.requestHash, kind: "api_request" as const, sourceId: FIXTURE_SOURCE_NATIVE_QUALIFICATION.sourceId, target: "/v1/products", requestedAt: "2026-07-17T10:00:00.000Z", attempt: 1, paidAmountUsd: 0, previousLogHash: null, outcome: "success" as const }, "logHash") satisfies SourceNativeAccessLogEntry];
  const sampleLock = lockSourceNativeSample({ seed: "task9", frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: records }) });
  return buildStage15SourceNativeBatch({ batchId: "task9-batch", selectionBrief: brief, qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, accessRequest: request, authorization, accessLog, sampleLock, records, createdAt: "2026-07-17T12:00:00.000Z" });
}
function temp() { return mkdtempSync(join(tmpdir(), "stage15-source-native-")); }
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function rewriteManifest(directory: string, mutate: (manifest: Record<string, unknown>) => void = () => undefined) {
  const file = join(directory, "source-native-batch-manifest.v1.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  mutate(manifest);
  const { preparationHash: _old, ...body } = manifest;
  const text = JSON.stringify({ ...body, preparationHash: stableHash(body) });
  writeFileSync(file, text);
  writeFileSync(join(directory, "source-native-batch-manifest.v1.sha256"), `${sha256(text)}  source-native-batch-manifest.v1.json\n`);
}

describe("source-native preparation artifact closure", () => {
  it("publishes one fixed, non-self-describing preparation allowlist", () => {
    expect(PREPARATION_ARTIFACT_PATHS).toHaveLength(24);
    expect(PREPARATION_ARTIFACT_PATHS).not.toContain("stage15-run.v1.json");
    expect(PREPARATION_ARTIFACT_PATHS).not.toContain("source-native-effectiveness-analysis.v1.json");
  });
  it("writes exactly the frozen 1-19 closure, is idempotent, and rejects extra or drifted files", () => {
    const root = temp(); try {
      const first = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" });
      expect(first.write.written.length).toBeGreaterThan(30);
      expect(first.manifest.pendingArtifacts).toEqual(expect.arrayContaining([{ name: "stage15_run", status: "stage_required_pending" }]));
      expect(first.files).not.toContain("stage15-run.v1.json");
      expect(first.files).toContain("source-native-batch-manifest.v1.json");
      expect(generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" }).write.unchanged.length).toBe(first.files.length);
      writeFileSync(join(first.directory, "extra.json"), "{}");
      expect(() => generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" })).toThrow("SOURCE_NATIVE_PREPARATION_CONFLICT");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed for missing sidecars, raw drift, canonical drift, and reparse-like extra entries", () => {
    const root = temp(); try {
      const generated = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" });
      const artifact = "source-native-selection-brief.v1.json"; const sidecar = join(generated.directory, artifact.replace(/\.json$/u, ".sha256"));
      unlinkSync(sidecar); expect(() => assertStage15SourceNativePreparation(generated.directory, root)).toThrow("SOURCE_NATIVE_PREPARATION_SET_DRIFT");
      writeFileSync(sidecar, `${sha256(readFileSync(join(generated.directory, artifact), "utf8"))}  ${artifact}\n`);
      writeFileSync(join(generated.directory, artifact), "{}"); expect(() => assertStage15SourceNativePreparation(generated.directory, root)).toThrow("SOURCE_NATIVE_PREPARATION_RAW_DRIFT");
    } finally { rmSync(root, { recursive: true, force: true }); }
    const symlinkRoot = temp(); try {
      const generated = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: symlinkRoot, createdAt: "2026-07-17T12:00:00.000Z" });
      try { symlinkSync(join(generated.directory, "source-native-selection-brief.v1.json"), join(generated.directory, "linked.json")); } catch { return; }
      expect(() => assertStage15SourceNativePreparation(generated.directory, symlinkRoot)).toThrow("SOURCE_NATIVE_PREPARATION_SET_DRIFT");
    } finally { rmSync(symlinkRoot, { recursive: true, force: true }); }
  });

  it("rejects a Windows junction or directory symlink used as the explicit output ancestor", () => {
    const root = temp(); const linked = join(root, "linked-root"); try {
      try { symlinkSync(root, linked, "junction"); } catch { return; }
      expect(() => generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: linked, createdAt: "2026-07-17T12:00:00.000Z" })).toThrow("SOURCE_NATIVE_PREPARATION_PATH_ESCAPE");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("anchors the nearest existing output parent across the atomic writer and rejects identity replacement", () => {
    const root = temp(); const replaced = `${root}-replaced`;
    try {
      artifactWriteHook.current = () => { renameSync(root, replaced); mkdirSync(root); };
      expect(() => generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" })).toThrow("SOURCE_NATIVE_PREPARATION_PATH_ESCAPE");
    } finally { artifactWriteHook.current = undefined; rmSync(root, { recursive: true, force: true }); rmSync(replaced, { recursive: true, force: true }); }
  });

  it("rejects a real junction ancestor even when outputRoot itself is an ordinary existing directory", () => {
    const root = temp(); const outside = temp(); const link = join(root, "safe", "link"); const outputRoot = join(link, "existing");
    try {
      mkdirSync(join(root, "safe")); symlinkSync(outside, link, "junction"); mkdirSync(outputRoot);
      expect(() => generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot, createdAt: "2026-07-17T12:00:00.000Z" })).toThrow("SOURCE_NATIVE_PREPARATION_PATH_ESCAPE");
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });

  it("rejects a self-consistent manifest that injects a terminal artifact", () => {
    const root = temp(); try {
      const generated = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" }); const terminal = "stage15-run.v1.json"; const content = "{}";
      writeFileSync(join(generated.directory, terminal), content); writeFileSync(join(generated.directory, terminal.replace(/\.json$/u, ".sha256")), `${sha256(content)}  ${terminal}\n`);
      rewriteManifest(generated.directory, (manifest) => { (manifest.artifacts as unknown[]).push({ relativePath: terminal, rawUtf8Sha256: sha256(content), canonicalHash: stableHash({}), kind: "json" }); });
      expect(() => assertStage15SourceNativePreparation(generated.directory, root)).toThrow("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects a rehashed manifest after any required entry, file, or sidecar is removed", () => {
    for (const kind of ["entry", "file", "sidecar"] as const) {
      const root = temp(); try {
        const generated = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" }); const required = "source-native-selection-brief.v1.json";
        if (kind === "entry") rewriteManifest(generated.directory, (manifest) => { manifest.artifacts = (manifest.artifacts as Array<{ relativePath: string }>).filter((entry) => entry.relativePath !== required); });
        else { unlinkSync(join(generated.directory, kind === "file" ? required : required.replace(/\.json$/u, ".sha256"))); rewriteManifest(generated.directory); }
        expect(() => assertStage15SourceNativePreparation(generated.directory, root)).toThrow(kind === "entry" ? "SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID" : "SOURCE_NATIVE_PREPARATION_SET_DRIFT");
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });

  it("fails a captured anchor when its directory identity changes", () => {
    const root = temp(); const replaced = `${root}-replaced`; try {
      const anchor = capturePathAnchor(root, "ANCHOR_CHANGED"); renameSync(root, replaced); mkdirSync(root);
      expect(() => assertPathAnchorUnchanged(anchor, "ANCHOR_CHANGED")).toThrow("ANCHOR_CHANGED");
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(replaced, { recursive: true, force: true }); }
  });
});
