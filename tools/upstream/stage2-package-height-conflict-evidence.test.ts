import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStage2PackageHeightConflictEvidence,
  generateStage2PackageHeightConflictEvidence,
  type Stage2PackageHeightConflictInput,
} from "./stage2-package-height-conflict-evidence";

const PROJECT = resolve(process.cwd(), "..");
const read = <T>(relative: string) => JSON.parse(readFileSync(join(PROJECT, relative), "utf8")) as T;

function input(): Stage2PackageHeightConflictInput {
  return {
    request: read<Stage2PackageHeightConflictInput["request"]>("06_测试与验证/2026-07-15-Phase-Stage2-Remaining-Evidence-01/stage2-remaining-evidence-request.v1.json"),
    submission: read<Stage2PackageHeightConflictInput["submission"]>("06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01/stage2-evidence-submission.public-cost-applied.v1.json"),
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
  };
}

describe("Stage 2 package-height conflict evidence", () => {
  it("preserves the new structured-table observation without resolving the 3.5/3.8 conflict", () => {
    const values = input();
    const original = structuredClone(values.submission);
    const evidence = buildStage2PackageHeightConflictEvidence(values);

    expect(values.submission).toEqual(original);
    expect(evidence).toMatchObject({
      status: "valid_counterevidence_not_applied",
      observation: {
        tableVariantText: "灰色六层",
        currentSelectorText: "米色六层",
        packageHeightCm: 3.5,
      },
      conflictAssessment: {
        status: "conflict_confirmed_not_resolved",
        packageHeightCmApplied: null,
      },
      boundary: { submissionMutated: false, fbaCalculationAllowed: false },
    });
    expect(evidence.reasonCodes).toEqual([
      "structured_table_supports_3_5",
      "earlier_product_image_supports_3_8",
      "current_selector_is_beige_six_layer",
      "supplier_confirmation_absent",
    ]);
  });

  it("writes an idempotent evidence JSON without copying the screenshot", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-package-height-conflict-"));
    const first = generateStage2PackageHeightConflictEvidence({ ...input(), outputDirectory });
    const second = generateStage2PackageHeightConflictEvidence({ ...input(), outputDirectory });
    expect(first.files).toEqual(["stage2-package-height-conflict-evidence.v1.json", "README-包装高度仍冲突.md"]);
    expect(first.artifactWrite.written).toHaveLength(2);
    expect(second.artifactWrite.unchanged).toHaveLength(2);
    expect(readFileSync(join(outputDirectory, first.files[0]), "utf8")).not.toContain("AppData");
  });

  it("fails closed if the evidence request is tampered", () => {
    const values = input();
    values.request.missingFields = [];
    expect(() => buildStage2PackageHeightConflictEvidence(values))
      .toThrow("STAGE2_PACKAGE_HEIGHT_EVIDENCE_SOURCE_INVALID");
  });
});
