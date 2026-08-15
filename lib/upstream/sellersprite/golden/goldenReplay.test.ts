import { describe, expect, it } from "vitest";
import {
  detectSellerSpriteReportType,
} from "../reportType";
import { precheckSellerSpriteXlsx } from "../precheck";
import { GOLDEN_REPORT_CASES } from "./golden-cases";
import { createSellerSpritePreviewTestWorkbook } from "../../../../tools/upstream/sellersprite-preview/test-fixtures";

const CAPTURED_AT = "2026-08-14T02:00:00.000Z";

function caseById(id: string) {
  const caseItem = GOLDEN_REPORT_CASES.find((item) => item.id === id);
  if (!caseItem) throw new Error(`golden case not found: ${id}`);
  return caseItem;
}

function goldenWorkbook(caseItem: (typeof GOLDEN_REPORT_CASES)[number]) {
  const rows = caseItem.rows?.map((values) => {
    const record: Record<string, string> = {};
    caseItem.headers.forEach((header, index) => {
      const value = values[index];
      if (value !== null) record[header] = value;
    });
    return record;
  }) ?? [];
  return createSellerSpritePreviewTestWorkbook({
    headers: [...caseItem.headers],
    rows,
  });
}

describe("SellerSprite Golden Dataset — Parser Replay", () => {
  it.each(GOLDEN_REPORT_CASES)(
    "detect: $id ($name)",
    (caseItem) => {
      const first = detectSellerSpriteReportType(caseItem.headers, caseItem.rows);
      // deterministic：同输入两次运行结果一致
      const second = detectSellerSpriteReportType(caseItem.headers, caseItem.rows);
      expect(second).toEqual(first);

      expect(first.reportType).toBe(caseItem.expectedDetected);
      if (caseItem.expectedReasonCode !== undefined) {
        expect(first.reasonCode).toBe(caseItem.expectedReasonCode);
      }
      if (caseItem.expectedDetected === "unknown") {
        // fail-closed：unknown 必须带原因码
        expect(first.reasonCode).toBeTruthy();
      }
    },
  );

  it.each(GOLDEN_REPORT_CASES)(
    "precheck auto-detection: $id ($name)",
    (caseItem) => {
      const result = precheckSellerSpriteXlsx(goldenWorkbook(caseItem), {
        capturedAt: CAPTURED_AT,
      });
      if (caseItem.expectedDetected === "unknown") {
        expect(result.reportType).toBe("unknown");
        expect(result.reportTypeMatched).toBe(false);
        if (caseItem.precheckReasonCode !== false) {
          expect(result.detectionReasonCode).toBe(caseItem.expectedReasonCode);
        }
        expect(result.errors.some((error) => error.code === (caseItem.precheckErrorCode ?? "unsupported_report_type"))).toBe(true);
      } else {
        expect(result.reportType).toBe(caseItem.expectedDetected);
        expect(result.reportTypeMatched).toBe(true);
      }
    },
  );

  it.each(GOLDEN_REPORT_CASES.filter((caseItem) => caseItem.expectedWithExplicit !== undefined))(
    "precheck explicit selection: $id ($name)",
    (caseItem) => {
      const result = precheckSellerSpriteXlsx(goldenWorkbook(caseItem), {
        capturedAt: CAPTURED_AT,
        expectedReportType: caseItem.expectedWithExplicit,
      });
      if (caseItem.expectedExplicitMismatch === true) {
        // 强证据冲突：拒绝，如实报告检测结果
        expect(result.reportTypeMatched).toBe(false);
        expect(result.reportType).toBe(caseItem.expectedDetected);
        expect(result.errors.some((error) => error.code === "report_type_mismatch")).toBe(true);
        return;
      }
      // 人工选择覆盖（自动判定证据不足场景）：放行，但检测证据保留
      expect(result.reportType).toBe(caseItem.expectedWithExplicit);
      expect(result.reportTypeMatched).toBe(true);
      if (caseItem.expectedReasonCode !== undefined) {
        expect(result.detectionReasonCode).toBe(caseItem.expectedReasonCode);
      }
      expect(result.errors.some((error) => error.code === "unsupported_report_type")).toBe(false);
      expect(result.errors.some((error) => error.code === "report_type_mismatch")).toBe(false);
    },
  );

  it("auto-detection fails closed for new-format workbooks (no single-point BSR rule)", () => {
    const psCase = caseById("ps-no-search-rank-explicit");
    const psAuto = precheckSellerSpriteXlsx(goldenWorkbook(psCase), {
      capturedAt: CAPTURED_AT,
    });
    expect(psAuto.reportType).toBe("unknown");
    expect(psAuto.detectionReasonCode).toBe("ambiguous_ps_without_search_rank");
    expect(psAuto.reportTypeMatched).toBe(false);

    // 对抗样本：CC Top100（BSR 11..100 >10）不得因 BSR 数值误判为 Product Search
    const ccBeyond = caseById("cc-bsr-beyond-band");
    const ccAuto = precheckSellerSpriteXlsx(goldenWorkbook(ccBeyond), {
      capturedAt: CAPTURED_AT,
    });
    expect(ccAuto.reportType).toBe("unknown");
    expect(ccAuto.detectionReasonCode).toBe("ambiguous_ps_without_search_rank");
    expect(ccAuto.reportTypeMatched).toBe(false);
    // 显式选择 category_current 放行（结构合法），不产生 report_type_mismatch
    const ccExplicit = precheckSellerSpriteXlsx(goldenWorkbook(ccBeyond), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "category_current",
    });
    expect(ccExplicit.reportType).toBe("category_current");
    expect(ccExplicit.reportTypeMatched).toBe(true);
  });
});
