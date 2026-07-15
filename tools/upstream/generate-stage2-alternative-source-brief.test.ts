import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceMaterials } from "./generate-stage2-alternative-source-brief";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const ORIGINAL_BRIEF = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/08-Stage2-high-01取证授权材料/stage2-evidence-collection-brief.v1.json");
const FAILED_RESULT = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Public-Revalidation-01/stage2-public-revalidation-result.v1.json");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Stage 2 alternative source material generation", () => {
  it("writes a parseable, idempotent, non-authorizing source decision package", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-source-"));
    roots.push(outputDirectory);
    const input = {
      originalBriefFile: ORIGINAL_BRIEF,
      failedRevalidationResultFile: FAILED_RESULT,
      outputDirectory,
      createdAt: "2026-07-15T03:00:00.000Z",
    };

    const first = generateStage2AlternativeSourceMaterials(input);
    const second = generateStage2AlternativeSourceMaterials(input);

    expect(first.validation).toMatchObject({ status: "valid_pending_authorization", reasonCodes: [] });
    expect(first.research).toMatchObject({
      schemaVersion: "stage2-alternative-source-research.v1",
      status: "selected_pending_authorization",
      selectedPlatform: "made_in_china",
      realProductEvidenceCollected: false,
    });
    expect(first.summary).toMatchObject({
      realWebsiteAccessedDuringGeneration: false,
      realProductEvidenceCollected: false,
      authorizationGranted: false,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
    });
    expect(second.artifactWrite).toEqual({
      written: [],
      unchanged: first.summary.files,
    });

    expect(first.summary.files).toContain("02-离线能力探针实现规格.md");
    expect(first.summary.files).toContain("03-用户复核清单.md");
    expect(readFileSync(resolve(outputDirectory, "02-离线能力探针实现规格.md"), "utf8"))
      .toContain("能力探针不采集供应商字段");
    expect(readFileSync(resolve(outputDirectory, "03-用户复核清单.md"), "utf8"))
      .toContain("确认 Brief-02，离线实现能力探针");

    for (const file of first.summary.files.filter((name) => name.endsWith(".md"))) {
      expect(readFileSync(resolve(outputDirectory, file), "utf8")).not.toMatch(/[ \t]+$/m);
    }

    for (const file of first.summary.files) {
      const content = readFileSync(resolve(outputDirectory, file), "utf8");
      if (file.endsWith(".json")) expect(() => JSON.parse(content)).not.toThrow();
      else expect(content.length).toBeGreaterThan(100);
    }
  });
});
