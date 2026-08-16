/**
 * V3 Final Interaction Correction — R7：deriveResearchMaterialStatus 测试
 *
 * 任务 110 节要求：product basics / keyword / browser / voc / sourcing / competitor
 * missing → confirmed → available；preview 不算；failed write 不算；reload 派生；
 * AI summary 不影响 Evidence 存在性。
 */
import { describe, expect, it } from "vitest";
import { deriveResearchMaterialStatus, RESEARCH_MATERIAL_ROWS } from "@/lib/client/evidenceCompletion";

function baseResult(): Record<string, unknown> {
  return {
    sourceMeta: { source: "opportunity" },
    candidateToTask: { version: 1, candidateId: "candidate-x" },
  };
}

describe("deriveResearchMaterialStatus（R7 统一 resolver）", () => {
  it("空 result → 商品基础=已有（来源身份）/ 竞品=可选 / 其余=待补", () => {
    const status = deriveResearchMaterialStatus(baseResult());
    expect(status.productBasics).toBe("已有");
    expect(status.competitor).toBe("可选");
    expect(status.keyword).toBe("待补");
    expect(status.browser).toBe("待补");
    expect(status.voc).toBe("待补");
    expect(status.sourcing).toBe("可选");
  });

  it("null/undefined → 安全默认（不崩）", () => {
    expect(deriveResearchMaterialStatus(null)).toEqual(deriveResearchMaterialStatus(undefined));
    const status = deriveResearchMaterialStatus(null);
    expect(status.keyword).toBe("待补");
    expect(status.voc).toBe("待补");
  });

  it("keyword persisted rows → 已有；preview 不算", () => {
    const withRows = baseResult();
    withRows.keywordEvidence = { schema: "seller-sprite-keyword-evidence.v1", reportType: "reverse_asin", rows: [{ rowNumber: 1, keyword: "x" }] };
    expect(deriveResearchMaterialStatus(withRows).keyword).toBe("已有");
    // preview（未 persist 的 namespace 不存在）不算
    expect(deriveResearchMaterialStatus(baseResult()).keyword).toBe("待补");
  });

  it("browser snapshots → 已有；无 → 待补", () => {
    const withSnap = baseResult();
    withSnap.browserEvidence = { snapshots: [{ evidenceId: "ev-1" }] };
    expect(deriveResearchMaterialStatus(withSnap).browser).toBe("已有");
    expect(deriveResearchMaterialStatus(baseResult()).browser).toBe("待补");
  });

  it("voc dataset reviews → 已有（不需要 VOC AI 分析）", () => {
    const withVoc = baseResult();
    withVoc.reviewEvidence = { dataset: { reviews: [{ evidenceId: "r1" }, { evidenceId: "r2" }] } };
    expect(deriveResearchMaterialStatus(withVoc).voc).toBe("已有");
    // 只有 vocAnalysis（AI 分析）没有 reviews → 仍待补（AI 不参与判定）
    const aiOnly = baseResult();
    aiOnly.vocAnalysis = { runId: "run-1" };
    expect(deriveResearchMaterialStatus(aiOnly).voc).toBe("待补");
    expect(deriveResearchMaterialStatus(baseResult()).voc).toBe("待补");
  });

  it("sourcing humanConfirmed → 可选变已有；未确认 preview 不算", () => {
    const withConfirmed = baseResult();
    withConfirmed.sourcingEvidence = { humanConfirmed: [{ offerId: "o1" }] };
    expect(deriveResearchMaterialStatus(withConfirmed).sourcing).toBe("已有");
    expect(deriveResearchMaterialStatus(baseResult()).sourcing).toBe("可选");
  });

  it("competitor asins → 可选变已有", () => {
    const withCompetitors = baseResult();
    withCompetitors.competitorEvidence = { asins: [{ asin: "B0X" }] };
    expect(deriveResearchMaterialStatus(withCompetitors).competitor).toBe("已有");
    expect(deriveResearchMaterialStatus(baseResult()).competitor).toBe("可选");
  });

  it("AI summary 不影响任何 Evidence 存在性", () => {
    const withSummary = baseResult();
    withSummary.aiEvidenceSummary = { runId: "run-1", summary: { facts: [{ id: "f1" }] } };
    const status = deriveResearchMaterialStatus(withSummary);
    expect(status.browser).toBe("待补");
    expect(status.voc).toBe("待补");
    expect(status.keyword).toBe("待补");
  });

  it("RESEARCH_MATERIAL_ROWS 覆盖全部 6 项（UI 渲染权威）", () => {
    expect(RESEARCH_MATERIAL_ROWS.map((row) => row.key)).toEqual([
      "productBasics", "competitor", "keyword", "browser", "voc", "sourcing",
    ]);
    // optional 语义：competitor/sourcing 可选，其余必填
    expect(RESEARCH_MATERIAL_ROWS.filter((row) => row.optional).map((row) => row.key)).toEqual(["competitor", "sourcing"]);
  });
});
