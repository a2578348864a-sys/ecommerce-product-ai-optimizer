import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2RemainingEvidenceRequest } from "./generate-stage2-remaining-evidence-request";

const project = process.env.STAGE2_REMAINING_EVIDENCE_PROJECT;
const createdAt = process.env.STAGE2_REMAINING_EVIDENCE_CREATED_AT;
const sourceDirectory = process.env.STAGE2_REMAINING_EVIDENCE_SOURCE_DIRECTORY;
const applicationFileName = process.env.STAGE2_REMAINING_EVIDENCE_APPLICATION_FILE;
const validationFileName = process.env.STAGE2_REMAINING_EVIDENCE_VALIDATION_FILE;
const outputDirectory = process.env.STAGE2_REMAINING_EVIDENCE_OUTPUT_DIRECTORY;
const expectedMissingCount = process.env.STAGE2_REMAINING_EVIDENCE_EXPECTED_MISSING_COUNT;

describe("Stage 2 remaining evidence runtime generator", () => {
  it.runIf(Boolean(project && createdAt))("writes the authoritative beginner handoff", () => {
    const source = join(project!, sourceDirectory
      ?? "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01");
    const result = generateStage2RemainingEvidenceRequest({
      applicationFile: join(source, applicationFileName ?? "stage2-public-cost-application-result.v1.json"),
      validationFile: join(source, validationFileName ?? "stage2-evidence-validation.public-cost-applied.v1.json"),
      createdAt: createdAt!,
      outputDirectory: join(project!, outputDirectory
        ?? "06_测试与验证/2026-07-15-Phase-Stage2-Remaining-Evidence-01"),
    });
    expect(result.request.status).toBe("pending_user_evidence");
    expect(result.request.missingFields).toHaveLength(Number(expectedMissingCount ?? 10));
  });
});
