import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2PackageHeightConfirmation } from "./stage2-package-height-confirmation";
import type { Stage2EvidenceGapInventory, Stage2EvidenceSubmission } from "./stage2-evidence-intake";
import type { Stage2PackageHeightConflictEvidence } from "./stage2-package-height-confirmation";
import { readFileSync } from "node:fs";

const project = process.env.STAGE2_PACKAGE_HEIGHT_CONFIRMATION_PROJECT;
const confirmedAt = process.env.STAGE2_PACKAGE_HEIGHT_CONFIRMATION_CONFIRMED_AT;
const confirmationText = process.env.STAGE2_PACKAGE_HEIGHT_CONFIRMATION_TEXT;

describe("Stage 2 package-height confirmation runtime generator", () => {
  it.runIf(Boolean(project && confirmedAt && confirmationText))(
    "writes the project-owner-confirmed 3.5 cm successor package",
    () => {
      const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
      const result = generateStage2PackageHeightConfirmation({
        inventory: read<Stage2EvidenceGapInventory>(join(project!, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json")),
        submission: read<Stage2EvidenceSubmission>(join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01/stage2-evidence-submission.public-cost-applied.v1.json")),
        conflictEvidence: read<Stage2PackageHeightConflictEvidence>(join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Conflict-Evidence-01/stage2-package-height-conflict-evidence.v1.json")),
        confirmationText: confirmationText!,
        confirmedAt: confirmedAt!,
        outputDirectory: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Confirmation-01"),
      });

      expect(result.application.status).toBe("package_height_manual_confirmation_applied_locally");
      expect(result.submission.samples[0].fields.packageHeightCm.value).toBe(3.5);
      expect(result.request.missingFields).not.toContain("packageHeightCm");
      expect(result.validation.status).toBe("incomplete");
      expect(result.calibration.status).toBe("profit_insufficient_evidence");
    },
  );
});
