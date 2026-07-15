import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";

const resultDirectory = process.env.STAGE2_GLOBAL_SOURCES_R1_RESULT_DIRECTORY;

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(resultDirectory!, name), "utf8")) as Record<string, unknown>;
}

function expectValidHash(value: Record<string, unknown>, key: "evidenceHash" | "inputHash") {
  const { [key]: hash, ...body } = value;
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(stableHash(body)).toBe(hash);
}

describe("Global Sources C1A-R1 saved real-result evidence", () => {
  it.runIf(Boolean(resultDirectory))(
    "recomputes every hash and verifies cross-file budgets without external access",
    () => {
      const authorization = readJson("stage2-global-sources-discovery-authorization.v1.json");
      const policyRequest = readJson("stage2-global-sources-robots-request.v1.json");
      const policyPreflight = readJson("stage2-global-sources-policy-preflight.v1.json");
      const run = readJson("stage2-global-sources-discovery-run.v1.json");
      const summary = readJson("generation-summary.stage2-global-sources-discovery.v1.json");

      expectValidHash(authorization, "evidenceHash");
      expectValidHash(policyRequest, "inputHash");
      expectValidHash(policyPreflight, "inputHash");
      expectValidHash(run, "evidenceHash");
      expectValidHash(summary, "evidenceHash");

      const consumption = authorization.consumption as Record<string, unknown>;
      expect(consumption).toMatchObject({ status: "consumed", runId: run.runId });
      expect(run).toMatchObject({
        authorizationEvidenceHash: authorization.evidenceHash,
        policyRequestInputHash: policyRequest.inputHash,
        policyPreflightInputHash: policyPreflight.inputHash,
        status: summary.status,
        errorCode: summary.errorCode,
        realWebsiteAccessed: true,
        navigationBudget: {
          maximum: 1,
          used: summary.homepageNavigations,
          searchPageNavigations: 0,
          productPageNavigations: 0,
          automaticRetryCount: 0,
        },
        externalActionBudget: { maximum: 2, policyUsed: 1 },
        supplierFieldsCollected: 0,
        stage2SubmissionGenerated: false,
        candidateGenerated: false,
        databaseWritten: false,
        externalAiOrPaidApiCalled: false,
      });
      expect(summary).toMatchObject({
        runId: run.runId,
        runEvidenceHash: run.evidenceHash,
        authorizationEvidenceHash: authorization.evidenceHash,
        policyRequests: 1,
        searchPageNavigations: 0,
        productPageNavigations: 0,
        supplierFieldsCollected: 0,
        stage2SubmissionGenerated: false,
        candidateGenerated: false,
        databaseWritten: false,
      });
      expect((run.externalActionBudget as Record<string, unknown>).totalUsed).toBe(
        1 + Number((run.navigationBudget as Record<string, unknown>).used),
      );
      if (run.browserSessionStarted === false) {
        expect(run).toMatchObject({ cleanup: null, page: null });
        expect((run.navigationBudget as Record<string, unknown>).used).toBe(0);
      }
    },
  );
});
