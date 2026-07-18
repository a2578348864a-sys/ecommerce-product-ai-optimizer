import { createElement } from "react";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  filterStage15PreviewItems,
  Stage15ScreeningPreview,
} from "@/components/cross-border/Stage15ScreeningPreview";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

function realPreview() {
  const result = loadStage15ScreeningPreview({
    environment: "development",
    projectMaterialsRoot: resolve(process.cwd(), ".."),
  });
  if (result.status !== "ready") throw new Error(result.errorCode);
  return result.preview;
}

describe("Stage15ScreeningPreview", () => {
  it("renders the read-only boundary, exact partition, local images, and evidence explanations", () => {
    const html = renderToStaticMarkup(createElement(Stage15ScreeningPreview, { preview: realPreview() }));

    expect(html).toContain("调查短名单预览");
    expect(html).toContain("本地只读");
    expect(html).toContain("工程收敛已验证");
    expect(html).toContain("筛选有效性未验证");
    expect(html).toContain("中文商品类型和用途仅用于理解辅助，不是来源页面事实");
    expect(html).toContain("20");
    expect(html).toContain("5");
    expect(html).toContain("进入调查短名单");
    expect(html).toContain("保留观察");
    expect(html).toContain("本批不继续");
    expect(html).toContain("市场证据不足");
    expect(html).toContain("advance 只是本批调查名额");
    expect(html).toContain("商业验证未开始，不能判断利润或可采购性");
    expect(html).toContain("页面评分（仅供参考）");
    expect(html).toContain("评论数量（不是销量）");
    expect(html).toContain("不是入选原因");
    expect(html).toContain("不能证明销量、质量或利润");
    expect(html).toContain("为什么进入调查短名单");
    expect(html).toContain("已经确认");
    expect(html).toContain("还没有确认");
    expect(html).toContain("下一步只查这一件事");
    expect(html).toContain("Stage 1.5 什么时候停止");
    expect(html).toContain("Stage 2 以后再判断");
    expect(html).toContain("原始证据（供复核）");
    expect(html).toContain("这不等于没有风险");
    expect(html).toContain("不改变商品状态、排名或商业结论");
    expect(html).not.toContain("无已记录内容");
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("图片未缓存");
    expect((html.match(/data-testid="screening-item"/g) ?? [])).toHaveLength(20);
    expect(html).not.toContain("m.media-amazon.com");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("保存并推进");
    expect(html).not.toContain("创建正式 Candidate");
  });

  it("filters without changing the source items", () => {
    const preview = realPreview();
    const sourceSnapshot = JSON.stringify(preview.items);

    expect(filterStage15PreviewItems(preview.items, "all")).toHaveLength(20);
    expect(filterStage15PreviewItems(preview.items, "advance")).toHaveLength(5);
    expect(filterStage15PreviewItems(preview.items, "watch")).toHaveLength(11);
    expect(filterStage15PreviewItems(preview.items, "reject")).toHaveLength(3);
    expect(filterStage15PreviewItems(preview.items, "insufficient")).toHaveLength(1);
    expect(JSON.stringify(preview.items)).toBe(sourceSnapshot);
  });
});
