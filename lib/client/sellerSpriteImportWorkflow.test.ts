import { describe, expect, it } from "vitest";
import {
  buildCandidateResearchHref,
  buildImportFormData,
  canOpenImportConfirmation,
  importErrorToMessage,
  isImportConfirmationEnabled,
  isSelectionOverLimit,
  isTokenExpiryCode,
  parseImportResponse,
  processedRowHashes,
  SELLERSPRITE_IMPORT_FIELDS,
  SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS,
  selectAllRows,
  serializeSelectedRowHashes,
  toggleRowSelection,
} from "@/lib/client/sellerSpriteImportWorkflow";

const H = (n: number) => `${String(n).padStart(64, "a")}`;
const rowHashes = Array.from({ length: 25 }, (_, i) => H(i + 1));

function sampleFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "sample.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("SellerSprite import workflow", () => {
  describe("selection state", () => {
    it("toggles a single row on and off (rowHash identity only)", () => {
      const added = toggleRowSelection([], rowHashes[0]);
      expect(added).toEqual([rowHashes[0]]);
      const removed = toggleRowSelection(added, rowHashes[0]);
      expect(removed).toEqual([]);
    });

    it("selects all rows but caps at 20 and reports the overflow explicitly", () => {
      const { selected, overLimit } = selectAllRows(rowHashes);
      expect(selected).toHaveLength(SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS);
      expect(overLimit).toBe(true);
      expect(isSelectionOverLimit(rowHashes.length)).toBe(true);
    });

    it("select-all deduplicates and respects order of first appearance", () => {
      const { selected } = selectAllRows([rowHashes[1], rowHashes[0], rowHashes[1]]);
      expect(selected).toEqual([rowHashes[1], rowHashes[0]]);
    });
  });

  describe("import gating", () => {
    it("disables import without a token, with blocking errors, with zero selection, or while importing", () => {
      expect(canOpenImportConfirmation({ selectedCount: 1, hasImportToken: false, hasBlockingErrors: false, isImporting: false })).toBe(false);
      expect(canOpenImportConfirmation({ selectedCount: 1, hasImportToken: true, hasBlockingErrors: true, isImporting: false })).toBe(false);
      expect(canOpenImportConfirmation({ selectedCount: 0, hasImportToken: true, hasBlockingErrors: false, isImporting: false })).toBe(false);
      expect(canOpenImportConfirmation({ selectedCount: 1, hasImportToken: true, hasBlockingErrors: false, isImporting: true })).toBe(false);
      expect(canOpenImportConfirmation({ selectedCount: 1, hasImportToken: true, hasBlockingErrors: false, isImporting: false })).toBe(true);
    });

    it("caps the allowed selection at 20", () => {
      const over = Array.from({ length: 21 }, (_, i) => H(i + 1));
      const { selected, overLimit } = selectAllRows(over);
      expect(selected).toHaveLength(20);
      expect(overLimit).toBe(true);
    });
  });

  describe("confirmation gate", () => {
    it("requires selection, and requires warning acknowledgement when warnings exist", () => {
      expect(isImportConfirmationEnabled({ selectedCount: 0, hasWarnings: false, warningsAcknowledged: false, isImporting: false })).toBe(false);
      expect(isImportConfirmationEnabled({ selectedCount: 1, hasWarnings: false, warningsAcknowledged: false, isImporting: false })).toBe(true);
      expect(isImportConfirmationEnabled({ selectedCount: 1, hasWarnings: true, warningsAcknowledged: false, isImporting: false })).toBe(false);
      expect(isImportConfirmationEnabled({ selectedCount: 1, hasWarnings: true, warningsAcknowledged: true, isImporting: false })).toBe(true);
      expect(isImportConfirmationEnabled({ selectedCount: 1, hasWarnings: false, warningsAcknowledged: false, isImporting: true })).toBe(false);
    });
  });

  describe("import request construction", () => {
    it("builds a FormData with exactly the allowed fields and the original File object", () => {
      const file = sampleFile();
      const body = buildImportFormData({
        file,
        previewToken: "preview-import-v1.token",
        selectedRowHashesJson: JSON.stringify([rowHashes[0]]),
        confirmed: "true",
        warningsAccepted: "false",
      });
      const keys = [...body.keys()].sort();
      expect(keys).toEqual([...SELLERSPRITE_IMPORT_FIELDS].sort());
      expect(body.get("file")).toBe(file);
      expect(body.get("previewToken")).toBe("preview-import-v1.token");
      expect(body.get("selectedRowHashesJson")).toBe(JSON.stringify([rowHashes[0]]));
      expect(body.get("confirmed")).toBe("true");
      expect(body.get("warningsAccepted")).toBe("false");
    });

    it("serializes selected row hashes in selection order", () => {
      const selected = [rowHashes[2], rowHashes[0], rowHashes[1]];
      expect(serializeSelectedRowHashes(selected)).toBe(JSON.stringify(selected));
    });
  });

  describe("import response parsing", () => {
    it("normalizes created / skipped / conflicts and keeps candidateIds from the response", () => {
      const payload = {
        ok: true,
        created: [{ rowHash: rowHashes[0], candidateId: "cand-created" }],
        skipped: [{ rowHash: rowHashes[1], candidateId: "cand-skipped", reason: "already_imported" }],
        conflicts: [{ rowHash: rowHashes[2], candidateId: "cand-existing", reason: "candidate_exists_with_different_snapshot" }],
        warnings: [],
      };
      const result = parseImportResponse(payload);
      expect(result).not.toBeNull();
      expect(result!.created[0].candidateId).toBe("cand-created");
      expect(result!.skipped[0].candidateId).toBe("cand-skipped");
      expect(result!.conflicts[0].candidateId).toBe("cand-existing");
      expect(processedRowHashes(result!).has(rowHashes[0])).toBe(true);
      expect(processedRowHashes(result!).has(rowHashes[1])).toBe(true);
      expect(processedRowHashes(result!).has(rowHashes[2])).toBe(false);
    });

    it("returns null for non-ok or malformed payloads", () => {
      expect(parseImportResponse({ ok: false })).toBeNull();
      expect(parseImportResponse(null)).toBeNull();
      expect(parseImportResponse({ ok: true, created: [{ rowHash: "x" }] })).not.toBeNull();
    });
  });

  describe("error presentation", () => {
    it("maps every HTTP status to a safe user-facing message without internals", () => {
      const messages = [
        importErrorToMessage(400, "invalid_selected_rows"),
        importErrorToMessage(401, "invalid_access"),
        importErrorToMessage(403, "preview_token_subject_mismatch"),
        importErrorToMessage(415, "xlsx_required"),
        importErrorToMessage(422, "preview_token_file_mismatch"),
        importErrorToMessage(429, "rate_limited"),
        importErrorToMessage(500, "unexpected"),
        importErrorToMessage(0, "network_error"),
      ];
      for (const message of messages) {
        expect(message.length).toBeGreaterThan(0);
        // No internals: no stack traces, raw token values, signing material,
        // credentials, or visitor access codes in user-facing messages.
        expect(message).not.toMatch(/preview-import-v1\.|SIGNING_KEY|stack|at \w+ \(/i);
        expect(message).not.toMatch(/secret|access.?password|password[:=]|visitor.?access/i);
      }
    });

    it("detects token expiry codes", () => {
      expect(isTokenExpiryCode("preview_token_expired")).toBe(true);
      expect(isTokenExpiryCode("preview_token_not_yet_valid")).toBe(true);
      expect(isTokenExpiryCode("preview_token_file_mismatch")).toBe(false);
    });

    it("expiry messages instruct to regenerate the preview", () => {
      expect(importErrorToMessage(422, "preview_token_expired")).toContain("重新生成预览");
    });
  });

  describe("continue-research navigation", () => {
    it("builds the canonical /agent/run href with the server candidateId only", () => {
      const href = buildCandidateResearchHref("candidate-owner-001");
      expect(href).toBe("/agent/run?source=opportunity&candidateId=candidate-owner-001");
    });

    it("returns null for a local draft id so no forged navigation happens", () => {
      expect(buildCandidateResearchHref("opp-local123")).toBeNull();
    });

    it("takes candidateId only from the server import response, never from rowHash or ASIN fields", () => {
      // parseImportResponse only reads candidateId from the payload; a row
      // carrying rowHash but no candidateId is dropped, so the workflow
      // never has a candidateId to navigate with from a rowHash alone.
      const result = parseImportResponse({
        ok: true,
        created: [{ rowHash: "a".repeat(64) }],
        skipped: [],
        conflicts: [],
        warnings: [],
      });
      expect(result!.created).toHaveLength(0);
      const withId = parseImportResponse({
        ok: true,
        created: [{ rowHash: "a".repeat(64), candidateId: "candidate-server-1" }],
        skipped: [],
        conflicts: [],
        warnings: [],
      });
      expect(buildCandidateResearchHref(withId!.created[0].candidateId))
        .toBe("/agent/run?source=opportunity&candidateId=candidate-server-1");
    });
  });
});
