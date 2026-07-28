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

    expect(list).toContain("研究历史");
    expect(list).toContain("最后更新");
    expect(list).toContain("已生成内容");
    expect(list).toContain("ResearchProductImage");
    expect(detail).toContain("ResearchProductImage");
    expect(source("components/ResearchProductImage.tsx")).toContain('loading="lazy"');
    expect(source("components/ResearchProductImage.tsx")).toContain("onError=");
    expect(source("components/ResearchProductImage.tsx")).toContain("object-contain");
    expect(list).toContain("技术状态与证据");
    expect(detail).toContain("商品研究结果");
    expect(detail).toContain("人工核验");
    expect(detail).toContain("技术信息与原始数据");
    expect(listPage).toContain("商品研究历史");
    expect(detailPage).toContain("商品研究结果");
  });

  it("derives saved artifacts and uses encoded task ids for Studio links", () => {
    const list = source("components/TaskRecordsList.tsx");
    const detail = source("components/TaskRecordDetail.tsx");

    expect(list).toContain("deriveProductResearchPresentation");
    expect(detail).toContain("deriveProductResearchPresentation");
    expect(detail).toContain("presentation.actions");
    expect(source("lib/productResearchPresentation.ts")).toContain(
      "/listing-studio?taskId=${encodedId}",
    );
    expect(source("lib/productResearchPresentation.ts")).toContain(
      "/image-studio?taskId=${encodedId}",
    );
  });
});
