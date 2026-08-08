/**
 * Creative Handoff Panel — 浏览器专用白名单类型
 *
 * 严格依据服务层 Browser DTO（productCreativeHandoffPreview.ts）定义。
 * 禁止声明/访问：candidateId、actorRef、内部主体、demoAccessId、
 * requestKeyHash、requestFingerprint、Request Ledger、完整 researchHash、
 * 完整 handoffFingerprint、sourceReference 内部对象、完整 Task、完整 resultJson。
 */

export type HandoffEligibility =
  | "eligible"
  | "no_confirmed_facts"
  | "legacy_not_supported"
  | "decision_not_creative_ready"
  | "workflow_incomplete"
  | "research_hash_invalid"
  | "verification_invalid"
  | "candidate_identity_mismatch"
  | "blocking_issue_present"
  | "research_mode_invalid";

export type ConfirmableFactCandidate = {
  selectionId: string;
  canonicalField: string;
  displayValue: string;
  sourceKindSummary: string;
  capturedAt: string;
  allowedUsageScopes: string[];
  humanConfirmationRequired: true;
  provenanceSummary: string;
};

export type StableSourceFact = {
  selectionId: string;
  field: string;
  label: string;
  stabilityRule: string;
};

export type AiReference = {
  selectionId: string;
  field: string;
  summary: string;
  allowedUse: string;
};

export type HandoffIssue = {
  selectionId: string;
  field: string;
  kind: string;
  summary: string;
  risk: string;
};

export type ProhibitedClaim = {
  selectionId: string;
  category: string;
  summary: string;
  appliesTo: string[];
};

export type CreativeHandoffPreview = {
  eligibility: HandoffEligibility;
  researchDecisionSummary?: {
    decisionStatus: string;
    workflowStatus: string;
    researchRevision: number;
    researchFingerprint: string;
  };
  candidateFactOptions?: { selectionId: string; field: string; label: string; valueSummary: string }[];
  confirmableFactCandidates?: ConfirmableFactCandidate[];
  stableSourceFacts?: StableSourceFact[];
  aiReferences?: AiReference[];
  issues?: HandoffIssue[];
  prohibitedClaims?: ProhibitedClaim[];
  creativePreferences?: {
    targetMarket?: string;
    language?: string;
    tone?: string;
    imageStyle?: string;
    backgroundPreference?: string;
    compositionPreference?: string;
    additionalRequirements?: string;
  };
  visualReferenceCandidates?: {
    selectionId: string;
    sourceTier: string;
    approvedForReference: boolean;
    summary?: string;
    contentHash?: string;
    /** V2 Visual Preview: 安全缩略图地址（同源 API；仅当候选人已绑定本任务时非空） */
    thumbnailUrl?: string;
  }[];
  blockingCodes?: string[];
  expectedResearchRevision?: number;
  expectedCurrentHandoffRevision?: number;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
};

export type HandoffDetailConfirmedFact = {
  field: string;
  label: string;
  usageScopes: string[];
};

export type HandoffDetailVersion = {
  revision: number;
  createdAt: string;
  confirmedFactFields: string[];
};

export type CreativeHandoffDetail = {
  handoffId?: string;
  currentRevision?: number;
  controlState?: string;
  effectiveStatus: string;
  staleReasonCode?: string;
  canCreateNewRevision: boolean;
  humanReviewRequired: boolean;
  sourceResearchRevision?: number;
  confirmedFacts?: HandoffDetailConfirmedFact[];
  prohibitedClaims?: { category: string; summary: string; appliesTo: string[] }[];
  versions?: HandoffDetailVersion[];
  createdAt?: string;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
};

export type PreviewResponse = {
  preview: CreativeHandoffPreview | null;
  gateReason: string;
};

export type DetailResponse = {
  detail: CreativeHandoffDetail | null;
  gateReason: string;
};

export type CreateResponse = {
  handoffId: string;
  currentRevision: number;
  isNewRevision: boolean;
  idempotentReplay: boolean;
};

export type RevokeResponse = {
  handoffId: string;
  controlState: string;
  idempotentReplay: boolean;
};

export type ApiError = {
  status: number;
  code: string;
  message: string;
};

export const REVOKE_REASON_OPTIONS = [
  { value: "explicit_user_revoke", label: "用户主动撤回" },
  { value: "decision_changed", label: "研究决定已改变" },
  { value: "identity_invalid", label: "候选身份无效" },
  { value: "verification_invalid", label: "验证信息无效" },
] as const;

export type RevokeReasonCode = (typeof REVOKE_REASON_OPTIONS)[number]["value"];

export const STALE_REASON_LABELS: Record<string, string> = {
  research_revision_changed: "研究版本已更新，旧交接内容已过期。",
  source_snapshot_changed: "来源数据已变化，旧交接内容已过期。",
  handoff_superseded: "交接已被新版本替代。",
  default: "交接已过期，请查看最新预览后重新确认。",
};

export const ELIGIBILITY_BLOCK_LABELS: Record<string, string> = {
  decision_not_creative_ready: "当前研究决定尚未进入创作准备，暂不能创建创作交接。",
  workflow_incomplete: "研究工作流尚未完成。",
  research_hash_invalid: "研究数据校验未通过。",
  verification_invalid: "研究验证信息无效。",
  candidate_identity_mismatch: "候选身份与研究记录不一致。",
  blocking_issue_present: "存在阻塞问题，暂不能创建创作交接。",
  research_mode_invalid: "当前研究模式不允许创建创作交接。",
  legacy_not_supported: "该记录没有可信商品研究合同，暂不支持创建创作交接。请从商品研究池重新创建正式研究。",
  no_confirmed_facts: "当前没有可人工确认的商品事实。",
  default: "当前研究状态不允许创建创作交接。",
};
