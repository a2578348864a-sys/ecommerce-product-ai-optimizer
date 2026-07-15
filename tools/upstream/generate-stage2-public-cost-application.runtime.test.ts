import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2PublicCostApplication } from "./generate-stage2-public-cost-application";

const project = process.env.STAGE2_PUBLIC_COST_APPLICATION_PROJECT;
const confirmationText = process.env.STAGE2_PUBLIC_COST_APPLICATION_CONFIRMATION;
const decidedAt = process.env.STAGE2_PUBLIC_COST_APPLICATION_DECIDED_AT;
const appliedAt = process.env.STAGE2_PUBLIC_COST_APPLICATION_APPLIED_AT;

describe("Stage 2 public-cost application runtime generator", () => {
  it.runIf(Boolean(project && confirmationText && decidedAt && appliedAt))(
    "writes the reviewed provisional BOM application package",
    () => {
      const research = join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01");
      const result = generateStage2PublicCostApplication({
        inventoryFile: join(project!, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
        submissionFile: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-submission.partial.v1.json"),
        briefFile: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json"),
        runFile: join(research, "stage2-public-cost-research-run.v1.json"),
        evidenceFile: join(research, "stage2-public-cost-evidence.v1.json"),
        evidenceValidationFile: join(research, "stage2-public-cost-evidence-validation.v1.json"),
        derivationPreviewFile: join(research, "stage2-public-cost-derivation-preview.v1.json"),
        patchPreviewFile: join(research, "stage2-public-cost-submission-patch.preview.v1.json"),
        requestFile: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Review-01/stage2-public-cost-review-request.v1.json"),
        confirmationText: confirmationText!,
        decidedAt: decidedAt!,
        appliedAt: appliedAt!,
        outputDirectory: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01"),
      });

      expect(result.decisionValidation.status).toBe("valid_accepted_not_applied");
      expect(result.application.status).toBe("provisional_bom_applied_locally");
      expect(result.validation.status).toBe("incomplete");
      expect(result.validation.summary.readyForCalibrationCount).toBe(0);
      expect(result.calibration.status).toBe("profit_insufficient_evidence");
    },
  );
});
