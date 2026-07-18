import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { generateStage15ShadowAltReviewResult } from "./generate-stage15-shadow-alt-review-result";
import { preparedFixture } from "./stage15-shadow-alt-review-test-fixtures";

const temporaryDirectories: string[] = [];

function resultFixture() {
  const fixture = preparedFixture();
  temporaryDirectories.push(fixture.batchDirectory);
  return fixture;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Stage 1.5 alternative review result generator", () => {
  it("writes a passed result only for two exact eligible products", () => {
    const root = resultFixture();
    const result = generateStage15ShadowAltReviewResult({
      batchDirectory: root.batchDirectory,
      authorization: root.authorization,
      accessLog: root.completeAccessLog,
      captures: [root.eligibleA, root.eligibleB, root.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    });
    expect(result.evidence.readiness.status).toBe("probe_passed_pending_full_budget");
    expect(result.evidence.readiness.humanEvaluationAllowed).toBe(false);
    expect(result.files).toContain("stage15-shadow-alt-review-access-authorization.v1.json");
    expect(result.files).toContain("stage15-shadow-alt-review-evidence-package.v1.json");
    expect(result.files).toHaveLength(12);
    const readiness = readFileSync(join(result.directory, "stage15-shadow-alt-review-readiness.v1.json"), "utf8");
    const summary = readFileSync(join(result.directory, "generation-summary.stage15-shadow-alt-review-result.v1.json"), "utf8");
    for (const forbidden of ["reviewerName", "avatar", "location", "orderId", "amazon.com"]) {
      expect(`${readiness}${summary}`).not.toContain(forbidden);
    }
  });

  it("rejects a result whose authorization drifted", () => {
    const root = resultFixture();
    expect(() => generateStage15ShadowAltReviewResult({
      batchDirectory: root.batchDirectory,
      authorization: { ...root.authorization, requestHash: "f".repeat(64) },
      accessLog: root.completeAccessLog,
      captures: [root.eligibleA, root.eligibleB, root.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_AUTHORIZATION_DRIFT");
  });

  it("rejects a missing or drifted capture source file", () => {
    const root = resultFixture();
    writeFileSync(join(root.batchDirectory, root.eligibleA.sourceCapture.relativePath), "tampered\n", "utf8");
    expect(() => generateStage15ShadowAltReviewResult({
      batchDirectory: root.batchDirectory,
      authorization: root.authorization,
      accessLog: root.completeAccessLog,
      captures: [root.eligibleA, root.eligibleB, root.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_CAPTURE_FILE_DRIFT");
  });

  it("does not overwrite a conflicting immutable execution set", () => {
    const root = resultFixture();
    const input = {
      batchDirectory: root.batchDirectory,
      authorization: root.authorization,
      accessLog: root.completeAccessLog,
      captures: [root.eligibleA, root.eligibleB, root.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    };
    const first = generateStage15ShadowAltReviewResult(input);
    writeFileSync(join(first.directory, "stage15-shadow-alt-review-readiness.v1.json"), "{\"tampered\":true}\n", "utf8");
    expect(() => generateStage15ShadowAltReviewResult(input)).toThrow("STAGE15_SHADOW_ALT_REVIEW_RESULT_CONFLICT");
  });

  it("rejects extra preparation files and capture paths outside the batch", () => {
    const extra = resultFixture();
    writeFileSync(join(extra.batchDirectory, "alternative-review-probe-v1", "preparation", "extra.json"), "{}\n", "utf8");
    expect(() => generateStage15ShadowAltReviewResult({
      batchDirectory: extra.batchDirectory,
      authorization: extra.authorization,
      accessLog: extra.completeAccessLog,
      captures: [extra.eligibleA, extra.eligibleB, extra.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_PREPARATION_SET_DRIFT");

    const escaped = resultFixture();
    const { captureHash: _captureHash, ...body } = escaped.eligibleA;
    void _captureHash;
    const escapedBody = { ...body, sourceCapture: { ...body.sourceCapture, relativePath: "../outside.txt" } };
    const capture = { ...escapedBody, captureHash: stableHash(escapedBody) };
    expect(() => generateStage15ShadowAltReviewResult({
      batchDirectory: escaped.batchDirectory,
      authorization: escaped.authorization,
      accessLog: escaped.completeAccessLog,
      captures: [capture, escaped.eligibleB, escaped.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_CAPTURE_FILE_DRIFT");
  });

  it("rejects non-file entries in the immutable preparation set", () => {
    const root = resultFixture();
    mkdirSync(join(root.batchDirectory, "alternative-review-probe-v1", "preparation", "unexpected-directory"));
    expect(() => generateStage15ShadowAltReviewResult({
      batchDirectory: root.batchDirectory,
      authorization: root.authorization,
      accessLog: root.completeAccessLog,
      captures: [root.eligibleA, root.eligibleB, root.identityConflictC],
      createdAt: "2026-07-17T10:00:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_PREPARATION_SET_DRIFT");
  });
});
