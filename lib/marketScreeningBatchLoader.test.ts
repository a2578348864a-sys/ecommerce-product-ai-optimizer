import { TEST_PROJECT_MATERIALS_ROOT } from "../tests/helpers/project-materials";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH,
  loadMarketScreeningBatchManifest,
  type ManifestErrorCode,
} from "@/lib/marketScreeningBatchManifest";
import {
  loadMarketScreeningBatch,
  mapManifestErrorCode,
} from "@/lib/marketScreeningBatchLoader";

const sourceRoot = TEST_PROJECT_MATERIALS_ROOT;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function copyFile(relativePath: string, targetRoot: string) {
  const target = resolve(targetRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(sourceRoot, relativePath), target);
}

function fixtureRoot() {
  const manifestResult = loadMarketScreeningBatchManifest({
    environment: "development",
    projectMaterialsRoot: sourceRoot,
  });
  if (manifestResult.status !== "ready") throw new Error(manifestResult.errorCode);
  const root = mkdtempSync(join(tmpdir(), "market-screening-loader-"));
  temporaryRoots.push(root);
  copyFile(FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH, root);
  copyFile(FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH.replace(/\.json$/, ".sha256"), root);
  for (const artifact of manifestResult.manifest.artifacts) copyFile(artifact.relativePath, root);
  return root;
}

function manifestOnlyRoot() {
  const root = mkdtempSync(join(tmpdir(), "market-screening-manifest-only-"));
  temporaryRoots.push(root);
  copyFile(FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH, root);
  copyFile(FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH.replace(/\.json$/, ".sha256"), root);
  return root;
}

function emptyRoot() {
  const root = mkdtempSync(join(tmpdir(), "market-screening-empty-"));
  temporaryRoots.push(root);
  return root;
}

function rewriteManifest(root: string, update: (manifest: Record<string, unknown> & { artifacts: Array<Record<string, unknown>> }) => void) {
  const path = resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  update(manifest);
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path, raw, "utf8");
  const sha = createHash("sha256").update(raw).digest("hex");
  writeFileSync(path.replace(/\.json$/, ".sha256"), `${sha}  ${basename(path)}\n`, "utf8");
}

function rewriteWholeFileArtifact(
  root: string,
  key: string,
  update: (artifact: Record<string, unknown>) => void,
) {
  const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
  if (manifest.status !== "ready") throw new Error(manifest.errorCode);
  const ref = manifest.manifest.artifacts.find((artifact) => artifact.key === key);
  if (!ref || ref.jsonPointer !== "") throw new Error(`Expected whole-file artifact: ${key}`);
  const path = resolve(root, ref.relativePath);
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  update(artifact);
  const raw = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(path, raw, "utf8");
  const fileSha256 = createHash("sha256").update(raw).digest("hex");
  rewriteManifest(root, (value) => {
    const artifactRef = value.artifacts.find((candidate) => candidate.key === key);
    if (!artifactRef) throw new Error(`Missing artifact ref: ${key}`);
    artifactRef.fileSha256 = fileSha256;
  });
}

describe("ManifestErrorCode mapping", () => {
  it.each([
    ["batch_manifest_not_configured", "batch_manifest_not_configured"],
    ["batch_manifest_missing", "batch_manifest_missing"],
    ["batch_manifest_sidecar_invalid", "batch_manifest_sidecar_invalid"],
    ["batch_manifest_hash_mismatch", "batch_manifest_hash_mismatch"],
    ["batch_manifest_schema_invalid", "batch_manifest_schema_invalid"],
    ["batch_manifest_path_invalid", "batch_manifest_path_invalid"],
  ] as const)("maps ManifestErrorCode %s deterministically", (input, expected) => {
    expect(mapManifestErrorCode(input satisfies ManifestErrorCode)).toBe(expected);
  });
});

describe("loadMarketScreeningBatch", () => {
  it("loads the real frozen batch as ready_full", () => {
    const result = loadMarketScreeningBatch({
      environment: "development",
      projectMaterialsRoot: sourceRoot,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.batch.batchReadiness).toMatchObject({
      status: "ready_full",
      acceptedUniqueProductCount: 20,
      stage1InputCount: 20,
      stage15PartitionCount: 20,
      optionalDetailStatus: "verified",
    });
    expect(result.batch.artifacts.stage15Run).toBeDefined();
  });

  it("returns upstream_only when a Stage artifact is absent", () => {
    const root = fixtureRoot();
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const ranking = manifest.manifest.artifacts.find((artifact) => artifact.key === "stage1Ranking")!;
    unlinkSync(resolve(root, ranking.relativePath));

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "upstream_only",
      upstream: { batchReadiness: { status: "upstream_only", reasonCodes: ["stage_artifact_not_ready"] } },
    });
  });

  it("returns upstream_only when a presentation artifact is absent", () => {
    const root = fixtureRoot();
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const packet = manifest.manifest.artifacts.find((artifact) => artifact.key === "visualPacket")!;
    unlinkSync(resolve(root, packet.relativePath));

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "upstream_only",
      upstream: { batchReadiness: { status: "upstream_only", reasonCodes: ["presentation_artifact_not_ready"] } },
    });
  });

  it("returns upstream_only when a declared Stage output explicitly remains pending", () => {
    const root = fixtureRoot();
    rewriteWholeFileArtifact(root, "stage15Run", (artifact) => {
      artifact.status = "pending";
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "upstream_only",
      upstream: { batchReadiness: { status: "upstream_only", reasonCodes: ["stage_artifact_not_ready"] } },
    });
  });

  it("blocks when an upstream artifact is absent", () => {
    const root = fixtureRoot();
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const upstream = manifest.manifest.artifacts.find((artifact) => artifact.key === "selectionBrief")!;
    unlinkSync(resolve(root, upstream.relativePath));

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "upstream_artifact_missing",
    });
  });

  it("blocks a present artifact with a raw SHA conflict", () => {
    const root = fixtureRoot();
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const run = manifest.manifest.artifacts.find((artifact) => artifact.key === "stage15Run")!;
    writeFileSync(resolve(root, run.relativePath), "{}\n", "utf8");

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_hash_mismatch",
    });
  });

  it("blocks a present artifact whose identity contradicts its binding", () => {
    const root = fixtureRoot();
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const runRef = manifest.manifest.artifacts.find((artifact) => artifact.key === "stage15Run")!;
    const runPath = resolve(root, runRef.relativePath);
    const run = JSON.parse(readFileSync(runPath, "utf8"));
    run.rankingRunId = "ranking-conflict";
    const raw = `${JSON.stringify(run, null, 2)}\n`;
    writeFileSync(runPath, raw, "utf8");
    const fileSha256 = createHash("sha256").update(raw).digest("hex");
    rewriteManifest(root, (value) => {
      const ref = value.artifacts.find((artifact) => artifact.key === "stage15Run")!;
      ref.fileSha256 = fileSha256;
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_identity_conflict",
    });
  });

  it("blocks a present artifact with the wrong artifact schema", () => {
    const root = fixtureRoot();
    rewriteWholeFileArtifact(root, "stage15Run", (artifact) => {
      artifact.schemaVersion = "novice-market-screening-run.v2";
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_schema_invalid",
    });
  });

  it("blocks a symlinked artifact directory even when the bytes and SHA are valid", () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(join(tmpdir(), "market-screening-artifact-outside-"));
    temporaryRoots.push(outside);
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const ref = manifest.manifest.artifacts.find((artifact) => artifact.key === "stage15Run")!;
    const outsideArtifact = resolve(outside, "stage15.json");
    copyFileSync(resolve(root, ref.relativePath), outsideArtifact);
    const link = resolve(root, "linked-artifact-dir");
    symlinkSync(outside, link, "junction");
    rewriteManifest(root, (value) => {
      const artifactRef = value.artifacts.find((artifact) => artifact.key === "stage15Run")!;
      artifactRef.relativePath = "linked-artifact-dir/stage15.json";
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_path_invalid",
    });
  });

  it("blocks product identities that no longer match across Import, Stage 1 and Stage 1.5", () => {
    const root = fixtureRoot();
    rewriteWholeFileArtifact(root, "stage15Run", (artifact) => {
      const items = artifact.items as Array<Record<string, unknown>>;
      items[0] = { ...items[0], productKey: "amazon:US:B000000000" };
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_identity_conflict",
    });
  });

  it("blocks a Stage 1.5 partition that drifts from the frozen expected counts", () => {
    const root = fixtureRoot();
    rewriteWholeFileArtifact(root, "stage15Run", (artifact) => {
      const summary = artifact.summary as Record<string, unknown>;
      summary.advance = 4;
      summary.watch = 12;
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_identity_conflict",
    });
  });

  it("omits a partially missing optional detail group without downgrading core", () => {
    const root = fixtureRoot();
    const manifest = loadMarketScreeningBatchManifest({ environment: "development", projectMaterialsRoot: root });
    if (manifest.status !== "ready") throw new Error(manifest.errorCode);
    const detail = manifest.manifest.artifacts.find((artifact) => artifact.key === "detailRun")!;
    unlinkSync(resolve(root, detail.relativePath));

    const result = loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root });
    expect(result).toMatchObject({
      status: "ready",
      batch: { batchReadiness: { status: "ready_full", optionalDetailStatus: "incomplete_omitted" } },
    });
    if (result.status !== "ready") return;
    for (const key of [
      "detailBrief",
      "detailBriefGenerationSummary",
      "detailAuthorization",
      "detailRun",
      "detailGenerationSummary",
    ] as const) {
      expect(result.batch.artifacts[key]).toBeUndefined();
    }
  });

  it("allows the optional detail group to be entirely undeclared", () => {
    const root = fixtureRoot();
    rewriteManifest(root, (value) => {
      value.artifacts = value.artifacts.filter((artifact) => artifact.groupId !== "detail_evidence_a02");
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "ready",
      batch: { batchReadiness: { status: "ready_full", optionalDetailStatus: "not_attached" } },
    });
  });

  it("blocks a contradictory optional detail artifact instead of silently omitting it", () => {
    const root = fixtureRoot();
    rewriteWholeFileArtifact(root, "detailRun", (artifact) => {
      artifact.briefId = "detail-brief-conflict";
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_identity_conflict",
    });
  });

  it("blocks optional detail ASINs that do not exactly match the Brief target set", () => {
    const root = fixtureRoot();
    rewriteWholeFileArtifact(root, "detailRun", (artifact) => {
      const pages = artifact.pages as Array<Record<string, unknown>>;
      pages[0] = { ...pages[0], expectedAsin: "B000000000" };
    });

    expect(loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot: root })).toMatchObject({
      status: "blocked",
      errorCode: "artifact_identity_conflict",
    });
  });

  it.each([
    ["batch_manifest_not_configured", () => ({
      environment: "production" as const,
      projectMaterialsRoot: sourceRoot,
    })],
    ["batch_manifest_missing", () => ({
      environment: "development" as const,
      projectMaterialsRoot: emptyRoot(),
    })],
    ["batch_manifest_sidecar_invalid", () => {
      const root = manifestOnlyRoot();
      writeFileSync(resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH.replace(/\.json$/, ".sha256")), "invalid\n");
      return { environment: "development" as const, projectMaterialsRoot: root };
    }],
    ["batch_manifest_hash_mismatch", () => {
      const root = manifestOnlyRoot();
      const path = resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH);
      writeFileSync(path, `${readFileSync(path, "utf8")} `, "utf8");
      return { environment: "development" as const, projectMaterialsRoot: root };
    }],
    ["batch_manifest_schema_invalid", () => {
      const root = manifestOnlyRoot();
      rewriteManifest(root, (manifest) => {
        manifest.schemaVersion = "market-screening-batch-manifest.v2";
      });
      return { environment: "development" as const, projectMaterialsRoot: root };
    }],
    ["batch_manifest_path_invalid", () => ({
      environment: "development" as const,
      projectMaterialsRoot: resolve(manifestOnlyRoot(), "missing-project-root"),
    })],
  ] as const)("propagates unavailable Manifest result %s as the exact blocked code", (expected, options) => {
    expect(loadMarketScreeningBatch(options())).toEqual(expect.objectContaining({
      status: "blocked",
      errorCode: expected,
    }));
  });
});
