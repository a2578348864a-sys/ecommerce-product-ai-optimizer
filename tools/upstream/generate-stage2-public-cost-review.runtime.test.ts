import { describe, expect, it } from "vitest";
import { generateStage2PublicCostReview } from "./generate-stage2-public-cost-review";

const project = process.env.STAGE2_PUBLIC_COST_REVIEW_PROJECT;
describe("Stage 2 public cost review runtime generator", () => {
  it.runIf(Boolean(project))("generates the real pending review package", () => {
    const run = `${project}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01`;
    const result = generateStage2PublicCostReview({
      briefFile: `${project}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json`,
      runFile: `${run}/stage2-public-cost-research-run.v1.json`, evidenceFile: `${run}/stage2-public-cost-evidence.v1.json`,
      validationFile: `${run}/stage2-public-cost-evidence-validation.v1.json`, previewFile: `${run}/stage2-public-cost-derivation-preview.v1.json`,
      patchPreviewFile: `${run}/stage2-public-cost-submission-patch.preview.v1.json`, createdAt: "2026-07-15T18:03:00+08:00",
      outputDirectory: `${project}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Review-01`,
    });
    expect(result.validation.status).toBe("valid_pending_user_review");
  });
});
