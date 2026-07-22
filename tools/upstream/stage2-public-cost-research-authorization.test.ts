import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectMaterialPath } from "../../tests/helpers/project-materials";
import {
  STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT,
  buildStage2PublicCostResearchAuthorizationGrant,
  buildStage2PublicCostResearchAuthorizationRequest,
  consumeStage2PublicCostResearchAuthorizationGrant,
  validateStage2PublicCostResearchAuthorizationConsumption,
  validateStage2PublicCostResearchAuthorizationGrant,
  validateStage2PublicCostResearchAuthorizationRequest,
} from "./stage2-public-cost-research-authorization";
import type { Stage2PublicCostResearchBrief } from "./stage2-public-cost-research-brief";

const BRIEF_FILE = projectMaterialPath(
  "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json",
);

function readBrief() {
  return JSON.parse(readFileSync(BRIEF_FILE, "utf8")) as Stage2PublicCostResearchBrief;
}

describe("Stage 2 公开成本研究一次性授权契约", () => {
  it("将未授权请求绑定到 Brief Hash、固定 Origin、导航预算与零重试", () => {
    const brief = readBrief();
    const request = buildStage2PublicCostResearchAuthorizationRequest(brief, "2026-07-15T09:00:00.000Z");

    expect(validateStage2PublicCostResearchAuthorizationRequest(brief, request)).toMatchObject({
      status: "valid_not_granted",
      reasonCodes: [],
    });
    expect(request).toMatchObject({
      status: "not_granted",
      briefId: brief.briefId,
      briefHash: brief.briefHash,
      exactAuthorizationText: STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT,
      requestedScope: {
        allowedOrigins: ["https://www.federalreserve.gov", "https://sell.amazon.com"],
        maxTotalNavigations: 6,
        automaticRetryCount: 0,
        maxSamples: 1,
      },
      authorizationGrantGenerated: false,
    });
  });

  it("授权文本必须逐字一致，并且 Grant 只保存文本 Hash、不保存原文", () => {
    const brief = readBrief();
    const request = buildStage2PublicCostResearchAuthorizationRequest(brief, "2026-07-15T09:00:00.000Z");
    expect(() => buildStage2PublicCostResearchAuthorizationGrant({
      brief,
      request,
      authorizationText: `${STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT} `,
      authorizedAt: "2026-07-15T09:01:00.000Z",
      authorizedBy: "user",
    })).toThrow("STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT_MISMATCH");

    const grant = buildStage2PublicCostResearchAuthorizationGrant({
      brief,
      request,
      authorizationText: STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT,
      authorizedAt: "2026-07-15T09:01:00.000Z",
      authorizedBy: "user",
    });
    expect(grant).not.toHaveProperty("authorizationText");
    expect(grant).toMatchObject({ status: "granted", singleUse: true, consumed: false });
    expect(validateStage2PublicCostResearchAuthorizationGrant(brief, request, grant)).toMatchObject({
      status: "valid_unconsumed_grant",
      reasonCodes: [],
    });
    const runId = "stage2-public-cost-run-0123456789abcdef01234567";
    const consumption = consumeStage2PublicCostResearchAuthorizationGrant({
      brief, request, grant, runId, consumedAt: "2026-07-15T09:02:00.000Z",
    });
    expect(validateStage2PublicCostResearchAuthorizationConsumption(brief, request, grant, consumption)).toMatchObject({
      status: "valid_consumed",
      reasonCodes: [],
    });
    expect(consumption).toMatchObject({ consumed: true, runId });
  });

  it("Brief、范围或请求 Hash 被篡改时 fail-closed", () => {
    const brief = readBrief();
    const request = buildStage2PublicCostResearchAuthorizationRequest(brief, "2026-07-15T09:00:00.000Z");
    const tampered = structuredClone(request);
    tampered.requestedScope.maxTotalNavigations = 7 as 6;
    expect(validateStage2PublicCostResearchAuthorizationRequest(brief, tampered).status).not.toBe("valid_not_granted");

    const changedBrief = structuredClone(brief);
    changedBrief.briefHash = "changed";
    expect(validateStage2PublicCostResearchAuthorizationRequest(changedBrief, request).status).not.toBe("valid_not_granted");
  });
});
