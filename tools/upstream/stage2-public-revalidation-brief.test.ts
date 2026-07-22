import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import type { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import type { reviewStage2PublicRunEvidence } from "./run-stage2-public-evidence-collection";
import {
  buildStage2PublicRevalidationBrief,
  validateStage2PublicRevalidationBrief,
} from "./stage2-public-revalidation-brief";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const ORIGINAL = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/08-Stage2-high-01取证授权材料/stage2-evidence-collection-brief.v1.json");
const RUN_ROOT = resolve(PROJECT_ROOT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Evidence-01");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function build() {
  return buildStage2PublicRevalidationBrief({
    originalBrief: readJson<Stage2EvidenceCollectionBrief>(ORIGINAL),
    failedRun: readJson<ReturnType<typeof buildStage2PublicRunEvidence>>(
      resolve(RUN_ROOT, "stage2-public-evidence-collection-run.v1.json"),
    ),
    failedReview: readJson<ReturnType<typeof reviewStage2PublicRunEvidence>>(
      resolve(RUN_ROOT, "stage2-public-evidence-run-review.v1.json"),
    ),
    createdAt: "2026-07-15T00:30:00.000Z",
  });
}

describe("Stage 2 public evidence revalidation brief", () => {
  it("binds the failed run, offline fixes, exact scope and pending authorization", () => {
    const brief = build();
    expect(brief).toMatchObject({
      schemaVersion: "stage2-public-revalidation-brief.v1",
      status: "pending_user_authorization",
      sampleId: "stage2-high-01",
      query: "hanging closet organizer 6 shelf grey",
      authorization: { status: "not_granted", authorizedAt: null, authorizedBy: null },
      requestedScope: {
        allowedOrigin: "https://www.alibaba.com",
        maxTotalNavigations: 4,
        maxSearchResultPages: 1,
        maxSupplierProductPages: 3,
        automaticRetryCount: 0,
      },
      fixProof: {
        everyRedirectOriginFailClosed: true,
        chromeInternalErrorClassified: true,
        diagnosticFinalUrlUsesDomLocation: true,
        privateBrowserStateProbeRejected: true,
        proofLevel: "offline_unit_and_full_regression_only",
      },
    });
    expect(validateStage2PublicRevalidationBrief(brief)).toMatchObject({
      status: "valid_pending_authorization",
      reasonCodes: [],
    });
  });

  it("changes its hash when a critical scope field changes and then fails validation", () => {
    const brief = build();
    const originalHash = brief.briefHash;
    brief.requestedScope.maxTotalNavigations = 3 as 4;
    expect(brief.briefHash).toBe(originalHash);
    expect(validateStage2PublicRevalidationBrief(brief)).toMatchObject({
      status: "invalid_hash",
      reasonCodes: expect.arrayContaining(["brief_hash_mismatch", "navigation_scope_invalid"]),
    });
  });

  it("does not turn the failed run or offline fix into authorization or success", () => {
    const brief = build();
    expect(brief.boundary).toMatchObject({
      thisBriefIsNotAuthorization: true,
      priorRunRemainsNonAuthoritative: true,
      noAutomaticWebsiteAccess: true,
      stage2SubmissionRequiresConfirmedVariant: true,
    });
    expect(brief.expectedResult).toEqual({
      successRequiresConfirmedSameVariant: true,
      failureStillWritesSanitizedRunEvidence: true,
      stage2SubmissionGeneratedAutomatically: false,
      candidateGenerated: false,
      databaseWritten: false,
    });
  });
});
