import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AltReviewAccessLogEntry, AltReviewCapture, Stage15ShadowAltReviewAuthorization } from "./stage15-shadow-alt-review-contract";
import { generateStage15ShadowAltReviewResult } from "./generate-stage15-shadow-alt-review-result";

type ApprovedResultInput = {
  authorization: Stage15ShadowAltReviewAuthorization;
  accessLog: AltReviewAccessLogEntry[];
  captures: AltReviewCapture[];
};

const run = process.env.RUN_STAGE15_SHADOW_ALT_REVIEW_RESULT === "1" ? it : it.skip;

describe("Stage 1.5 real Batch C alternative review result runtime", () => {
  run("imports approved local captures and generates one immutable result set", () => {
    const batchDirectory = process.env.STAGE15_SHADOW_ALT_REVIEW_BATCH_DIR;
    const inputPath = process.env.STAGE15_SHADOW_ALT_REVIEW_RESULT_INPUT;
    const createdAt = process.env.STAGE15_SHADOW_ALT_REVIEW_CREATED_AT;
    if (!batchDirectory || !inputPath || !createdAt) throw new Error("SHADOW_ALT_REVIEW_RUNTIME_INPUT_MISSING");
    const input = JSON.parse(readFileSync(inputPath, "utf8")) as ApprovedResultInput;
    if (!input.authorization || !Array.isArray(input.accessLog) || !Array.isArray(input.captures)) {
      throw new Error("SHADOW_ALT_REVIEW_APPROVED_RESULT_INPUT_INVALID");
    }
    const result = generateStage15ShadowAltReviewResult({ batchDirectory, ...input, createdAt });
    expect(result.evidence.readiness.humanEvaluationAllowed).toBe(false);
  });
});
