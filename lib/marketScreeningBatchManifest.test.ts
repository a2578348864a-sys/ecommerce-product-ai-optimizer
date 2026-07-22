import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH,
  loadMarketScreeningBatchManifest,
} from "@/lib/marketScreeningBatchManifest";
import { stableHash } from "@/lib/upstream/pipeline";
import {
  readProjectMaterial,
  TEST_PROJECT_MATERIALS_ROOT,
} from "@/tests/helpers/project-materials";

const roots: string[] = [];

const FROZEN_FILE_SHA256 = {
  "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/human-assisted-amazon-run.v2.json": "8ac0235ee3c39d9a653f1d5d9212c62f93ed65b5e7afa27f85f1ea12f4138b47",
  "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-blind-review-material.v1.json": "93bdb99a0551674b64b625040d99674f05a7df26c9ba1c5275b7e97c9cddafac",
  "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-ranking.v1.json": "ad36ddf2f1e5c902013359b586516f28065f741076fb039602fb08e3720bd8d5",
  "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-offline-run-summary.v1.json": "79969503762e49267a5e60fa6ac33ccad6e62a7727851f5080c16897628fc84f",
  "06_测试与验证/2026-07-15-Phase-Stage1.5-Novice-Screening-01/novice-market-screening-run.v1.json": "6c58470266e6e6cf00177896e535405642fd74fea4012bcc033840d98cc167d6",
  "06_测试与验证/2026-07-15-Phase-Stage1.5-Novice-Screening-01/novice-market-screening-acceptance.v1.json": "3277912137d2004ff0e5d2bb62206612a12000de7828e13fc78487302cdae6ca",
  "06_测试与验证/2026-07-15-Phase-Stage1.5-Novice-Screening-01/generation-summary.novice-market-screening.v1.json": "6a926d03d034067daa6fda437ea2cb6d48344a22bb7ecb28679f32a290119616",
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/04-视觉盲评V2/novice-visual-presentation-input.v1.json": "2215a84638666444c5058bf9cac7a2256f363d17ab180a8f3bce8d6d0fa78807",
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/04-视觉盲评V2/novice-visual-blind-review-packet.v2.json": "20359deeb4968dc2def4bdb8cfca33f884d4ab703ea1177871846ae695949783",
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/04-视觉盲评V2/generation-summary.v2.json": "e959612923174e12c99dab8f196b4975fb1195c1a8866e1bad138883026f80e8",
  "06_测试与验证/2026-07-15-Phase-Stage1.5-Effectiveness-Revalidation-Brief-01/stage15-effectiveness-revalidation-brief.v1.json": "8470f7791d4baa3734df8d44375716c2ebcc4f28f01506b636c9b71e047c566a",
  "06_测试与验证/2026-07-15-Phase-Stage1.5-Effectiveness-Revalidation-Brief-01/generation-summary.stage15-effectiveness-revalidation-brief.v1.json": "88240226f2966ab87a85ace2760c69a8f3e0533f406757d9d0ee9bd81e5b9aed",
  "06_测试与验证/2026-07-16-Phase-Stage1.5-Effectiveness-Revalidation-A-02/stage15-effectiveness-revalidation-authorization.v1.json": "7f4758912c18270e11a7d9d693b8831f6c3a05257704f88b93a96846f3f76442",
  "06_测试与验证/2026-07-16-Phase-Stage1.5-Effectiveness-Revalidation-A-02/stage15-effectiveness-revalidation-run.v1.json": "aa4e52bda7dbb48041d536fb0be0a0c2efccff78b27438d1228a050925ca993f",
  "06_测试与验证/2026-07-16-Phase-Stage1.5-Effectiveness-Revalidation-A-02/generation-summary.stage15-effectiveness-revalidation.v1.json": "f928bf78578d204e96abc7f24654cbd928a240bccc7ae09014c61e8014216035",
} as const;

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "market-screening-manifest-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function validManifest(
  environment: "development" | "test" | "production" = "development",
  manifestId = "phase0-market-screening-frozen-20260717-01",
) {
  return {
    schemaVersion: "market-screening-batch-manifest.v1",
    batchMode: "frozen_validation_batch",
    manifestId,
    environment,
    identities: {
      briefId: "brief-1",
      collectionRunId: "run-1",
      sourceBatchIds: ["source-batch-1"],
      importBatchId: "batch-1",
      importPackageHash: "a".repeat(64),
      rankingRunId: "ranking-1",
      screeningHash: "b".repeat(64),
    },
    artifacts: [{
      key: "selectionBrief",
      requirementLevel: "upstream_required",
      groupId: "core",
      relativePath: "fixtures/upstream.json",
      fileSha256: "c".repeat(64),
      containerSchemaVersion: "human-assisted-amazon-run.v2",
      jsonPointer: "/sourceAdapter/pipeline/brief",
      artifactSchemaVersion: "selection-brief.v1",
      bindingAssertions: [{ jsonPointer: "/briefId", equals: "brief-1" }],
    }],
    imageAssetRoot: { relativePath: "fixtures/images" },
    sourcePolicy: {
      requiredSourceIds: ["human_assisted_amazon"],
      optionalSourceIds: [],
      minimumSuccessfulSourceCount: 1,
      minimumStage1InputCount: 20,
      allowStageOutputsWhenPartial: false,
    },
    expectedCounts: {
      acceptedUniqueProductCount: 20,
      stage1InputCount: 20,
      stage15: { advance: 5, watch: 11, reject: 3, insufficient: 1, total: 20 },
    },
    createdAt: "2026-07-17T00:00:00.000Z",
    frozenAt: "2026-07-17T00:00:00.000Z",
  };
}

function writeManifest(
  root: string,
  manifest = validManifest(),
  relativePath = FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH,
) {
  const manifestPath = resolve(root, relativePath);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, raw, "utf8");
  const sha = createHash("sha256").update(raw, "utf8").digest("hex");
  writeFileSync(
    manifestPath.replace(/\.json$/, ".sha256"),
    `${sha}  ${basename(manifestPath)}\n`,
    "utf8",
  );
  return manifestPath;
}

describe("loadMarketScreeningBatchManifest", () => {
  it("loads only the fixed development manifest and never selects a sibling latest", () => {
    const root = tempRoot();
    writeManifest(root);
    writeManifest(root, { ...validManifest(), manifestId: "latest-must-not-win" }, "latest/market-screening-batch-manifest.v1.json");

    const result = loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: root,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.manifest.manifestId).toBe("phase0-market-screening-frozen-20260717-01");
      expect(result.manifestPath).toBe(resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH));
    }
  });

  it("fails closed in production until a production batch is registered", () => {
    expect(loadMarketScreeningBatchManifest({
      environment: "production",
      projectMaterialsRoot: tempRoot(),
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_not_configured" });
  });

  it("loads only the exact production manifest pinned by the reviewed registration", () => {
    const root = tempRoot();
    const manifestId = "phase0-market-screening-production-20260717-01";
    const relativePath = "registered/market-screening-batch-manifest.v1.json";
    const manifestPath = writeManifest(root, validManifest("production", manifestId), relativePath);
    const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");

    const result = loadMarketScreeningBatchManifest({
      environment: "production",
      projectMaterialsRoot: root,
      productionRegistration: {
        registrationId: "production-registration-20260717-01",
        manifestId,
        manifestRelativePath: relativePath,
        manifestSha256,
      },
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.manifest.environment).toBe("production");
      expect(result.manifest.manifestId).toBe(manifestId);
      expect(result.manifestPath).toBe(manifestPath);
    }
  });

  it("fails closed when a production registration path, identity, or hash drifts", () => {
    const root = tempRoot();
    const manifestId = "phase0-market-screening-production-20260717-01";
    const relativePath = "registered/market-screening-batch-manifest.v1.json";
    const manifestPath = writeManifest(root, validManifest("production", manifestId), relativePath);
    const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
    const baseRegistration = {
      registrationId: "production-registration-20260717-01",
      manifestId,
      manifestRelativePath: relativePath,
      manifestSha256,
    };

    expect(loadMarketScreeningBatchManifest({
      environment: "production",
      projectMaterialsRoot: root,
      productionRegistration: { ...baseRegistration, manifestRelativePath: "../outside.json" },
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_path_invalid" });
    expect(loadMarketScreeningBatchManifest({
      environment: "production",
      projectMaterialsRoot: root,
      productionRegistration: { ...baseRegistration, manifestId: "wrong-manifest" },
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_schema_invalid" });
    expect(loadMarketScreeningBatchManifest({
      environment: "production",
      projectMaterialsRoot: root,
      productionRegistration: { ...baseRegistration, manifestSha256: "f".repeat(64) },
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_hash_mismatch" });
  });

  it("allows an explicit test manifest path only in test", () => {
    const root = tempRoot();
    const testPath = writeManifest(root, validManifest("test"), "fixtures/manifest.json");

    expect(loadMarketScreeningBatchManifest({
      environment: "test",
      projectMaterialsRoot: root,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_not_configured" });
    expect(loadMarketScreeningBatchManifest({
      environment: "test",
      projectMaterialsRoot: root,
      testManifestPath: testPath,
    }).status).toBe("ready");
    expect(loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: root,
      testManifestPath: testPath,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_path_invalid" });
  });

  it("returns deterministic missing, sidecar and hash errors", () => {
    const missingRoot = tempRoot();
    expect(loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: missingRoot,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_missing" });

    const sidecarRoot = tempRoot();
    const sidecarPath = writeManifest(sidecarRoot).replace(/\.json$/, ".sha256");
    writeFileSync(sidecarPath, "not-a-sidecar\n", "utf8");
    expect(loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: sidecarRoot,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_sidecar_invalid" });

    const hashRoot = tempRoot();
    const manifestPath = writeManifest(hashRoot);
    writeFileSync(manifestPath, `${JSON.stringify(validManifest())}\n`, "utf8");
    expect(loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: hashRoot,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_hash_mismatch" });
  });

  it.each([
    ["unknown requirement", () => ({
      ...validManifest(),
      artifacts: [{ ...validManifest().artifacts[0], requirementLevel: "required" }],
    })],
    ["invalid JSON pointer", () => ({
      ...validManifest(),
      artifacts: [{ ...validManifest().artifacts[0], jsonPointer: "sourceAdapter/pipeline" }],
    })],
    ["invalid artifact path", () => ({
      ...validManifest(),
      artifacts: [{ ...validManifest().artifacts[0], relativePath: "../outside.json" }],
    })],
    ["wrong schema", () => ({ ...validManifest(), schemaVersion: "market-screening-batch-manifest.v2" })],
    ["conflicting declarations for one container", () => ({
      ...validManifest(),
      artifacts: [
        validManifest().artifacts[0],
        {
          ...validManifest().artifacts[0],
          key: "collectionRun",
          fileSha256: "d".repeat(64),
          jsonPointer: "/sourceAdapter/pipeline/run",
          artifactSchemaVersion: "collection-run.v1",
        },
      ],
    })],
  ])("rejects schema-invalid content: %s", (_name, build) => {
    const root = tempRoot();
    writeManifest(root, build() as ReturnType<typeof validManifest>);
    expect(loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: root,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_schema_invalid" });
  });

  it("rejects explicit traversal and symlinked manifest paths", () => {
    const traversalRoot = tempRoot();
    expect(loadMarketScreeningBatchManifest({
      environment: "test",
      projectMaterialsRoot: traversalRoot,
      testManifestPath: "../outside.json",
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_path_invalid" });

    const symlinkRoot = tempRoot();
    const outside = tempRoot();
    writeManifest(outside, validManifest("test"), "manifest.json");
    const link = join(symlinkRoot, "linked");
    symlinkSync(outside, link, "junction");
    expect(loadMarketScreeningBatchManifest({
      environment: "test",
      projectMaterialsRoot: symlinkRoot,
      testManifestPath: join(link, "manifest.json"),
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_path_invalid" });
  });

  it("rejects an oversized manifest before parsing", () => {
    const root = tempRoot();
    const path = resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    const raw = " ".repeat(1_048_577);
    writeFileSync(path, raw, "utf8");
    const sha = createHash("sha256").update(raw).digest("hex");
    writeFileSync(path.replace(/\.json$/, ".sha256"), `${sha}  ${basename(path)}\n`, "utf8");

    expect(loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot: root,
    })).toEqual({ status: "unavailable", errorCode: "batch_manifest_schema_invalid" });
  });

  it("uses the existing canonical stable hash implementation for the real Stage 1 fixture", () => {
    const rawFixture = readProjectMaterial(
      "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-blind-review-material.v1.json",
    );
    const fixture = JSON.parse(rawFixture.toString("utf8"));

    expect(createHash("sha256").update(rawFixture).digest("hex"))
      .toBe("93bdb99a0551674b64b625040d99674f05a7df26c9ba1c5275b7e97c9cddafac");
    expect(stableHash(fixture)).toBe("1278022857dac6b2f0f2e81d8403c1c76bb985ba0c42c2fb054366d105b409c7");
  });

  it("loads the frozen real batch as a complete 18-artifact closure", () => {
    const projectMaterialsRoot = TEST_PROJECT_MATERIALS_ROOT;
    const result = loadMarketScreeningBatchManifest({
      environment: "development",
      projectMaterialsRoot,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.manifest.batchMode).toBe("frozen_validation_batch");
    expect(result.manifest.identities).toEqual({
      briefId: "brief-human-assisted-20260714103154",
      collectionRunId: "run-amazon-live-711cbbfc894b9a38d14081ba",
      sourceBatchIds: ["source-batch-4e6574b31b375cc2af96b971"],
      importBatchId: "batch-239c01df5d9eb963d4ef",
      importPackageHash: "cfa158f78cbd56c854ca35ae0d6241a2b9456735aaef7f5a21d776d41a1b005a",
      rankingRunId: "ranking-3e915b7638c43def68f22948",
      screeningHash: "edbdc1bd7e0fe9d5e394dbce90707411ceb77d36fad5150c679abf1a29b318c8",
    });
    expect(result.manifest.artifacts.map((artifact) => artifact.key).sort()).toEqual([
      "collectionRun",
      "detailAuthorization",
      "detailBrief",
      "detailBriefGenerationSummary",
      "detailGenerationSummary",
      "detailRun",
      "importPackage",
      "selectionBrief",
      "sourceAdapterResult",
      "stage15Acceptance",
      "stage15GenerationSummary",
      "stage15Run",
      "stage1BlindReviewMaterial",
      "stage1Ranking",
      "stage1Summary",
      "visualGenerationSummary",
      "visualPacket",
      "visualPresentationInput",
    ]);
    expect(result.manifest.sourcePolicy).toEqual({
      requiredSourceIds: ["human_assisted_amazon"],
      optionalSourceIds: [],
      minimumSuccessfulSourceCount: 1,
      minimumStage1InputCount: 20,
      allowStageOutputsWhenPartial: false,
    });
    expect(result.manifest.expectedCounts).toEqual({
      acceptedUniqueProductCount: 20,
      stage1InputCount: 20,
      stage15: { advance: 5, watch: 11, reject: 3, insufficient: 1, total: 20 },
    });

    expect(Object.fromEntries(result.manifest.artifacts.map((artifact) => [
      artifact.relativePath,
      artifact.fileSha256,
    ]))).toEqual(FROZEN_FILE_SHA256);

    for (const artifact of result.manifest.artifacts) {
      const actual = createHash("sha256")
        .update(readFileSync(resolve(projectMaterialsRoot, artifact.relativePath)))
        .digest("hex");
      expect(actual, artifact.key).toBe(artifact.fileSha256);
    }
  });
});
