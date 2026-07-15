import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePhase2AcceptanceReport } from "./generate-phase2-acceptance-report";

const sourceFile = process.env.PHASE2_ACCEPTANCE_SOURCE_FILE;
const outputDirectory = process.env.PHASE2_ACCEPTANCE_OUTPUT_DIRECTORY;
const evaluatedAt = process.env.PHASE2_ACCEPTANCE_EVALUATED_AT;

describe("Phase 2 acceptance runtime generator", () => {
  it.runIf(Boolean(sourceFile && outputDirectory && evaluatedAt))(
    "writes one versioned acceptance report from the authorized local evidence file",
    () => {
      const result = generatePhase2AcceptanceReport({ sourceFile: sourceFile!, outputDirectory: outputDirectory!, evaluatedAt: evaluatedAt! });
      const report = JSON.parse(readFileSync(join(outputDirectory!, "phase2-acceptance-report.v1.json"), "utf8"));
      expect(result.status).toBe("passed");
      expect(report.status).toBe("passed");
      expect(report.counts.rawObservationCount).toBe(20);
      expect(report.counts.importPreviewCandidateCount).toBe(20);
      expect(report.criteria.formalCandidateNotGenerated).toBe(true);
      expect(report.criteria.productionDatabaseNotWritten).toBe(true);
    },
  );
});
