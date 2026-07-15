import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage2PublicCostDerivationPreview,
  validateStage2PublicCostEvidence,
  type Stage2PublicCostEvidence,
} from "./stage2-public-cost-evidence";
import {
  validateStage2PublicCostResearchBrief,
  type Stage2PublicCostResearchBrief,
} from "./stage2-public-cost-research-brief";

const ROOT = resolve(
  process.cwd(),
  "../06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01",
);

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, name), "utf8")) as T;
}

describe("Stage 2 公开成本研究版本化产物", () => {
  it("真实生成产物可由同一契约复核且保持未授权、未采集、未推导", () => {
    const brief = readJson<Stage2PublicCostResearchBrief>("stage2-public-cost-research-brief.v1.json");
    const evidence = readJson<Stage2PublicCostEvidence>("stage2-public-cost-evidence.template.v1.json");
    const preview = readJson<ReturnType<typeof buildStage2PublicCostDerivationPreview>>(
      "stage2-public-cost-derivation-preview.template.v1.json",
    );
    const summary = readJson<Record<string, unknown> & { evidenceHash: string }>(
      "generation-summary.stage2-public-cost-research.v1.json",
    );

    expect(validateStage2PublicCostResearchBrief(brief).status).toBe("valid_pending_authorization");
    expect(validateStage2PublicCostEvidence(brief, evidence).status).toBe("valid_pending_research");
    expect(preview).toEqual(buildStage2PublicCostDerivationPreview(brief, evidence));
    expect(preview.status).toBe("pending_research");
    const { evidenceHash, ...summaryBody } = summary;
    expect(stableHash(summaryBody)).toBe(evidenceHash);
    expect(summaryBody).toMatchObject({
      status: "valid_pending_authorization",
      boundary: {
        userAuthorizationGranted: false,
        externalWebsiteAccessed: false,
        evidenceCollected: false,
        stage2SubmissionMutated: false,
        profitCalculated: false,
        candidateCreated: false,
        databaseWritten: false,
        externalAiApiCalled: false,
      },
    });
  });

  it("产物不包含浏览器会话、认证头或完整页面内容字段", () => {
    const combined = [
      "stage2-public-cost-research-brief.v1.json",
      "stage2-public-cost-evidence.template.v1.json",
      "stage2-public-cost-derivation-preview.template.v1.json",
      "generation-summary.stage2-public-cost-research.v1.json",
    ].map((name) => readFileSync(resolve(ROOT, name), "utf8")).join("\n").toLowerCase();

    for (const forbidden of [
      '"cookie"', '"authorizationheader"', '"token"', '"password"',
      '"localstorage"', '"sessionstorage"', '"html"', '"pagebody"',
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
