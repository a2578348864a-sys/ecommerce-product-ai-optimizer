import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import type { KeywordReport, KeywordReportRow, KeywordReportType } from "@/lib/upstream/sellersprite/keywordReports";
import { KEYWORD_REPORT_SCHEMA } from "@/lib/upstream/sellersprite/keywordReports";

/**
 * 关键词 Evidence（seller-sprite-keyword-evidence.v1）——Phase 3/4 Save Evidence 闭环。
 * 存储：taskResultJson.keywordEvidence（writer 所有权契约，乐观并发）。
 * 流程：Preview（解析）→ Human bind（前端确认归属）→ Save（本模块）→ Workbench（读取）。
 */

export const KEYWORD_EVIDENCE_SCHEMA = "seller-sprite-keyword-evidence.v1" as const;
export const KEYWORD_EVIDENCE_NAMESPACE = "keywordEvidence" as const;

export type KeywordEvidenceV1 = {
  schema: typeof KEYWORD_EVIDENCE_SCHEMA;
  reportType: KeywordReportType;
  capturedAt: string;
  dataPeriod: null;
  rows: KeywordReportRow[];
  updatedAt: string;
};

export class KeywordEvidenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KeywordEvidenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseRow(value: unknown): KeywordReportRow | null {
  if (!isRecord(value)) return null;
  const rowNumber = typeof value.rowNumber === "number" ? value.rowNumber : null;
  const keyword = asString(value.keyword);
  if (rowNumber === null || !keyword) return null;
  const fields: Record<string, unknown> = {};
  if (isRecord(value.fields)) {
    for (const [field, fieldValue] of Object.entries(value.fields)) {
      if (isRecord(fieldValue)) {
        fields[field] = {
          raw: fieldValue.raw === null || typeof fieldValue.raw === "string" ? fieldValue.raw : null,
          normalized: fieldValue.normalized ?? null,
          metricNature: asString(fieldValue.metricNature, "unknown"),
          applicability: asString(fieldValue.applicability, "missing"),
        };
      }
    }
  }
  return {
    rowNumber,
    keyword,
    keywordTranslation: value.keywordTranslation === null || value.keywordTranslation === undefined
      ? null
      : asString(value.keywordTranslation),
    fields: fields as KeywordReportRow["fields"],
  };
}

export function parseKeywordEvidence(value: unknown): KeywordEvidenceV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== KEYWORD_EVIDENCE_SCHEMA) return null;
  const reportType = value.reportType;
  if (reportType !== "reverse_asin" && reportType !== "keyword_mining") return null;
  if (!Array.isArray(value.rows)) return null;
  const rows: KeywordReportRow[] = [];
  for (const item of value.rows) {
    const row = parseRow(item);
    if (!row) return null;
    rows.push(row);
  }
  const capturedAt = asString(value.capturedAt);
  if (!capturedAt) return null;
  return {
    schema: KEYWORD_EVIDENCE_SCHEMA,
    reportType,
    capturedAt,
    dataPeriod: null,
    rows,
    updatedAt: asString(value.updatedAt),
  };
}

export function keywordReportToEvidence(report: KeywordReport, updatedAt: string): KeywordEvidenceV1 {
  return {
    schema: KEYWORD_EVIDENCE_SCHEMA,
    reportType: report.reportType,
    capturedAt: report.capturedAt,
    dataPeriod: report.dataPeriod,
    rows: report.rows,
    updatedAt,
  };
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function readKeywordEvidenceSnapshot(
  context: AccessContext,
  taskId: string,
): Promise<{ updatedAt: Date | string; resultJson: string }> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) {
      throw new KeywordEvidenceError("not_found", 404, "任务不存在。");
    }
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) {
      throw new KeywordEvidenceError("not_found", 404, "任务不存在。");
    }
    return { updatedAt: task.updatedAt, resultJson: task.resultJson };
  }
  if (isSandboxTaskId(taskId)) {
    throw new KeywordEvidenceError("not_found", 404, "任务不存在。");
  }
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, updatedAt: true, resultJson: true },
  });
  if (!task) {
    throw new KeywordEvidenceError("not_found", 404, "任务不存在。");
  }
  return { updatedAt: task.updatedAt, resultJson: task.resultJson };
}

export async function getKeywordEvidence(
  context: AccessContext,
  taskId: string,
): Promise<KeywordEvidenceV1 | null> {
  const snapshot = await readKeywordEvidenceSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  const raw = result[KEYWORD_EVIDENCE_NAMESPACE];
  if (raw === undefined) return null;
  return parseKeywordEvidence(raw);
}

export async function saveKeywordEvidence(input: {
  context: AccessContext;
  taskId: string;
  evidence: KeywordEvidenceV1;
  expectedStorageVersion: { resultJsonHash: string; updatedAt: string };
}): Promise<KeywordEvidenceV1> {
  if (input.evidence.rows.length === 0) {
    throw new KeywordEvidenceError("no_valid_rows", 400, "没有可保存的关键词证据行。");
  }
  try {
    const mutation = await mutateTaskResultJson({
      context: input.context,
      taskId: input.taskId,
      writer: "keyword-evidence",
      expectedStorageVersion: input.expectedStorageVersion,
      mutate: (current) => {
        const next: KeywordEvidenceV1 = {
          ...input.evidence,
          updatedAt: new Date().toISOString(),
        };
        return {
          result: { ...current, [KEYWORD_EVIDENCE_NAMESPACE]: next },
          value: next,
        };
      },
    });
    return mutation.value;
  } catch (error) {
    if (error instanceof KeywordEvidenceError) throw error;
    if (error instanceof TaskResultJsonMutationError) {
      throw new KeywordEvidenceError(error.code, error.status, error.message);
    }
    throw error;
  }
}
