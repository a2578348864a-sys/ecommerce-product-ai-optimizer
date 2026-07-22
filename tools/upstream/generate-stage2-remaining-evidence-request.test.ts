import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2RemainingEvidenceRequest } from "./generate-stage2-remaining-evidence-request";

describe("Stage 2 remaining evidence request generator", () => {
  it("writes an idempotent machine request and beginner handoff", () => {
    const project = TEST_PROJECT_MATERIALS_ROOT;
    const source = join(project, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Application-01");
    const output = mkdtempSync(join(tmpdir(), "stage2-remaining-evidence-"));
    const input = {
      applicationFile: join(source, "stage2-public-cost-application-result.v1.json"),
      validationFile: join(source, "stage2-evidence-validation.public-cost-applied.v1.json"),
      createdAt: "2026-07-15T18:45:00+08:00",
      outputDirectory: output,
    };
    const first = generateStage2RemainingEvidenceRequest(input);
    const second = generateStage2RemainingEvidenceRequest(input);

    expect(first.request.status).toBe("pending_user_evidence");
    expect(first.files).toEqual(["stage2-remaining-evidence-request.v1.json", "README-小白补证据清单.md"]);
    expect(first.artifactWrite.written).toHaveLength(2);
    expect(second.artifactWrite.unchanged).toHaveLength(2);
  });

  it("does not ask the user to choose 3.5 versus 3.8 again after height confirmation", () => {
    const project = TEST_PROJECT_MATERIALS_ROOT;
    const source = join(project, "06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Confirmation-01");
    const output = mkdtempSync(join(tmpdir(), "stage2-remaining-evidence-height-confirmed-"));
    generateStage2RemainingEvidenceRequest({
      applicationFile: join(source, "stage2-package-height-confirmation-application.v1.json"),
      validationFile: join(source, "stage2-evidence-validation.package-height-applied.v1.json"),
      createdAt: "2026-07-15T19:11:24+08:00",
      outputDirectory: output,
    });
    const handoff = readFileSync(join(output, "README-小白补证据清单.md"), "utf8");

    expect(handoff).not.toContain("不凭感觉选择 3.5cm 或 3.8cm");
    expect(handoff).toContain("包装高度3.5cm已由项目所有者作为人工工作值确认");
  });
});
