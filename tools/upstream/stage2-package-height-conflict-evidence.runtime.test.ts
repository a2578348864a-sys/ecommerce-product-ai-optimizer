import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2PackageHeightConflictEvidence } from "./stage2-package-height-conflict-evidence";

const project = process.env.STAGE2_PACKAGE_HEIGHT_PROJECT;

describe("Stage 2 package-height conflict evidence runtime generator", () => {
  it.runIf(Boolean(project))("writes the new screenshot observation without applying a height", () => {
    const result = generateStage2PackageHeightConflictEvidence({
      request: JSON.parse(readFileSync(join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Remaining-Evidence-01/stage2-remaining-evidence-request.v1.json"), "utf8")),
      submission: JSON.parse(readFileSync(join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01/stage2-evidence-submission.public-cost-applied.v1.json"), "utf8")),
      receivedAt: "2026-07-15T18:51:13+08:00",
      sourceImageSha256: "a511cbd9d40eeac971cd8cfbdb175a88ddb56f8a65ff7c2c2f91d9c5c507ea5c",
      tableVariantText: "灰色六层",
      currentSelectorText: "米色六层",
      packageLengthCm: 31,
      packageWidthCm: 31,
      packageHeightCm: 3.5,
      packageVolumeCm3: 3363.5,
      packageWeightKg: 0.58,
      existingObservedHeightsCm: [3.5, 3.8],
      outputDirectory: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Conflict-Evidence-01"),
    });
    expect(result.evidence.status).toBe("valid_counterevidence_not_applied");
    expect(result.evidence.conflictAssessment.packageHeightCmApplied).toBeNull();
  });
});
