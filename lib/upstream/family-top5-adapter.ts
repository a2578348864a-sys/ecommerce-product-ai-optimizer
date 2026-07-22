import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  FAMILY_TOP5_MANIFEST_SCHEMA_VERSION,
  FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION,
  FAMILY_TOP5_SCHEMA_VERSION,
  type DataReadiness,
  type FamilyTop5ProvenanceV1,
  type ProductFamilyReviewDataV1,
  type SourceArtifactBinding,
} from "@/lib/upstream/family-top5-types";

const FIXTURE_DIR = resolve(process.cwd(), "lib/upstream/fixtures");
const MANIFEST_FILE = "family-top5-review-manifest.v1.json";
const DATA_FILE = "family-top5-review.v1.json";
const PROVENANCE_FILE = "family-top5-provenance.v1.json";
const REVIEW_SCHEMA_FILE = "family-top5-human-review-schema.v1.json";

export const FAMILY_TOP5_TRUSTED_MANIFEST_SHA256 =
  "8e7dda3a182f7bdd1afd52d50a6437a633ec0c1be7100d9fd851f14ddc43dc6e";

const EXPECTED_ARTIFACTS = [DATA_FILE, PROVENANCE_FILE, REVIEW_SCHEMA_FILE] as const;

interface ManifestEntry {
  path: string;
  sidecarPath: string;
  bytes: number;
  sha256: string;
}

interface Manifest {
  schemaVersion: string;
  provenanceSchemaVersion: string;
  sourceArtifactId: string;
  codeBaseline: { commit: string; tree: string; branch: string };
  artifacts: ManifestEntry[];
}

export interface FamilyTop5LoadResult {
  data: ProductFamilyReviewDataV1 | null;
  provenance: FamilyTop5ProvenanceV1 | null;
  sourceArtifactBinding: SourceArtifactBinding | null;
  readiness: DataReadiness;
  error?: string;
}

interface LoaderOptions {
  fixtureDir: string;
  trustedManifestSha256: string;
}

const EXPECTED_PROVENANCE: FamilyTop5ProvenanceV1 = {
  schemaVersion: FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION,
  probe: {
    probeCommit: "157b7536a0634c9151a45b75bcd6642ccc90faa0",
    probeTree: "5f632bbde5934d2cd8e3ccb3f92ffd45af7aaf4c",
    artifactId: "Provider-Capability-Probe-Real-157b753-06",
    inputHash: "ae00aa98457399478aae6a8bcc1d30b6eb213776061465bd7d4748c8b21ebb4c",
    runBindingHash: "c3bebbb9c00626ee44afbd14ebd3cfd02ef0ae8c5a32cd87a38e38067753aa61",
    fixturePath: "Provider-Capability-Probe-Real-157b753-06/fixtures/page-1.json",
    fixtureSha256: "767a7e4c720c25489945af0736941b80cce3d2162e7635b4d6e98b4475a78f7e",
    manifestSha256: "2475e6cfe2d9f10cf2e4429fb44b7af6207e122eca1004a77db458c2448605c6",
  },
  providerAwareV2: {
    version: "provider-aware-market-screening.v2",
    inputHash: "a8950d22210978bd39b7c83e25d55b02c26a126d33f892248e4e287bf63d5328",
    contentHash: "35d5527f69ecf7c82354eae4736a55932853b4693211b9afdce3e6d1c7065b5a",
    sourceProbeInputHash: "ae00aa98457399478aae6a8bcc1d30b6eb213776061465bd7d4748c8b21ebb4c",
    sourceFixtureSha256: "767a7e4c720c25489945af0736941b80cce3d2162e7635b4d6e98b4475a78f7e",
  },
  familyPackage: {
    familyGrouperVersion: "provider-product-family-grouper.v1",
    sourceV2InputHash: "a8950d22210978bd39b7c83e25d55b02c26a126d33f892248e4e287bf63d5328",
    sourceV2ContentHash: "35d5527f69ecf7c82354eae4736a55932853b4693211b9afdce3e6d1c7065b5a",
    familyDataSha256: "8c8f27543c98084e54dc560ba38c1d4ca02b9fcb231e315c1f055b6fe3037d6e",
    familyManifestSha256: "22659991089c5b0c9e274d0f97d85a56eff324186e7ed0b23417a245e2543928",
    generatedHtmlSha256: "d55b8da9fc56e94427948484ee49369ff507fcb443a477b4a67aac207d86ee68",
    familyCount: 22,
    topFamilyCount: 5,
    remainingFamilyCount: 17,
  },
  appFixture: {
    sourceArtifactId: "2026-07-21-Provider-Aware-Family-Top5-Review-07",
    copiedFromPath:
      "06_测试与验证/2026-07-21-Provider-Aware-Family-Top5-Review-07/investigation-product-family-data.v1.json",
    sourceSha256: "8c8f27543c98084e54dc560ba38c1d4ca02b9fcb231e315c1f055b6fe3037d6e",
    localFixtureSha256: "8c8f27543c98084e54dc560ba38c1d4ca02b9fcb231e315c1f055b6fe3037d6e",
    provenanceSchemaVersion: FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION,
  },
};

function fail(readiness: DataReadiness, error: string): FamilyTop5LoadResult {
  return { data: null, provenance: null, sourceArtifactBinding: null, readiness, error };
}

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSidecar(path: string, expectedFileName: string): string | null {
  const value = readFileSync(path, "utf8");
  const match = /^([a-f0-9]{64}) {2}([^\r\n]+)\r?\n?$/u.exec(value);
  return match && match[2] === expectedFileName ? match[1] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(value: unknown): Manifest | null {
  if (!isRecord(value) || !isRecord(value.codeBaseline) || !Array.isArray(value.artifacts)) return null;
  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.provenanceSchemaVersion !== "string" ||
    typeof value.sourceArtifactId !== "string"
  ) return null;
  const { codeBaseline } = value;
  if (
    typeof codeBaseline.commit !== "string" ||
    typeof codeBaseline.tree !== "string" ||
    typeof codeBaseline.branch !== "string"
  ) return null;
  const artifacts: ManifestEntry[] = [];
  for (const artifact of value.artifacts) {
    if (
      !isRecord(artifact) ||
      typeof artifact.path !== "string" ||
      typeof artifact.sidecarPath !== "string" ||
      typeof artifact.bytes !== "number" ||
      typeof artifact.sha256 !== "string"
    ) return null;
    artifacts.push({
      path: artifact.path,
      sidecarPath: artifact.sidecarPath,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    });
  }
  return {
    schemaVersion: value.schemaVersion,
    provenanceSchemaVersion: value.provenanceSchemaVersion,
    sourceArtifactId: value.sourceArtifactId,
    codeBaseline: {
      commit: codeBaseline.commit,
      tree: codeBaseline.tree,
      branch: codeBaseline.branch,
    },
    artifacts,
  };
}

function validateManifestArtifacts(manifest: Manifest): boolean {
  if (manifest.artifacts.length !== EXPECTED_ARTIFACTS.length) return false;
  const paths = manifest.artifacts.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) return false;
  return EXPECTED_ARTIFACTS.every((path) => {
    const entry = manifest.artifacts.find((candidate) => candidate.path === path);
    return entry?.sidecarPath === `${path}.sha256` && /^[a-f0-9]{64}$/u.test(entry.sha256);
  });
}

function validateDataShape(data: ProductFamilyReviewDataV1, provenance: FamilyTop5ProvenanceV1): boolean {
  const familyIds = [...data.topFamilies, ...data.remainingFamilies].map((family) => family.familyId);
  return (
    data.listingCount === 23 &&
    data.familyCount === provenance.familyPackage.familyCount &&
    data.topFamilyCount === provenance.familyPackage.topFamilyCount &&
    data.remainingFamilyCount === provenance.familyPackage.remainingFamilyCount &&
    data.topFamilies.length === 5 &&
    data.remainingFamilies.length === 17 &&
    familyIds.length === 22 &&
    new Set(familyIds).size === familyIds.length &&
    data.familyGrouperVersion === provenance.familyPackage.familyGrouperVersion
  );
}

export function createFamilyTop5Loader(options: LoaderOptions): () => FamilyTop5LoadResult {
  return () => {
    const manifestPath = resolve(options.fixtureDir, MANIFEST_FILE);
    let manifestHash: string;
    let manifest: Manifest | null;
    try {
      const manifestBytes = readFileSync(manifestPath);
      manifestHash = sha256Bytes(manifestBytes);
      const sidecarHash = readSidecar(`${manifestPath}.sha256`, MANIFEST_FILE);
      if (sidecarHash !== manifestHash || manifestHash !== options.trustedManifestSha256) {
        return fail("artifact_integrity_failed", "manifest_integrity_failed");
      }
      manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
    } catch (error) {
      return fail(
        (error as NodeJS.ErrnoException).code === "ENOENT" ? "artifact_missing" : "artifact_integrity_failed",
        "manifest_unavailable",
      );
    }

    if (!manifest) return fail("artifact_integrity_failed", "manifest_invalid");
    if (
      manifest.schemaVersion !== FAMILY_TOP5_MANIFEST_SCHEMA_VERSION ||
      manifest.provenanceSchemaVersion !== FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION
    ) return fail("schema_unsupported", "schema_unsupported");
    if (!validateManifestArtifacts(manifest)) return fail("artifact_missing", "artifact_set_invalid");

    const verified = new Map<string, string>();
    for (const expectedPath of EXPECTED_ARTIFACTS) {
      const entry = manifest.artifacts.find((artifact) => artifact.path === expectedPath);
      if (!entry) return fail("artifact_missing", "artifact_set_invalid");
      const artifactPath = resolve(options.fixtureDir, expectedPath);
      try {
        const sidecarHash = readSidecar(resolve(options.fixtureDir, entry.sidecarPath), expectedPath);
        const actualHash = sha256Bytes(readFileSync(artifactPath));
        if (sidecarHash !== entry.sha256 || actualHash !== entry.sha256 || statSync(artifactPath).size !== entry.bytes) {
          return fail("artifact_integrity_failed", "artifact_integrity_failed");
        }
        verified.set(expectedPath, actualHash);
      } catch (error) {
        return fail(
          (error as NodeJS.ErrnoException).code === "ENOENT" ? "artifact_missing" : "artifact_integrity_failed",
          "artifact_unavailable",
        );
      }
    }

    let data: ProductFamilyReviewDataV1;
    let provenance: FamilyTop5ProvenanceV1;
    try {
      data = readJson(resolve(options.fixtureDir, DATA_FILE)) as ProductFamilyReviewDataV1;
      provenance = readJson(resolve(options.fixtureDir, PROVENANCE_FILE)) as FamilyTop5ProvenanceV1;
    } catch {
      return fail("artifact_integrity_failed", "artifact_json_invalid");
    }

    if (data.schemaVersion !== FAMILY_TOP5_SCHEMA_VERSION) return fail("schema_unsupported", "schema_unsupported");
    if (provenance.schemaVersion !== FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION) {
      return fail("schema_unsupported", "schema_unsupported");
    }
    if (!isDeepStrictEqual(provenance, EXPECTED_PROVENANCE)) {
      return fail("provenance_invalid", "provenance_invalid");
    }
    const dataHash = verified.get(DATA_FILE);
    if (
      !dataHash ||
      !isDeepStrictEqual(manifest.codeBaseline, data.codeBaseline) ||
      manifest.codeBaseline.commit !== "21f30cee168bccc8956b55de3f361df08ad5d9c9" ||
      manifest.codeBaseline.tree !== "56cb678c849621f211148b4725e8df19a0d6aa15" ||
      manifest.codeBaseline.branch !== "codex/pipeline-provider-probe-v1" ||
      provenance.providerAwareV2.sourceProbeInputHash !== provenance.probe.inputHash ||
      provenance.providerAwareV2.sourceFixtureSha256 !== provenance.probe.fixtureSha256 ||
      provenance.familyPackage.sourceV2InputHash !== provenance.providerAwareV2.inputHash ||
      provenance.familyPackage.sourceV2ContentHash !== provenance.providerAwareV2.contentHash ||
      provenance.familyPackage.familyDataSha256 !== dataHash ||
      provenance.appFixture.sourceSha256 !== dataHash ||
      provenance.appFixture.localFixtureSha256 !== dataHash ||
      provenance.appFixture.provenanceSchemaVersion !== provenance.schemaVersion ||
      manifest.sourceArtifactId !== provenance.appFixture.sourceArtifactId ||
      !validateDataShape(data, provenance)
    ) return fail("provenance_invalid", "provenance_invalid");

    const sourceArtifactBinding: SourceArtifactBinding = {
      sourceArtifactId: provenance.appFixture.sourceArtifactId,
      probeInputHash: provenance.probe.inputHash,
      probeRunBindingHash: provenance.probe.runBindingHash,
      providerAwareV2InputHash: provenance.providerAwareV2.inputHash,
      providerAwareV2ContentHash: provenance.providerAwareV2.contentHash,
      familyDataSha256: provenance.familyPackage.familyDataSha256,
      familyManifestSha256: provenance.familyPackage.familyManifestSha256,
      appManifestSha256: manifestHash,
      provenanceSha256: verified.get(PROVENANCE_FILE) ?? "",
    };
    return { data, provenance, sourceArtifactBinding, readiness: "ready" };
  };
}

const loadDefaultFamilyTop5Data = createFamilyTop5Loader({
  fixtureDir: FIXTURE_DIR,
  trustedManifestSha256: FAMILY_TOP5_TRUSTED_MANIFEST_SHA256,
});

export function loadFamilyTop5Data(): FamilyTop5LoadResult {
  return loadDefaultFamilyTop5Data();
}
