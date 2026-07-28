import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH } from "@/lib/marketScreeningBatchManifest";
import { resolveProjectMaterialsRoot } from "@/lib/projectMaterialsRoot";

const roots: string[] = [];

function tempRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function createRecognizedMaterialsRoot() {
  const root = tempRoot("project-materials-ready-");
  const manifestPath = resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, "{}\n", "utf8");
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("resolveProjectMaterialsRoot", () => {
  it("accepts an explicitly configured, recognized project materials root", () => {
    const projectMaterialsRoot = createRecognizedMaterialsRoot();

    expect(resolveProjectMaterialsRoot({
      configuredRoot: projectMaterialsRoot,
      cwd: tempRoot("project-materials-cwd-"),
    })).toEqual({
      status: "ready",
      projectMaterialsRoot,
      source: "runtime_config",
    });
  });

  it("fails closed with a deterministic error when project materials are unavailable", () => {
    const cwd = tempRoot("project-materials-missing-");

    expect(resolveProjectMaterialsRoot({ configuredRoot: null, cwd })).toEqual({
      status: "unavailable",
      errorCode: "project_materials_root_unavailable",
    });
  });

  it("rejects an explicitly configured unknown external directory", () => {
    const unknownExternalRoot = tempRoot("project-materials-unknown-");

    expect(resolveProjectMaterialsRoot({
      configuredRoot: unknownExternalRoot,
      cwd: tempRoot("project-materials-fallback-must-not-run-"),
    })).toEqual({
      status: "unavailable",
      errorCode: "project_materials_root_unavailable",
    });
  });

  it("turns an unavailable root into a deterministic blocked batch", () => {
    expect(loadMarketScreeningBatch({
      environment: "development",
      projectMaterialsRoot: null,
    })).toMatchObject({
      status: "blocked",
      errorCode: "project_materials_root_unavailable",
      batchReadiness: {
        status: "blocked",
        reasonCodes: ["manifest_invalid"],
      },
    });
  });
});
