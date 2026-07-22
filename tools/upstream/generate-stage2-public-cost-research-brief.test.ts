import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2PublicCostResearchBrief } from "./generate-stage2-public-cost-research-brief";

const PROJECT = TEST_PROJECT_MATERIALS_ROOT;
const temporaryDirectories: string[] = [];

afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("Stage 2 public cost research brief generator", () => {
  it("生成版本化 Brief、待填写结果模板、中文授权文本和摘要，且重放幂等", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-public-cost-brief-"));
    temporaryDirectories.push(outputDirectory);
    const input = {
      inventoryFile: resolve(PROJECT, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
      submissionFile: resolve(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-submission.partial.v1.json"),
      validationFile: resolve(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-validation.partial.v1.json"),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-15T16:30:00+08:00",
      outputDirectory,
    };
    const result = generateStage2PublicCostResearchBrief(input);

    expect(result).toMatchObject({ status: "valid_pending_authorization", sampleId: "stage2-high-01" });
    const brief = JSON.parse(readFileSync(join(outputDirectory, "stage2-public-cost-research-brief.v1.json"), "utf8"));
    const template = JSON.parse(readFileSync(join(outputDirectory, "stage2-public-cost-evidence.template.v1.json"), "utf8"));
    const preview = JSON.parse(readFileSync(join(outputDirectory, "stage2-public-cost-derivation-preview.template.v1.json"), "utf8"));
    const authorization = readFileSync(join(outputDirectory, "README-醒来后只需确认.md"), "utf8");
    expect(brief.status).toBe("pending_user_authorization");
    expect(template.status).toBe("not_collected");
    expect(preview.status).toBe("pending_research");
    expect((Object.values(template.observations) as Array<{ value: unknown }>).every((item) => item.value === null)).toBe(true);
    expect(authorization).toContain("本文件不是授权");
    expect(authorization).toContain("不会查询头程、包装、仓储、退货准备金或合规结论");
    expect(authorization).toContain("我明确授权按 Stage2-Public-Cost-Research-01");

    const replay = generateStage2PublicCostResearchBrief(input);
    expect(replay.artifactWrite).toEqual({ written: [], unchanged: result.files });

    writeFileSync(join(outputDirectory, result.files[0]), "conflict\n", "utf8");
    expect(() => generateStage2PublicCostResearchBrief(input)).toThrow("STAGE2_PUBLIC_COST_BRIEF_OUTPUT_CONFLICT");
  });
});
