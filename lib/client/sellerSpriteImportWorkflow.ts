/**
 * SellerSprite Preview → Candidate import client workflow logic.
 *
 * Pure module (no React) so the full selection / import / result / navigation
 * behavior is unit-testable without a DOM. The preview panel consumes this.
 */
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";

export const SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS = 20;

export const SELLERSPRITE_IMPORT_FIELDS = [
  "file",
  "previewToken",
  "selectedRowHashesJson",
  "confirmed",
  "warningsAccepted",
] as const;

export type SellerSpriteImportResultRow = {
  rowHash: string;
  candidateId: string;
  reason?: string;
};

export type SellerSpriteImportResult = {
  created: SellerSpriteImportResultRow[];
  skipped: SellerSpriteImportResultRow[];
  conflicts: SellerSpriteImportResultRow[];
  warnings: unknown[];
};

// ── Selection state ──────────────────────────────

export function toggleRowSelection(current: readonly string[], rowHash: string): string[] {
  if (!rowHash) return [...current];
  return current.includes(rowHash)
    ? current.filter((hash) => hash !== rowHash)
    : [...current, rowHash];
}

export function selectAllRows(rowHashes: readonly string[]): {
  selected: string[];
  overLimit: boolean;
} {
  const unique = Array.from(new Set(rowHashes.filter(Boolean)));
  const overLimit = unique.length > SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS;
  return {
    selected: unique.slice(0, SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS),
    overLimit,
  };
}

export function isSelectionOverLimit(count: number): boolean {
  return count > SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS;
}

export function canOpenImportConfirmation(options: {
  selectedCount: number;
  hasImportToken: boolean;
  hasBlockingErrors: boolean;
  isImporting: boolean;
}): boolean {
  if (options.isImporting) return false;
  if (options.hasBlockingErrors) return false;
  if (!options.hasImportToken) return false;
  return options.selectedCount >= 1
    && options.selectedCount <= SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS;
}

export function processedRowHashes(result: SellerSpriteImportResult): Set<string> {
  return new Set([
    ...result.created.map((row) => row.rowHash),
    ...result.skipped.map((row) => row.rowHash),
  ]);
}

export function isImportConfirmationEnabled(options: {
  selectedCount: number;
  hasWarnings: boolean;
  warningsAcknowledged: boolean;
  isImporting: boolean;
}): boolean {
  if (options.isImporting) return false;
  if (options.selectedCount < 1) return false;
  if (options.hasWarnings && !options.warningsAcknowledged) return false;
  return true;
}

// ── Import request ───────────────────────────────

export function buildImportFormData(options: {
  file: File;
  previewToken: string;
  selectedRowHashesJson: string;
  confirmed: string;
  warningsAccepted: string;
}): FormData {
  const body = new FormData();
  body.set("file", options.file);
  body.set("previewToken", options.previewToken);
  body.set("selectedRowHashesJson", options.selectedRowHashesJson);
  body.set("confirmed", options.confirmed);
  body.set("warningsAccepted", options.warningsAccepted);
  return body;
}

export function serializeSelectedRowHashes(selected: readonly string[]): string {
  return JSON.stringify(selected);
}

// ── Import response parsing ──────────────────────

export function parseImportResponse(payload: unknown): SellerSpriteImportResult | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.ok !== true) return null;

  const parseRows = (value: unknown): SellerSpriteImportResultRow[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SellerSpriteImportResultRow[] => {
      if (typeof item !== "object" || item === null) return [];
      const row = item as Record<string, unknown>;
      if (typeof row.rowHash !== "string" || typeof row.candidateId !== "string") return [];
      return [{
        rowHash: row.rowHash,
        candidateId: row.candidateId,
        ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
      }];
    });
  };

  return {
    created: parseRows(record.created),
    skipped: parseRows(record.skipped),
    conflicts: parseRows(record.conflicts),
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
  };
}

// ── Error presentation (safe, no internals) ──────

const TOKEN_EXPIRY_CODES = new Set(["preview_token_expired", "preview_token_not_yet_valid"]);

export function isTokenExpiryCode(code: string): boolean {
  return TOKEN_EXPIRY_CODES.has(code);
}

export function importErrorToMessage(status: number, code: string): string {
  if (isTokenExpiryCode(code)) {
    return "预览已过期，请重新生成预览后再导入。";
  }
  if (status === 400) return "上传或选择参数错误，请检查后重试。";
  if (status === 401) return "登录状态已失效，请重新登录后继续。";
  if (status === 403) return "请求来源或身份验证失败，请重新登录后重试。";
  if (status === 415) return "文件格式不支持，请使用卖家精灵导出的 XLSX。";
  if (status === 422) return "文件、Token、选择或确认校验失败，请重新预览后重试。";
  if (status === 429) return "操作过于频繁，请稍后重试。";
  if (status === 500) return "系统暂时无法完成导入，请稍后重试。";
  return "导入失败，请稍后重试。";
}

// ── Continue-research navigation ─────────────────

export function buildCandidateResearchHref(candidateId: string): string | null {
  return buildCandidateAgentRunHref({ candidateId });
}
