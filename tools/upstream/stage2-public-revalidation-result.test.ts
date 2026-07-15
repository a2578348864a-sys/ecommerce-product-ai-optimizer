import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2PublicRevalidationAuthorization } from "./run-stage2-public-revalidation";
import type { reviewStage2PublicRunEvidence } from "./run-stage2-public-evidence-collection";
import type { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import type { Stage2PublicRevalidationBrief } from "./stage2-public-revalidation-brief";
import { buildStage2PublicRevalidationResult } from "./stage2-public-revalidation-result";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const BRIEF_ROOT = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Public-Evidence-01/revalidation-authorization");
const RUN_ROOT = resolve(PROJECT_ROOT, "06_测试与验证/2026-07-15-Phase-Stage2-Public-Revalidation-01");

function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function inputs() {
  return {
    brief: read<Stage2PublicRevalidationBrief>(resolve(BRIEF_ROOT, "stage2-public-revalidation-brief.v1.json")),
    authorization: read<Stage2PublicRevalidationAuthorization>(
      resolve(RUN_ROOT, "stage2-public-revalidation-authorization.v1.json"),
    ),
    run: read<ReturnType<typeof buildStage2PublicRunEvidence>>(
      resolve(RUN_ROOT, "stage2-public-evidence-collection-run.v1.json"),
    ),
    review: read<ReturnType<typeof reviewStage2PublicRunEvidence>>(
      resolve(RUN_ROOT, "stage2-public-evidence-run-review.v1.json"),
    ),
  };
}

describe("Stage 2 public revalidation result", () => {
  it("binds the explicit authorization to an authoritative fail-closed result", () => {
    expect(buildStage2PublicRevalidationResult(inputs())).toMatchObject({
      schemaVersion: "stage2-public-revalidation-result.v1",
      status: "failed_closed",
      errorCode: "unexpected_origin_redirect",
      reasonCodes: ["search_intermediate_redirect_origin_not_allowed"],
      proofLevel: "authoritative_failure_evidence",
      navigationBudget: { maximum: 4, used: 1 },
      stage2EvidenceReady: false,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      },
    });
  });

  it("rejects a tampered authorization instead of blessing the run", () => {
    const input = inputs();
    input.authorization.scope.maxTotalNavigations = 3 as 4;
    expect(() => buildStage2PublicRevalidationResult(input))
      .toThrow("STAGE2_REVALIDATION_RESULT_AUTHORIZATION_INVALID");
  });
});
