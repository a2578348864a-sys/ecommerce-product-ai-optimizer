import { describe, expect, it } from "vitest";
import { runStage2PublicRevalidation } from "./run-stage2-public-revalidation";

const required = {
  originalBriefFile: process.env.STAGE2_REVALIDATION_RUN_ORIGINAL_BRIEF_FILE,
  revalidationBriefFile: process.env.STAGE2_REVALIDATION_RUN_BRIEF_FILE,
  outputDirectory: process.env.STAGE2_REVALIDATION_RUN_OUTPUT_DIRECTORY,
  authorizedAt: process.env.STAGE2_REVALIDATION_RUN_AUTHORIZED_AT,
};
const authorizationConfirmed = process.env.STAGE2_REVALIDATION_USER_AUTHORIZATION_CONFIRMED === "true";

describe("Stage 2 public revalidation runtime", () => {
  it.runIf(Object.values(required).every(Boolean) && authorizationConfirmed)(
    "runs exactly once only after explicit revalidation authorization",
    async () => {
      const result = await runStage2PublicRevalidation({
        ...(required as Record<keyof typeof required, string>),
        userAuthorizationConfirmed: true,
      });
      expect(result.authorization.status).toBe("granted");
      expect(result.run.navigationBudget.used).toBeLessThanOrEqual(4);
      expect(result.run.cleanup).toMatchObject({
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      });
    },
    120_000,
  );
});
