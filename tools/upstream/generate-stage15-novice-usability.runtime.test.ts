import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage15NoviceUsability } from "./generate-stage15-novice-usability";

const screeningRunFile = process.env.STAGE15_USABILITY_SCREENING_RUN_FILE;
const outputDirectory = process.env.STAGE15_USABILITY_OUTPUT_DIRECTORY;
const createdAt = process.env.STAGE15_USABILITY_CREATED_AT;

describe("Stage 1.5 novice usability runtime generator", () => {
  it.runIf(Boolean(screeningRunFile && outputDirectory && createdAt))(
    "writes a blank, hash-bound local usability packet",
    () => {
      const result = generateStage15NoviceUsability({
        screeningRunFile: screeningRunFile!,
        outputDirectory: outputDirectory!,
        createdAt: createdAt!,
      });
      const protocol = JSON.parse(readFileSync(join(outputDirectory!, result.files[0]), "utf8"));
      const worksheet = JSON.parse(readFileSync(join(outputDirectory!, result.files[1]), "utf8"));
      const resultTemplate = JSON.parse(readFileSync(join(outputDirectory!, result.files[2]), "utf8"));

      expect(protocol.expectedAdvanceCount).toBe(5);
      expect(worksheet.response.selectedBlindItemIds).toEqual([]);
      expect(JSON.stringify(worksheet)).not.toContain("expectedAdvanceBlindItemIds");
      expect(resultTemplate.status).toBe("pending_user_input");
      expect(result.summary.manualUserInputObserved).toBe(false);
      expect(result.summary.timeSavingConclusion).toBe("not_validated_without_comparable_baseline");
      expect(result.summary.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
    },
  );
});
