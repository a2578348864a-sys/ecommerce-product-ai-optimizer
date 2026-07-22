import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStage2NextEvidenceHandoff,
  generateStage2NextEvidenceHandoff,
  type Stage2NextEvidenceHandoffInput,
} from "./stage2-next-evidence-handoff";

const PROJECT = TEST_PROJECT_MATERIALS_ROOT;
const read = <T>(relative: string) => JSON.parse(readFileSync(join(PROJECT, relative), "utf8")) as T;

function input(): Stage2NextEvidenceHandoffInput {
  return {
    inventory: read("06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
    submission: read("06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Confirmation-01/stage2-evidence-submission.package-height-applied.v1.json"),
    validation: read("06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Confirmation-01/stage2-evidence-validation.package-height-applied.v1.json"),
    request: read("06_测试与验证/2026-07-15-Phase-Stage2-Remaining-Evidence-03/stage2-remaining-evidence-request.v1.json"),
    createdAt: "2026-07-15T19:30:00+08:00",
  };
}

describe("Stage 2 next-evidence handoff", () => {
  it("prefills only confirmed facts and separates Amazon fees from freight evidence", () => {
    const handoff = buildStage2NextEvidenceHandoff(input());

    expect(handoff).toMatchObject({
      status: "pending_manual_evidence_capture",
      target: { sampleId: "stage2-high-01", productKey: "amazon:US:B07SYPLVTG", asin: "B07SYPLVTG" },
      knownInputs: {
        salePriceUsd: 15.98,
        provisionalBomUsdPerItem: 2.73,
        packageMetric: { lengthCm: 31, widthCm: 31, heightCm: 3.5, weightKg: 0.58 },
        packageImperialDiagnostic: { lengthIn: 12.2, widthIn: 12.2, heightIn: 1.38, weightLb: 1.28, weightOz: 20.46 },
      },
      tracks: [
        { trackId: "amazon_fee_evidence", requestedFields: ["platformCommission", "fba"] },
        { trackId: "first_mile_quote", requestedFields: ["firstMile", "logisticsEvidenceUrl"] },
      ],
      boundary: {
        doesNotCalculateAmazonFees: true,
        doesNotCalculateProfit: true,
        doesNotMutateSubmission: true,
      },
    });
    expect(handoff.remainingLaterFields).toEqual([
      "supplierCapturedAt",
      "packaging",
      "storage",
      "returnReserve",
      "complianceEvidenceUrl",
    ]);
  });

  it("writes an idempotent machine packet and beginner instructions", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-next-evidence-handoff-"));
    const first = generateStage2NextEvidenceHandoff({ ...input(), outputDirectory });
    const second = generateStage2NextEvidenceHandoff({ ...input(), outputDirectory });

    expect(first.artifactWrite.written).toHaveLength(3);
    expect(second.artifactWrite.unchanged).toHaveLength(3);
    const readme = readFileSync(join(outputDirectory, "README-醒来后只做这两步.md"), "utf8");
    expect(readme).toContain("你不需要计算");
    expect(readme).toContain("B07SYPLVTG");
    expect(readme).toContain("31 × 31 × 3.5 cm");
  });

  it("fails closed when the request no longer binds to the validation", () => {
    const values = input();
    values.request.sourceValidationHash = "0".repeat(64);
    expect(() => buildStage2NextEvidenceHandoff(values))
      .toThrow("STAGE2_NEXT_EVIDENCE_HANDOFF_SOURCE_INVALID");
  });
});
