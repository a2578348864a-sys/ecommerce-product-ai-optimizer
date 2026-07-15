import { describe, expect, it } from "vitest";
import { STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_PHRASE } from "./stage2-alternative-source-probe-authorization";
import { runAuthorizedStage2AlternativeSourceCapabilityProbe } from "./run-stage2-alternative-source-capability-probe";

const required = {
  briefFile: process.env.STAGE2_ALTERNATIVE_PROBE_BRIEF_FILE,
  offlineValidationFile: process.env.STAGE2_ALTERNATIVE_PROBE_OFFLINE_VALIDATION_FILE,
  authorizationRequestFile: process.env.STAGE2_ALTERNATIVE_PROBE_AUTHORIZATION_REQUEST_FILE,
  researchFile: process.env.STAGE2_ALTERNATIVE_PROBE_RESEARCH_FILE,
  outputDirectory: process.env.STAGE2_ALTERNATIVE_PROBE_OUTPUT_DIRECTORY,
  authorizationPhrase: process.env.STAGE2_ALTERNATIVE_PROBE_AUTHORIZATION_PHRASE,
  capturedAt: process.env.STAGE2_ALTERNATIVE_PROBE_CAPTURED_AT,
};
const exactAuthorizationConfirmed = required.authorizationPhrase
  === STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_PHRASE;

describe("Stage 2 alternative source real capability probe runtime", () => {
  it.runIf(Object.values(required).every(Boolean) && exactAuthorizationConfirmed)(
    "consumes the exact single-use authorization and stays within the capability-only budget",
    async () => {
      const result = await runAuthorizedStage2AlternativeSourceCapabilityProbe(
        required as Record<keyof typeof required, string>,
      );
      expect(result.authorization.consumption.status).toBe("consumed");
      expect(result.run.externalActionBudget).toMatchObject({
        maximum: 2,
        policyUsed: 1,
      });
      expect(result.run.navigationBudget).toMatchObject({
        maximum: 1,
        productPageNavigations: 0,
        automaticRetryCount: 0,
      });
      expect(result.run.supplierFieldsCollected).toBe(0);
      expect(result.run.stage2SubmissionGenerated).toBe(false);
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
