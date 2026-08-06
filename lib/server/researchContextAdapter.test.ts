import { describe, expect, it } from "vitest";
import {
  adaptResearchContextForHandoff,
} from "@/lib/server/researchContextAdapter";
import { buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";

/** 构造与真实 save-task 完全同构的 resultJson（V1 context + researchRecord + sourceMeta） */
function buildRealSavedTaskFixture(overrides: {
  context?: Record<string, unknown>;
  researchRecord?: Record<string, unknown>;
  candidateName?: string;
  productName?: string;
  withImage?: boolean;
} = {}) {
  const candidateId = "cmsh8428o000111nopha3wcbv";
  const contextHash = "84920252669631853792e49d16d974da7cd6bf7fc559e70d912503504a6a67d6";
  const facts = {
    capturedAt: "2026-08-06T07:57:46.956Z",
    originKind: "seller_sprite_market_research",
    marketplace: "Amazon US",
    reportType: "SellerSprite Search Results",
    asin: "B0ACCE0001",
    parentAsin: "B0ACCP0001",
    productUrl: "https://www.amazon.com/dp/B0ACCE0001",
    title: "合成验收商品 桌面手机支架",
    imageUrl: "https://www.amazon.com/images/p1.jpg",
    priceUsd: 12.99,
    rating: 4.6,
    reviewCount: 230,
    brand: "AccBrand",
    category: "Home & Kitchen > Office",
    searchRank: 12,
    estimatedMonthlySales: 450,
    estimatedMonthlyRevenueUsd: 5845,
    disclaimer: "third_party_estimate_point_in_time",
  };
  const researchHash = buildProductResearchHash({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "wf-68962026-bfc4-4504-9f2c-5516f78357c8",
    contextHash,
    inputHash: "a".repeat(64),
    resultHash: "b".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
      reviewedCount: 4,
      totalReviewSteps: 4,
      allReviewed: true,
    },
  });
  const decisionEvent = {
    decisionId: "90d732e9-5d6a-4440-a708-15b30186097d",
    status: "creative_ready",
    reason: "合成验收：风险可控，进入创作准备验证。",
    nextAction: "进入创作准备。",
    revision: 1,
    researchHash,
    decidedAt: "2026-08-06T08:10:15.536Z",
    actor: { mode: "owner", actorRef: "owner:v1" },
  };
  const imageSnapshot = overrides.withImage ? {
    version: "product-batch-product-image.v1",
    source: "sellersprite_product_batch",
    status: "available",
    productKey: "amazon:US:B0ACCE0001",
    candidateIdentityHash: "c".repeat(64),
    contentHash: "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77",
    capturedAt: "2026-08-06T07:57:46.956Z",
    bytes: 70,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  } : undefined;

  return {
    productName: overrides.productName ?? "合成验收商品 桌面手机支架",
    status: "completed",
    candidateAnalysisContext: overrides.context ?? {
      version: "candidate-analysis-context-v1",
      integrity: "verified_seller_sprite",
      facts,
      assessment: { researchMode: "market_research_only", promotionEligible: false },
    },
    researchRecord: overrides.researchRecord ?? {
      schema: "product-research-record.v1",
      revision: 1,
      researchHash,
      candidateId,
      runId: "wf-68962026-bfc4-4504-9f2c-5516f78357c8",
      contextHash,
      createdAt: "2026-08-06T07:57:46.956Z",
      updatedAt: "2026-08-06T08:10:15.536Z",
      latestDecision: decisionEvent,
      decisionEvents: [decisionEvent],
    },
    sourceMeta: {
      source: "opportunity",
      candidateId,
      candidateSnapshot: {
        version: 1,
        id: candidateId,
        name: overrides.candidateName ?? "合成验收商品 桌面手机支架",
        status: "worth_analyzing",
        capturedAt: "2026-08-06T07:57:46.956Z",
        ...(imageSnapshot ? { productImageSnapshot: imageSnapshot } : {}),
      },
    },
  };
}

describe("adaptResearchContextForHandoff", () => {
  it("适配真实 save-task V1 上下文为 Handoff 可消费格式", () => {
    const result = adaptResearchContextForHandoff(buildRealSavedTaskFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;
    expect(ctx.candidateId).toBe("cmsh8428o000111nopha3wcbv");
    expect(ctx.sourceType).toBe("seller_sprite_market_research");
    expect(ctx.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ctx.asin).toBe("B0ACCE0001");
    expect(ctx.productName).toBe("合成验收商品 桌面手机支架");
    expect(ctx.promotionEligible).toBe(false);
    expect(ctx.evidenceStatus).toBe("sellersprite_market_research");
    expect(ctx.capturedAt).toBe("2026-08-06T07:57:46.956Z");
    expect(ctx.disclaimer).toBe("third_party_estimate_point_in_time");
    // 无图片快照时 productImage 省略（Handoff 合同允许可选）
    expect(ctx.productImage).toBeUndefined();
  });

  it("productImage 快照存在时构造 task_snapshot 图片（内容哈希一致）", () => {
    const result = adaptResearchContextForHandoff(buildRealSavedTaskFixture({ withImage: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.productImage).toBeDefined();
    expect(result.context.productImage?.provenance).toBe("task_snapshot");
    expect(result.context.productImage?.mimeType).toBe("image/png");
    expect(result.context.productImage?.contentHash).toBe("c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77");
  });

  it("已是 Handoff 可消费格式时原样通过（不重复转换）", () => {
    const directContext = {
      candidateId: "cmsh8428o000111nopha3wcbv",
      productName: "合成验收商品",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite 市场调查",
      marketplace: "Amazon US",
      reportType: "SellerSprite Search Results",
      asin: "B0ACCE0001",
      parentAsin: "B0ACCP0001",
      productUrl: "https://www.amazon.com/dp/B0ACCE0001",
      title: "合成验收商品 桌面手机支架",
      imageUrl: "https://www.amazon.com/images/p1.jpg",
      priceUsd: 12.99,
      rating: 4.6,
      reviewCount: 230,
      brand: "AccBrand",
      category: "Home & Kitchen > Office",
      disclaimer: "third_party_estimate_point_in_time",
      evidenceStatus: "sellersprite_market_research",
      researchPriority: "人工研究",
      promotionEligible: false,
      capturedAt: "2026-08-06T07:57:46.956Z",
      contextHash: "84920252669631853792e49d16d974da7cd6bf7fc559e70d912503504a6a67d6",
    };
    const result = adaptResearchContextForHandoff(buildRealSavedTaskFixture({ context: directContext }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.sourceType).toBe("seller_sprite_market_research");
  });

  it("researchRecord 缺失时 fail-closed（不伪造绑定）", () => {
    const fixture = buildRealSavedTaskFixture();
    delete (fixture as Record<string, unknown>).researchRecord;
    const result = adaptResearchContextForHandoff(fixture);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("research_record_missing");
  });

  it("researchRecord contextHash 非法时 fail-closed", () => {
    const fixture = buildRealSavedTaskFixture();
    fixture.researchRecord.contextHash = "not-a-hash";
    const result = adaptResearchContextForHandoff(fixture);
    expect(result.ok).toBe(false);
  });

  it("SellerSprite 事实不完整时 fail-closed（不伪造 asin/title）", () => {
    const fixture = buildRealSavedTaskFixture();
    (fixture.candidateAnalysisContext as Record<string, unknown>).facts = {
      ...(fixture.candidateAnalysisContext as { facts: Record<string, unknown> }).facts,
      asin: "",
      title: "",
    };
    const result = adaptResearchContextForHandoff(fixture);
    expect(result.ok).toBe(false);
  });

  it("unverified 或未知 integrity 时 fail-closed", () => {
    const fixture = buildRealSavedTaskFixture({
      context: {
        version: "candidate-analysis-context-v1",
        integrity: "unverified",
      },
    });
    const result = adaptResearchContextForHandoff(fixture);
    expect(result.ok).toBe(false);
  });

  it("candidateAnalysisContext 缺失时 fail-closed", () => {
    const fixture = buildRealSavedTaskFixture();
    delete (fixture as Record<string, unknown>).candidateAnalysisContext;
    const result = adaptResearchContextForHandoff(fixture);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("candidate_analysis_context_missing");
  });

  it("productName 缺失时 fail-closed", () => {
    const fixture = buildRealSavedTaskFixture();
    delete (fixture as Record<string, unknown>).productName;
    fixture.sourceMeta.candidateSnapshot.name = "";
    const result = adaptResearchContextForHandoff(fixture);
    expect(result.ok).toBe(false);
  });

  it("适配结果可被 parseCandidateResearchContext 重新接受（合同一致）", async () => {
    const { parseCandidateResearchContext } = await import("@/lib/candidateResearchContext");
    const result = adaptResearchContextForHandoff(buildRealSavedTaskFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parseCandidateResearchContext(result.context);
    expect(reparsed).not.toBeNull();
    expect(reparsed?.candidateId).toBe(result.context.candidateId);
  });
});
