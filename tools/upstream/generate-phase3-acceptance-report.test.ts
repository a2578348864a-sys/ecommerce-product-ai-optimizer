import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePhase3AcceptanceReport } from "./generate-phase3-acceptance-report";

const ROOT = resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证");
const temporaryDirectories: string[] = [];

afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function input(outputDirectory: string) {
  return {
    stage1SummaryFile: resolve(ROOT, "2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-offline-run-summary.v1.json"),
    responsesFile: resolve(ROOT, "2026-07-14-Phase-Stage1-Solo-Validation-01/01-新手盲评-先填写/novice-blind-review-responses.v1.json"),
    comparisonFile: resolve(ROOT, "2026-07-14-Phase-Stage1-Solo-Validation-01/03-盲评对照/novice-stage1-comparison.v1.json"),
    candidatePreviewFile: resolve(ROOT, "2026-07-14-Phase-Stage1-Solo-Validation-01/07-Stage2人工决定与Candidate预览/candidate-advancement-preview.blocked.v1.json"),
    evaluatedAt: "2026-07-14T14:48:00.000Z",
    outputDirectory,
  };
}

describe("Phase 3 acceptance report generator", () => {
  it("writes a protected Stage 1 and blind-review acceptance package", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "phase3-acceptance-"));
    temporaryDirectories.push(outputDirectory);
    const first = generatePhase3AcceptanceReport(input(outputDirectory));
    const report = JSON.parse(readFileSync(join(outputDirectory, "phase3-acceptance-report.v1.json"), "utf8"));

    expect(first.status).toBe("passed");
    expect(report.validationConclusion).toBe("limited_scope_reduction_not_business_validated");
    expect(report.counts.completedBlindReviewAnswers).toBe(20);
    expect(report.counts.formalCandidateCount).toBe(0);
    expect(report.businessValidationProven).toBe(false);

    const replay = generatePhase3AcceptanceReport(input(outputDirectory));
    expect(replay.artifactWrite).toEqual({ written: [], unchanged: first.files });

    writeFileSync(join(outputDirectory, first.files[0]), "conflict\n", "utf8");
    expect(() => generatePhase3AcceptanceReport(input(outputDirectory))).toThrow("PHASE3_ACCEPTANCE_OUTPUT_CONFLICT");
  });
});
