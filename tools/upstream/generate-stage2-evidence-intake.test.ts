import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectMaterialPath } from "../../tests/helpers/project-materials";
import { generateStage2EvidenceIntakeArtifacts } from "./generate-stage2-evidence-intake";

const temporaryDirectories: string[] = [];
const INVENTORY_FILE = projectMaterialPath(
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json",
);

afterEach(() => {
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Stage 2 evidence intake artifact generator", () => {
  it("生成真实空白模板和明确隔离的合成校准 Fixture，不修改缺口清单", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-evidence-intake-"));
    temporaryDirectories.push(outputDirectory);
    const before = sha256(INVENTORY_FILE);

    const result = generateStage2EvidenceIntakeArtifacts({
      inventoryFile: INVENTORY_FILE,
      outputDirectory,
      createdAt: "2026-07-14T12:00:00.000Z",
    });

    expect(sha256(INVENTORY_FILE)).toBe(before);
    expect(result.realEvidence.status).toBe("incomplete");
    expect(result.realEvidence.sampleCount).toBe(7);
    expect(result.syntheticFixture.status).toBe("synthetic_fixture_calculated");
    expect(result.syntheticFixture.businessValidationProven).toBe(false);

    const template = JSON.parse(readFileSync(join(outputDirectory, "stage2-evidence-submission.template.v1.json"), "utf8"));
    const validation = JSON.parse(readFileSync(join(outputDirectory, "stage2-evidence-validation.incomplete.v1.json"), "utf8"));
    const synthetic = JSON.parse(readFileSync(join(outputDirectory, "synthetic-fixture/stage2-evidence-submission.synthetic.v1.json"), "utf8"));
    expect(template.samples).toHaveLength(7);
    expect(validation.status).toBe("incomplete");
    expect(synthetic.evidenceMode).toBe("synthetic_fixture");
    expect(JSON.stringify(template)).not.toContain("humanContinueDecision");
    expect(JSON.stringify(synthetic)).toContain("fixture.invalid");
  });

  it("相同输入和时间重复生成的 JSON 字节完全一致", () => {
    const first = mkdtempSync(join(tmpdir(), "stage2-evidence-intake-a-"));
    const second = mkdtempSync(join(tmpdir(), "stage2-evidence-intake-b-"));
    temporaryDirectories.push(first, second);
    const input = { inventoryFile: INVENTORY_FILE, createdAt: "2026-07-14T12:00:00.000Z" };

    const a = generateStage2EvidenceIntakeArtifacts({ ...input, outputDirectory: first });
    const b = generateStage2EvidenceIntakeArtifacts({ ...input, outputDirectory: second });

    expect(a.files).toEqual(b.files);
    for (const file of a.files.filter((path) => path.endsWith(".json"))) {
      expect(readFileSync(join(first, file))).toEqual(readFileSync(join(second, file)));
    }
  });

  it("同目录同内容幂等，冲突时不覆盖也不补写缺失文件", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-evidence-intake-safe-"));
    temporaryDirectories.push(outputDirectory);
    const input = { inventoryFile: INVENTORY_FILE, createdAt: "2026-07-14T12:00:00.000Z", outputDirectory };
    const first = generateStage2EvidenceIntakeArtifacts(input);
    const replay = generateStage2EvidenceIntakeArtifacts(input);
    expect(replay.artifactWrite).toEqual({ written: [], unchanged: first.files });

    writeFileSync(join(outputDirectory, first.files[0]), "user-edited\n", "utf8");
    rmSync(join(outputDirectory, first.files[1]));
    expect(() => generateStage2EvidenceIntakeArtifacts(input)).toThrow("STAGE2_EVIDENCE_INTAKE_OUTPUT_CONFLICT");
    expect(readFileSync(join(outputDirectory, first.files[0]), "utf8")).toBe("user-edited\n");
    expect(existsSync(join(outputDirectory, first.files[1]))).toBe(false);
  });
});
