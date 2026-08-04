import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Import Boundary Test
 *
 * Ensures that production contract modules (productCreativeHandoff.ts,
 * productCreativeHandoffSchema.ts, productCreativeHandoffStatus.ts,
 * productCreativeHandoffProjection.ts, productCreativeHandoffFingerprint)
 * do NOT import ajv or ajv-formats.
 *
 * These libraries must only be used by test files.
 */

const LIB_DIR = path.resolve(__dirname);
const PRODUCTION_FILES = [
  "productCreativeHandoff.ts",
  "productCreativeHandoffSchema.ts",
  "productCreativeHandoffStatus.ts",
  "productCreativeHandoffProjection.ts",
];

describe("production import boundary", () => {
  it("production contract modules never import ajv", () => {
    for (const file of PRODUCTION_FILES) {
      const content = fs.readFileSync(path.join(LIB_DIR, file), "utf-8");
      const lines = content.split("\n");

      const ajvImport = lines.find(
        (line) =>
          (line.startsWith("import") || line.startsWith("require")) &&
          (line.includes("ajv") || line.includes("ajv-formats"))
      );

      if (ajvImport) {
        // Fail with clear diagnostic
        expect(`${file}: ${ajvImport.trim()}`).toBe(
          `${file}: no ajv import allowed`
        );
      }
    }
    // If we got here, no ajv imports found
    expect(true).toBe(true);
  });

  it("ajv and ajv-formats are only imported by test files", () => {
    const allLibFiles = fs.readdirSync(LIB_DIR).filter((f) => f.endsWith(".ts"));
    const testFiles = allLibFiles.filter((f) => f.includes(".test."));
    const nonTestFiles = allLibFiles.filter((f) => !f.includes(".test."));

    for (const file of nonTestFiles) {
      const content = fs.readFileSync(path.join(LIB_DIR, file), "utf-8");
      const hasAjv =
        content.includes("from 'ajv") ||
        content.includes('from "ajv') ||
        content.includes("require('ajv") ||
        content.includes('require("ajv');
      const hasAjvFormats =
        content.includes("from 'ajv-formats") ||
        content.includes('from "ajv-formats') ||
        content.includes("require('ajv-formats") ||
        content.includes('require("ajv-formats');

      if (hasAjv || hasAjvFormats) {
        expect(`${file}: contains ajv import`).toBe(
          `${file}: no ajv import allowed in non-test files`
        );
      }
    }

    // Verify test files DO import ajv (sanity check)
    const parityTest = testFiles.find((f) => f.includes("SchemaParity"));
    if (parityTest) {
      const content = fs.readFileSync(path.join(LIB_DIR, parityTest), "utf-8");
      expect(content).toMatch(/ajv\/dist\/2020/);
      expect(content).toMatch(/ajv-formats/);
    }
  });
});
