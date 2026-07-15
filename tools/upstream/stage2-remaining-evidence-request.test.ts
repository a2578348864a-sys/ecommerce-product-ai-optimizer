import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStage2RemainingEvidenceRequest } from "./stage2-remaining-evidence-request";

const ROOT = resolve(process.cwd(), "../06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01");
const read = (name: string) => JSON.parse(readFileSync(resolve(ROOT, name), "utf8"));

describe("Stage 2 remaining evidence request", () => {
  it("binds the current application and groups only real missing fields", () => {
    const request = buildStage2RemainingEvidenceRequest({
      application: read("stage2-public-cost-application-result.v1.json"),
      validation: read("stage2-evidence-validation.public-cost-applied.v1.json"),
      createdAt: "2026-07-15T18:45:00+08:00",
    });

    expect(request).toMatchObject({
      status: "pending_user_evidence",
      target: { sampleId: "stage2-high-01", acceptedProvisionalBomUsd: 2.73 },
      boundary: { unknownValuesRemainNull: true, profitMayNotBeCalculated: true },
    });
    expect(request.missingFields).toEqual([
      "supplierCapturedAt", "packageHeightCm", "firstMile", "logisticsEvidenceUrl",
      "platformCommission", "fba", "packaging", "storage", "returnReserve", "complianceEvidenceUrl",
    ]);
    expect(request.evidenceGroups.flatMap((group) => group.fields)).toEqual(request.missingFields);
  });

  it("fails closed when the validation hash is tampered", () => {
    const validation = read("stage2-evidence-validation.public-cost-applied.v1.json");
    validation.summary.readyForCalibrationCount = 1;
    expect(() => buildStage2RemainingEvidenceRequest({
      application: read("stage2-public-cost-application-result.v1.json"),
      validation,
      createdAt: "2026-07-15T18:45:00+08:00",
    })).toThrow("STAGE2_REMAINING_EVIDENCE_SOURCE_INVALID");
  });
});
