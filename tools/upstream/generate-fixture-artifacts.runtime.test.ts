import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateFixtureArtifacts } from "./generate-fixture-artifacts";

const outputDirectory = process.env.UPSTREAM_ARTIFACT_OUTPUT_DIRECTORY;

describe("offline upstream artifact generator", () => {
  it.runIf(Boolean(outputDirectory))("regenerates the complete offline artifact set through one code path", () => {
    const result = generateFixtureArtifacts(resolve(outputDirectory!));
    expect(result.files).toEqual([
      "01-fixture-pipeline-summary.json",
      "02-import-preview.json",
      "03-stage1-ranking.json",
      "04-blind-review-material.json",
      "05-stage2-calibration-material.json",
      "06-amazon-us-canary-page1.v2.json",
      "07-source-adapter-fixture-preview.json",
      "08-source-adapter-json-preview.json",
      "09-source-adapter-csv-preview.json",
    ]);
  });
});
