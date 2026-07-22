import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2AdvancementMaterials } from "./generate-stage2-advancement-materials";

const ROOT = resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01");
const INPUTS = {
  inventoryFile: resolve(ROOT, "05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
  evidenceSubmissionFile: resolve(ROOT, "06-Stage2证据录入/stage2-evidence-submission.template.v1.json"),
  stage2PacketFile: resolve(ROOT, "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json"),
  rankingFile: resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-ranking.v1.json"),
  decidedAt: "2026-07-14T13:00:00.000Z",
};
const temporaryDirectories: string[] = [];

afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writePartiallyReadyRealSubmission(directory: string) {
  const source = resolve(ROOT, "06-Stage2证据录入/synthetic-fixture/stage2-evidence-submission.synthetic.v1.json");
  const submission = JSON.parse(readFileSync(source, "utf8"));
  submission.evidenceMode = "real_evidence";
  submission.submissionId = "test-only-real-mode-partially-ready";
  submission.submittedBy = "test_fixture_not_real_business_evidence";
  for (const sample of submission.samples.slice(1)) {
    sample.variantIdentity = {
      status: "unknown",
      amazonVariant: null,
      supplierVariant: null,
      confirmedAt: null,
      evidence: null,
    };
    for (const field of Object.keys(sample.fields)) {
      sample.fields[field] = { value: null, missingReason: "not_collected", evidence: null };
    }
  }
  const path = join(directory, "stage2-evidence-submission.partial-real.v1.json");
  writeFileSync(path, `${JSON.stringify(submission, null, 2)}\n`, "utf8");
  return path;
}

describe("Stage 2 advancement material generator", () => {
  it("为当前真实不完整证据生成空白决定和 0 Candidate 的阻断预览", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-advancement-"));
    temporaryDirectories.push(outputDirectory);
    const protectedHashes = Object.fromEntries(Object.entries(INPUTS)
      .filter(([, path]) => typeof path === "string" && path.endsWith(".json"))
      .map(([key, path]) => [key, sha256(path)]));

    const result = generateStage2AdvancementMaterials({ ...INPUTS, outputDirectory });

    expect(result).toMatchObject({
      decisionStatus: "blocked_by_evidence",
      previewStatus: "blocked_by_evidence",
      candidatePreviewCount: 0,
    });
    const decisions = JSON.parse(readFileSync(join(outputDirectory, "stage2-human-decision.template.v1.json"), "utf8"));
    const preview = JSON.parse(readFileSync(join(outputDirectory, "candidate-advancement-preview.blocked.v1.json"), "utf8"));
    expect(decisions.decisions).toHaveLength(7);
    expect(decisions.decisions.every((item: { decision: unknown }) => item.decision === null)).toBe(true);
    expect(preview.candidates).toEqual([]);
    expect(preview.boundary).toMatchObject({ databaseWritten: false, apiCalled: false, candidateCreated: false });

    for (const [key, expected] of Object.entries(protectedHashes)) {
      expect(sha256(INPUTS[key as keyof typeof INPUTS])).toBe(expected);
    }
  });

  it("相同输入和时间重复生成保持字节确定性", () => {
    const first = mkdtempSync(join(tmpdir(), "stage2-advancement-a-"));
    const second = mkdtempSync(join(tmpdir(), "stage2-advancement-b-"));
    temporaryDirectories.push(first, second);
    const a = generateStage2AdvancementMaterials({ ...INPUTS, outputDirectory: first });
    const b = generateStage2AdvancementMaterials({ ...INPUTS, outputDirectory: second });
    expect(a.files).toEqual(b.files);
    for (const file of a.files.filter((path) => path.endsWith(".json"))) {
      expect(readFileSync(join(first, file))).toEqual(readFileSync(join(second, file)));
    }
  });

  it("一条样本就绪时产物明确记录部分就绪并只等待该条人工决定", () => {
    const temporaryInputDirectory = mkdtempSync(join(tmpdir(), "stage2-advancement-partial-input-"));
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-advancement-partial-output-"));
    temporaryDirectories.push(temporaryInputDirectory, outputDirectory);
    const evidenceSubmissionFile = writePartiallyReadyRealSubmission(temporaryInputDirectory);

    const result = generateStage2AdvancementMaterials({
      ...INPUTS,
      evidenceSubmissionFile,
      outputDirectory,
    });
    const summary = JSON.parse(readFileSync(join(
      outputDirectory,
      "generation-summary.stage2-advancement.v1.json",
    ), "utf8"));
    const readme = readFileSync(join(outputDirectory, "README-Stage2人工决定与Candidate预览.md"), "utf8");

    expect(result).toMatchObject({
      decisionStatus: "pending_user_input",
      previewStatus: "blocked_by_human_decision",
      candidatePreviewCount: 0,
    });
    expect(summary.boundary).toMatchObject({
      objectiveEvidenceComplete: false,
      objectiveEvidencePartiallyReady: true,
      objectiveEvidenceReadySampleCount: 1,
      objectiveEvidenceBlockedSampleCount: 6,
    });
    expect(readme).toContain("1 条已具备客观证据资格");
    expect(readme).toContain("6 条仍被证据门禁阻断");
  });

  it("拒绝覆盖人工决定或预览文件，冲突时整包不补写", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-advancement-safe-"));
    temporaryDirectories.push(outputDirectory);
    const input = { ...INPUTS, outputDirectory };
    const first = generateStage2AdvancementMaterials(input);
    const replay = generateStage2AdvancementMaterials(input);
    expect(replay.artifactWrite).toEqual({ written: [], unchanged: first.files });

    writeFileSync(join(outputDirectory, first.files[0]), "manual-decision-edited\n", "utf8");
    rmSync(join(outputDirectory, first.files[1]));
    expect(() => generateStage2AdvancementMaterials(input)).toThrow("STAGE2_ADVANCEMENT_OUTPUT_CONFLICT");
    expect(readFileSync(join(outputDirectory, first.files[0]), "utf8")).toBe("manual-decision-edited\n");
    expect(existsSync(join(outputDirectory, first.files[1]))).toBe(false);
  });
});
