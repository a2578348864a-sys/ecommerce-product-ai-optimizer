import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 3 research history information architecture", () => {
  const detail = source("components/TaskRecordDetail.tsx");
  const list = source("components/TaskRecordsList.tsx");
  const decision = source("components/product-research/ProductResearchDecisionPanel.tsx");
  const listingPack = source("components/ListingPackCard.tsx");

  it("retires the five-step workspace from the Task detail public UI", () => {
    expect(detail).not.toContain("WorkflowStepWorkspace");
    expect(detail).not.toContain("deriveCurrentStepKey");
    expect(detail).not.toContain("推进步骤");
    expect(detail).not.toContain("CreativeHandoffPanel");
    expect(detail).not.toContain("ListingHandoffSection");
    expect(detail).not.toContain("ImageHandoffSection");
    expect(existsSync(resolve(process.cwd(), "components/tasks/WorkflowStepWorkspace.tsx"))).toBe(false);
  });

  it("keeps research, decision, tools and historical artifacts as separate sections", () => {
    for (const heading of ["商品身份与来源", "历史初始分析", "人工决定", "创作工具", "历史成果"]) {
      expect(detail).toContain(heading);
    }
    expect(detail).toContain("ProductResearchDecisionPanel");
    expect(detail).toContain("/listing-studio?taskId=${encodeURIComponent(record.id)}");
    expect(detail).toContain("/image-studio?taskId=${encodeURIComponent(record.id)}");
    expect(detail).toContain('data-testid="historical-artifacts"');
  });

  it("presents research status and artifacts without a creative workflow stage", () => {
    expect(list).toContain("deriveResearchHistoryStatus");
    expect(list).toContain("deriveHistoricalArtifactSummary");
    expect(list).toContain("研究状态");
    expect(list).toContain("历史成果");
    expect(list).not.toContain('["当前阶段", presentation.stage.label]');
    expect(list).not.toContain("下一步：{presentationAction");
  });

  it("does not expose an internal research fingerprint in the decision UI", () => {
    expect(decision).not.toContain("研究指纹");
    expect(decision).toContain("决定历史");
    expect(decision).toContain("保存人工决定");
  });

  it("renders legacy Listing artifacts in an explicitly read-only mode", () => {
    expect(detail).toContain("<ListingPackCard");
    expect(detail).toContain("readOnly");
    expect(listingPack).toContain("readOnly?: boolean");
    expect(listingPack).toContain("!readOnly");
  });
});
