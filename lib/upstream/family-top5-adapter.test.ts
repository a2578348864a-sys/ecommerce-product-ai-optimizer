import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFamilyTop5Loader,
  FAMILY_TOP5_TRUSTED_MANIFEST_SHA256,
} from "@/lib/upstream/family-top5-adapter";

const SOURCE_DIR = resolve(process.cwd(), "lib/upstream/fixtures");
const MANIFEST_FILE = "family-top5-review-manifest.v1.json";
const FILES = [
  MANIFEST_FILE,
  `${MANIFEST_FILE}.sha256`,
  "family-top5-review.v1.json",
  "family-top5-review.v1.json.sha256",
  "family-top5-provenance.v1.json",
  "family-top5-provenance.v1.json.sha256",
  "family-top5-human-review-schema.v1.json",
  "family-top5-human-review-schema.v1.json.sha256",
] as const;

const temporaryDirectories: string[] = [];

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeSidecar(path: string): void {
  writeFileSync(`${path}.sha256`, `${sha256(path)}  ${basename(path)}\n`, "utf8");
}

function fixtureCopy(): string {
  const directory = mkdtempSync(join(tmpdir(), "family-top5-adapter-"));
  temporaryDirectories.push(directory);
  for (const file of FILES) copyFileSync(join(SOURCE_DIR, file), join(directory, file));
  return directory;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function refreshArtifact(directory: string, file: string): string {
  const artifactPath = join(directory, file);
  writeSidecar(artifactPath);
  const manifestPath = join(directory, MANIFEST_FILE);
  const manifest = readJson(manifestPath);
  const entries = manifest.artifacts as Array<Record<string, unknown>>;
  const entry = entries.find((candidate) => candidate.path === file);
  if (!entry) throw new Error("test_fixture_entry_missing");
  entry.bytes = statSync(artifactPath).size;
  entry.sha256 = sha256(artifactPath);
  writeJson(manifestPath, manifest);
  writeSidecar(manifestPath);
  return sha256(manifestPath);
}

function load(directory: string, trustedManifestSha256 = sha256(join(directory, MANIFEST_FILE))) {
  return createFamilyTop5Loader({ fixtureDir: directory, trustedManifestSha256 })();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Family Top 5 audited fixture adapter", () => {
  it("returns ready only for the committed manifest, sidecars, fixture and provenance", () => {
    const result = createFamilyTop5Loader({
      fixtureDir: SOURCE_DIR,
      trustedManifestSha256: FAMILY_TOP5_TRUSTED_MANIFEST_SHA256,
    })();
    expect(result.readiness).toBe("ready");
    expect(result.data?.topFamilies).toHaveLength(5);
    expect(result.data?.remainingFamilies).toHaveLength(17);
    expect(result.sourceArtifactBinding).toMatchObject({
      sourceArtifactId: "2026-07-21-Provider-Aware-Family-Top5-Review-07",
      appManifestSha256: FAMILY_TOP5_TRUSTED_MANIFEST_SHA256,
      familyDataSha256: "8c8f27543c98084e54dc560ba38c1d4ca02b9fcb231e315c1f055b6fe3037d6e",
    });
  });

  it("fails closed when the manifest references the obsolete data filename", () => {
    const directory = fixtureCopy();
    const manifestPath = join(directory, MANIFEST_FILE);
    const manifest = readJson(manifestPath);
    (manifest.artifacts as Array<Record<string, unknown>>)[0].path = "investigation-product-family-data.v1.json";
    writeJson(manifestPath, manifest);
    writeSidecar(manifestPath);
    expect(load(directory).readiness).not.toBe("ready");
  });

  it("reports artifact_missing when the trusted manifest sidecar is absent", () => {
    const directory = fixtureCopy();
    unlinkSync(join(directory, `${MANIFEST_FILE}.sha256`));
    expect(load(directory).readiness).toBe("artifact_missing");
  });

  it("reports artifact_integrity_failed for a bad manifest hash", () => {
    const directory = fixtureCopy();
    writeFileSync(join(directory, `${MANIFEST_FILE}.sha256`), `${"0".repeat(64)}  ${MANIFEST_FILE}\n`);
    expect(load(directory).readiness).toBe("artifact_integrity_failed");
  });

  it("reports artifact_integrity_failed for changed fixture bytes", () => {
    const directory = fixtureCopy();
    writeFileSync(join(directory, "family-top5-review.v1.json"), "{}\n", "utf8");
    expect(load(directory).readiness).toBe("artifact_integrity_failed");
  });

  it("reports provenance_invalid when a required provenance field is absent", () => {
    const directory = fixtureCopy();
    const path = join(directory, "family-top5-provenance.v1.json");
    const provenance = readJson(path);
    delete (provenance.probe as Record<string, unknown>).probeCommit;
    writeJson(path, provenance);
    const trustedHash = refreshArtifact(directory, "family-top5-provenance.v1.json");
    expect(load(directory, trustedHash).readiness).toBe("provenance_invalid");
  });

  it("rejects a different probe inputHash", () => {
    const directory = fixtureCopy();
    const path = join(directory, "family-top5-provenance.v1.json");
    const provenance = readJson(path);
    (provenance.probe as Record<string, unknown>).inputHash = "1".repeat(64);
    writeJson(path, provenance);
    expect(load(directory, refreshArtifact(directory, "family-top5-provenance.v1.json")).readiness).toBe("provenance_invalid");
  });

  it("rejects a different probe runBindingHash", () => {
    const directory = fixtureCopy();
    const path = join(directory, "family-top5-provenance.v1.json");
    const provenance = readJson(path);
    (provenance.probe as Record<string, unknown>).runBindingHash = "2".repeat(64);
    writeJson(path, provenance);
    expect(load(directory, refreshArtifact(directory, "family-top5-provenance.v1.json")).readiness).toBe("provenance_invalid");
  });

  it("rejects different Provider-aware v2 input and content hashes", () => {
    const directory = fixtureCopy();
    const path = join(directory, "family-top5-provenance.v1.json");
    const provenance = readJson(path);
    const v2 = provenance.providerAwareV2 as Record<string, unknown>;
    v2.inputHash = "3".repeat(64);
    v2.contentHash = "4".repeat(64);
    writeJson(path, provenance);
    expect(load(directory, refreshArtifact(directory, "family-top5-provenance.v1.json")).readiness).toBe("provenance_invalid");
  });

  it("reports schema_unsupported for an unsupported fixture schema", () => {
    const directory = fixtureCopy();
    const path = join(directory, "family-top5-review.v1.json");
    const data = readJson(path);
    data.schemaVersion = "investigation-product-family-data.v2";
    writeJson(path, data);
    expect(load(directory, refreshArtifact(directory, "family-top5-review.v1.json")).readiness).toBe("schema_unsupported");
  });

  it("rejects a coherently rehashed artifact from another source batch", () => {
    const directory = fixtureCopy();
    const path = join(directory, "family-top5-provenance.v1.json");
    const provenance = readJson(path);
    (provenance.appFixture as Record<string, unknown>).sourceArtifactId = "another-batch";
    (provenance.probe as Record<string, unknown>).artifactId = "another-probe";
    writeJson(path, provenance);
    const manifestPath = join(directory, MANIFEST_FILE);
    const trustedHash = refreshArtifact(directory, "family-top5-provenance.v1.json");
    const manifest = readJson(manifestPath);
    manifest.sourceArtifactId = "another-batch";
    writeJson(manifestPath, manifest);
    writeSidecar(manifestPath);
    expect(load(directory, sha256(manifestPath)).readiness).toBe("provenance_invalid");
    expect(trustedHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
