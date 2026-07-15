import { describe, expect, it } from "vitest";
import { STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_PHRASE } from "./stage2-alternative-source-probe-reauthorization";
import { runAuthorizedStage2AlternativeSourceCapabilityProbe } from "./run-stage2-alternative-source-capability-probe";

const required = {
  briefFile: process.env.STAGE2_ALTERNATIVE_PROBE_02_BRIEF_FILE,
  offlineValidationFile: process.env.STAGE2_ALTERNATIVE_PROBE_02_OFFLINE_VALIDATION_FILE,
  authorizationRequestFile: process.env.STAGE2_ALTERNATIVE_PROBE_02_AUTHORIZATION_REQUEST_FILE,
  priorAuthorizationFile: process.env.STAGE2_ALTERNATIVE_PROBE_02_PRIOR_AUTHORIZATION_FILE,
  priorRunFile: process.env.STAGE2_ALTERNATIVE_PROBE_02_PRIOR_RUN_FILE,
  unknownPageDiagnosticValidationFile:
    process.env.STAGE2_ALTERNATIVE_PROBE_02_UNKNOWN_PAGE_DIAGNOSTIC_VALIDATION_FILE,
  researchFile: process.env.STAGE2_ALTERNATIVE_PROBE_02_RESEARCH_FILE,
  outputDirectory: process.env.STAGE2_ALTERNATIVE_PROBE_02_OUTPUT_DIRECTORY,
  authorizationPhrase: process.env.STAGE2_ALTERNATIVE_PROBE_02_AUTHORIZATION_PHRASE,
  capturedAt: process.env.STAGE2_ALTERNATIVE_PROBE_02_CAPTURED_AT,
};
const exactAuthorizationConfirmed = required.authorizationPhrase
  === STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_PHRASE;

describe("Stage 2 alternative-source Capability-Probe-02 runtime", () => {
  it.runIf(Object.values(required).every(Boolean) && exactAuthorizationConfirmed)(
    "consumes the v2 grant once and preserves the zero-product-page fail-closed budget",
    async () => {
      const result = await runAuthorizedStage2AlternativeSourceCapabilityProbe(
        required as Record<keyof typeof required, string>,
      );
      expect(result.authorization).toMatchObject({
        schemaVersion: "stage2-alternative-source-capability-probe-authorization.v2",
        status: "granted_single_use",
        consumption: { status: "consumed", runId: result.run.runId },
      });
      expect(result.run.externalActionBudget).toMatchObject({ maximum: 2, policyUsed: 1 });
      expect(result.run.navigationBudget).toMatchObject({
        maximum: 1,
        productPageNavigations: 0,
        automaticRetryCount: 0,
      });
      expect(result.run).toMatchObject({
        schemaVersion: "stage2-alternative-source-capability-probe-run.v3",
        supplierFieldsCollected: 0,
        stage2SubmissionGenerated: false,
        candidateGenerated: false,
        databaseWritten: false,
        externalAiOrPaidApiCalled: false,
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
    },
    120_000,
  );
});
