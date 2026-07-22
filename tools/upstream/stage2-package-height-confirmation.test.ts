import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStage2RemainingEvidenceRequest } from "./stage2-remaining-evidence-request";
import {
  applyStage2PackageHeightConfirmation,
  buildStage2PackageHeightConfirmationDecision,
  generateStage2PackageHeightConfirmation,
  type Stage2PackageHeightConfirmationInput,
} from "./stage2-package-height-confirmation";

const PROJECT = TEST_PROJECT_MATERIALS_ROOT;
const read = <T>(relative: string) => JSON.parse(readFileSync(join(PROJECT, relative), "utf8")) as T;

function input(): Stage2PackageHeightConfirmationInput {
  return {
    inventory: read("06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
    submission: read("06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01/stage2-evidence-submission.public-cost-applied.v1.json"),
    conflictEvidence: read("06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Conflict-Evidence-01/stage2-package-height-conflict-evidence.v1.json"),
    confirmationText: "是3.5cm",
    confirmedAt: "2026-07-15T19:15:00+08:00",
  };
}

describe("Stage 2 package-height confirmation", () => {
  it("applies only the project owner's 3.5 cm manual working value and preserves counterevidence", () => {
    const values = input();
    const original = structuredClone(values.submission);
    const decision = buildStage2PackageHeightConfirmationDecision(values);
    const result = applyStage2PackageHeightConfirmation({ ...values, decision });

    expect(values.submission).toEqual(original);
    expect(decision).toMatchObject({
      status: "accepted_manual_working_value_not_supplier_confirmation",
      confirmedValueCm: 3.5,
      supplierConfirmed: false,
    });
    expect(result.submission.samples[0].fields.packageHeightCm).toMatchObject({
      value: 3.5,
      missingReason: null,
      evidence: { sourceType: "manual", sourceUrl: null },
    });
    expect(result.submission.samples[0].fields.firstMile.value).toBeNull();
    expect(result.submission.samples[0].fields.fba.value).toBeNull();
    expect(result.application).toMatchObject({
      status: "package_height_manual_confirmation_applied_locally",
      appliedField: { field: "packageHeightCm", value: 3.5, unit: "cm" },
      derivedDiagnostics: { packageVolumeCm3: 3363.5 },
      boundary: {
        originalConflictEvidencePreserved: true,
        supplierConfirmationClaimed: false,
        fbaCalculated: false,
      },
    });
    expect(result.validation.status).toBe("incomplete");
    expect(result.calibration.status).toBe("profit_insufficient_evidence");
  });

  it("regenerates a nine-field request without asking the user to choose the resolved height again", () => {
    const values = input();
    const decision = buildStage2PackageHeightConfirmationDecision(values);
    const applied = applyStage2PackageHeightConfirmation({ ...values, decision });
    const request = buildStage2RemainingEvidenceRequest({
      application: applied.application,
      validation: applied.validation,
      createdAt: "2026-07-15T19:15:00+08:00",
    });

    expect(request.missingFields).toHaveLength(9);
    expect(request.missingFields).not.toContain("packageHeightCm");
    expect(request.hardRules).not.toContain("do_not_choose_conflicting_package_height_by_guess");
    expect(request.target.acceptedProvisionalBomUsd).toBe(2.73);
    expect(request.evidenceGroups[0]).toMatchObject({
      groupId: "supplier_variant_confirmation",
      fields: ["supplierCapturedAt"],
    });
  });

  it("fails closed for a different value or tampered conflict evidence", () => {
    const wrongValue = input();
    wrongValue.confirmationText = "是3.8cm";
    expect(() => buildStage2PackageHeightConfirmationDecision(wrongValue))
      .toThrow("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_TEXT_INVALID");

    const tampered = input();
    tampered.conflictEvidence.observation.packageHeightCm = 3.8;
    expect(() => buildStage2PackageHeightConfirmationDecision(tampered))
      .toThrow("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_SOURCE_INVALID");
  });

  it("writes the successor evidence package idempotently without overwriting source artifacts", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-package-height-confirmation-"));
    const first = generateStage2PackageHeightConfirmation({ ...input(), outputDirectory });
    const second = generateStage2PackageHeightConfirmation({ ...input(), outputDirectory });

    expect(first.files).toHaveLength(8);
    expect(first.artifactWrite.written).toHaveLength(8);
    expect(second.artifactWrite.unchanged).toHaveLength(8);
    expect(JSON.parse(readFileSync(join(outputDirectory, "stage2-remaining-evidence-request.v1.json"), "utf8")))
      .toMatchObject({ missingFields: expect.not.arrayContaining(["packageHeightCm"]) });
  });
});
