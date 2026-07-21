// ═══ Family Top 5 Data Adapter — Read-only fixture loader ═══

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ProductFamilyReviewDataV1, DataReadiness,
} from "@/lib/upstream/family-top5-types";
import { FAMILY_TOP5_SCHEMA_VERSION } from "@/lib/upstream/family-top5-types";

const FIXTURE_DIR = resolve(process.cwd(), "lib/upstream/fixtures");
const DATA_FILE = "family-top5-review.v1.json";
const MANIFEST_FILE = "family-top5-review-manifest.v1.json";
const SCHEMA_FILE = "family-review-response-schema.v1.json"; // not used at load time

interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

interface Manifest {
  schemaVersion: string;
  codeBaseline: { commit: string; tree: string; branch: string };
  artifacts: ManifestEntry[];
}

let cached: { data: ProductFamilyReviewDataV1 | null; readiness: DataReadiness; error?: string } | null = null;

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function loadManifest(): { manifest: Manifest | null; readiness: DataReadiness; error?: string } {
  const manifestPath = resolve(FIXTURE_DIR, MANIFEST_FILE);
  const sidecarPath = manifestPath + ".sha256";
  try {
    const manifestRaw = readFileSync(manifestPath, "utf8");
    const sidecarRaw = readFileSync(sidecarPath, "utf8");
    const expectedHash = sidecarRaw.split(/\s+/)[0];
    const actualHash = sha256File(manifestPath);
    if (expectedHash !== actualHash) {
      return { manifest: null, readiness: "artifact_integrity_failed", error: "manifest.sha256 mismatch" };
    }
    const manifest = JSON.parse(manifestRaw) as Manifest;
    return { manifest, readiness: "ready" };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { manifest: null, readiness: "artifact_missing", error: "manifest file missing" };
    }
    return { manifest: null, readiness: "artifact_integrity_failed", error: (e as Error).message };
  }
}

function validateDataFile(manifest: Manifest): { readiness: DataReadiness; error?: string } {
  const dataEntry = manifest.artifacts.find(a => a.path === DATA_FILE);
  if (!dataEntry) return { readiness: "artifact_missing", error: "data file not in manifest" };
  const dataPath = resolve(FIXTURE_DIR, DATA_FILE);
  try {
    const actualHash = sha256File(dataPath);
    if (actualHash !== dataEntry.sha256) {
      return { readiness: "artifact_integrity_failed", error: "data sha256 mismatch" };
    }
    return { readiness: "ready" };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { readiness: "artifact_missing", error: "data file missing" };
    }
    return { readiness: "artifact_integrity_failed", error: (e as Error).message };
  }
}

export function loadFamilyTop5Data(): { data: ProductFamilyReviewDataV1 | null; readiness: DataReadiness; error?: string } {
  if (cached) return cached;

  const { manifest, readiness: mReadiness, error: mError } = loadManifest();
  if (!manifest) {
    cached = { data: null, readiness: mReadiness, error: mError };
    return cached;
  }

  const { readiness: dReadiness, error: dError } = validateDataFile(manifest);
  if (dReadiness !== "ready") {
    cached = { data: null, readiness: dReadiness, error: dError };
    return cached;
  }

  const dataPath = resolve(FIXTURE_DIR, DATA_FILE);
  const data = JSON.parse(readFileSync(dataPath, "utf8")) as ProductFamilyReviewDataV1;

  if (data.schemaVersion !== FAMILY_TOP5_SCHEMA_VERSION) {
    cached = { data: null, readiness: "schema_unsupported", error: "expected " + FAMILY_TOP5_SCHEMA_VERSION + " got " + (data as unknown as Record<string, unknown>).schemaVersion };
    return cached;
  }

  cached = { data, readiness: "ready" };
  return cached;
}

export function getCachedFamilyTop5Data() {
  return cached?.data ?? null;
}
