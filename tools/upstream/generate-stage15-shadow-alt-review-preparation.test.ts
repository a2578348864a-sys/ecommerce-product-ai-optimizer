import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { generateStage15ShadowAltReviewPreparation } from "./generate-stage15-shadow-alt-review-preparation";
import {
  fixtureBatchC,
  fixtureQueries,
  fixtureRegistryEntries,
  hashEveryTopLevelFile,
} from "./stage15-shadow-alt-review-test-fixtures";

const temporaryDirectories: string[] = [];

function batchFixture() {
  const directory = fixtureBatchC();
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Stage 1.5 alternative review preparation generator", () => {
  it("writes one immutable preparation set after verifying every existing top-level artifact", () => {
    const root = batchFixture();
    const before = hashEveryTopLevelFile(root);

    const first = generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    });
    const second = generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    });

    expect(first.write.written.length).toBeGreaterThan(0);
    expect(second.write.unchanged).toEqual(first.files);
    expect(hashEveryTopLevelFile(root)).toEqual(before);
    expect(first.readiness).toMatchObject({
      status: "pending_user_access_approval",
      executionAllowed: false,
      humanEvaluationAllowed: false,
      batchVUnlocked: false,
    });
    expect(first.files).toHaveLength(10);
  });

  it("fails before writing when a Manifest artifact drifts", () => {
    const root = batchFixture();
    writeFileSync(join(root, "selection-brief.v1.json"), "{\"tampered\":true}\n", "utf8");

    expect(() => generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_UPSTREAM_HASH_DRIFT:selection-brief.v1.json");
  });

  it("requires the frozen login-wall stop state even when its internal Hash is recomputed", () => {
    const root = batchFixture();
    const path = join(root, "stage15-shadow-detail-access-preflight.v1.json");
    const preflight = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete preflight.preflightHash;
    preflight.status = "ready";
    preflight.executionAllowed = true;
    writeFileSync(path, `${JSON.stringify({ ...preflight, preflightHash: stableHash(preflight) }, null, 2)}\n`, "utf8");

    expect(() => generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_DETAIL_STOP_INVALID");
  });

  it("does not overwrite a conflicting preparation directory", () => {
    const root = batchFixture();
    generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    });
    writeFileSync(
      join(root, "alternative-review-probe-v1", "preparation", "stage15-shadow-alt-review-readiness.v1.json"),
      "{\"tampered\":true}\n",
      "utf8",
    );

    expect(() => generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    })).toThrow("STAGE15_SHADOW_ALT_REVIEW_PREPARATION_CONFLICT:preparation");
  });

  it("requires the complete frozen Manifest artifact set", () => {
    const root = batchFixture();
    const path = join(root, "stage15-shadow-upstream-manifest.v1.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete manifest.manifestHash;
    manifest.artifacts = (manifest.artifacts as Array<{ relativePath: string }>)
      .filter((artifact) => artifact.relativePath !== "human-evaluation-form.md");
    writeFileSync(path, `${JSON.stringify({ ...manifest, manifestHash: stableHash(manifest) }, null, 2)}\n`, "utf8");

    expect(() => generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_MANIFEST_ARTIFACT_SET_INVALID");
  });

  it("rejects Manifest artifact paths that are not top-level filenames", () => {
    const root = batchFixture();
    const path = join(root, "stage15-shadow-upstream-manifest.v1.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete manifest.manifestHash;
    const artifacts = manifest.artifacts as Array<Record<string, unknown>>;
    artifacts[0] = { ...artifacts[0], relativePath: "..\\escape.json" };
    writeFileSync(path, `${JSON.stringify({ ...manifest, manifestHash: stableHash(manifest) }, null, 2)}\n`, "utf8");

    expect(() => generateStage15ShadowAltReviewPreparation({
      batchDirectory: root,
      registryEntries: fixtureRegistryEntries,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_MANIFEST_ARTIFACT_PATH_INVALID");
  });
});
