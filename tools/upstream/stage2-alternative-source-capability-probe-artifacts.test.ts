import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";

const OUTPUT = resolve(import.meta.dirname, "../../../06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01");
const readJson = (name: string) => JSON.parse(readFileSync(resolve(OUTPUT, name), "utf8")) as Record<string, unknown>;

describe("saved Stage 2 alternative source capability probe evidence", () => {
  it("is hash-valid, single-use, fail-closed, capability-only evidence", () => {
    const authorization = readJson("stage2-alternative-source-capability-probe-authorization.v1.json");
    const robots = readJson("stage2-alternative-source-robots-request.v1.json");
    const policy = readJson("stage2-alternative-source-policy-preflight.v1.json");
    const run = readJson("stage2-alternative-source-capability-probe-run.v2.json");
    const summary = readJson("generation-summary.stage2-alternative-source-capability-probe.v1.json");
    for (const artifact of [authorization, robots, policy, run, summary]) {
      const hashKey = "evidenceHash" in artifact ? "evidenceHash" : "inputHash";
      const hash = artifact[hashKey];
      const body = { ...artifact };
      delete body[hashKey];
      expect(hash).toBe(stableHash(body));
    }
    expect(authorization.consumption).toMatchObject({ status: "consumed", runId: run.runId });
    expect(run).toMatchObject({
      status: "failed_closed",
      errorCode: "unknown_page",
      reasonCodes: ["search_container_marker_missing"],
      realWebsiteAccessed: true,
      navigationBudget: { maximum: 1, used: 1, productPageNavigations: 0, automaticRetryCount: 0 },
      externalActionBudget: { maximum: 2, policyUsed: 1, navigationUsed: 1, totalUsed: 2 },
      allowedProductUrls: [],
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
      externalAiOrPaidApiCalled: false,
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      },
    });
    expect(policy).toMatchObject({ status: "allowed", robotsDecision: "allowed", requestCount: 1 });
    expect(robots).toMatchObject({ httpStatus: 200, requestCount: 1, responseBodyStored: false });
    expect(summary).toMatchObject({ runEvidenceHash: run.evidenceHash, status: "failed_closed" });
  });

  it("contains no stored robots body, complete HTML, profile path, or common secret material", () => {
    const raw = [
      "stage2-alternative-source-capability-probe-authorization.v1.json",
      "stage2-alternative-source-robots-request.v1.json",
      "stage2-alternative-source-policy-preflight.v1.json",
      "stage2-alternative-source-capability-probe-run.v2.json",
      "generation-summary.stage2-alternative-source-capability-probe.v1.json",
    ].map((name) => readFileSync(resolve(OUTPUT, name), "utf8")).join("\n");
    expect(raw).not.toMatch(/<!doctype|<html|<body|cookie|localStorage|sessionStorage/i);
    expect(raw).not.toMatch(/authorization\s*[:=]\s*bearer|api[_-]?key\s*[:=]|password\s*[:=]|token\s*[:=]/i);
    expect(raw).not.toMatch(/[A-Z]:\\Users\\[^\\]+\\AppData/i);
  });
});
