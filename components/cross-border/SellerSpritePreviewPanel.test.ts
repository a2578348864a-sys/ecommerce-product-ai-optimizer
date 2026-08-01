import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function panelSource(): Promise<string> {
  return readFile(new URL("./SellerSpritePreviewPanel.tsx", import.meta.url), "utf8");
}

describe("SellerSpritePreviewPanel V2 contract", () => {
  it("delegates response presentation to the behavior-tested results view", async () => {
    const source = await panelSource();

    expect(source).toContain("SellerSpritePreviewResults");
    expect(source).toContain("<SellerSpritePreviewResults");
    expect(source).not.toContain("<table");
    expect(source).not.toContain("row.facts.amazonUrl");
  });

  it("uses the shared authenticated Preview endpoint without owning a second workspace shell", async () => {
    const source = await panelSource();
    expect(source).toContain('fetch("/api/opportunities/sellersprite-preview"');
    expect(source).toContain("buildAccessHeaders()");
    expect(source).toContain("上传并安全解析");
    expect(source).toContain("surface-card");
    expect(source).toContain("linear-button-primary");
    expect(source).not.toMatch(/WorkspaceSidebar|WorkspaceMobileNav|workspace-layout/);
    expect(source).not.toMatch(/requireOwnerOnly|opportunityCandidateService|marketSignalRanking|marketSnapshot|ShadowReport/i);
  });

  it("calls the completed Import API with the workflow helper and keeps the original File", async () => {
    const source = await panelSource();
    expect(source).toContain('fetch("/api/opportunities/sellersprite-import"');
    expect(source).toContain("buildImportFormData(");
    expect(source).toContain("serializeSelectedRowHashes(");
    expect(source).toContain('confirmed: "true"');
    expect(source).not.toContain("window.confirm");
    expect(source).not.toMatch(/body\.set\("(role|subjectId|demoAccessId|asin|title|productUrl|score|sourceMetaJson)"/i);
  });

  it("gates selection and import on token, blocking errors, and selection count", async () => {
    const source = await panelSource();
    expect(source).toContain("canOpenImportConfirmation(");
    expect(source).toContain("hasBlockingErrors");
    expect(source).toContain("hasImportToken");
    expect(source).toContain("SELLERSPRITE_IMPORT_MAX_SELECTED_ROWS");
    expect(source).toContain("已选择");
    expect(source).toContain("加入商品研究池");
  });

  it("requires an explicit second confirmation before import and warns when warnings exist", async () => {
    const source = await panelSource();
    expect(source).toContain("确认加入商品研究池");
    expect(source).toContain("不自动运行 AI");
    expect(source).toContain("不自动创建 Task");
    expect(source).toContain("不代表采购建议或选品结论");
    expect(source).toContain("我已了解上述警告");
    expect(source).toContain("isImportConfirmationEnabled(");
    expect(source).toContain("warningsAcknowledged");
  });

  it("shows created / skipped / conflicts summaries with continue-research from server candidateIds", async () => {
    const source = await panelSource();
    expect(source).toContain("已加入商品研究池");
    expect(source).toContain("已存在于商品研究池");
    expect(source).toContain("来源快照不同");
    expect(source).toContain("继续调查");
    expect(source).toContain("buildCandidateResearchHref(");
    expect(source).toContain('href="/opportunity-candidates"');
    expect(source).toContain("查看商品研究池");
    expect(source).toContain("row.candidateId");
    // No manual URL assembly with ASIN/title.
    expect(source).not.toMatch(/agent\/run\?.*(asin|title|rowHash)/i);
  });

  it("delegates invalid-row presentation and surfaces token expiry with a regenerate action", async () => {
    const source = await panelSource();
    expect(source).toContain("SellerSpritePreviewResults");
    expect(source).toContain("isTokenExpiryCode(");
    expect(source).toContain("重新生成预览");
    expect(source).toContain("文件只在当前页面会话中保留");
  });

  it("offers identical Owner/Visitor capability without role branching or auto actions", async () => {
    const source = await panelSource();
    expect(source).not.toMatch(/getAccessMode|mode === "owner"|mode === "demo"|requireOwnerOnly|isSandbox/i);
    expect(source).not.toMatch(/createTask|aiClient|openai/i);
    expect(source).not.toMatch(/fetch\("\/api\/tasks|fetch\("\/api\/agents/i);
  });
});
