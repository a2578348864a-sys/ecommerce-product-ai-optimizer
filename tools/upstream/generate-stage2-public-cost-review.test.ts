import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2PublicCostReview } from "./generate-stage2-public-cost-review";

const PROJECT = TEST_PROJECT_MATERIALS_ROOT;
function input(outputDirectory: string) {
  const run = resolve(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01");
  return {
    briefFile: resolve(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json"),
    runFile: resolve(run, "stage2-public-cost-research-run.v1.json"),
    evidenceFile: resolve(run, "stage2-public-cost-evidence.v1.json"),
    validationFile: resolve(run, "stage2-public-cost-evidence-validation.v1.json"),
    previewFile: resolve(run, "stage2-public-cost-derivation-preview.v1.json"),
    patchPreviewFile: resolve(run, "stage2-public-cost-submission-patch.preview.v1.json"),
    createdAt: "2026-07-15T18:03:00+08:00",
    outputDirectory,
  };
}

describe("Stage 2 公开成本复核请求生成器", () => {
  it("只生成pending请求且相同输入幂等", () => {
    const output = mkdtempSync(resolve(tmpdir(), "stage2-cost-review-"));
    try {
      const first = generateStage2PublicCostReview(input(output));
      const second = generateStage2PublicCostReview(input(output));
      const request = JSON.parse(readFileSync(resolve(output, first.files[0]), "utf8"));
      expect(first.artifactWrite.written).toHaveLength(3);
      expect(second.artifactWrite.unchanged).toHaveLength(3);
      expect(request.status).toBe("pending_user_review");
      expect(request.stage2SubmissionMutated).toBe(false);
    } finally { rmSync(output, { recursive: true, force: true }); }
  });
});
