import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage2PublicCostResearchAuthorizationRequest,
  type Stage2PublicCostResearchAuthorizationRequest,
} from "./stage2-public-cost-research-authorization";
import type { Stage2PublicCostResearchBrief } from "./stage2-public-cost-research-brief";

const PROJECT = resolve(process.cwd(), "..");
const BRIEF_FILE = resolve(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json");
const ROOT = resolve(PROJECT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Authorization-01");

describe("Stage 2 公开成本研究一次性授权产物", () => {
  it("产物只表示未授权，并与权威 Brief 和 Hash 一致", () => {
    const brief = JSON.parse(readFileSync(BRIEF_FILE, "utf8")) as Stage2PublicCostResearchBrief;
    const request = JSON.parse(readFileSync(resolve(ROOT, "stage2-public-cost-research-authorization-request.v1.json"), "utf8")) as Stage2PublicCostResearchAuthorizationRequest;
    const summary = JSON.parse(readFileSync(resolve(ROOT, "generation-summary.stage2-public-cost-authorization.v1.json"), "utf8")) as Record<string, unknown> & { evidenceHash: string };
    expect(validateStage2PublicCostResearchAuthorizationRequest(brief, request).status).toBe("valid_not_granted");
    const { evidenceHash, ...body } = summary;
    expect(stableHash(body)).toBe(evidenceHash);
    expect(body).toMatchObject({
      status: "valid_not_granted",
      boundary: { authorizationGranted: false, authorizationGrantGenerated: false, externalWebsiteAccessed: false },
    });
  });

  it("不含 Grant、会话或页面内容", () => {
    const combined = [
      "stage2-public-cost-research-authorization-request.v1.json",
      "generation-summary.stage2-public-cost-authorization.v1.json",
    ].map((name) => readFileSync(resolve(ROOT, name), "utf8")).join("\n").toLowerCase();
    for (const forbidden of ["authorization-grant.v1", '"cookie"', '"token"', '"password"', '"html"', '"pagebody"']) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
