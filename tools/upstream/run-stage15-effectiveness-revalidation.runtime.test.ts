import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAuthorizedStage15EffectivenessRevalidation } from "./run-stage15-effectiveness-revalidation";

const briefFile = process.env.STAGE15_REVALIDATION_BRIEF_FILE;
const outputDirectory = process.env.STAGE15_REVALIDATION_OUTPUT_DIRECTORY;
const authorizationPhrase = process.env.STAGE15_REVALIDATION_AUTHORIZATION_PHRASE;
const capturedAt = process.env.STAGE15_REVALIDATION_CAPTURED_AT;

describe("Stage 1.5 effectiveness A revalidation runtime", () => {
  it.runIf(Boolean(briefFile && outputDirectory && authorizationPhrase && capturedAt))(
    "runs the single authorized bounded product-detail evidence pass",
    async () => {
      const result = await runAuthorizedStage15EffectivenessRevalidation({
        briefFile: briefFile!,
        outputDirectory: outputDirectory!,
        authorizationPhrase: authorizationPhrase!,
        capturedAt: capturedAt!,
      });

      expect(result.authorization.status).toBe("granted_single_use");
      expect(result.run.navigationBudget.used).toBeLessThanOrEqual(10);
      expect(result.run.navigationBudget).toMatchObject({
        searchNavigations: 0,
        retries: 0,
      });
      expect(result.run).toMatchObject({
        stage1OrStage15Mutated: false,
        stage2FieldsConsumed: false,
        candidateGenerated: false,
        databaseWritten: false,
        externalAiOrPaidApiCalled: false,
      });
      expect(result.run.cleanup).toMatchObject({
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      });

      const writtenRun = JSON.parse(readFileSync(join(
        outputDirectory!,
        "stage15-effectiveness-revalidation-run.v1.json",
      ), "utf8"));
      expect(writtenRun.evidenceHash).toBe(result.run.evidenceHash);
      expect(result.artifactWrite.written.length + result.artifactWrite.unchanged.length).toBe(3);
    },
    600_000,
  );
});
