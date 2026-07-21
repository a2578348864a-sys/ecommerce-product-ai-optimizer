import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOpportunitiesSurfaceCopy } from "@/components/cross-border/OpportunitiesForm";

const importPageSource = readFileSync(
  resolve(process.cwd(), "app/opportunities/import/page.tsx"),
  "utf8",
);
const opportunitiesPageSource = readFileSync(
  resolve(process.cwd(), "app/opportunities/page.tsx"),
  "utf8",
);

describe("advanced opportunities import compatibility entry", () => {
  it("renders the existing form in the advanced import surface", () => {
    expect(importPageSource).toContain('<OpportunitiesForm surface="advanced_import" />');
    expect(importPageSource).toContain("sourceArtifactBinding={sourceArtifactBinding}");
    expect(getOpportunitiesSurfaceCopy("advanced_import")).toEqual({
      eyebrow: "高级工具",
      title: "手工导入外部来源",
      description: "保留现有 URL、RSS、Sitemap 与历史候选流程；导入不等于完成 Evidence 筛选或进入调查短名单。",
    });
  });

  it("renders Family Top 5 only behind the complete audited-data readiness gate", () => {
    expect(importPageSource).toContain(
      'if (readiness === "ready" && data && sourceArtifactBinding)',
    );
    expect(importPageSource).toContain("topFamilies={data.topFamilies}");
    expect(importPageSource).toContain("remainingFamilies={data.remainingFamilies}");
    expect(importPageSource).toContain("公开市场预筛数据完整性校验失败");
    expect(importPageSource).toContain("请勿使用本页面做商业判断");
  });

  it("keeps import advanced after the formal route switches to the read-only workbench", () => {
    expect(opportunitiesPageSource).toContain("<MarketScreeningWorkbench");
    expect(opportunitiesPageSource).toContain('environment: "production"');
    expect(opportunitiesPageSource).not.toContain("<OpportunitiesForm");
    expect(opportunitiesPageSource).not.toContain('surface="advanced_import"');
  });
});
