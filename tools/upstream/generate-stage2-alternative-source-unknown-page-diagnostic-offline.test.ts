import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { generateStage2AlternativeSourceUnknownPageDiagnosticOfflineEvidence } from "./generate-stage2-alternative-source-unknown-page-diagnostic-offline";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const BRIEF_FILE = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json");
const FIXTURE_FILE = resolve(import.meta.dirname,
  "fixtures/stage2-alternative-source-unknown-page-diagnostic.v1.json");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Stage 2 alternative-source unknown-page offline evidence generation", () => {
  it("writes parseable idempotent evidence from the real diagnostic builder", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-unknown-page-"));
    roots.push(outputDirectory);
    const input = {
      briefFile: BRIEF_FILE,
      fixtureFile: FIXTURE_FILE,
      outputDirectory,
      createdAt: "2026-07-15T03:40:00.000Z",
    };
    const first = generateStage2AlternativeSourceUnknownPageDiagnosticOfflineEvidence(input);
    const second = generateStage2AlternativeSourceUnknownPageDiagnosticOfflineEvidence(input);

    expect(first.validation).toMatchObject({
      schemaVersion: "stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1",
      status: "offline_validation_passed",
      proofLevel: "offline_fixture_only",
      scenarioCount: 9,
      failedScenarioIds: [],
      realWebsiteAccessed: false,
      selectorOrThresholdChanged: false,
    });
    expect(first.validation.statusCounts).toEqual({
      diagnostic_evidence_present: 3,
      diagnostic_evidence_absent: 1,
      diagnostic_evidence_insufficient: 1,
      diagnostic_context_blocked: 2,
      diagnostic_input_invalid: 1,
      not_applicable: 1,
    });
    const { evidenceHash, ...body } = first.validation;
    expect(evidenceHash).toBe(stableHash(body));
    expect(second.artifactWrite).toEqual({ written: [], unchanged: first.summary.files });
    for (const file of first.summary.files) {
      const content = readFileSync(resolve(outputDirectory, file), "utf8");
      expect(content).not.toContain("C:\\Users\\");
      expect(content).not.toMatch(/cookie\s*[:=]|authorization\s*[:=]|token\s*[:=]/i);
      if (file.endsWith(".json")) expect(() => JSON.parse(content)).not.toThrow();
    }
  });
});
