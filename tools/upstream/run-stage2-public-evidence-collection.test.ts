import { describe, expect, it } from "vitest";
import { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import { reviewStage2PublicRunEvidence } from "./run-stage2-public-evidence-collection";

describe("Stage 2 public run review", () => {
  it("invalidates a run that continued after an unexpected intermediate redirect", () => {
    const run = buildStage2PublicRunEvidence({
      runId: "run-1",
      briefId: "brief-1",
      briefHash: "a".repeat(64),
      capturedAt: "2026-07-14T16:00:00.000Z",
      status: "failed",
      errorCode: "unexpected_origin_redirect",
      reasonCodes: ["final_origin_not_allowed"],
      pages: [
        {
          requestedOrigin: "https://www.alibaba.com",
          requestedPath: "/trade/search",
          finalOrigin: "https://www.alibaba.com",
          finalPath: "/trade/search",
          redirectCount: 1,
          redirectOrigins: ["http://www.alibaba.com"],
          httpStatus: 200,
          contentType: "text/html",
          navigationElapsedMs: 10,
          domWaitElapsedMs: 5,
          readyState: "complete",
          title: "Alibaba",
          visibleTextLength: 100,
          diagnosticTextHash: "b".repeat(64),
          classification: "search_results",
          classificationReasonCodes: [],
          productLinks: [],
          productTitle: null,
          objectiveFields: null,
          variantIdentity: null,
        },
        {
          requestedOrigin: "https://www.alibaba.com",
          requestedPath: "/product-detail/a.html",
          finalOrigin: "https://www.alibaba.com",
          finalPath: "/product-detail/a.html",
          redirectCount: 0,
          redirectOrigins: [],
          httpStatus: 200,
          contentType: "text/html",
          navigationElapsedMs: 10,
          domWaitElapsedMs: 5,
          readyState: "complete",
          title: "",
          visibleTextLength: 0,
          diagnosticTextHash: "c".repeat(64),
          classification: "unexpected_origin_redirect",
          classificationReasonCodes: [],
          productLinks: [],
          productTitle: null,
          objectiveFields: null,
          variantIdentity: null,
        },
      ],
      navigationBudget: { maximum: 4, used: 2 },
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      },
    });
    expect(reviewStage2PublicRunEvidence(run)).toMatchObject({
      status: "non_authoritative_failed_evidence",
      reasonCodes: [
        "unexpected_intermediate_redirect_origin",
        "collector_continued_after_fail_closed_redirect",
        "page_classification_conflicts_with_recorded_final_origin",
      ],
      realWebsiteRerunPerformed: false,
      stage2SubmissionEligible: false,
    });
  });
});
