import {
  buildFactCandidateView,
  getFactCandidates,
} from "@/lib/factCandidates";
import {
  getProductResearchRecord,
  getProductResearchVerification,
  getResearchCompletion,
  getResearchStaleState,
  hasProductResearchRecordNamespace,
  isModernResearchTaskShape,
  verifyProductResearchHash,
} from "@/lib/productResearchRecord";

export type ResearchLifecyclePhase =
  | "created"
  | "collecting"
  | "awaiting_confirmation"
  | "awaiting_decision"
  | "ready_to_complete"
  | "completed"
  | "abandoned"
  | "blocked";

export type ResearchCollectionStatus =
  | "not_started"
  | "running"
  | "partial"
  | "ready"
  | "failed";

export type ResearchConfirmationStatus = "none" | "pending" | "confirmed";

export type ResearchDecisionStatus =
  | "none"
  | "needs_information"
  | "creative_ready"
  | "abandoned";

export type ResearchCompletionStatus = "not_completed" | "completed" | "abandoned";

export type ResearchCreativeReadiness = "not_ready" | "ready" | "blocked";

export type ResearchContractMode = "modern" | "legacy" | "invalid";

export type ResearchRuntimeCollectionStatus =
  | "running"
  | "awaiting_confirmation"
  | "ready"
  | "failed"
  | "partial"
  | "needs_user";

export type ResearchLifecycleSnapshot = {
  /** 统一业务 phase，不是原始 resultJson 的 status 包装。 */
  phase: ResearchLifecyclePhase;
  collectionStatus: ResearchCollectionStatus;
  confirmationStatus: ResearchConfirmationStatus;
  decisionStatus: ResearchDecisionStatus;
  completionStatus: ResearchCompletionStatus;
  creativeReadiness: ResearchCreativeReadiness;
  stale: boolean;
  blockers: string[];
  nextAction: string;
  /** 用于明确区分新版、旧版和损坏合同；不暴露原始字段。 */
  contractMode: ResearchContractMode;
};

export type ResearchLifecycleReaderInput = {
  result: unknown;
  /** 仅作为旧任务兼容输入；modern task 不得覆盖 latestDecision。 */
  decisionStatus?: string | null;
  type?: string | null;
  /** 当前候选绑定是否已经由调用方完成实体校验。undefined = 尚未验证。 */
  candidateBindingValid?: boolean;
  /** Orchestrator 的短期运行态；不存在时 reader 必须依赖持久化资料稳定工作。 */
  runtimeCollection?: {
    status?: ResearchRuntimeCollectionStatus | null;
    pendingPreview?: boolean;
  } | null;
  /** 由 fact-candidates 端点得到的当前待确认数量；不传时从持久化证据派生。 */
  pendingConfirmationCount?: number;
};

const LEGACY_DECISIONS = new Set(["pending", "continue", "need_info", "rejected"]);
const EVIDENCE_KEYS = [
  "browserEvidence",
  "keywordEvidence",
  "competitorEvidence",
  "reviewEvidence",
  "vocAnalysis",
  "sourcingEvidence",
  "aiEvidenceSummary",
  "finalReport",
  "agentOutputSnapshot",
  "summary",
  "listingPrepSnapshot",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasResearchMaterial(result: Record<string, unknown>): boolean {
  return EVIDENCE_KEYS.some((key) => {
    const value = result[key];
    if (Array.isArray(value)) return value.length > 0;
    return isRecord(value) && Object.keys(value).length > 0;
  })
    || hasOwn(result, "factCandidates")
    || hasOwn(result, "researchVerification");
}

// Modern-shape detection lives in lib/productResearchRecord so the lifecycle reader
// and the creative/Listing gate share one predicate (they used to disagree: a task
// with candidate markers but no research record yet read as "legacy" to the gate).

function normalizeLegacyDecision(value: unknown): ResearchDecisionStatus {
  if (value === "rejected") return "abandoned";
  if (value === "continue") return "creative_ready";
  if (value === "need_info") return "needs_information";
  return "none";
}

function readModernDecision(result: Record<string, unknown>): ResearchDecisionStatus {
  const record = getProductResearchRecord(result);
  if (!record) return "none";
  return record.latestDecision.status;
}

function readCompletionStatus(result: Record<string, unknown>): ResearchCompletionStatus {
  const completion = getResearchCompletion(result);
  if (!completion) return "not_completed";
  return completion.status === "completed" ? "completed" : "abandoned";
}

function readCollectionStatus(
  result: Record<string, unknown>,
  input: ResearchLifecycleReaderInput,
): ResearchCollectionStatus {
  const runtime = input.runtimeCollection?.status;
  if (runtime === "running") return "running";
  if (runtime === "failed") return "failed";
  if (runtime === "ready") return "ready";
  if (runtime === "awaiting_confirmation" || runtime === "partial" || runtime === "needs_user") return "partial";

  const verification = getProductResearchVerification(result);
  if (verification?.workflowStatus === "completed") return "ready";
  if (verification?.workflowStatus === "partial_failed") return "failed";
  return hasResearchMaterial(result) ? "partial" : "not_started";
}

function readConfirmationStatus(
  result: Record<string, unknown>,
  input: ResearchLifecycleReaderInput,
): ResearchConfirmationStatus {
  const stored = getFactCandidates(result);
  const confirmedCount = stored?.confirmed.length ?? 0;
  const pendingCount = input.pendingConfirmationCount === undefined
    ? buildFactCandidateView(result).candidates.length
    : Math.max(0, Math.floor(input.pendingConfirmationCount));
  if (pendingCount > 0) return "pending";
  if (confirmedCount > 0) return "confirmed";
  return "none";
}

function boundedPush(blockers: string[], value: string): void {
  if (!blockers.includes(value) && blockers.length < 8) blockers.push(value);
}

function invalidSnapshot(
  blockers: string[],
  collectionStatus: ResearchCollectionStatus,
  confirmationStatus: ResearchConfirmationStatus,
): ResearchLifecycleSnapshot {
  return {
    phase: "blocked",
    collectionStatus,
    confirmationStatus,
    decisionStatus: "none",
    completionStatus: "not_completed",
    creativeReadiness: "blocked",
    stale: false,
    blockers,
    nextAction: "返回商品研究核对研究合同。",
    contractMode: "invalid",
  };
}

/**
 * Research Lifecycle 的单一只读入口。
 *
 * 该函数只读取并派生快照，不写数据库，不改变任何旧字段，也不执行 Creative Handoff
 * 或 Listing 生成。Runtime collection 只是当前请求的临时投影，不能覆盖已持久化完成态。
 */
export function getResearchLifecycleState(input: ResearchLifecycleReaderInput): ResearchLifecycleSnapshot {
  const result = isRecord(input.result) ? input.result : null;
  if (!result) {
    return invalidSnapshot(["research_result_invalid"], "not_started", "none");
  }

  const modern = isModernResearchTaskShape(result);
  const hasRecordField = hasOwn(result, "researchRecord");
  const record = getProductResearchRecord(result);
  const hasVersionedRecord = hasProductResearchRecordNamespace(result);
  const verification = getProductResearchVerification(result);
  const collectionStatus = readCollectionStatus(result, input);
  const confirmationStatus = readConfirmationStatus(result, input);

  if (hasRecordField && !record) {
    return invalidSnapshot(["research_record_invalid"], collectionStatus, confirmationStatus);
  }
  if (hasOwn(result, "researchVerification") && !verification) {
    return invalidSnapshot(["research_verification_invalid"], collectionStatus, confirmationStatus);
  }
  if (hasVersionedRecord && (!record || !verification || !verifyProductResearchHash(record, verification))) {
    return invalidSnapshot(["research_verification_invalid"], collectionStatus, confirmationStatus);
  }

  if (!modern) {
    const legacyDecision = normalizeLegacyDecision(input.decisionStatus);
    const blockers: string[] = ["legacy_not_supported"];
    if (legacyDecision === "abandoned") {
      return {
        phase: "abandoned",
        collectionStatus,
        confirmationStatus,
        decisionStatus: "abandoned",
        completionStatus: "abandoned",
        creativeReadiness: "blocked",
        stale: false,
        blockers,
        nextAction: "查看旧研究记录；新版研究合同未建立。",
        contractMode: "legacy",
      };
    }
    if (legacyDecision === "creative_ready" || legacyDecision === "needs_information") {
      return {
        phase: "awaiting_decision",
        collectionStatus,
        confirmationStatus,
        decisionStatus: legacyDecision,
        completionStatus: "not_completed",
        creativeReadiness: "blocked",
        stale: false,
        blockers,
        nextAction: "该记录属于旧版合同，不能直接进入创作；请建立新版研究记录。",
        contractMode: "legacy",
      };
    }
    return {
      phase: hasResearchMaterial(result) ? "awaiting_decision" : "created",
      collectionStatus,
      confirmationStatus,
      decisionStatus: "none",
      completionStatus: "not_completed",
      creativeReadiness: "blocked",
      stale: false,
      blockers,
      nextAction: "该记录属于旧版合同，不能直接进入创作；请建立新版研究记录。",
      contractMode: "legacy",
    };
  }

  const blockers: string[] = [];
  const decisionStatus = record?.latestDecision.status ?? "none";
  const completionStatus = readCompletionStatus(result);
  const stale = getResearchStaleState(result).stale;
  const runtime = input.runtimeCollection;

  if (completionStatus === "abandoned" || decisionStatus === "abandoned") {
    return {
      phase: "abandoned",
      collectionStatus,
      confirmationStatus,
      decisionStatus: "abandoned",
      completionStatus: completionStatus === "abandoned" ? "abandoned" : "not_completed",
      creativeReadiness: "blocked",
      stale: false,
      blockers: ["decision_abandoned"],
      nextAction: "查看放弃原因；当前研究不进入创作。",
      contractMode: "modern",
    };
  }

  if (completionStatus === "completed") {
    if (stale) {
      return {
        phase: "completed",
        collectionStatus,
        confirmationStatus,
        decisionStatus,
        completionStatus,
        creativeReadiness: "blocked",
        stale: true,
        blockers: ["research_stale_requires_reconfirmation"],
        nextAction: "重新确认研究结论。",
        contractMode: "modern",
      };
    }
    if (decisionStatus !== "creative_ready") boundedPush(blockers, "decision_not_creative_ready");
    if (!verification) boundedPush(blockers, "research_verification_missing");
    if (input.candidateBindingValid !== true) boundedPush(blockers, input.candidateBindingValid === false ? "candidate_binding_invalid" : "candidate_binding_unverified");
    if (blockers.length > 0) {
      return {
        phase: "completed",
        collectionStatus,
        confirmationStatus,
        decisionStatus,
        completionStatus,
        creativeReadiness: "blocked",
        stale: false,
        blockers,
        nextAction: "核对研究绑定和人工决定后再进入创作。",
        contractMode: "modern",
      };
    }
    return {
      phase: "completed",
      collectionStatus,
      confirmationStatus,
      decisionStatus,
      completionStatus,
      creativeReadiness: "ready",
      stale: false,
      blockers: [],
      nextAction: "进入 Creative Handoff。",
      contractMode: "modern",
    };
  }

  if (decisionStatus === "creative_ready") {
    return {
      phase: "ready_to_complete",
      collectionStatus,
      confirmationStatus,
      decisionStatus,
      completionStatus,
      creativeReadiness: "blocked",
      stale: false,
      blockers: ["research_not_completed"],
      nextAction: "完成研究并保存研究记录。",
      contractMode: "modern",
    };
  }

  if (decisionStatus === "needs_information") {
    return {
      phase: "awaiting_decision",
      collectionStatus,
      confirmationStatus,
      decisionStatus,
      completionStatus,
      creativeReadiness: "not_ready",
      stale: false,
      blockers: ["research_needs_information"],
      nextAction: "补充研究资料后重新保存人工决定。",
      contractMode: "modern",
    };
  }

  if (confirmationStatus === "pending" || runtime?.pendingPreview === true || runtime?.status === "awaiting_confirmation") {
    return {
      phase: "awaiting_confirmation",
      collectionStatus,
      confirmationStatus: "pending",
      decisionStatus,
      completionStatus,
      creativeReadiness: "not_ready",
      stale: false,
      blockers: ["pending_confirmation"],
      nextAction: "确认待确认事实或研究预览。",
      contractMode: "modern",
    };
  }

  if (collectionStatus === "failed") {
    return {
      phase: "blocked",
      collectionStatus,
      confirmationStatus,
      decisionStatus,
      completionStatus,
      creativeReadiness: "blocked",
      stale: false,
      blockers: ["collection_failed"],
      nextAction: "检查失败来源后重试采集或补充资料。",
      contractMode: "modern",
    };
  }

  if (collectionStatus === "running") {
    return {
      phase: "collecting",
      collectionStatus,
      confirmationStatus,
      decisionStatus,
      completionStatus,
      creativeReadiness: "not_ready",
      stale: false,
      blockers: [],
      nextAction: "等待研究资料采集完成。",
      contractMode: "modern",
    };
  }

  if (hasResearchMaterial(result) || collectionStatus === "ready" || confirmationStatus === "confirmed") {
    return {
      phase: "awaiting_decision",
      collectionStatus,
      confirmationStatus,
      decisionStatus,
      completionStatus,
      creativeReadiness: "not_ready",
      stale: false,
      blockers: ["decision_not_saved"],
      nextAction: "保存人工研究决定。",
      contractMode: "modern",
    };
  }

  return {
    phase: "created",
    collectionStatus,
    confirmationStatus,
    decisionStatus,
    completionStatus,
    creativeReadiness: "not_ready",
    stale: false,
    blockers: [],
    nextAction: "开始补齐研究资料。",
    contractMode: "modern",
  };
}

/** 供测试和审计使用：确认 legacy 兼容输入没有被误读为新版决定。 */
export function isLegacyDecisionStatus(value: unknown): boolean {
  return typeof value === "string" && LEGACY_DECISIONS.has(value);
}
