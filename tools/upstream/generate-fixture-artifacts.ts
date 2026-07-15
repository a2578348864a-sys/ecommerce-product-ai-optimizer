import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import fixture from "../../lib/upstream/fixtures/amazon-us-closet-organizer.v1.json";
import {
  buildFixtureArtifacts,
  buildNonAuthoritativeCanaryEvidence,
} from "../../lib/upstream/artifacts";
import { adaptCsvSource } from "../../lib/upstream/sourceAdapters";

function writeJson(path: string, content: unknown) {
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

export function generateFixtureArtifacts(outputDirectory: string, legacyCanaryPaths: string[] = []) {
  if (!outputDirectory.trim()) throw new Error("OUTPUT_DIRECTORY_REQUIRED");
  const outputPath = resolve(outputDirectory);
  mkdirSync(outputPath, { recursive: true });
  const artifacts = buildFixtureArtifacts(fixture);
  const csvTemplate = readFileSync(resolve(import.meta.dirname, "fixtures", "stage1-import-template.v1.csv"), "utf8");
  const csvPreview = adaptCsvSource({
    schemaVersion: "csv-source-adapter-input.v1",
    csvText: csvTemplate,
    brief: {
      ...fixture.brief,
      briefId: "brief-csv-template-preview-v1",
      sampleBudget: { maxPages: 1, maxAppearances: 20 },
    },
    collectionRunId: "run-csv-template-preview-v1",
    collectorVersion: "local-csv-adapter.v1",
  });

  const files: Record<string, unknown> = {
    "01-fixture-pipeline-summary.json": {
      schemaVersion: "fixture-pipeline-summary.v2",
      brief: artifacts.pipeline.brief,
      run: artifacts.pipeline.run,
      metrics: artifacts.pipeline.metrics,
      contextGate: artifacts.pipeline.contextGate,
      layoutGate: artifacts.pipeline.layoutGate,
      rawObservationCount: artifacts.pipeline.rawObservationCount,
      uniqueProductCount: artifacts.pipeline.uniqueProductCount,
      quarantined: artifacts.pipeline.quarantined,
    },
    "02-import-preview.json": artifacts.pipeline.importPackage,
    "03-stage1-ranking.json": artifacts.stage1,
    "04-blind-review-material.json": artifacts.blindReview,
    "05-stage2-calibration-material.json": {
      schemaVersion: "stage2-calibration-material.v1",
      note: "Only observed sale price is prefilled. Supply-chain inputs require human evidence; no profit result is fabricated.",
      samples: artifacts.stage2Calibration,
    },
    "06-amazon-us-canary-page1.v2.json": artifacts.canaryEvidence,
    "07-source-adapter-fixture-preview.json": artifacts.fixtureSource,
    "08-source-adapter-json-preview.json": artifacts.jsonSource,
    "09-source-adapter-csv-preview.json": csvPreview,
  };

  for (const [fileName, content] of Object.entries(files)) writeJson(resolve(outputPath, fileName), content);

  const downgradedLegacyCanaries = legacyCanaryPaths.map((legacyPath) => {
    const resolvedPath = resolve(legacyPath);
    const legacy = JSON.parse(readFileSync(resolvedPath, "utf8")) as unknown;
    const downgraded = buildNonAuthoritativeCanaryEvidence(legacy);
    writeJson(resolvedPath, downgraded);
    return resolvedPath;
  });

  return { outputPath, files: Object.keys(files), downgradedLegacyCanaries };
}
