import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { KeywordReportEvidenceSection } from "./KeywordReportEvidenceSection";

/**
 * 轮 13：关键词报表区 用户语言收口。
 * capturedAt → 采集时间；缺失单元格 unknown → 尚未取得（字段名/枚举不变，仅展示文案）。
 */

const evidence = {
  reportType: "reverse_asin",
  capturedAt: "2026-08-14T02:00:00.000Z",
  rows: [
    {
      rowNumber: 1,
      keyword: "lunch box",
      keywordTranslation: "午餐盒",
      fields: {
        trafficShare: { raw: 0.5, normalized: 0.5, metricNature: "snapshot", applicability: "available" },
        naturalRank: { raw: null, normalized: null, metricNature: "derived", applicability: "missing" },
      },
    },
  ],
};

function renderWith(value: unknown) {
  return renderToStaticMarkup(createElement(KeywordReportEvidenceSection, {
    taskId: "task-x",
    evidence: value as never,
    storageVersion: null,
    onChanged: () => undefined,
  } as never));
}

describe("KeywordReportEvidenceSection 用户语言（轮 13）", () => {
  it("保存态：显示「采集时间」，不出现 capturedAt/unknown", () => {
    const html = renderWith(evidence);
    expect(html).toContain("采集时间");
    expect(html).not.toContain("capturedAt");
    expect(html).not.toContain("unknown");
  });
  it("缺失字段单元格：显示「尚未取得」，不出现 unknown", () => {
    const html = renderWith(evidence);
    expect(html).toContain("尚未取得");
    expect(html).not.toContain("unknown");
  });
});
