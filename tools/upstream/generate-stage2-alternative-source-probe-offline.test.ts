import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { generateStage2AlternativeSourceProbeOfflineEvidence } from "./generate-stage2-alternative-source-probe-offline";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const BRIEF_FILE = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json");
const FIXTURE_FILE = resolve(import.meta.dirname, "fixtures/stage2-alternative-source-probe.v1.json");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Stage 2 alternative source offline probe evidence generation", () => {
  it("writes parseable, idempotent evidence without claiming a real website probe", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-probe-offline-"));
    roots.push(outputDirectory);
    const input = {
      briefFile: BRIEF_FILE,
      fixtureFile: FIXTURE_FILE,
      outputDirectory,
      createdAt: "2026-07-15T02:30:00.000Z",
    };

    const first = generateStage2AlternativeSourceProbeOfflineEvidence(input);
    const second = generateStage2AlternativeSourceProbeOfflineEvidence(input);

    expect(first.validation).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-offline-validation.v1",
      status: "offline_validation_passed",
      proofLevel: "offline_fixture_only",
      realWebsiteAccessed: false,
      runtimeProbeExecuted: false,
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
    });
    expect(first.validation.scenarioCounts).toEqual({ page: 17, url: 6, policy: 5, total: 28 });
    expect(first.validation.failedScenarioIds).toEqual([]);
    expect(first.validation.pageClassificationCounts.search_results_ready).toBe(2);
    expect(first.validation.pageClassificationCounts.unknown_page).toBe(4);
    expect(first.validation.briefHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.validation.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.validation.inputHash).toMatch(/^[a-f0-9]{64}$/);
    const { evidenceHash, ...validationBody } = first.validation;
    expect(evidenceHash).toBe(stableHash(validationBody));
    expect(second.artifactWrite).toEqual({ written: [], unchanged: first.summary.files });

    for (const file of first.summary.files) {
      const content = readFileSync(resolve(outputDirectory, file), "utf8");
      expect(content).not.toContain("C:\\Users\\");
      expect(content).not.toMatch(/cookie|authorization\s*:/i);
      if (file.endsWith(".json")) expect(() => JSON.parse(content)).not.toThrow();
      else expect(content.length).toBeGreaterThan(100);
    }
  });

  it("fails closed when a fixture expectation disagrees with the real classifier", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-probe-offline-"));
    roots.push(outputDirectory);
    const fixture = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as {
      pageScenarios: Array<{ expectedClassification: string }>;
    };
    fixture.pageScenarios[0].expectedClassification = "unknown_page";
    const changedFixtureFile = resolve(outputDirectory, "changed-fixture.json");
    writeFileSync(changedFixtureFile, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

    expect(() => generateStage2AlternativeSourceProbeOfflineEvidence({
      briefFile: BRIEF_FILE,
      fixtureFile: changedFixtureFile,
      outputDirectory: resolve(outputDirectory, "result"),
      createdAt: "2026-07-15T02:30:00.000Z",
    })).toThrow("STAGE2_ALTERNATIVE_SOURCE_PROBE_FIXTURE_VALIDATION_FAILED");
  });
});
