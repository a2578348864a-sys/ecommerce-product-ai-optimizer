import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateNoviceMarketScreening } from "./generate-novice-market-screening";

const humanAssistedRunFile = process.env.NOVICE_SCREENING_HUMAN_RUN_FILE;
const rankingFile = process.env.NOVICE_SCREENING_RANKING_FILE;
const blindReviewFile = process.env.NOVICE_SCREENING_BLIND_REVIEW_FILE;
const novicePacketFile = process.env.NOVICE_SCREENING_PACKET_FILE;
const responsesFile = process.env.NOVICE_SCREENING_RESPONSES_FILE;
const outputDirectory = process.env.NOVICE_SCREENING_OUTPUT_DIRECTORY;
const createdAt = process.env.NOVICE_SCREENING_CREATED_AT;

describe("novice market screening runtime generator", () => {
  it.runIf(Boolean(
    humanAssistedRunFile
      && rankingFile
      && blindReviewFile
      && novicePacketFile
      && responsesFile
      && outputDirectory
      && createdAt,
  ))("writes the locked 20-item offline replay", () => {
    const result = generateNoviceMarketScreening({
      humanAssistedRunFile: humanAssistedRunFile!,
      rankingFile: rankingFile!,
      blindReviewFile: blindReviewFile!,
      novicePacketFile: novicePacketFile!,
      responsesFile: responsesFile!,
      outputDirectory: outputDirectory!,
      createdAt: createdAt!,
    });
    const run = JSON.parse(readFileSync(join(outputDirectory!, "novice-market-screening-run.v1.json"), "utf8"));

    expect(result.acceptance.engineering.conclusion).toBe("deterministic_scope_reduction_verified");
    expect(result.acceptance.effectiveness.conclusion).toBe("screening_effectiveness_not_validated");
    expect(run.items).toHaveLength(20);
    expect(run.summary.advance).toBeGreaterThanOrEqual(3);
    expect(run.summary.advance).toBeLessThanOrEqual(5);
  });
});
