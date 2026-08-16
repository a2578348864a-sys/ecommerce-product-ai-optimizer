import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("product research history presentation", () => {
  it("uses the user-facing research-history language in list and detail routes", () => {
    const list = source("components/TaskRecordsList.tsx");
    const detail = source("components/TaskRecordDetail.tsx");
    const listPage = source("app/tasks/page.tsx");
    const detailPage = source("app/tasks/[id]/page.tsx");

    expect(list).toContain("研究记录");
    expect(list).toContain("研究时间");
    expect(list).toContain("历史成果");
    expect(list).toContain("ResearchProductImage");
    expect(detail).toContain("ResearchProductImage");
    expect(source("components/ResearchProductImage.tsx")).toContain('loading="lazy"');
    expect(source("components/ResearchProductImage.tsx")).toContain("onError=");
    expect(source("components/ResearchProductImage.tsx")).toContain("object-contain");
    // Phase1：卡片级技术字段已从用户主流程移除
    expect(list).not.toContain("内部阶段");
    expect(detail).toContain("商品研究记录");
    expect(detail).toContain("人工决定");
    expect(detail).not.toContain("技术信息与原始数据");
    expect(listPage).toContain("商品研究记录");
    expect(detailPage).toContain("商品研究记录");
  });

  it("derives saved artifacts and routes Studio actions to task detail", () => {
    const list = source("components/TaskRecordsList.tsx");
    const detail = source("components/TaskRecordDetail.tsx");

    expect(list).toContain("deriveProductResearchPresentation");
    expect(detail).toContain("deriveProductResearchPresentation");
    expect(detail).toContain("deriveHistoricalArtifactSummary");
    expect(detail).toContain("`/listing-studio?taskId=${encodeURIComponent(record.id)}`");
    expect(detail).toContain("`/image-studio?taskId=${encodeURIComponent(record.id)}`");
    // 旧派生器继续兼容历史数据，但 Task 详情使用 Phase 2 独立 Studio 入口。
    expect(source("lib/productResearchPresentation.ts")).toContain(
      "href: `/tasks/${encodedId}`",
    );
    expect(source("lib/productResearchPresentation.ts")).not.toContain(
      "/listing-studio?taskId=",
    );
    expect(source("lib/productResearchPresentation.ts")).not.toContain(
      "/image-studio?taskId=",
    );
  });
});
