import { describe, expect, it } from "vitest";
import { generateStage2EvidenceIntakeArtifacts } from "./generate-stage2-evidence-intake";

const inventoryFile = process.env.STAGE2_EVIDENCE_INVENTORY_FILE;
const outputDirectory = process.env.STAGE2_EVIDENCE_INTAKE_OUTPUT_DIRECTORY;
const createdAt = process.env.STAGE2_EVIDENCE_INTAKE_CREATED_AT;

describe("Stage 2 evidence intake runtime generator", () => {
  it.runIf(Boolean(inventoryFile && outputDirectory && createdAt))(
    "generates the current seven-sample template and offline synthetic proof",
    () => {
      const result = generateStage2EvidenceIntakeArtifacts({
        inventoryFile: inventoryFile!,
        outputDirectory: outputDirectory!,
        createdAt: createdAt!,
      });
      expect(result.realEvidence).toEqual({ status: "incomplete", sampleCount: 7 });
      expect(result.syntheticFixture).toEqual({
        status: "synthetic_fixture_calculated",
        sampleCount: 7,
        businessValidationProven: false,
      });
    },
  );
});
