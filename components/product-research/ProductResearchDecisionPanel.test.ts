import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "components/product-research/ProductResearchDecisionPanel.tsx"),
  "utf8",
);
const detailSource = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");

describe("版本化商品研究决定面板", () => {
  it("展示三项明确决定、完整历史、版本与研究指纹", () => {
    expect(panelSource).toContain("进入创作准备");
    expect(panelSource).toContain("待补信息");
    expect(panelSource).toContain("放弃研究");
    expect(panelSource).toContain("决定历史");
    expect(panelSource).toContain("研究指纹");
    expect(panelSource).toContain("版本 {state.record.revision}");
    expect(panelSource).toContain("event.actorMode === \"owner\" ? \"Owner\" : \"Visitor\"");
  });

  it("使用专用 GET/PATCH、稳定 decisionId 和 expectedRevision 处理并发", () => {
    expect(panelSource).toContain("/research-decision`");
    expect(panelSource).toContain('method: "PATCH"');
    expect(panelSource).toContain("expectedRevision: state.record.revision");
    expect(panelSource).toContain("decisionIdRef.current = crypto.randomUUID()");
    expect(panelSource).toContain('data.error.code === "research_record_conflict"');
    expect(panelSource).toContain("该记录已在其他页面更新");
  });

  it("旧记录只读，版本化记录不会继续使用通用 Task 状态 PATCH", () => {
    expect(panelSource).toContain("旧版研究记录仅供查看");
    expect(detailSource).toContain("ProductResearchDecisionPanel");
    expect(detailSource).toContain("hasVersionedProductResearchRecord");
    expect(detailSource).toContain("版本化研究决定请在上方专用面板更新");
    expect(detailSource).toContain("初始流程复核快照，不是当前正式研究决定");
    expect(detailSource).toContain("当前正式决定、原因和下一步以上方版本化面板为准");
  });

  it("不会把进入创作准备描述为自动创建或发布", () => {
    expect(panelSource).toContain("尚未生成结构化创作交接卡");
    expect(panelSource).toContain("Listing / Image 自动交接将在 PR-3 完成");
    expect(panelSource).not.toContain("自动进入 Listing");
    expect(panelSource).not.toContain("自动上架");
  });
});
