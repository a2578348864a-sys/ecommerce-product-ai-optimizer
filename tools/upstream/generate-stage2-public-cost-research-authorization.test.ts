import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2PublicCostResearchAuthorization } from "./generate-stage2-public-cost-research-authorization";

const BRIEF_FILE = resolve(
  process.cwd(),
  "../06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json",
);
const created: string[] = [];

function output() {
  const path = mkdtempSync(resolve(tmpdir(), "stage2-public-cost-auth-"));
  created.push(path);
  return path;
}

afterEach(() => created.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("Stage 2 公开成本授权请求生成器", () => {
  it("只生成 not_granted 请求，重复生成幂等", () => {
    const outputDirectory = output();
    const input = { briefFile: BRIEF_FILE, createdAt: "2026-07-15T09:00:00.000Z", outputDirectory };
    const first = generateStage2PublicCostResearchAuthorization(input);
    const second = generateStage2PublicCostResearchAuthorization(input);
    const request = JSON.parse(readFileSync(resolve(outputDirectory, first.files[0]), "utf8"));
    const summary = JSON.parse(readFileSync(resolve(outputDirectory, first.files[2]), "utf8"));

    expect(first.artifactWrite.written).toHaveLength(3);
    expect(second.artifactWrite.unchanged).toHaveLength(3);
    expect(request).toMatchObject({ status: "not_granted", authorizationGrantGenerated: false });
    expect(summary.boundary).toMatchObject({
      authorizationGranted: false,
      authorizationGrantGenerated: false,
      externalWebsiteAccessed: false,
      evidenceCollected: false,
      databaseWritten: false,
      externalAiApiCalled: false,
    });
  });

  it("已存在内容冲突时拒绝覆盖", () => {
    const outputDirectory = output();
    const input = { briefFile: BRIEF_FILE, createdAt: "2026-07-15T09:00:00.000Z", outputDirectory };
    const result = generateStage2PublicCostResearchAuthorization(input);
    writeFileSync(resolve(outputDirectory, result.files[0]), "tampered", "utf8");
    expect(() => generateStage2PublicCostResearchAuthorization(input)).toThrow(
      "STAGE2_PUBLIC_COST_AUTHORIZATION_OUTPUT_CONFLICT",
    );
  });
});
