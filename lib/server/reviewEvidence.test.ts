import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  buildReviewContentHash,
  buildReviewDuplicateKey,
  buildReviewItem,
  clearReviews,
  computeDatasetStats,
  getReviewEvidence,
  importReviews,
  isValidAsin,
  normalizeReviewText,
  parseReviewEvidence,
  REVIEW_DATASET_MAX_PER_ASIN,
  REVIEW_DATASET_MAX_REVIEWS,
  REVIEW_TEXT_MAX_CHARS,
  ReviewEvidenceError,
} from "@/lib/server/reviewEvidence";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "review-evidence-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO_A = "demo-access-a";
const ASIN_A = "B0A1B2C3D4";
const ASIN_B = "B0E5F6G7H8";

function visitorContext(demoAccessId = DEMO_A) {
  return {
    mode: "demo" as const,
    token: `tok-${demoAccessId}`,
    demoAccessId,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function toStorageVersion(taskId: string, context = visitorContext()) {
  const task = getSandboxTask(context.demoAccessId, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

let taskId: string;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "review-evidence-"));
  const task = await createTrustedSandboxTask(
    DEMO_A,
    {
      type: "workflow",
      title: "Review Evidence Test",
      platform: "amazon",
      productUrl: null,
      materialText: "",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        sourceMeta: { source: "opportunity", candidateId: "candidate-review-evidence" },
        candidateToTask: { version: 1, candidateId: "candidate-review-evidence" },
      }),
      productLifecycle: "new_candidate",
      decisionStatus: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    } as Parameters<typeof createTrustedSandboxTask>[1],
  );
  taskId = task.id;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("review normalization & hashing", () => {
  it("normalizes whitespace and case for dedupe hashing", () => {
    expect(normalizeReviewText("  Great   product!!  ")).toBe("great product!!");
    expect(buildReviewContentHash("Great product!!")).toBe(buildReviewContentHash("  GREAT   PRODUCT!! "));
  });

  it("builds duplicate keys preferring reviewId", () => {
    const base = { asin: ASIN_A, contentHash: "h", rating: 5, reviewDate: "2026-01-01" };
    expect(buildReviewDuplicateKey({ ...base, reviewId: "R1" })).toBe("rid:R1");
    expect(buildReviewDuplicateKey({ ...base, reviewId: null })).toBe(`key:${ASIN_A}|h|5|2026-01-01`);
  });

  it("validates ASIN format", () => {
    expect(isValidAsin("B0A1B2C3D4")).toBe(true);
    expect(isValidAsin("b0a1b2c3d4")).toBe(false);
    expect(isValidAsin("B0A1B2C3")).toBe(false);
  });
});

describe("buildReviewItem (entity binding hard gate)", () => {
  it("builds a review with manual_confirmed binding and content hash", () => {
    const item = buildReviewItem({
      asin: ASIN_A,
      sourceProductRole: "competitor",
      reviewText: "  Fits great, but a little flimsy.  ",
      rating: 3,
      reviewId: "R123",
    }, NOW);
    expect(item.productAsin).toBe(ASIN_A);
    expect(item.sourceProductRole).toBe("competitor");
    expect(item.entityBindingProof).toEqual({
      asin: ASIN_A,
      sourceProductRole: "competitor",
      binding: "manual_confirmed",
      note: null,
    });
    expect(item.reviewText).toBe("Fits great, but a little flimsy.");
    expect(item.nature).toBe("review_observation");
    expect(item.duplicateKey).toBe("rid:R123");
    expect(item.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid ASIN and invalid rating", () => {
    const expectCode = (fn: () => void, code: string) => {
      try {
        fn();
        throw new Error(`expected ${code} but succeeded`);
      } catch (error) {
        expect((error as { code?: string }).code).toBe(code);
      }
    };
    expectCode(() => buildReviewItem({ asin: "BAD", sourceProductRole: "current_candidate", reviewText: "x" }, NOW), "invalid_asin");
    expectCode(() => buildReviewItem({ asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "x", rating: 6 }, NOW), "invalid_rating");
  });

  it("rejects empty and oversized review text", () => {
    const expectCode = (fn: () => void, code: string) => {
      try {
        fn();
        throw new Error(`expected ${code} but succeeded`);
      } catch (error) {
        expect((error as { code?: string }).code).toBe(code);
      }
    };
    expectCode(() => buildReviewItem({ asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "   " }, NOW), "invalid_review_text");
    expectCode(() => buildReviewItem({ asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "x".repeat(REVIEW_TEXT_MAX_CHARS + 1) }, NOW), "review_text_too_long");
  });
});

describe("reviewEvidence import (visitor sandbox)", () => {
  it("reads null when namespace absent, imports reviews with stats", async () => {
    const context = visitorContext();
    expect(await getReviewEvidence(context, taskId)).toBeNull();

    const outcome = await importReviews({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [
        { asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "Love it, very sturdy.", rating: 5 },
        { asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "Too heavy for travel.", rating: 2 },
        { asin: ASIN_B, sourceProductRole: "competitor", reviewText: "Cheaper but leaks.", rating: 1, reviewId: "CB1" },
      ],
    });
    expect(outcome.kind).toBe("saved");
    expect(outcome.importedCount).toBe(3);
    expect(outcome.duplicateCount).toBe(0);
    const stats = outcome.evidence.dataset.stats;
    expect(stats.totalReviews).toBe(3);
    expect(stats.positiveCount).toBe(1);
    expect(stats.negativeCount).toBe(2);
    expect(stats.neutralCount).toBe(0);
    expect(stats.sourceProductCount).toBe(2);
    expect(stats.currentCandidateCount).toBe(2);
    expect(stats.competitorCount).toBe(1);
    expect(outcome.evidence.candidateId).toBe("candidate-review-evidence");
  });

  it("dedupes identical reviews (reviewId and asin+hash+rating+date)", async () => {
    const context = visitorContext();
    await importReviews({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [
        { asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "Same review text", rating: 4 },
      ],
    });
    const second = await importReviews({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [
        { asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "same review text  ", rating: 4 }, // 规范化后相同
        { asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "Same review text", rating: 5, reviewId: "R9" }, // reviewId 不同 → 新条目
      ],
    });
    expect(second.importedCount).toBe(1);
    expect(second.duplicateCount).toBe(1);
    const evidence = await getReviewEvidence(context, taskId);
    expect(evidence!.dataset.reviews).toHaveLength(2);
  });

  it("enforces per-ASIN and total dataset bounds with explicit rejection", async () => {
    const context = visitorContext();
    // 填满 ASIN_A 的 per-ASIN 上限
    const reviews = Array.from({ length: REVIEW_DATASET_MAX_PER_ASIN + 5 }, (_, index) => ({
      asin: ASIN_A,
      sourceProductRole: "current_candidate" as const,
      reviewText: `Review number ${index}`,
      rating: 4,
      reviewId: `A-${index}`,
    }));
    const outcome = await importReviews({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      reviews,
    });
    expect(outcome.importedCount).toBe(REVIEW_DATASET_MAX_PER_ASIN);
    expect(outcome.rejectedCount).toBe(5);
    const evidence = await getReviewEvidence(context, taskId);
    expect(evidence!.dataset.reviews).toHaveLength(REVIEW_DATASET_MAX_PER_ASIN);
    expect(evidence!.dataset.reviews.every((review) => review.productAsin === ASIN_A)).toBe(true);
  });

  it("rejects imports that would exceed the total dataset limit", async () => {
    const context = visitorContext();
    const ASINS = [ASIN_A, ASIN_B, "B0C7D8E9F0"];
    const fill = Array.from({ length: REVIEW_DATASET_MAX_REVIEWS }, (_, index) => ({
      asin: ASINS[index % 3],
      sourceProductRole: (index % 3 === 0 ? "current_candidate" : "competitor") as "current_candidate" | "competitor",
      reviewText: `Review ${index}`,
      rating: 3,
      reviewId: `R-${index}`,
    }));
    await importReviews({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), reviews: fill });
    // 用全新 ASIN 的评论触发总数据集上限（避免撞 per-ASIN 上限）
    await expect(
      importReviews({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), reviews: [
        { asin: "B0C7D8E9F1", sourceProductRole: "competitor", reviewText: "Over the limit", rating: 3, reviewId: "R-OVER" },
      ] }),
    ).rejects.toMatchObject({ code: "review_dataset_limit", status: 409 });
  });

  it("clear empties dataset and removes stale vocAnalysis", async () => {
    const context = visitorContext();
    await importReviews({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [{ asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "Only review", rating: 4 }],
    });
    // 手工塞一个 vocAnalysis 占位（同 writer 允许）
    const { mutateTaskResultJson } = await import("@/lib/server/taskResultJsonMutation");
    await mutateTaskResultJson({
      context,
      taskId,
      writer: "review-evidence",
      expectedStorageVersion: toStorageVersion(taskId),
      mutate: (current) => ({
        result: { ...current, vocAnalysis: { schema: "voc-analysis.v1", version: 1, runId: "run-1", inputEvidenceHash: "h", themes: {} } },
        value: { saved: true },
      }),
    });
    const cleared = await clearReviews({ context, taskId, expectedStorageVersion: toStorageVersion(taskId) });
    expect(cleared.cleared).toBe(true);
    const evidence = await getReviewEvidence(context, taskId);
    expect(evidence!.dataset.reviews).toHaveLength(0);
    const snapshot = getSandboxTask(DEMO_A, taskId)!;
    const result = JSON.parse(snapshot.resultJson) as Record<string, unknown>;
    expect(result.vocAnalysis).toBeUndefined();
  });

  it("rejects malformed stored namespaces fail-soft (read)", async () => {
    const context = visitorContext();
    expect(parseReviewEvidence({ schema: "review-evidence.v2", version: 1, dataset: { reviews: [] } })).toBeNull();
    expect(parseReviewEvidence(null)).toBeNull();
    expect(parseReviewEvidence({ schema: "review-evidence.v1", version: 1, dataset: { reviews: [{ broken: true }] } })).toBeNull();
  });

  it("isolation: visitor cannot read another sandbox's data", async () => {
    const context = visitorContext();
    await importReviews({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      reviews: [{ asin: ASIN_A, sourceProductRole: "current_candidate", reviewText: "private", rating: 4 }],
    });
    // 另一个 visitor 访问同一 sandbox task id（不属于它）→ 404
    const other = visitorContext("demo-access-b");
    await expect(getReviewEvidence(other, taskId)).rejects.toBeInstanceOf(ReviewEvidenceError);
  });
});
