import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyTop5LoadResult } from "@/lib/upstream/family-top5-adapter";
import { getOpportunitiesSurfaceCopy } from "@/components/cross-border/OpportunitiesForm";

const loader = vi.hoisted(() => vi.fn<() => FamilyTop5LoadResult>());

vi.mock("@/lib/upstream/family-top5-adapter", () => ({
  loadFamilyTop5Data: loader,
}));

vi.mock("@/components/cross-border/OpportunitiesForm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/cross-border/OpportunitiesForm")>();
  return {
    ...actual,
    OpportunitiesForm: () => createElement("div", { "data-testid": "opportunities-form" }),
  };
});

import OpportunitiesImportPage from "@/app/opportunities/import/page";

let readyResult: FamilyTop5LoadResult;

function renderPage(result: FamilyTop5LoadResult): string {
  loader.mockReturnValue(result);
  return renderToStaticMarkup(createElement(OpportunitiesImportPage));
}

beforeAll(async () => {
  const actual = await vi.importActual<typeof import("@/lib/upstream/family-top5-adapter")>(
    "@/lib/upstream/family-top5-adapter",
  );
  readyResult = actual.loadFamilyTop5Data();
  if (readyResult.readiness !== "ready" || !readyResult.data || !readyResult.sourceArtifactBinding) {
    throw new Error(readyResult.error ?? readyResult.readiness);
  }
});

beforeEach(() => loader.mockReset());

describe("advanced opportunities import compatibility entry", () => {
  it("renders the audited Family Top 5 exactly once only when the loader is ready", () => {
    const html = renderPage(readyResult);

    expect((html.match(/data-testid="family-top5-review"/gu) ?? [])).toHaveLength(1);
    expect((html.match(/data-testid="family-card"/gu) ?? [])).toHaveLength(5);
    expect(html).toContain("Listing：23");
    expect(html).toContain("商品家族：22");
    expect(html).toContain("Top：5");
    expect(html).toContain("其余：17");
    expect((html.match(/data-testid="opportunities-form"/gu) ?? [])).toHaveLength(1);
  });

  it.each([
    ["artifact_integrity_failed", "公开市场预筛数据完整性校验失败"],
    ["provenance_invalid", "公开市场预筛数据完整性校验失败"],
    ["schema_unsupported", "公开市场预筛数据完整性校验失败"],
    ["artifact_missing", "公开市场预筛数据尚未准备"],
  ] as const)("fails closed for %s without rendering untrusted family data", (readiness, message) => {
    const html = renderPage({
      data: null,
      provenance: null,
      sourceArtifactBinding: null,
      readiness,
      error: `test_${readiness}`,
    });

    expect(html).toContain(message);
    expect(html).not.toContain('data-testid="family-top5-review"');
    expect(html).not.toContain('data-testid="family-card"');
    expect(html).not.toContain("108ee1b6");
    expect((html.match(/data-testid="opportunities-form"/gu) ?? [])).toHaveLength(1);
  });

  it("does not render family data when readiness says ready but required data is absent", () => {
    const html = renderPage({
      data: null,
      provenance: null,
      sourceArtifactBinding: null,
      readiness: "ready",
      error: "test_incomplete_ready_state",
    });

    expect(html).not.toContain('data-testid="family-top5-review"');
    expect(html).not.toContain("108ee1b6");
    expect((html.match(/data-testid="opportunities-form"/gu) ?? [])).toHaveLength(1);
  });

  it("keeps the advanced import surface copy explicit", () => {
    expect(getOpportunitiesSurfaceCopy("advanced_import")).toEqual({
      eyebrow: "高级工具",
      lockedTitle: "手工导入外部来源 · 功能预览",
      lockedDescription: "保留现有 URL、RSS、Sitemap 与历史候选流程；导入不等于完成 Evidence 筛选或进入调查短名单。",
      unlockedTitle: "手工导入外部来源",
      unlockedDescription: "保留现有 URL、RSS、Sitemap 与历史候选流程；导入不等于完成 Evidence 筛选或进入调查短名单。",
    });
  });

  it("preserves the existing opportunities surface copy", () => {
    expect(getOpportunitiesSurfaceCopy("legacy_default")).toEqual({
      eyebrow: null,
      lockedTitle: "机会雷达 / 候选品池 · 功能预览",
      lockedDescription: "跨境电商机会来源导入与候选池 — 未解锁时可浏览功能说明和示例",
      unlockedTitle: "机会雷达",
      unlockedDescription: "先看市场信号，再决定是否进入商业深挖。",
    });
  });
});
