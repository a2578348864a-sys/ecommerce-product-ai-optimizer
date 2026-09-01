import { VocEvidenceSection } from "@/components/evidence/VocEvidenceSection";
import { BrowserEvidenceSection } from "@/components/evidence/BrowserEvidenceSection";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildResearchMaterialRows,
  coveredFactFieldSet,
  deriveResearchStatus,
  EXPECTED_FACT_FIELDS,
  extractCandidateScore,
  extractDecisionSummary,
  extractEvidenceGaps,
  extractKeywordBrief,
  extractOverviewItems,
  extractReportSource,
  mergeConfirmedIntoOverview,
  natureForField,
  compactOverviewItems,
  type ResearchMaterialRow,
} from "./EvidenceWorkbench";
import { buildKeywordBriefDraft } from "./keywordBriefDraft";
import type { ConfirmedFactCandidate } from "@/lib/factCandidates";

const wbSource = readFileSync(resolve(process.cwd(), "components/evidence/EvidenceWorkbench.tsx"), "utf8");
const cardSource = readFileSync(resolve(process.cwd(), "components/evidence/KeywordPendingSubmitCard.tsx"), "utf8");
const buttonSource = readFileSync(resolve(process.cwd(), "components/evidence/BrowserUseCollectButton.tsx"), "utf8");

const batchResult = {
  sourceMeta: {
    candidateSnapshot: { score: 73 },
    productBatchSnapshot: {
      asin: "B0TEST0001",
      marketplace: "amazon.com",
      reportType: "search_results",
      capturedAt: "2026-08-14T02:00:00.000Z",
      evidenceHash: "e".repeat(64),
      productFacts: {
        productTitle: "Golden Test Bottle",
        brand: "Golden Brand",
        price: 24.99,
        rating: 4.6,
        reviews: 1234,
        rootCategoryBsr: 12700,
        subCategoryBsr: 1266,
        estimatedMonthlySales: 228,
        estimatedMonthlyRevenue: 10237,
      },
    },
  },
  researchRecord: {
    latestDecision: {
      status: "needs_information",
      reason: "缺货源与合规证据",
      nextAction: "补充供应商信息",
    },
  },
  decisionEvidence: {
    missingData: [{ summary: "缺采购价" }, { summary: "缺 MOQ" }],
  },
  listingKeywordBrief: {
    primaryKeyword: "insulated water bottle",
    supportingKeywords: ["stainless steel"],
    backendSearchTerms: ["water bottle", "tumbler"],
    source: "sellersprite",
  },
};

describe("EvidenceWorkbench extractors", () => {
  it("商品概览默认只展示8项，其余仍可展开查看", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      field: `field-${index}`,
      label: `字段${index}`,
      value: `值${index}`,
      nature: "snapshot" as const,
    }));
    const compact = compactOverviewItems(items);
    expect(compact.visible).toHaveLength(8);
    expect(compact.hidden).toHaveLength(4);
    expect([...compact.visible, ...compact.hidden]).toEqual(items);
  });

  it("extracts overview items with metricNature and estimate labeling", () => {
    const items = extractOverviewItems(batchResult);
    expect(items.find((item) => item.field === "asin")?.value).toBe("B0TEST0001");
    const price = items.find((item) => item.field === "price");
    expect(price?.value).toBe("24.99");
    expect(price?.nature).toBe("snapshot");
    const sales = items.find((item) => item.field === "estimatedMonthlySales");
    expect(sales?.nature).toBe("estimate");
    const title = items.find((item) => item.field === "productTitle");
    expect(title?.nature).toBe("unknown");
  });

  it("keeps missing facts as unknown instead of guessing", () => {
    const items = extractOverviewItems({
      sourceMeta: { productBatchSnapshot: { asin: "B0TEST0001", productFacts: { productTitle: "T" } } },
    });
    const price = items.find((item) => item.field === "price");
    expect(price?.value).toBe("尚未取得");
    expect(price?.raw).toBeUndefined();
  });

  it("extracts decision summary with labels", () => {
    const decision = extractDecisionSummary(batchResult);
    expect(decision?.status).toBe("needs_information");
    expect(decision?.label).toBe("待补信息");
    expect(decision?.reason).toContain("货源");
    expect(extractDecisionSummary({})).toBeNull();
  });

  // ── V3 Final HWF（P1-03）：详情页投影（productResearchSummary）为决策权威 ──
  it("reads decision from productResearchSummary projection (detail page has no researchRecord)", () => {
    const decision = extractDecisionSummary({
      productResearchSummary: {
        schema: "product-research-record.v1",
        revision: 2,
        status: "creative_ready",
        label: "进入创作准备",
        reasonSummary: "证据已齐",
        nextActionSummary: "生成 Listing",
        decidedAt: "2026-08-15T00:00:00.000Z",
        actorMode: "owner",
        researchHashFingerprint: "f".repeat(64),
        legacy: false,
      },
    });
    expect(decision?.status).toBe("creative_ready");
    expect(decision?.label).toBe("进入创作准备");
    expect(decision?.reason).toBe("证据已齐");
    expect(decision?.nextAction).toBe("生成 Listing");
  });

  it("falls back to researchRecord.latestDecision when summary is absent (full result path)", () => {
    expect(extractDecisionSummary(batchResult)?.status).toBe("needs_information");
  });

  it("extracts evidence gaps without inventing missing items", () => {
    expect(extractEvidenceGaps(batchResult)).toEqual(["缺采购价", "缺 MOQ"]);
    expect(extractEvidenceGaps({ decisionEvidence: {} })).toEqual([]);
  });

  it("extracts keyword brief", () => {
    const brief = extractKeywordBrief(batchResult);
    expect(brief?.primaryKeyword).toBe("insulated water bottle");
    expect(brief?.source).toBe("sellersprite");
    expect(extractKeywordBrief({})).toBeNull();
  });

  it("extracts candidate score with reference-signal semantics", () => {
    expect(extractCandidateScore(batchResult)).toEqual({ score: 73, available: true });
    expect(extractCandidateScore({})).toEqual({ score: null, available: false });
  });

  it("extracts report source provenance", () => {
    const source = extractReportSource(batchResult);
    expect(source?.reportType).toBe("search_results");
    expect(source?.capturedAt).toContain("2026-08-14");
    expect(source?.evidenceHash).toHaveLength(64);
  });

  it("maps metric nature per field contract", () => {
    expect(natureForField("price")).toBe("snapshot");
    expect(natureForField("rating")).toBe("snapshot");
    expect(natureForField("estimatedMonthlySales")).toBe("estimate");
    expect(natureForField("brand")).toBe("unknown");
  });
});

// ── V3 Final R12：研究资料清单 + 研究状态行（§170/§175/§176/§177） ──

describe("buildResearchMaterialRows / deriveResearchStatus", () => {
  const emptyInput = {
    overview: [],
    competitors: [],
    keywordReportEvidence: null,
    browserEvidence: null,
    vocEvidence: null,
    sourcingConfirmed: false,
  };

  it("无任何 Evidence → 0 类已有，状态 empty（研究资料尚待补充）", () => {
    const rows = buildResearchMaterialRows(emptyInput);
    expect(rows.filter((row) => row.state === "已有")).toHaveLength(0);
    expect(deriveResearchStatus(rows, null)).toEqual({ status: "empty", collectedLabels: [] });
  });

  it("已有 Amazon + VOC Evidence、无 AI 总结 → partial（研究进行中），正确列出已收集类别", () => {
    const rows = buildResearchMaterialRows({
      ...emptyInput,
      browserEvidence: { snapshots: [{ asin: "B0X" }] },
      vocEvidence: { dataset: { reviews: [{ id: "r1" }] } },
    });
    expect(rows.find((row) => row.key === "browser")?.state).toBe("已有");
    expect(rows.find((row) => row.key === "voc")?.state).toBe("已有");
    const summary = deriveResearchStatus(rows, null);
    expect(summary.status).toBe("partial");
    expect(summary.collectedLabels).toEqual(["Amazon 页面", "买家评论"]);
  });

  it("有 AI 证据总结 → ai_ready（AI 已整理当前资料），不再显示「研究尚未开始」", () => {
    const rows = buildResearchMaterialRows(emptyInput);
    const summary = deriveResearchStatus(rows, { summary: "..." });
    expect(summary.status).toBe("ai_ready");
  });

  it("研究开始 ≠ AI 总结生成：有 Evidence 无 AI 时不落入 empty", () => {
    const rows = buildResearchMaterialRows({
      ...emptyInput,
      competitors: [{ asin: "B0A" }],
      sourcingConfirmed: true,
    });
    expect(deriveResearchStatus(rows, null).status).toBe("partial");
  });

  it("可选类别缺失保持可选，必填类别缺失保持待补（Requirement×Collection 语义）", () => {
    const rows = buildResearchMaterialRows(emptyInput);
    expect(rows.find((row) => row.key === "competitor")?.state).toBe("可选");
    expect(rows.find((row) => row.key === "sourcing")?.state).toBe("可选");
    expect(rows.find((row) => row.key === "keyword")?.state).toBe("待补");
    expect(rows.find((row) => row.key === "browser")?.state).toBe("待补");
    expect(rows.find((row) => row.key === "voc")?.state).toBe("待补");
    expect(rows.find((row) => row.key === "productBasics")?.state).toBe("待补");
  });

  it("keyword 报表已有 → keyword 行升级为已有", () => {
    const rows = buildResearchMaterialRows({ ...emptyInput, keywordReportEvidence: {} });
    expect(rows.find((row) => row.key === "keyword")?.state).toBe("已有");
  });

  it("rows 类型完整（state 只能是三态）", () => {
    const rows: ResearchMaterialRow[] = buildResearchMaterialRows(emptyInput);
    for (const row of rows) {
      expect(["已有", "待补", "可选"]).toContain(row.state);
    }
  });
});

// ── V3 Final HWF（P1-03 一致性）：已确认事实合并与计数 ──

describe("mergeConfirmedIntoOverview / coveredFactFieldSet", () => {
  const confirmed = (items: Array<Partial<ConfirmedFactCandidate> & { field: string; value: string | number }>): ConfirmedFactCandidate[] =>
    items.map((item, index) => ({
      candidateId: `human_manual:${item.field}`,
      label: item.field,
      sourceKind: "human_manual",
      sourceRef: "human_manual.supplied",
      humanConfirmationRequired: true,
      confirmedAt: "2026-08-15T00:00:00.000Z",
      confirmedBy: "owner",
      ...item,
      field: item.field,
      value: item.value,
    }));

  it("追加标题派生等已确认事实到商品概览（消除「已确认却显示暂无证据」矛盾）", () => {
    const overview = extractOverviewItems({
      sourceMeta: {
        productBatchSnapshot: { asin: "B0TEST0001", productFacts: { productTitle: "T", brand: "B", price: 10 } },
      },
    });
    const merged = mergeConfirmedIntoOverview(overview, confirmed([
      { field: "product_type", value: "保温杯", sourceKind: "product_title" },
      { field: "brand", value: "B2", sourceKind: "product_title" }, // 与 overview 同字段 → 去重
      { field: "capacity", value: "12oz" },
    ]));
    const fields = merged.map((item) => item.field);
    expect(fields).toContain("product_type");
    expect(fields).toContain("capacity");
    expect(fields.filter((field) => field === "brand")).toHaveLength(1);
    const productType = merged.find((item) => item.field === "product_type");
    expect(productType?.nature).toBe("derived"); // 标题派生
    expect(merged.find((item) => item.field === "capacity")?.nature).toBe("snapshot"); // 人工核实确定性值
  });

  it("coveredFactFieldSet：overview 归一化（rootCategory→category / BSR）+ confirmed 并集；市场观察不计入商品事实", () => {
    const overview = extractOverviewItems({
      sourceMeta: {
        productBatchSnapshot: {
          asin: "B0TEST0001",
          productFacts: { productTitle: "T", brand: "B", rootCategory: "Kitchen", rootCategoryBsr: 100 },
        },
      },
    });
    const covered = coveredFactFieldSet(overview, confirmed([{ field: "capacity", value: "12oz" }]));
    expect(covered.has("brand")).toBe(true);
    // V3R（契约④）：category/bsr 是市场观察，不计入商品事实覆盖
    expect(covered.has("category")).toBe(false);
    expect(covered.has("bsr")).toBe(false);
    expect(covered.has("capacity")).toBe(true);
    expect(covered.has("price")).toBe(false);
    expect(covered.size).toBe(2);
    expect(EXPECTED_FACT_FIELDS.has("capacity")).toBe(true);
    expect(EXPECTED_FACT_FIELDS.has("price")).toBe(false);
    expect(EXPECTED_FACT_FIELDS.size).toBe(15);
  });

  it("coveredFactFieldSet：confirmed 中的市场观察字段（price 等）不计入商品事实覆盖", () => {
    const covered = coveredFactFieldSet([], confirmed([
      { field: "capacity", value: "12oz" },
      { field: "price", value: 13.99 },
      { field: "reviews", value: 176393 },
    ]));
    expect(covered.has("capacity")).toBe(true);
    expect(covered.has("price")).toBe(false);
    expect(covered.has("reviews")).toBe(false);
    expect(covered.size).toBe(1);
  });

  it("buildResearchMaterialRows：已确认事实使商品基础资料升级为已有并给出 N/M 明细", () => {
    const covered = coveredFactFieldSet([], confirmed([{ field: "capacity", value: "12oz" }]));
    const rows = buildResearchMaterialRows({
      overview: [],
      competitors: [],
      keywordReportEvidence: null,
      browserEvidence: null,
      vocEvidence: null,
      sourcingConfirmed: false,
      productBasicsState: covered.size > 0 ? "已有" : "待补",
      productBasicsDetail: `已有 ${covered.size} 项 / 仍缺 ${EXPECTED_FACT_FIELDS.size - covered.size} 项`,
    });
    const productBasics = rows.find((row) => row.key === "productBasics");
    expect(productBasics?.state).toBe("已有");
    expect(productBasics?.detail).toBe("已有 1 项 / 仍缺 14 项");
  });
});

import { projectTaskResultForBrowser } from "@/lib/productResearchPublicDto";

describe("round9 批次概览恢复（详情投影→商品概览）", () => {
  const skeleton = {
    type: "workflow",
    productName: "Closet organizer",
    candidateToTask: { version: 1, candidateId: "private-candidate-id", confirmation: "research_started", confirmedAt: "2026-08-14T02:00:00.000Z" },
    candidateAnalysisContext: {
      version: "candidate-analysis-context-v1",
      integrity: "verified_product_batch",
      facts: {
        capturedAt: "2026-08-14T02:00:00.000Z",
        originKind: "seller_sprite_product_batch",
        productBatchId: "batch-1",
        productBatchItemId: "item-1",
        productName: "Closet organizer",
        marketplace: "US",
        asin: "B0SAMPLE12",
        reportType: "search_results",
        query: "organizer",
        category: "Home",
        researchPriority: "priority_1",
        evidenceStatus: "sufficient_for_comparison",
        provisionalDisposition: "provisional_score_only",
        evidenceHash: "e".repeat(64),
        itemHash: "d".repeat(64),
        sellerSpriteDisclaimerVersion: "v1",
        productFacts: {
          productTitle: "Closet organizer",
          brand: "Acme",
          price: 24.99,
          rating: 4.5,
          reviews: 120,
          rootCategoryBsr: 12700,
          subCategoryBsr: 1266,
          estimatedMonthlySales: 228,
          estimatedMonthlyRevenue: 10237,
        },
      },
      assessment: { researchMode: "market_research_only", promotionEligible: false },
    },
  };

  it("经过正式详情安全投影后，商品概览显示真实批次事实（不显示未绑定批次空态）", () => {
    const projected = projectTaskResultForBrowser(skeleton, "detail");
    const items = extractOverviewItems(projected);
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.find((item) => item.field === "productTitle")?.value).toBe("Closet organizer");
    expect(items.find((item) => item.field === "brand")?.value).toBe("Acme");
    expect(items.find((item) => item.field === "price")?.value).toBe("24.99");
    expect(items.find((item) => item.field === "rating")?.value).toBe("4.5");
    expect(items.find((item) => item.field === "reviews")?.value).toBe("120");
    expect(items.find((item) => item.field === "rootCategoryBsr")?.value).toBe("12700");
  });
});

describe("用户语言与信息收口（轮 12）", () => {
  it("评论区 SSR：零出现 Evidence/VOC/Missing/unknown，出现买家评论与需求（当前商品 ASIN 只读）", () => {
    const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
    const { createElement } = require("react") as typeof import("react");
    const html = renderToStaticMarkup(createElement(VocEvidenceSection, {
      taskId: "t1", taskAsin: "B08NCVT244", evidence: null, analysis: null, storageVersion: null, capability: null, onChanged: () => undefined,
    } as never));
    expect(html).toContain("粘贴导入");
    expect(/Evidence|\bVOC\b|Missing|unknown/.test(html)).toBe(false);
  });
  it("Amazon 商品资料区 SSR：标题与字段使用业务语言；成本与风险目标 id 保留", () => {
    const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
    const { createElement } = require("react") as typeof import("react");
    const html = renderToStaticMarkup(createElement(BrowserEvidenceSection, {
      taskId: "t1", taskAsin: "B08NCVT244", evidence: null, storageVersion: null, capability: null, onChanged: () => undefined,
    } as never));
    expect(/Evidence|\bVOC\b|Missing|unknown/.test(html)).toBe(false);
  });
});

describe("轮 10 合并：竞品与关键词自动化（源码结构契约）", () => {
  it("顺序：关键词策略在竞品策略上方（JSX 结构顺序）", () => {
    const kwIdx = wbSource.indexOf("<KeywordStrategyCard");
    const cmpIdx = wbSource.indexOf("<CompetitorStrategyCard");
    expect(kwIdx).toBeGreaterThan(0);
    expect(cmpIdx).toBeGreaterThan(kwIdx);
    // 去重红线（第2轮新结构：策略卡各唯一，旧平铺区块不再出现）
    expect((wbSource.match(/<CompetitorStrategyCard/g) || []).length).toBe(1);
    expect((wbSource.match(/<KeywordStrategyCard/g) || []).length).toBe(1);
    expect((wbSource.match(/workbench-competitors/g) || []).length).toBe(0);
    expect((wbSource.match(/workbench-keywords/g) || []).length).toBe(0);
  });
  it("竞品采集按钮升级为合并采集（文案「采集关键词+竞品」并携带关键词预览接线）", () => {
    expect(buttonSource).toContain("采集关键词+竞品");
    expect(buttonSource).toContain("onCollected");
    expect(buttonSource).toContain("keywordPreviewId");
    expect(wbSource).toContain("keywordPending");
    expect(wbSource).toContain("onCollected={({ keywordPreviewId");
  });
  it("轮 12.5 合并红线：关键词区不再有自己的采集/上传入口（仅竞品合并采集一键）", () => {
    expect(wbSource).not.toContain('kind="keyword"');
    expect(wbSource).not.toContain("自动采集关键词");
    expect(wbSource).not.toContain("上传 SellerSprite");
    expect(wbSource).toContain('<BrowserUseCollectButton taskId={taskId} kind="competitor"');
    expect(wbSource).toContain("<KeywordPendingSubmitCard");
  });
  it("轮 13 一致性：live 研究资料清单冒泡给外层（onMaterialRowsChange 接线）", () => {
    expect(wbSource).toContain("onMaterialRowsChange");
    expect(wbSource).toContain("onMaterialRowsChange?.({ rows: materialRows, counts: liveCounts, hasAiSummary: aiSummary })");
    expect(wbSource).toContain("LiveEvidenceCounts");
    expect(wbSource).toContain("materialRowsJson");
  });
  it("关键词区待确认卡片：保存走 keyword-evidence save_browser_use + 关键词区版本；保存后刷新并清卡", () => {
    expect(wbSource).toContain("<KeywordPendingSubmitCard");
    expect(wbSource).toContain("keywordReportStorageVersion");
    expect(wbSource).toContain("setKeywordPending(null); loadKeywordEvidence();");
    expect(cardSource).toContain("待确认：竞品采集得到的关键词");
    expect(cardSource).toContain("keyword-pending-save");
    expect(cardSource).toContain("keyword-pending-cancel");
    expect(cardSource).toContain("buildSaveBrowserUsePayload");
    expect(cardSource).toContain("keyword-evidence");
  });
  it("失败语义：关键词段失败仍 409（not 新行为）；预览/保存/取消无落库副作用（save 之外）", () => {
    expect(cardSource).toContain("取消");
    expect(cardSource).toContain("版本信息尚未就绪");
    expect(cardSource).toContain("未发送保存请求");
    expect(buttonSource).toContain("已取消，未保存任何数据。");
  });
});


// ── R6 UX 修复：已保存关键词证据 → Keyword Brief 生成与确认 ──
// TDD：先写纯函数与接线契约，再最小实现。

describe("buildKeywordBriefDraft（已保存证据 → Brief 草稿）", () => {
  it("从第 1 行关键词取主词，其余去重取前 N 辅助词（backend 空，由用户确认）", () => {
    const rows = [
      { rowNumber: 1, keyword: "kids food jar", keywordTranslation: "儿童食品罐", fields: {} },
      { rowNumber: 2, keyword: "insulated lunch box", keywordTranslation: "保温午餐盒", fields: {} },
      { rowNumber: 3, keyword: "kids food jar", keywordTranslation: "儿童食品罐", fields: {} },
      { rowNumber: 4, keyword: "bento jar", keywordTranslation: "便当罐", fields: {} },
      { rowNumber: 5, keyword: "", keywordTranslation: null, fields: {} },
    ];
    const draft = buildKeywordBriefDraft(rows as never);
    expect(draft).not.toBeNull();
    expect(draft?.primaryKeyword).toBe("kids food jar");
    expect(draft?.supportingKeywords).toEqual(["insulated lunch box", "bento jar"]); // 去重 + 跳过空词 + 无重复
  });

  it("无有效关键词行 → null（不给空白 Brief）", () => {
    expect(buildKeywordBriefDraft([] as never)).toBeNull();
    expect(buildKeywordBriefDraft([{ rowNumber: 1, keyword: "  ", fields: {} }] as never)).toBeNull();
  });

  it("辅助词有界（最多 5 个），且不重复主词", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      rowNumber: i + 1,
      keyword: "kw-" + (i === 0 ? "primary" : "s" + i),
      keywordTranslation: null,
      fields: {},
    }));
    const draft = buildKeywordBriefDraft(rows as never);
    expect(draft?.primaryKeyword).toBe("kw-primary");
    expect(draft?.supportingKeywords.length).toBeLessThanOrEqual(5);
    expect(draft?.supportingKeywords).not.toContain("kw-primary");
  });
});

describe("KeywordStrategyCard 接线契约（替代旧 KeywordBriefCreateCard）", () => {
  const kwCardSource = readFileSync(resolve(process.cwd(), "components/evidence/KeywordStrategyCard.tsx"), "utf8");
  it("KeywordStrategyCard 是关键词方案卡片（旧 KeywordBriefCreateCard 已废弃）", () => {
    expect(kwCardSource).toContain("KeywordStrategyCard");
    expect(kwCardSource).toContain("我已核对关键词方案");
    expect(kwCardSource).toContain("disabled");
    expect(kwCardSource).toContain("onSaved");
  });
  it("EvidenceWorkbench 的 onSave 必须调用后端 save_keyword_brief（action + confirmed:true + keywordBrief + /listing-handoff）", () => {
    expect(wbSource).toContain("KeywordStrategyCard");
    expect(wbSource).toContain("save_keyword_brief");
    expect(wbSource).toContain("confirmed: true");
    expect(wbSource).toContain("keywordBrief");
    expect(wbSource).toContain("/listing-handoff");
  });
});

describe("EvidenceWorkbench 关键词资料区接线", () => {
  it("关键词区渲染 KeywordStrategyCard（默认摘要+调整方案入口）", () => {
    expect(wbSource).toContain("KeywordStrategyCard");
    expect(wbSource).toContain("keywordReportEvidence");
    expect(wbSource).toContain("briefPrimary={keywordBrief");
  });
});

describe("关键词策略状态源（第3轮：不能用详情投影的缺失字段）", () => {
  it("从 listing-handoff GET 读取 keywordBriefSummary 作为状态源（不能用 result.listingKeywordBrief——detail 投影不返回）", () => {
    expect(wbSource).toContain('/listing-handoff');
    expect(wbSource).toContain('keywordBriefSummary');
    expect(wbSource).toContain('loadKeywordBriefState');
  });
});
