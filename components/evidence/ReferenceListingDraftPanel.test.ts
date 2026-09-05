import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ReferenceListingDraftPanel Component Source & Contract Check", () => {
  const panelSource = readFileSync(
    resolve(process.cwd(), "components/evidence/ReferenceListingDraftPanel.tsx"),
    "utf8",
  );
  const workbenchSource = readFileSync(
    resolve(process.cwd(), "components/evidence/EvidenceWorkbench.tsx"),
    "utf8",
  );

  it("面板必须包含法定身份标记：研究对象参考初稿 · 基于采集资料，待人工复核", () => {
    expect(panelSource).toContain("按现有资料生成参考初稿");
    expect(panelSource).toContain("研究对象参考初稿 · 基于采集资料，待人工复核");
    expect(panelSource).toContain("data-testid=\"reference-listing-draft-panel\"");
    expect(panelSource).toContain("data-testid=\"draft-identity-badge\"");
  });

  it("面板必须包含主生成按钮及编辑字段（标题、卖点、描述）", () => {
    expect(panelSource).toContain("data-testid=\"generate-reference-draft-btn\"");
    expect(panelSource).toContain("data-testid=\"reference-draft-title-input\"");
    expect(panelSource).toContain("data-testid=\"reference-draft-desc-input\"");
    expect(panelSource).toContain("reference-draft-bullet-");
  });

  it("必须提供复制文案与下载 Markdown 操作", () => {
    expect(panelSource).toContain("data-testid=\"copy-reference-draft-btn\"");
    expect(panelSource).toContain("data-testid=\"download-reference-draft-btn\"");
    expect(panelSource).toContain("handleDownloadMarkdown");
  });

  it("必须区分本地规则生成与待人工复核，并在用户手动编辑后标记「已手动编辑，需复核」", () => {
    expect(panelSource).toContain("本地规则生成");
    expect(panelSource).toContain("待人工复核");
    expect(panelSource).toContain("data-testid=\"badge-manually-edited\"");
    expect(panelSource).toContain("已手动编辑，需复核");
  });

  it("必须通过独立命名空间进行任务隔离的本地暂存（localStorage）并在异常时降级", () => {
    expect(panelSource).toContain("qingxuan:ref_draft:v2:");
    expect(panelSource).toContain("safeLocalStorageGet");
    expect(panelSource).toContain("safeLocalStorageSet");
    expect(panelSource).toContain("storageUnavailable");
    expect(panelSource).toContain("reqSeqRef");
  });

  it("必须分离生成时依据与最新准备度（generationSnapshot）", () => {
    expect(panelSource).toContain("generationSnapshot");
    expect(panelSource).toContain("DraftGenerationSnapshot");
    expect(panelSource).toContain("isStale");
  });

  it("EvidenceWorkbench 必须就地挂载 ReferenceListingDraftPanel，不被正式交接状态挡住", () => {
    expect(workbenchSource).toContain("import { ReferenceListingDraftPanel }");
    expect(workbenchSource).toContain("<ReferenceListingDraftPanel");
  });
});
