import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateNoviceMarketScreening } from "./generate-novice-market-screening";

const projectRoot = resolve(process.cwd(), "..");
const canaryDirectory = resolve(
  projectRoot,
  "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15",
);
const noviceDirectory = resolve(
  projectRoot,
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/01-新手盲评-先填写",
);

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "novice-screening-"));
  temporaryDirectories.push(directory);
  return directory;
}

function input(outputDirectory: string) {
  return {
    humanAssistedRunFile: resolve(canaryDirectory, "human-assisted-amazon-run.v2.json"),
    rankingFile: resolve(canaryDirectory, "stage1-ranking.v1.json"),
    blindReviewFile: resolve(canaryDirectory, "stage1-blind-review-material.v1.json"),
    novicePacketFile: resolve(noviceDirectory, "novice-blind-review-packet.v1.json"),
    responsesFile: resolve(noviceDirectory, "novice-blind-review-responses.v1.json"),
    outputDirectory,
    createdAt: "2026-07-15T12:00:00.000Z",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("novice market screening artifact generator", () => {
  it("replays the locked 20-item Canary through the real contract", () => {
    const outputDirectory = temporaryDirectory();
    const generated = generateNoviceMarketScreening(input(outputDirectory));
    const run = JSON.parse(readFileSync(join(outputDirectory, "novice-market-screening-run.v1.json"), "utf8"));
    const acceptance = JSON.parse(
      readFileSync(join(outputDirectory, "novice-market-screening-acceptance.v1.json"), "utf8"),
    );
    const summary = JSON.parse(
      readFileSync(join(outputDirectory, "generation-summary.novice-market-screening.v1.json"), "utf8"),
    );

    expect(generated.artifactWrite.written).toHaveLength(4);
    expect(run.displayName).toBe("调查短名单预览");
    expect(run.items).toHaveLength(20);
    expect(Object.values(run.summary).reduce((sum: number, count) => sum + Number(count), 0)).toBe(20);
    expect(run.summary.advance).toBeGreaterThanOrEqual(3);
    expect(run.summary.advance).toBeLessThanOrEqual(5);
    expect(run.selectionMechanism).toBe("deterministic_top_k_quota");
    expect(run.formalCandidateGenerated).toBe(false);
    expect(run.productionDatabaseWritten).toBe(false);
    expect(run.externalAiApiCalled).toBe(false);
    expect(acceptance.engineering).toMatchObject({
      status: "passed",
      conclusion: "deterministic_scope_reduction_verified",
    });
    expect(acceptance.effectiveness).toMatchObject({
      status: "not_validated",
      conclusion: "screening_effectiveness_not_validated",
    });
    expect(summary.sourceFiles).toHaveLength(5);
    expect(summary.sourceFiles.every((file: { sha256?: string }) => /^[a-f0-9]{64}$/.test(file.sha256 ?? "")))
      .toBe(true);
  });

  it("is idempotent and refuses to overwrite a conflicting artifact", () => {
    const outputDirectory = temporaryDirectory();
    const first = generateNoviceMarketScreening(input(outputDirectory));
    const second = generateNoviceMarketScreening(input(outputDirectory));

    expect(first.run.screeningHash).toBe(second.run.screeningHash);
    expect(second.artifactWrite).toEqual({ written: [], unchanged: second.files });

    writeFileSync(join(outputDirectory, "novice-market-screening-run.v1.json"), "{}\n", "utf8");
    expect(() => generateNoviceMarketScreening(input(outputDirectory)))
      .toThrow(/NOVICE_SCREENING_OUTPUT_CONFLICT/);
  });
});
