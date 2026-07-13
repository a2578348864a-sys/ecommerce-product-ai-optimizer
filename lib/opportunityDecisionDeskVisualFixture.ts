import type { CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import type { OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";
import type { R22MarketDecision, R22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";

const FIXED_TIME = Date.parse("2026-07-13T00:00:00.000Z");
const FIXED_TIME_ISO = new Date(FIXED_TIME).toISOString();
const INPUT_HASH = "a".repeat(64);

function marketSnapshot(
  candidateId: string,
  marketDecision: R22MarketDecision,
  briefId: "A" | "B" = "A",
): R22MarketDecisionSnapshot {
  const insufficient = marketDecision === "insufficient_market_data";
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId,
    asin: `FIXTURE-${candidateId}`,
    briefId,
    frozenRank: 1,
    marketDecision,
    decisionReasons: [insufficient ? "required_market_data_incomplete" : "visual_fixture"],
    supportingEvidenceRefs: insufficient ? [] : [`fixture:market:${candidateId}`],
    opposingEvidenceRefs: [],
    marketMissingFields: insufficient ? ["customerProof"] : [],
    dataCompleteness: insufficient ? 0.5 : 1,
    confidence: insufficient ? "low" : "high",
    stabilityStatus: briefId === "B" ? "unstable" : "stable",
    ruleVersion: "r22-stage1-market-v1",
    inputHash: INPUT_HASH,
    createdAt: FIXED_TIME_ISO,
  };
}

function evidence(candidateId: string, riskFlags: string[] = []): CandidateEvidenceSnapshot {
  return {
    version: 1,
    sourceType: "visual_fixture",
    sourceName: "isolated-local-fixture",
    sourceUrl: `https://fixture.invalid/evidence/${candidateId}`,
    evidenceItems: ["仅用于部署前视觉验收"],
    extractionSignals: ["local_fixture"],
    qualityScore: 80,
    confidence: "high",
    riskFlags,
    decision: riskFlags.length > 0 ? "cautious" : "recommended",
    decisionReason: "deterministic visual fixture",
    nextAction: "visual review only",
    generatedAt: FIXED_TIME_ISO,
  };
}

function candidate(
  id: string,
  name: string,
  overrides: Partial<OpportunityCandidatePoolItem> = {},
): OpportunityCandidatePoolItem {
  return {
    id,
    identitySource: "server",
    sourceIntegrity: "verified_public",
    name,
    rawInput: name,
    link: `https://fixture.invalid/products/${id}/this-is-an-intentionally-long-audit-url-that-must-stay-out-of-the-compact-list`,
    score: 72,
    scoreAvailable: true,
    source: "隔离视觉 fixture",
    keyword: "organizer",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "仅用于检查状态语义和响应式布局",
    evidenceSnapshot: evidence(id),
    candidateStatus: "pending",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    lastActionAt: null,
    ...overrides,
  };
}

export const OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE: OpportunityCandidatePoolItem[] = [
  candidate("fixture-shortlisted", "折叠衣柜分层收纳架", {
    score: 88,
    candidateStatus: "worth_analyzing",
    r22MarketDecisionSnapshot: marketSnapshot("fixture-shortlisted", "market_shortlisted"),
    riskLevel: "green",
    riskLabel: "低风险",
  }),
  candidate("fixture-watch", "透明橱柜抽屉收纳盒", {
    score: 68,
    r22MarketDecisionSnapshot: marketSnapshot("fixture-watch", "market_watch"),
    riskLevel: "yellow",
    riskLabel: "待核对",
  }),
  candidate("fixture-insufficient", "水槽下双层置物架", {
    score: 0,
    scoreAvailable: false,
    r22MarketDecisionSnapshot: marketSnapshot("fixture-insufficient", "insufficient_market_data"),
    sourceIntegrity: "unverified",
  }),
  candidate("fixture-high-risk", "品牌图案桌面收纳套装", {
    score: 75,
    r22MarketDecisionSnapshot: marketSnapshot("fixture-high-risk", "market_watch", "B"),
    evidenceSnapshot: evidence("fixture-high-risk", ["ip_risk"]),
  }),
  candidate("fixture-unknown-risk", "网格文件抽屉整理盘", {
    score: 0,
    scoreAvailable: true,
    evidenceSnapshot: null,
    sourceIntegrity: "unverified",
  }),
  candidate("fixture-converted", "可旋转家庭办公收纳架", {
    score: 84,
    candidateStatus: "analyzed",
    convertedTaskId: "fixture-task-001",
    r22MarketDecisionSnapshot: marketSnapshot("fixture-converted", "market_shortlisted", "B"),
  }),
  candidate("fixture-rejected", "低质量同质化桌面杂物盒", {
    score: 31,
    candidateStatus: "rejected",
    r22MarketDecisionSnapshot: marketSnapshot("fixture-rejected", "market_reject", "B"),
    riskLevel: "red",
    riskLabel: "高风险",
  }),
];
