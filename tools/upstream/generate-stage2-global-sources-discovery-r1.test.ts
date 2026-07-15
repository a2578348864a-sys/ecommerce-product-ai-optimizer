import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2GlobalSourcesDiscoveryR1Materials } from "./generate-stage2-global-sources-discovery-r1";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const historicalSelection = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-alternative-source-selection.v1.json");
const historicalBrief = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-global-sources-discovery-brief.v1.json");
const fixture = resolve(PROJECT_ROOT,
  "电商工具/tools/upstream/fixtures/stage2-global-sources-discovery-r1.v1.json");
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function outputDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "global-sources-r1-generator-"));
  tempDirectories.push(directory);
  return directory;
}

function generate(directory: string) {
  return generateStage2GlobalSourcesDiscoveryR1Materials({
    selectionFile: historicalSelection,
    historicalBriefFile: historicalBrief,
    fixtureFile: fixture,
    outputDirectory: directory,
    createdAt: "2026-07-15T06:30:00.000Z",
  });
}

describe("Global Sources C1A-R1 offline material generator", () => {
  it("generates a ready offline package without website access", () => {
    const selectionBefore = readFileSync(historicalSelection, "utf8");
    const briefBefore = readFileSync(historicalBrief, "utf8");
    const directory = outputDirectory();
    const result = generate(directory);

    expect(result.artifactWrite.written).toHaveLength(6);
    expect(result.brief).toMatchObject({
      schemaVersion: "stage2-global-sources-discovery-brief.v2",
      requestedScope: { maxRobotsRequests: 1, maxHomepageNavigations: 1 },
    });
    expect(result.offlineValidation).toMatchObject({
      status: "offline_validation_passed",
      proofLevel: "offline_fixture_only",
      realWebsiteAccessed: false,
      runtimeDiscoveryExecuted: false,
      failedScenarioIds: [],
    });
    expect(result.authorizationRequest.authorization.status).toBe("not_granted");
    expect(result.summary).toMatchObject({
      realWebsiteAccessedDuringGeneration: false,
      runtimeDiscoveryExecuted: false,
      productPageNavigations: 0,
      supplierFieldsCollected: 0,
      databaseWritten: false,
    });
    expect(readFileSync(historicalSelection, "utf8")).toBe(selectionBefore);
    expect(readFileSync(historicalBrief, "utf8")).toBe(briefBefore);
  });

  it("replays identical bytes and rejects a partial conflict before writing", () => {
    const directory = outputDirectory();
    const first = generate(directory);
    const second = generate(directory);
    expect(first.artifactWrite.written).toHaveLength(6);
    expect(second.artifactWrite.unchanged).toHaveLength(6);

    const conflictDirectory = outputDirectory();
    writeFileSync(join(conflictDirectory, "stage2-global-sources-discovery-brief.v2.json"), "conflict", "utf8");
    expect(() => generate(conflictDirectory)).toThrowError(/STAGE2_GLOBAL_SOURCES_R1_OFFLINE_OUTPUT_CONFLICT/);
    expect(() => readFileSync(join(conflictDirectory,
      "stage2-global-sources-discovery-offline-validation.v1.json"), "utf8")).toThrow();
  });
});
