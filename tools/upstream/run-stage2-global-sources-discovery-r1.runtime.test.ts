import { describe, expect, it } from "vitest";
import { GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE } from "./stage2-global-sources-discovery-r1-authorization";
import { runAuthorizedStage2GlobalSourcesDiscoveryR1 } from "./run-stage2-global-sources-discovery-r1";

const required = {
  briefFile: process.env.STAGE2_GLOBAL_SOURCES_R1_BRIEF_FILE,
  offlineValidationFile: process.env.STAGE2_GLOBAL_SOURCES_R1_OFFLINE_VALIDATION_FILE,
  authorizationRequestFile: process.env.STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_REQUEST_FILE,
  outputDirectory: process.env.STAGE2_GLOBAL_SOURCES_R1_OUTPUT_DIRECTORY,
  authorizationPhrase: process.env.STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_PHRASE,
  capturedAt: process.env.STAGE2_GLOBAL_SOURCES_R1_CAPTURED_AT,
};
const exactAuthorizationConfirmed = required.authorizationPhrase
  === GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE;

describe("Global Sources C1A-R1 single-use real runtime", () => {
  it.runIf(Object.values(required).every(Boolean) && exactAuthorizationConfirmed)(
    "consumes the grant once and preserves the one-policy/one-homepage fail-closed boundary",
    async () => {
      const result = await runAuthorizedStage2GlobalSourcesDiscoveryR1(
        required as Record<keyof typeof required, string>,
      );
      expect(result.authorization).toMatchObject({
        schemaVersion: "stage2-global-sources-discovery-authorization.v1",
        status: "granted_single_use",
        consumption: { status: "consumed", runId: result.run.runId },
      });
      expect(result.run).toMatchObject({
        schemaVersion: "stage2-global-sources-discovery-run.v1",
        realWebsiteAccessed: true,
        navigationBudget: {
          maximum: 1,
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
      expect(result.summary).toMatchObject({
        policyRequests: 1,
        searchPageNavigations: 0,
        productPageNavigations: 0,
        supplierFieldsCollected: 0,
        stage2SubmissionGenerated: false,
        candidateGenerated: false,
        databaseWritten: false,
      });
      if (result.run.browserSessionStarted) {
        expect(result.run.cleanup).toMatchObject({
          pageClosed: true,
          browserClosed: true,
          debugPortReleased: true,
          profileRemoved: true,
          browserProcessBaselineRestored: true,
        });
      }
      expect(result.artifactWrite.written).toHaveLength(5);
    },
    120_000,
  );
});
