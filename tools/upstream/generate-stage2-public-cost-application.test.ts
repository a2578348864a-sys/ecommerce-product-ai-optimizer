import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2PublicCostApplication } from "./generate-stage2-public-cost-application";

const PROJECT = resolve(process.cwd(), "..");

function input(outputDirectory: string) {
  const research = join(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01");
  const requestFile = join(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Review-01/stage2-public-cost-review-request.v1.json");
  const request = JSON.parse(readFileSync(requestFile, "utf8"));
  return {
    inventoryFile: join(PROJECT, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
    submissionFile: join(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-submission.partial.v1.json"),
    briefFile: join(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json"),
    runFile: join(research, "stage2-public-cost-research-run.v1.json"),
    evidenceFile: join(research, "stage2-public-cost-evidence.v1.json"),
    evidenceValidationFile: join(research, "stage2-public-cost-evidence-validation.v1.json"),
    derivationPreviewFile: join(research, "stage2-public-cost-derivation-preview.v1.json"),
    patchPreviewFile: join(research, "stage2-public-cost-submission-patch.preview.v1.json"),
    requestFile,
    confirmationText: request.exactConfirmationText as string,
    decidedAt: "2026-07-15T18:40:00+08:00",
    appliedAt: "2026-07-15T18:41:00+08:00",
    outputDirectory,
  };
}

describe("Stage 2 public-cost application artifact generator", () => {
  it("writes a decision and BOM-only versioned outputs without mutating the source submission", () => {
    const output = mkdtempSync(join(tmpdir(), "stage2-public-cost-application-"));
    const first = generateStage2PublicCostApplication(input(output));
    const second = generateStage2PublicCostApplication(input(output));

    expect(first.files).toHaveLength(6);
    expect(first.artifactWrite.written).toHaveLength(6);
    expect(second.artifactWrite.unchanged).toHaveLength(6);
    expect(first.application.status).toBe("provisional_bom_applied_locally");
    expect(first.validation).toMatchObject({
      status: "incomplete",
      summary: { readyForCalibrationCount: 0, profitInsufficientEvidenceCount: 7 },
    });
    expect(first.calibration.status).toBe("profit_insufficient_evidence");
    expect(first.submission.samples.find((sample) => sample.sampleId === "stage2-high-01")?.fields.bom.value).toBe(2.73);
  });

  it("rejects any confirmation text that does not exactly match the request", () => {
    const output = mkdtempSync(join(tmpdir(), "stage2-public-cost-application-invalid-"));
    const values = input(output);
    values.confirmationText += " ";
    expect(() => generateStage2PublicCostApplication(values))
      .toThrow("STAGE2_PUBLIC_COST_REVIEW_TEXT_MISMATCH");
  });
});
