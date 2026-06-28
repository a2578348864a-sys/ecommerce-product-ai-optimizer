/**
 * DB-Protection.1 — Listing Snapshot Audit Tests
 *
 * Tests buildAuditEntry and writeAuditLog behavior.
 * Does NOT: read .env, call AI, output full resultJson, touch DB.
 */

import { describe, expect, it } from "vitest";
import { buildAuditEntry, writeAuditLog } from "./listingSnapshotAudit";

const fullSnapshot = {
  snapshotType: "ai_listing_pack",
  source: "real_ai_draft",
  version: 1,
  savedAt: "2026-06-29T00:00:00.000Z",
  titleCandidates: ["Title A", "Title B", "Title C"],
  bulletPoints: ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
  keywords: ["kw1", "kw2", "kw3"],
  humanReviewRequired: true,
  listings: [],
};

describe("listingSnapshotAudit", () => {
  it("builds audit entry with counts but not full content", () => {
    const entry = buildAuditEntry("task-123", fullSnapshot);
    expect(entry.taskId).toBe("task-123");
    expect(entry.snapshotType).toBe("ai_listing_pack");
    expect(entry.source).toBe("real_ai_draft");
    expect(entry.version).toBe(1);
    expect(entry.titleCandidatesCount).toBe(3);
    expect(entry.bulletPointsCount).toBe(5);
    expect(entry.keywordsCount).toBe(3);
    expect(entry.humanReviewRequired).toBe(true);
    // Must NOT include full content
    expect((entry as any).titleCandidates).toBeUndefined();
    expect((entry as any).bulletPoints).toBeUndefined();
    expect((entry as any).keywords).toBeUndefined();
    expect((entry as any).listings).toBeUndefined();
  });

  it("handles null/undefined snapshot gracefully", () => {
    const entry = buildAuditEntry("task-456", null);
    expect(entry.taskId).toBe("task-456");
    expect(entry.snapshotType).toBe("");
    expect(entry.titleCandidatesCount).toBeUndefined();
  });

  it("handles snapshot with missing fields gracefully", () => {
    const entry = buildAuditEntry("task-789", { snapshotType: "ai_listing_pack" });
    expect(entry.snapshotType).toBe("ai_listing_pack");
    expect(entry.source).toBeUndefined();
    expect(entry.titleCandidatesCount).toBeUndefined();
    expect(entry.bulletPointsCount).toBeUndefined();
  });

  it("writeAuditLog does not throw on any input", () => {
    // Must never throw — audit failure should not affect main flow
    expect(() => writeAuditLog(buildAuditEntry("task-safe", fullSnapshot))).not.toThrow();
  });
});
