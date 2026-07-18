import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage15EffectivenessHumanEvaluation } from "./generate-stage15-effectiveness-human-evaluation";

const briefFile = process.env.STAGE15_HUMAN_EVALUATION_BRIEF_FILE;
const runFile = process.env.STAGE15_HUMAN_EVALUATION_RUN_FILE;
const outputDirectory = process.env.STAGE15_HUMAN_EVALUATION_OUTPUT_DIRECTORY;
const createdAt = process.env.STAGE15_HUMAN_EVALUATION_CREATED_AT;

describe("Stage 1.5 human evaluation runtime generator", () => {
  it.runIf(Boolean(briefFile && runFile && outputDirectory && createdAt))(
    "writes a blinded pending packet and leaves every human answer empty",
    () => {
      const result = generateStage15EffectivenessHumanEvaluation({
        briefFile: briefFile!,
        runFile: runFile!,
        outputDirectory: outputDirectory!,
        createdAt: createdAt!,
      });
      const packet = JSON.parse(readFileSync(join(outputDirectory!, result.files[0]), "utf8"));
      const resultTemplate = JSON.parse(readFileSync(join(outputDirectory!, result.files[1]), "utf8"));
      const form = readFileSync(join(outputDirectory!, result.files[4]), "utf8");

      expect(packet.status).toBe("pending_human_evaluation");
      expect(packet.items).toHaveLength(10);
      expect(packet.evidenceCoverage.evaluationMustAllowInsufficientEvidence).toBe(true);
      expect(packet.items.every((item: { evaluation: { answers: Record<string, unknown> } }) =>
        Object.values(item.evaluation.answers).every((value) => value === null))).toBe(true);
      expect(resultTemplate.items.every((item: { answers: Record<string, unknown> }) =>
        Object.values(item.answers).every((value) => value === null))).toBe(true);

      const blindedPayload = JSON.stringify({ items: packet.items, resultTemplate });
      for (const forbidden of ["pilotItemId", "expectedAsin", "observedAsin", "sourceUrlHash", "safePath", "stage1Rank", "group", "lockedHuman", "profit", "supplier"]) {
        expect(blindedPayload).not.toContain(forbidden);
      }
      expect(form).toContain("worthFurtherInvestigation:");
      expect(packet.items.every((item: { evaluationItemId: string }) => form.includes(item.evaluationItemId))).toBe(true);
      for (const forbidden of ["pilotItemId", "expectedAsin", "observedAsin", "sourceUrlHash", "safePath", "stage1Rank", "groupAssignment", "lockedHuman"]) {
        expect(form).not.toContain(forbidden);
      }
      expect(result.summary.sourceRunEvidenceHash).toBe(packet.sourceRunEvidenceHash);
      expect(result.summary.outcomeAutoDecisionGenerated).toBe(false);
      expect(result.summary.externalWebsiteAccessedDuringGeneration).toBe(false);
      expect(result.summary.externalAiOrPaidApiCalled).toBe(false);
      expect(result.summary.databaseWritten).toBe(false);
      expect(result.summary.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
    },
  );
});
