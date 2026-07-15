import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePhase3AcceptanceReport } from "./generate-phase3-acceptance-report";

const stage1SummaryFile = process.env.PHASE3_ACCEPTANCE_STAGE1_FILE;
const responsesFile = process.env.PHASE3_ACCEPTANCE_RESPONSES_FILE;
const comparisonFile = process.env.PHASE3_ACCEPTANCE_COMPARISON_FILE;
const candidatePreviewFile = process.env.PHASE3_ACCEPTANCE_PREVIEW_FILE;
const outputDirectory = process.env.PHASE3_ACCEPTANCE_OUTPUT_DIRECTORY;
const evaluatedAt = process.env.PHASE3_ACCEPTANCE_EVALUATED_AT;

describe("Phase 3 acceptance runtime generator", () => {
  it.runIf(Boolean(stage1SummaryFile && responsesFile && comparisonFile && candidatePreviewFile && outputDirectory && evaluatedAt))(
    "writes the versioned Phase 3 acceptance package",
    () => {
      const result = generatePhase3AcceptanceReport({
        stage1SummaryFile: stage1SummaryFile!,
        responsesFile: responsesFile!,
        comparisonFile: comparisonFile!,
        candidatePreviewFile: candidatePreviewFile!,
        outputDirectory: outputDirectory!,
        evaluatedAt: evaluatedAt!,
      });
      const report = JSON.parse(readFileSync(join(outputDirectory!, "phase3-acceptance-report.v1.json"), "utf8"));
      expect(result.status).toBe("passed");
      expect(report.counts.completedBlindReviewAnswers).toBe(20);
      expect(report.validationConclusion).toBe("limited_scope_reduction_not_business_validated");
      expect(report.businessValidationProven).toBe(false);
    },
  );
});
