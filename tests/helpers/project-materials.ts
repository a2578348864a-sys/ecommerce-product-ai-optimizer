import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const TEST_REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
export const TEST_PROJECT_MATERIALS_ROOT = resolve(
  TEST_REPOSITORY_ROOT,
  "tests/fixtures/project-materials",
);

function resolveInside(root: string, logicalPath: string, kind: string) {
  if (!logicalPath || isAbsolute(logicalPath)) {
    throw new Error(`${kind}_PATH_INVALID`);
  }

  const resolved = resolve(root, logicalPath);
  const relativePath = relative(root, resolved);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${kind}_PATH_INVALID`);
  }
  return resolved;
}

export function projectMaterialPath(logicalPath: string) {
  const path = resolveInside(TEST_PROJECT_MATERIALS_ROOT, logicalPath, "TEST_PROJECT_MATERIAL");
  if (!existsSync(path)) throw new Error("TEST_PROJECT_MATERIAL_MISSING");
  return path;
}

export function repositoryPath(logicalPath: string) {
  const path = resolveInside(TEST_REPOSITORY_ROOT, logicalPath, "TEST_REPOSITORY_FILE");
  if (!existsSync(path)) throw new Error("TEST_REPOSITORY_FILE_MISSING");
  return path;
}

export function readProjectMaterial(logicalPath: string, expectedSha256?: string) {
  const bytes = readFileSync(projectMaterialPath(logicalPath));
  if (expectedSha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha256) throw new Error("TEST_PROJECT_MATERIAL_HASH_MISMATCH");
  }
  return bytes;
}
