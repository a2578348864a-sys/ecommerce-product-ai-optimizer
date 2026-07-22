import { TEST_PROJECT_MATERIALS_ROOT } from "../tests/helpers/project-materials";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH,
  loadMarketScreeningBatchManifest,
  type MarketScreeningBatchManifest,
} from "@/lib/marketScreeningBatchManifest";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

const authoritativeProjectRoot = TEST_PROJECT_MATERIALS_ROOT;
const temporaryRoots: string[] = [];

function loadManifest(root = authoritativeProjectRoot): MarketScreeningBatchManifest {
  const result = loadMarketScreeningBatchManifest({
    environment: "development",
    projectMaterialsRoot: root,
  });
  if (result.status !== "ready") throw new Error(result.errorCode);
  return result.manifest;
}

function copyRelative(sourceRoot: string, targetRoot: string, relativePath: string) {
  const source = resolve(sourceRoot, relativePath);
  const target = resolve(targetRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function makeFixtureRoot() {
  const root = mkdtempSync(resolve(tmpdir(), "stage15-preview-"));
  temporaryRoots.push(root);
  const manifest = loadManifest();
  copyRelative(authoritativeProjectRoot, root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH);
  copyRelative(
    authoritativeProjectRoot,
    root,
    FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH.replace(/\.json$/u, ".sha256"),
  );
  for (const relativePath of new Set(manifest.artifacts.map((artifact) => artifact.relativePath))) {
    copyRelative(authoritativeProjectRoot, root, relativePath);
  }
  copyRelative(authoritativeProjectRoot, root, manifest.imageAssetRoot.relativePath);
  return { root, manifest };
}

function options(projectMaterialsRoot: string) {
  return { environment: "development" as const, projectMaterialsRoot };
}

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function availableImageRelativePath(root: string) {
  const batch = loadMarketScreeningBatch(options(root));
  if (batch.status !== "ready") throw new Error(batch.status);
  const packet = batch.batch.artifacts.visualPacket;
  if (!packet || !Array.isArray(packet.items)) throw new Error("visual packet unavailable");
  for (const value of packet.items) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const image = value.image;
    if (typeof image !== "object" || image === null || Array.isArray(image)) continue;
    const localAsset = image.localAsset;
    if (typeof localAsset !== "object" || localAsset === null || Array.isArray(localAsset)) continue;
    if (localAsset.status === "available" && typeof localAsset.relativePath === "string") {
      return localAsset.relativePath;
    }
  }
  throw new Error("available image unavailable");
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("loadStage15ScreeningPreview", () => {
  it("does not select cwd or a latest batch when no explicit environment and root are supplied", () => {
    expect(loadStage15ScreeningPreview()).toEqual({
      status: "unavailable",
      errorCode: "preview_artifact_missing",
    });
  });

  it("loads the frozen manifest batch and only embeds verified local images", () => {
    const result = loadStage15ScreeningPreview(options(authoritativeProjectRoot));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.preview.items).toHaveLength(20);
    expect(result.preview.items.filter((item) => item.image.status === "available")).toHaveLength(11);
    expect(result.preview.items.filter((item) => item.image.status === "image_not_cached")).toHaveLength(9);
    expect(result.preview.items.some((item) => item.image.dataUrl?.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(JSON.stringify(result.preview)).not.toContain("m.media-amazon.com");
  });

  it("is read-only for every declared artifact and the image asset root", () => {
    const manifest = loadManifest();
    const artifactPaths = [...new Set(manifest.artifacts.map((artifact) => artifact.relativePath))];
    const before = new Map(
      artifactPaths.map((relativePath) => [
        relativePath,
        fileSha256(resolve(authoritativeProjectRoot, relativePath)),
      ]),
    );
    const imagePath = resolve(
      authoritativeProjectRoot,
      manifest.imageAssetRoot.relativePath,
      availableImageRelativePath(authoritativeProjectRoot),
    );
    const imageBefore = fileSha256(imagePath);

    expect(loadStage15ScreeningPreview(options(authoritativeProjectRoot)).status).toBe("ready");

    for (const [relativePath, hash] of before) {
      expect(fileSha256(resolve(authoritativeProjectRoot, relativePath))).toBe(hash);
    }
    expect(fileSha256(imagePath)).toBe(imageBefore);
  });

  it("keeps the batch renderable when one cached image fails byte integrity", () => {
    const { root, manifest } = makeFixtureRoot();
    const imagePath = resolve(root, manifest.imageAssetRoot.relativePath, availableImageRelativePath(root));
    writeFileSync(imagePath, Buffer.from("not-an-image", "utf8"));

    const result = loadStage15ScreeningPreview(options(root));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.preview.items.filter((item) => item.image.status === "image_integrity_failed")).toHaveLength(1);
  });

  it("fails closed when a required Stage 1.5 artifact is missing", () => {
    const { root, manifest } = makeFixtureRoot();
    const acceptance = manifest.artifacts.find((artifact) => artifact.key === "stage15Acceptance");
    if (!acceptance) throw new Error("stage15Acceptance ref unavailable");
    unlinkSync(resolve(root, acceptance.relativePath));

    expect(loadStage15ScreeningPreview(options(root))).toEqual({
      status: "unavailable",
      errorCode: "preview_artifact_missing",
    });
  });

  it("maps a tampered presentation artifact to a deterministic hash-binding error", () => {
    const { root, manifest } = makeFixtureRoot();
    const packet = manifest.artifacts.find((artifact) => artifact.key === "visualPacket");
    if (!packet) throw new Error("visualPacket ref unavailable");
    const packetPath = resolve(root, packet.relativePath);
    expect(existsSync(packetPath)).toBe(true);
    writeFileSync(packetPath, Buffer.concat([readFileSync(packetPath), Buffer.from("\n")]));

    expect(loadStage15ScreeningPreview(options(root))).toEqual({
      status: "unavailable",
      errorCode: "preview_hash_binding_invalid",
    });
  });
});
