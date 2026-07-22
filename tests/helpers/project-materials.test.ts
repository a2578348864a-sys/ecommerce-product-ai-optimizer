import { chdir, cwd } from "node:process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  projectMaterialPath,
  readProjectMaterial,
  repositoryPath,
  TEST_PROJECT_MATERIALS_ROOT,
} from "./project-materials";

const KNOWN_FIXTURE =
  "06_测试与验证/2026-07-15-Phase-Stage2-Next-Evidence-Handoff-02/stage2-next-evidence-handoff.v1.json";

describe("portable project material resolver", () => {
  it("resolves versioned fixtures independently from the current working directory", () => {
    const original = cwd();
    try {
      chdir(tmpdir());
      expect(projectMaterialPath(KNOWN_FIXTURE)).toContain(TEST_PROJECT_MATERIALS_ROOT);
      expect(readProjectMaterial(KNOWN_FIXTURE).byteLength).toBeGreaterThan(0);
      expect(repositoryPath("tools/upstream/fixtures/stage2-global-sources-discovery-r1.v1.json"))
        .toContain("stage2-global-sources-discovery-r1.v1.json");
    } finally {
      chdir(original);
    }
  });

  it("fails closed for absolute paths, traversal, missing fixtures and hash drift", () => {
    expect(() => projectMaterialPath("C:/outside.json")).toThrow("TEST_PROJECT_MATERIAL_PATH_INVALID");
    expect(() => projectMaterialPath("../outside.json")).toThrow("TEST_PROJECT_MATERIAL_PATH_INVALID");
    expect(() => projectMaterialPath("06_测试与验证/missing.json")).toThrow("TEST_PROJECT_MATERIAL_MISSING");
    expect(() => readProjectMaterial(KNOWN_FIXTURE, "0".repeat(64)))
      .toThrow("TEST_PROJECT_MATERIAL_HASH_MISMATCH");
  });
});
