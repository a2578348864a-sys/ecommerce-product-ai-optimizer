import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectMaterialPath } from "../../tests/helpers/project-materials";
import { generatePhase2AcceptanceReport } from "./generate-phase2-acceptance-report";

const SOURCE_FILE = projectMaterialPath(
  "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/human-assisted-amazon-run.v2.json",
);
const temporaryDirectories: string[] = [];

afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("Phase 2 acceptance report generator", () => {
  it("generates a protected report from Canary 15 without writing a formal Candidate", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "phase2-acceptance-"));
    temporaryDirectories.push(outputDirectory);
    const input = {
      sourceFile: SOURCE_FILE,
      evaluatedAt: "2026-07-14T14:42:00.000Z",
      outputDirectory,
    };

    const first = generatePhase2AcceptanceReport(input);
    const report = JSON.parse(readFileSync(join(outputDirectory, "phase2-acceptance-report.v1.json"), "utf8"));

    expect(first.status).toBe("passed");
    expect(report.status).toBe("passed");
    expect(report.counts).toEqual({
      rawObservationCount: 20,
      uniqueProductCount: 20,
      quarantinedCount: 0,
      importPreviewCandidateCount: 20,
    });
    expect(report.criteria.formalCandidateNotGenerated).toBe(true);
    expect(report.criteria.productionDatabaseNotWritten).toBe(true);
    expect(report.excludedProof).toContain("database_transaction");

    const replay = generatePhase2AcceptanceReport(input);
    expect(replay.artifactWrite).toEqual({ written: [], unchanged: first.files });

    writeFileSync(join(outputDirectory, first.files[0]), "conflict\n", "utf8");
    expect(() => generatePhase2AcceptanceReport(input)).toThrow("PHASE2_ACCEPTANCE_OUTPUT_CONFLICT");
  });
});
