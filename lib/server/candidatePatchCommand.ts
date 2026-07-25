/**
 * Phase 3F Reset-A2-2B — Candidate PATCH command parser.
 *
 * Only `status` and `sourceReviewAcknowledged` are allowed.
 * All other fields return `candidate_field_not_editable`.
 *
 * Pure function — no I/O, no Prisma, no HTTP, no React.
 */

import { isValidCandidateStatus, type CandidateStatus } from "@/lib/server/opportunityCandidateService";

// ── Types ────────────────────────────────────────

export type CandidatePatchCommand = Readonly<{
  status?: CandidateStatus;
  sourceReviewAcknowledged?: true;
}>;

export type CandidatePatchParseResult =
  | { ok: true; command: CandidatePatchCommand }
  | { ok: false; code: string; status: number; field?: string; message: string };

// ── Field classification ─────────────────────────

/** Fields that are permanently not editable via generic PATCH. */
const NON_EDITABLE_FIELDS = new Set([
  "name",
  "score",
  "link",
  "keyword",
  "risk",
  "riskLevel",
  "riskLabel",
  "summary",
  "summaryLabel",
  "rawInput",
  "source",
]);

/** */
const SOURCE_ANALYSIS_FIELDS = new Set([
  "sourceMetaJson",
  "analysisJson",
]);

/** Fields that are internal / scope / identity and must never be accepted. */
const INTERNAL_FIELDS = new Set([
  "id",
  "scopeId",
  "scopeKind",
  "subject",
  "subjectId",
  "demoAccessId",
  "createdAt",
  "updatedAt",
  "lastActionAt",
  "identityKey",
  "identityKeyVersion",
]);

/** Only these fields are allowed in a safe PATCH. */
const ALLOWED_FIELDS = new Set(["status", "sourceReviewAcknowledged"]);

/** Fields that constitute a source/analysis write attempt. */
const SOURCE_FIELDS = new Set([
  "sourceMetaJson",
  "analysisJson",
  "sourceEvidence",
  "ruleAssessment",
  "sourceProof",
]);

// ── Parser ───────────────────────────────────────

export function parseCandidatePatchCommand(
  rawBody: unknown,
): CandidatePatchParseResult {
  // Must be a plain object
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return error(400, "invalid_payload", "请求体必须是 JSON object。");
  }

  const body = rawBody as Record<string, unknown>;
  const keys = Object.keys(body);

  // Empty body
  if (keys.length === 0) {
    return error(400, "invalid_payload", "请求体不能为空。");
  }

  // ── Priority checks ───────────────────────────

  // 1) convertedTaskId — relationship lock (highest priority)
  if ("convertedTaskId" in body) {
    // Delegate to Route: this field exists, Route must return 409.
    // We signal this via a special result that the Route handles.
    return {
      ok: false,
      code: "candidate_task_link_locked",
      status: 409,
      message: "Candidate 与 Task 的关联只能由可信任务保存流程创建。",
    };
  }

  // 2) Unknown / internal / non-editable fields check (before status validation)
  for (const key of keys) {
    if (ALLOWED_FIELDS.has(key)) continue;

    if (INTERNAL_FIELDS.has(key)) {
      return error(400, "invalid_payload", "请求包含无效字段。");
    }

    if (SOURCE_ANALYSIS_FIELDS.has(key)) {
      // sourceMetaJson / analysisJson: pass through to Route
      // signed → existing 409 lock; legacy → 400 field_not_editable
      continue;
    }

    if (NON_EDITABLE_FIELDS.has(key)) {
      return {
        ok: false,
        code: "candidate_field_not_editable",
        status: 400,
        field: key,
        message: `Candidate 字段不可编辑: ${key}`,
      };
    }

    // Unknown field
    return error(400, "invalid_payload", "请求包含未知字段。");
  }

  // ── Build command ──────────────────────────────

  const command: { status?: CandidateStatus; sourceReviewAcknowledged?: true } = {};

  // status
  if ("status" in body) {
    const s = body.status;
    if (!isValidCandidateStatus(s)) {
      return error(400, "invalid_payload", "状态值不合法。");
    }
    command.status = s as CandidateStatus;
  }

  // sourceReviewAcknowledged
  if ("sourceReviewAcknowledged" in body) {
    if (body.sourceReviewAcknowledged === true) {
      command.sourceReviewAcknowledged = true;
    }
    // false / null / string → ignored, not persisted
  }

  // Must have at least one actionable field OR a source field (for route-level signed lock)
  const hasSourceField = keys.some((k) => SOURCE_ANALYSIS_FIELDS.has(k));
  if (command.status === undefined && command.sourceReviewAcknowledged !== true && !hasSourceField) {
    return error(400, "invalid_payload", "没有可执行的有效字段。");
  }

  return { ok: true, command };
}

// ── Helpers ──────────────────────────────────────

function error(status: number, code: string, message: string): CandidatePatchParseResult {
  return { ok: false, code, status, message };
}
