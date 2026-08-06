import { describe, expect, it } from "vitest";
import { normalizeAgentOutputSnapshot } from "@/lib/agentOutputSnapshot";
import { buildProductCreativeHandoffProjectionEvidence } from "@/lib/productCreativeHandoffProjectionEvidence";
import {
  projectProductCreativeHandoffCandidate,
  ProductCreativeHandoffProjectionError,
} from "@/lib/productCreativeHandoffProjection";
import { buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import type { CandidateResearchContext } from "@/lib/candidateResearchContext";

/**
 * P1-2 门禁协调：sellingPoints / Listing bullets 缺失不再阻断 Creative Handoff。
 *
 * 背景（第二次最终验收 BLOCKER）：真实 research（market_research_only）的
 * SummaryStepOutput 无 sellingPoints 字段、ListingStepOutput 只有 title/keywords
 * （无 bullets）→ agentOutputSnapshot.missingInputs=["Listing bullets"]
 * → nextActionSnapshot.blockingIssues 含 "Listing bullets"
 * → 投影证据产生 risk:"blocking" issue → parseCandidate 拒绝
 * → create 500 invalid_handoff_candidate。
 *
 * 修复后：blockingIssues 仅含真实阻塞（风险/合规/黑名单）；
 * missingInputs 作为 low-risk missing issue 留在证据层，不阻断 Handoff；
 * Listing bullets 由 Listing 阶段从 confirmedFacts 生成。
 */

const CANDIDATE_ID = "cmsh8428o000111nopha3wcbv";

function buildContext(): CandidateResearchContext {
  return {
    candidateId: CANDIDATE_ID,
    productName: "合成验收商品 桌面手机支架",
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
}

function buildAgentOutput(opts: {
  riskFlags?: string[];
  missingListingInputs?: boolean;
  withSellingPoints?: boolean;
} = {}) {
  const riskFlags = opts.riskFlags ?? [];
  const listing = opts.missingListingInputs === false
    ? { title: "English Title", bullets: ["bullet one"], keywords: ["kw"] }
    : { title: "", keywords: [] };
  return normalizeAgentOutputSnapshot({
    workflowResult: {
      productName: "合成验收商品 桌面手机支架",
      sourcing: { conclusion: "货源可行" },
      risk: { overallLevel: "yellow", riskFlags, summary: "中风险" },
      summary: {
        decision: "cautious",
        ...(opts.withSellingPoints ? { sellingPoints: ["卖点一"] } : {}),
      },
      listing,
      finalReport: {
        finalVerdict: "可做但需谨慎",
        riskLevel: "yellow",
        nextSteps: ["复核供应商"],
      },
    },
  });
}

function buildResearchRecord() {
  const researchHash = buildProductResearchHash({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: CANDIDATE_ID,
    runId: "wf-68962026-bfc4-4504-9f2c-5516f78357c8",
    contextHash: "84920252669631853792e49d16d974da7cd6bf7fc559e70d912503504a6a67d6",
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
  return {
    schema: "product-research-record.v1",
    revision: 1,
    researchHash,
    candidateId: CANDIDATE_ID,
    runId: "wf-68962026-bfc4-4504-9f2c-5516f78357c8",
    contextHash: "84920252669631853792e49d16d974da7cd6bf7fc559e70d912503504a6a67d6",
    createdAt: "2026-08-06T07:57:46.956Z",
    updatedAt: "2026-08-06T08:10:15.536Z",
    latestDecision: decisionEvent,
    decisionEvents: [decisionEvent],
  };
}

function project(evidence: ReturnType<typeof buildProductCreativeHandoffProjectionEvidence>) {
  return projectProductCreativeHandoffCandidate({
    sourceResearch: {
      recordSchema: "product-research-record.v1",
      candidateId: CANDIDATE_ID,
      researchRevision: 1,
      researchHash: "b".repeat(64),
      workflowStatus: "completed",
      decisionStatus: "creative_ready",
      candidateSourceFingerprint: "8492025266963185",
    },
    productIdentity: {
      displayName: "合成验收商品 桌面手机支架",
      identityConfirmedAt: "2026-08-06T08:10:15.536Z",
    },
    evidence: evidence.evidence,
    prohibitedClaims: [{
      claimId: "00000000-0000-4000-8000-000000000001",
      category: "absolute_claim" as const,
      summary: "Do not make absolute claims.",
      appliesTo: ["both" as const],
      source: "system_rule" as const,
    }],
    creativePreferences: { evidenceTier: "creative_preference" as const },
    visualReferences: [],
  });
}

describe("P1-2 Handoff 门禁协调", () => {
  it("真实研究（无 sellingPoints、无 bullets）→ blockingIssues 为空", () => {
    const snapshot = buildAgentOutput({ missingListingInputs: true });
    expect(snapshot.listingSnapshot.missingInputs).toContain("Listing bullets");
    expect(snapshot.nextActionSnapshot.blockingIssues).toEqual([]);
  });

  it("真实风险 flag 仍进入 blockingIssues（真实阻塞不放松）", () => {
    const snapshot = buildAgentOutput({ riskFlags: ["外观专利需查"] });
    expect(snapshot.nextActionSnapshot.blockingIssues).toContain("外观专利需查");
  });

  it("无阻塞 → 证据层无 blocking issue，可进入 noConfirmedFacts 降级路径", () => {
    const snapshot = buildAgentOutput({ missingListingInputs: true });
    const evidenceInput = buildProductCreativeHandoffProjectionEvidence({
      researchRecord: buildResearchRecord() as never,
      context: buildContext(),
      agentOutput: snapshot,
      researchRevision: 1,
      researchHash: "b".repeat(64),
    });
    // 无 blocking evidence（risk=blocking）→ 无风险阻断
    const blocking = evidenceInput.evidence.filter(
      (e) => e.evidenceTier === "unknown_or_conflict" && e.issue.risk === "blocking",
    );
    expect(blocking).toEqual([]);
    // 无 confirmedFacts 时投影抛 invalid_projected_candidate（既有语义：noConfirmedFacts 分支），
    // 而不是 invalid_handoff_candidate 500
    expect(() => project(evidenceInput)).toThrow(ProductCreativeHandoffProjectionError);
    try {
      project(evidenceInput);
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductCreativeHandoffProjectionError);
      expect((error as ProductCreativeHandoffProjectionError).code).toBe("invalid_projected_candidate");
    }
  });

  it("missingInputs 仅作为 low-risk issue 留在证据层（不阻断）", () => {
    const snapshot = buildAgentOutput({ missingListingInputs: true });
    const evidenceInput = buildProductCreativeHandoffProjectionEvidence({
      researchRecord: buildResearchRecord() as never,
      context: buildContext(),
      agentOutput: snapshot,
      researchRevision: 1,
      researchHash: "b".repeat(64),
    });
    const missingIssue = evidenceInput.evidence.find(
      (e) => e.evidenceTier === "unknown_or_conflict"
        && e.issue.field === "listing_input"
        && e.issue.summary.includes("Listing bullets"),
    );
    expect(missingIssue).toBeDefined();
    if (missingIssue && missingIssue.evidenceTier === "unknown_or_conflict") {
      expect(missingIssue.issue.risk).toBe("low");
    }
  });

  it("存在真实 blocking issue（risk:blocking）→ 投影被拒绝（门禁不放松）", () => {
    const snapshot = buildAgentOutput({ missingListingInputs: false, riskFlags: [] });
    // 手工注入 blocking issue（如旧快照中的真实阻塞）→ 必须仍然拒绝
    const evidenceInput = buildProductCreativeHandoffProjectionEvidence({
      researchRecord: buildResearchRecord() as never,
      context: buildContext(),
      agentOutput: {
        ...snapshot,
        nextActionSnapshot: {
          ...snapshot.nextActionSnapshot,
          blockingIssues: ["supplier not verified"],
        },
      },
      researchRevision: 1,
      researchHash: "b".repeat(64),
    });
    const blocking = evidenceInput.evidence.filter(
      (e) => e.evidenceTier === "unknown_or_conflict" && e.issue.risk === "blocking",
    );
    expect(blocking.length).toBeGreaterThan(0);
  });
});
