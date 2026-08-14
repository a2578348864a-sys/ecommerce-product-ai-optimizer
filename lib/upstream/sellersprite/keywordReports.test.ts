import { describe, expect, it } from "vitest";
import {
  GOLDEN_KEYWORD_MINING_HEADERS,
  GOLDEN_KEYWORD_MINING_ROWS,
  GOLDEN_REVERSE_ASIN_HEADERS,
  GOLDEN_REVERSE_ASIN_ROWS,
} from "./golden/golden-keyword-reports";
import {
  parseKeywordReport,
  ratioToPercent,
} from "./keywordReports";
import { detectKeywordReportType } from "./reportType";

function rowValues(row: Readonly<Record<string, string>>, headers: ReadonlyArray<string>): (string | null)[] {
  return headers.map((header) => row[header] ?? null);
}

describe("SellerSprite keyword reports (Reverse ASIN / Keyword Mining)", () => {
  it("detects report types from real header signatures", () => {
    expect(detectKeywordReportType(GOLDEN_REVERSE_ASIN_HEADERS)).toBe("reverse_asin");
    expect(detectKeywordReportType(GOLDEN_KEYWORD_MINING_HEADERS)).toBe("keyword_mining");
    expect(detectKeywordReportType(["#", "ASIN", "商品标题"])).toBeNull();
  });

  it("parses Reverse ASIN with 0-1 ratios stored raw, supplyDemandRatio not x100", () => {
    const result = parseKeywordReport({
      headers: GOLDEN_REVERSE_ASIN_HEADERS,
      rows: GOLDEN_REVERSE_ASIN_ROWS.map((row) => rowValues(row, GOLDEN_REVERSE_ASIN_HEADERS)),
      capturedAt: "2026-08-15T02:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.reportType).toBe("reverse_asin");
    expect(result.report.schema).toBe("sellersprite-keyword-report.v1");
    expect(result.report.dataPeriod).toBeNull();
    expect(result.report.rows).toHaveLength(5);

    const row = result.report.rows[0];
    expect(row.keyword).toBe("golden bottle");
    expect(row.fields.trafficShare).toMatchObject({ normalized: 0.2949, metricNature: "snapshot" });
    expect(row.fields.purchaseRate).toMatchObject({ normalized: 0.0031 });
    // 需供比：比率，不 ×100
    expect(row.fields.supplyDemandRatio).toMatchObject({ normalized: 1778.8 });
    expect(ratioToPercent(row.fields.trafficShare.normalized as number)).toBe("29.5%");
    // 自然排名页码派生对象
    expect(row.fields.naturalRankPage).toMatchObject({
      normalized: { page: 1, position: 5, total: 59 },
      metricNature: "derived",
    });
    // PPC 价格 / 竞价范围
    expect(row.fields.ppcBid).toMatchObject({ normalized: 3.22 });
    expect(row.fields.bidRange).toMatchObject({ normalized: { min: 2.42, max: 4.03 } });
    // 前十 ASIN 拆分
    expect(row.fields.top10Asins).toMatchObject({ normalized: ["B0GOLD0001", "B0GOLD0002", "B0GOLD0003"] });
    // 空值列（广告流量占比 / 广告排名页码）→ missing，不强造
    expect(row.fields.adTrafficShare).toMatchObject({ normalized: null, applicability: "missing" });
    expect(row.fields.adRankPage).toMatchObject({ normalized: null, applicability: "missing" });
  });

  it("parses Keyword Mining with real fields incl. ABA ranks and relevance", () => {
    const result = parseKeywordReport({
      headers: GOLDEN_KEYWORD_MINING_HEADERS,
      rows: GOLDEN_KEYWORD_MINING_ROWS.map((row) => rowValues(row, GOLDEN_KEYWORD_MINING_HEADERS)),
      capturedAt: "2026-08-15T02:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.reportType).toBe("keyword_mining");
    const row = result.report.rows[0];
    expect(row.keyword).toBe("golden");
    expect(row.fields.relevance).toMatchObject({ normalized: 100 });
    expect(row.fields.abaMonthlyRank).toMatchObject({ normalized: 5 });
    expect(row.fields.abaWeeklyRank).toMatchObject({ normalized: 2 });
    expect(row.fields.supplyDemandRatio).toMatchObject({ normalized: 1296.2 });
    // 真实样本中 转化总占比 存在 0 值：0 是合法值，不是缺失
    const zeroShare = result.report.rows[1];
    expect(zeroShare.fields.conversionShare).toMatchObject({ normalized: 0, applicability: "available" });
  });

  it("rejects non-keyword reports (PS/CC headers) as wrong report", () => {
    const result = parseKeywordReport({
      headers: ["#", "ASIN", "商品标题", "商品详情页链接", "大类目", "大类BSR"],
      rows: [["1", "B0TEST0001", "T", "https://a", "C", "1"]],
      capturedAt: "2026-08-15T02:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_report_type");
  });

  it("skips empty keyword rows and fails closed on zero valid rows", () => {
    const empty = parseKeywordReport({
      headers: GOLDEN_KEYWORD_MINING_HEADERS,
      rows: [GOLDEN_KEYWORD_MINING_HEADERS.map(() => "")],
      capturedAt: "2026-08-15T02:00:00.000Z",
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.code).toBe("no_valid_rows");
  });
});
