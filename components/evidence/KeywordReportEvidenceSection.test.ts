import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { KeywordReportEvidenceSection } from "./KeywordReportEvidenceSection";

/**
 * 轮 13：关键词报表区 用户语言收口。
 * capturedAt → 采集时间；缺失单元格 unknown → 尚未取得（字段名/枚举不变，仅展示文案）。
 * 轮 12.5 合并：上传/自动采集入口下线，组件只保存展示职责（红线：不出现上传/自动采集文案）。
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
    evidence: value as never,
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
  it("轮 12.5 合并红线：上传/自动采集/确认保存入口已从展示组件下线", () => {
    const html = renderWith(evidence);
    expect(html).not.toContain("上传 SellerSprite 关键词报表");
    expect(html).not.toContain("自动采集关键词");
    expect(html).not.toContain("确认并保存");
    expect(html).not.toContain('type="file"');
  });
  it("无证据态：提示来源为「采集关键词+竞品」", () => {
    const html = renderWith(null);
    expect(html).toContain("采集关键词+竞品");
  });
});
