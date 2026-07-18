import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  loadMarketScreeningBatch,
  type MarketScreeningBatchErrorCode,
} from "@/lib/marketScreeningBatchLoader";
import type {
  MarketScreeningEnvironment,
  ProductionBatchRegistration,
} from "@/lib/marketScreeningBatchManifest";
import {
  buildStage15ScreeningPreview,
  Stage15ScreeningPreviewError,
  type Stage15PreviewImageInput,
  type Stage15ScreeningPreviewView,
} from "@/lib/stage15ScreeningPreview";

export type Stage15ScreeningPreviewLoadErrorCode =
  | "preview_artifact_missing"
  | "preview_schema_invalid"
  | "preview_hash_binding_invalid"
  | "preview_partition_invalid"
  | "preview_visual_binding_invalid"
  | "preview_product_identity_conflict";

export type Stage15ScreeningPreviewLoadResult =
  | { status: "ready"; preview: Stage15ScreeningPreviewView }
  | { status: "unavailable"; errorCode: Stage15ScreeningPreviewLoadErrorCode };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

class LoaderError extends Error {
  readonly code: Stage15ScreeningPreviewLoadErrorCode;

  constructor(code: Stage15ScreeningPreviewLoadErrorCode) {
    super(code);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, target: string) {
  const relativeTarget = relative(root, target);
  return relativeTarget !== ".."
    && !relativeTarget.startsWith(`..${sep}`)
    && !isAbsolute(relativeTarget);
}

function resolveFixedDirectory(projectRoot: string, relativePath: string) {
  const target = resolve(projectRoot, relativePath);
  if (!isWithin(projectRoot, target)) throw new LoaderError("preview_visual_binding_invalid");
  try {
    const actual = realpathSync(target);
    if (!isWithin(projectRoot, actual) || !statSync(actual).isDirectory()) {
      throw new LoaderError("preview_visual_binding_invalid");
    }
    return actual;
  } catch (error) {
    if (error instanceof LoaderError) throw error;
    throw new LoaderError("preview_artifact_missing");
  }
}

function localAssetFor(item: Record<string, unknown>) {
  const image = item.image;
  if (!isRecord(image) || !isRecord(image.localAsset) || typeof item.blindItemId !== "string") {
    throw new LoaderError("preview_schema_invalid");
  }
  return { blindItemId: item.blindItemId, asset: image.localAsset };
}

function rawSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function imageMime(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) return "image/png";
  return null;
}

function integrityFailure(): Stage15PreviewImageInput {
  return { status: "image_integrity_failed", dataUrl: null, reason: "image_integrity_failed" };
}

function loadImage(assetRoot: string, asset: Record<string, unknown>): Stage15PreviewImageInput {
  if (asset.status === "not_cached") {
    if (asset.relativePath !== null
      || asset.contentSha256 !== null
      || asset.bytes !== null
      || typeof asset.missingReason !== "string") {
      throw new LoaderError("preview_schema_invalid");
    }
    return { status: "image_not_cached", dataUrl: null, reason: "image_not_cached" };
  }
  if (asset.status !== "available"
    || typeof asset.relativePath !== "string"
    || isAbsolute(asset.relativePath)
    || typeof asset.contentSha256 !== "string"
    || !/^[a-f\d]{64}$/iu.test(asset.contentSha256)
    || typeof asset.bytes !== "number"
    || !Number.isInteger(asset.bytes)
    || asset.bytes <= 0
    || asset.missingReason !== null) {
    throw new LoaderError("preview_schema_invalid");
  }

  const target = resolve(assetRoot, asset.relativePath);
  if (!isWithin(assetRoot, target)) throw new LoaderError("preview_visual_binding_invalid");
  try {
    if (lstatSync(target).isSymbolicLink()) throw new LoaderError("preview_visual_binding_invalid");
    const actual = realpathSync(target);
    if (!isWithin(assetRoot, actual)) throw new LoaderError("preview_visual_binding_invalid");
    const stat = statSync(actual);
    if (!stat.isFile() || stat.size !== asset.bytes || stat.size > MAX_IMAGE_BYTES) return integrityFailure();
    const bytes = readFileSync(actual);
    const mime = imageMime(bytes);
    if (!mime || rawSha256(bytes) !== asset.contentSha256.toLowerCase()) return integrityFailure();
    return { status: "available", dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, reason: null };
  } catch (error) {
    if (error instanceof LoaderError) throw error;
    return integrityFailure();
  }
}

function mapBatchError(code: MarketScreeningBatchErrorCode): Stage15ScreeningPreviewLoadErrorCode {
  if (code === "artifact_path_invalid" || code === "batch_manifest_path_invalid") {
    return "preview_visual_binding_invalid";
  }
  if (code === "artifact_schema_invalid" || code === "batch_manifest_schema_invalid") {
    return "preview_schema_invalid";
  }
  if (code === "artifact_hash_mismatch"
    || code === "artifact_identity_conflict"
    || code === "batch_manifest_hash_mismatch"
    || code === "batch_manifest_sidecar_invalid") {
    return "preview_hash_binding_invalid";
  }
  return "preview_artifact_missing";
}

export function loadStage15ScreeningPreview(options?: {
  environment: MarketScreeningEnvironment;
  projectMaterialsRoot: string;
  testManifestPath?: string;
  productionRegistration?: ProductionBatchRegistration;
}): Stage15ScreeningPreviewLoadResult {
  if (!options) return { status: "unavailable", errorCode: "preview_artifact_missing" };
  try {
    const batchResult = loadMarketScreeningBatch(options);
    if (batchResult.status === "blocked") {
      return { status: "unavailable", errorCode: mapBatchError(batchResult.errorCode) };
    }
    if (batchResult.status === "upstream_only") {
      return { status: "unavailable", errorCode: "preview_artifact_missing" };
    }
    const { batch } = batchResult;
    const screeningRun = batch.artifacts.stage15Run;
    const acceptance = batch.artifacts.stage15Acceptance;
    const generationSummary = batch.artifacts.stage15GenerationSummary;
    const visualPacket = batch.artifacts.visualPacket;
    if (!screeningRun || !acceptance || !generationSummary || !visualPacket || !Array.isArray(visualPacket.items)) {
      throw new LoaderError("preview_schema_invalid");
    }

    const projectRoot = realpathSync(resolve(options.projectMaterialsRoot));
    const assetRoot = resolveFixedDirectory(projectRoot, batch.manifest.imageAssetRoot.relativePath);
    const localImages: Record<string, Stage15PreviewImageInput> = {};
    for (const value of visualPacket.items) {
      if (!isRecord(value)) throw new LoaderError("preview_schema_invalid");
      const { blindItemId, asset } = localAssetFor(value);
      if (blindItemId in localImages) throw new LoaderError("preview_visual_binding_invalid");
      localImages[blindItemId] = loadImage(assetRoot, asset);
    }
    return {
      status: "ready",
      preview: buildStage15ScreeningPreview({
        screeningRun,
        acceptance,
        generationSummary,
        visualPacket,
        localImages,
      }),
    };
  } catch (error) {
    if (error instanceof LoaderError || error instanceof Stage15ScreeningPreviewError) {
      return { status: "unavailable", errorCode: error.code };
    }
    return { status: "unavailable", errorCode: "preview_schema_invalid" };
  }
}
