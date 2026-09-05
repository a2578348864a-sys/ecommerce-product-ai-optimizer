import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ListingPreparationSummary (ReferenceListingDraftPanel) Contract & Retirement Check", () => {
  const panelSource = readFileSync(
    resolve(process.cwd(), "components/evidence/ReferenceListingDraftPanel.tsx"),
    "utf8",
  );
  const workbenchSource = readFileSync(
    resolve(process.cwd(), "components/evidence/EvidenceWorkbench.tsx"),
    "utf8",
  );
  const taskDetailSource = readFileSync(
    resolve(process.cwd(), "components/TaskRecordDetail.tsx"),
    "utf8",
  );

  it("已彻底撤下参考初稿生成器与编辑组件（无生成按钮、无输入框、无复制下载、无本地缓存暂存）", () => {
    // 不再包含初稿生成标题
    expect(panelSource).not.toContain("按现有资料生成参考初稿");
    // 不再包含初稿生成按钮
    expect(panelSource).not.toContain("data-testid=\"generate-reference-draft-btn\"");
    // 不再包含标题、卖点、描述输入控件
    expect(panelSource).not.toContain("data-testid=\"reference-draft-title-input\"");
    expect(panelSource).not.toContain("data-testid=\"reference-draft-desc-input\"");
    expect(panelSource).not.toContain("reference-draft-bullet-");
    // 不再包含复制文案与下载 Markdown 按钮
    expect(panelSource).not.toContain("data-testid=\"copy-reference-draft-btn\"");
    expect(panelSource).not.toContain("data-testid=\"download-reference-draft-btn\"");
    expect(panelSource).not.toContain("handleDownloadMarkdown");
    // 不再包含 POST 请求
    expect(panelSource).not.toContain("method: \"POST\"");
    expect(panelSource).not.toContain("method: 'POST'");
  });

  it("面板结构转换为「Listing 准备情况」只读摘要，包含统计、详情折叠区与 Listing Studio 正式入口", () => {
    // 结构 ID 与 TestId
    expect(panelSource).toContain("id=\"listing-preparation-summary\"");
    expect(panelSource).toContain("data-testid=\"listing-preparation-summary\"");
    // 面板标题与待复核徽章
    expect(panelSource).toContain("Listing 准备情况");
    expect(panelSource).toContain("资料整理分析 · 待人工复核");
    // 统计项
    expect(panelSource).toContain("可用于 Listing 准备：");
    expect(panelSource).toContain("data-testid=\"adopted-count\"");
    expect(panelSource).toContain("暂不采用：");
    expect(panelSource).toContain("data-testid=\"excluded-count\"");
    // 仅基础身份信息时不足以支撑 Listing 准备的诚实警示
    expect(panelSource).toContain("data-testid=\"insufficient-warning\"");
    expect(panelSource).toContain("⚠️ 当前仅整理出基础身份信息，暂无足够的实质规格资料，尚不足以支撑完整 Listing 准备。");
    // 直达 Listing Studio 正式入口
    expect(panelSource).toContain("data-testid=\"goto-listing-studio-btn\"");
    expect(panelSource).toContain("/listing-studio?taskId=");
    expect(panelSource).toContain("进入 Listing Studio");
    // 折叠依据详情与清单
    expect(panelSource).toContain("data-testid=\"listing-prep-details\"");
    expect(panelSource).toContain("data-testid=\"adopted-materials-list\"");
    expect(panelSource).toContain("data-testid=\"excluded-materials-list\"");
    // 导出别名
    expect(panelSource).toContain("export { ReferenceListingDraftPanel as ListingPreparationSummary }");
  });

  it("TaskRecordDetail 必须挂载于下一步区域（aria-label=下一步：Listing 准备情况），且 EvidenceWorkbench 不再包含它", () => {
    expect(taskDetailSource).toContain("import { ReferenceListingDraftPanel }");
    expect(taskDetailSource).toContain("<ReferenceListingDraftPanel");
    expect(taskDetailSource).toContain('aria-label="下一步：Listing 准备情况"');
    expect(taskDetailSource).not.toContain('aria-label="下一步：参考初稿"');
    expect(workbenchSource).not.toContain("<ReferenceListingDraftPanel");
    expect(workbenchSource).not.toContain("import { ReferenceListingDraftPanel }");
  });
});

