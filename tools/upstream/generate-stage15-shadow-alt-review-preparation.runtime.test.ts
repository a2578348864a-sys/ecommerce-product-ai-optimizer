import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AltReviewRegistryEntry,
  Stage15ShadowAltReviewAccessRequest,
} from "./stage15-shadow-alt-review-contract";
import { generateStage15ShadowAltReviewPreparation } from "./generate-stage15-shadow-alt-review-preparation";

type ApprovedPreparationInput = {
  entries: AltReviewRegistryEntry[];
  queries: Stage15ShadowAltReviewAccessRequest["queries"];
};

function approvedPreparationInput(path: string): ApprovedPreparationInput {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ApprovedPreparationInput;
  if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.queries)) {
    throw new Error("SHADOW_ALT_REVIEW_APPROVED_INPUT_INVALID");
  }
  return parsed;
}

const run = process.env.RUN_STAGE15_SHADOW_ALT_REVIEW_PREPARATION === "1" ? it : it.skip;

describe("Stage 1.5 real Batch C alternative review preparation runtime", () => {
  run("validates and generates the explicit preparation set", () => {
    const batchDirectory = process.env.STAGE15_SHADOW_ALT_REVIEW_BATCH_DIR;
    const registryPath = process.env.STAGE15_SHADOW_ALT_REVIEW_REGISTRY_INPUT;
    const createdAt = process.env.STAGE15_SHADOW_ALT_REVIEW_CREATED_AT;
    if (!batchDirectory || !registryPath || !createdAt) {
      throw new Error("SHADOW_ALT_REVIEW_RUNTIME_INPUT_MISSING");
    }
    const approvedInput = approvedPreparationInput(registryPath);
    const result = generateStage15ShadowAltReviewPreparation({
      batchDirectory,
      registryEntries: approvedInput.entries,
      queries: approvedInput.queries,
      createdAt,
    });
    expect(result.readiness.status).toBe("pending_user_access_approval");
  });
});
