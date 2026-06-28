/**
 * DB-Protection.1 — Listing Snapshot Post-Save Audit
 *
 * Lightweight audit log for successful listing snapshot saves.
 * Logs only metadata (counts), never the full snapshot content.
 *
 * Does NOT: print env, print full resultJson, call AI, touch DB schema.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const AUDIT_LOG_FILENAME = "listing-snapshot-save.audit.log";

function getAuditLogPath(): string {
  const projectRoot = resolve(process.cwd());
  const logsDir = join(projectRoot, "logs");
  mkdirSync(logsDir, { recursive: true });
  return join(logsDir, AUDIT_LOG_FILENAME);
}

type AuditEntry = {
  timestamp: string;
  taskId: string;
  snapshotType: string;
  source?: unknown;
  version?: unknown;
  titleCandidatesCount?: number;
  bulletPointsCount?: number;
  keywordsCount?: number;
  humanReviewRequired?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build audit metadata from a saved snapshot without including full content.
 */
export function buildAuditEntry(
  taskId: string,
  snapshot: unknown,
): AuditEntry {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    taskId,
    snapshotType: "",
    source: undefined,
    version: undefined,
    titleCandidatesCount: undefined,
    bulletPointsCount: undefined,
    keywordsCount: undefined,
    humanReviewRequired: undefined,
  };

  if (isRecord(snapshot)) {
    entry.snapshotType = typeof snapshot.snapshotType === "string" ? snapshot.snapshotType : "";
    entry.source = snapshot.source;
    entry.version = snapshot.version;
    if (Array.isArray(snapshot.titleCandidates)) {
      entry.titleCandidatesCount = snapshot.titleCandidates.length;
    }
    if (Array.isArray(snapshot.bulletPoints)) {
      entry.bulletPointsCount = snapshot.bulletPoints.length;
    }
    if (Array.isArray(snapshot.keywords)) {
      entry.keywordsCount = snapshot.keywords.length;
    }
    entry.humanReviewRequired = typeof snapshot.humanReviewRequired === "boolean"
      ? snapshot.humanReviewRequired
      : undefined;
  }

  return entry;
}

/**
 * Write an audit entry to the log file.
 * Fails silently — audit failure should NOT break the main save flow.
 */
export function writeAuditLog(entry: AuditEntry): void {
  try {
    const logPath = getAuditLogPath();
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(logPath, line, "utf-8");
  } catch {
    // Audit log write failure must not affect the main flow.
    // Log a minimal warning.
    try {
      console.warn("[listingSnapshotAudit] Failed to write audit log entry for task:", entry.taskId);
    } catch { /* ignore */ }
  }
}
