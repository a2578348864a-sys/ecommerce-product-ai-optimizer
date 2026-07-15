import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2PublicRevalidationMaterials } from "./generate-stage2-public-revalidation-brief";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const ORIGINAL = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/08-Stage2-high-01取证授权材料/stage2-evidence-collection-brief.v1.json");
const RUN_ROOT = resolve(PROJECT_ROOT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Evidence-01");
const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Stage 2 public revalidation material generator", () => {
  it("writes parseable, pending-only materials idempotently", () => {
    const outputDirectory = mkdtempSync(resolve(tmpdir(), "stage2-revalidation-test-"));
    created.push(outputDirectory);
    const input = {
      originalBriefFile: ORIGINAL,
      failedRunFile: resolve(RUN_ROOT, "stage2-public-evidence-collection-run.v1.json"),
      failedReviewFile: resolve(RUN_ROOT, "stage2-public-evidence-run-review.v1.json"),
      outputDirectory,
      createdAt: "2026-07-15T00:30:00.000Z",
    };
    const first = generateStage2PublicRevalidationMaterials(input);
    const second = generateStage2PublicRevalidationMaterials(input);
    expect(first.validation.status).toBe("valid_pending_authorization");
    expect(first.summary).toMatchObject({ realWebsiteAccessed: false, authorizationGranted: false });
    expect(first.artifactWrite.written).toHaveLength(4);
    expect(second.artifactWrite.unchanged).toHaveLength(4);
    expect(JSON.parse(readFileSync(resolve(outputDirectory,
      "stage2-public-revalidation-brief.v1.json"), "utf8"))).toEqual(first.brief);
    expect(readFileSync(resolve(outputDirectory, "01-用户授权交接.md"), "utf8"))
      .toContain("本文件不是授权，也不会触发真实网站访问");
  });
});
