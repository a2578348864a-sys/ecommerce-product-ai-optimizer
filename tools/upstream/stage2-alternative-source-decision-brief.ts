import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";

type Evidence = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validHash(value: Evidence): boolean {
  if (typeof value.evidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.evidenceHash)) return false;
  const { evidenceHash, ...body } = value;
  return stableHash(body) === evidenceHash;
}

function validProbe1(value: Evidence, brief: Stage2AlternativeSourceBrief): boolean {
  const page = isRecord(value.page) ? value.page : {};
  return value.schemaVersion === "stage2-alternative-source-capability-probe-run.v2"
    && value.briefId === brief.briefId
    && value.briefHash === brief.briefHash
    && value.status === "failed_closed"
    && value.errorCode === "unknown_page"
    && page.classification === "unknown_page"
    && Array.isArray(value.allowedProductUrls)
    && value.allowedProductUrls.length === 0
    && value.supplierFieldsCollected === 0
    && validHash(value);
}

function validProbe2(value: Evidence, brief: Stage2AlternativeSourceBrief): boolean {
  const page = isRecord(value.page) ? value.page : {};
  const diagnostic = isRecord(value.unknownPageDiagnostic) ? value.unknownPageDiagnostic : {};
  const cleanup = isRecord(value.cleanup) ? value.cleanup : {};
  return value.schemaVersion === "stage2-alternative-source-capability-probe-run.v3"
    && value.briefId === brief.briefId
    && value.briefHash === brief.briefHash
    && value.status === "failed_closed"
    && value.errorCode === "unknown_page"
    && page.classification === "unknown_page"
    && diagnostic.status === "diagnostic_evidence_present"
    && diagnostic.failClosedRequired === true
    && diagnostic.allowsCollection === false
    && Array.isArray(value.allowedProductUrls)
    && value.allowedProductUrls.length === 0
    && value.supplierFieldsCollected === 0
    && cleanup.pageClosed === true
    && cleanup.browserClosed === true
    && cleanup.debugPortReleased === true
    && cleanup.profileRemoved === true
    && cleanup.browserProcessBaselineRestored === true
    && validHash(value);
}

export function buildStage2AlternativeSourceDecisionBrief(input: {
  brief: Stage2AlternativeSourceBrief;
  probe1Run: Evidence;
  probe2Run: Evidence;
  createdAt: string;
}) {
  if (!Number.isFinite(Date.parse(input.createdAt))
    || !validProbe1(input.probe1Run, input.brief)
    || !validProbe2(input.probe2Run, input.brief)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_DECISION_EVIDENCE_INVALID");
  }
  const probe1Page = input.probe1Run.page as Record<string, unknown>;
  const probe2Page = input.probe2Run.page as Record<string, unknown>;
  const diagnostic = input.probe2Run.unknownPageDiagnostic as Record<string, unknown>;
  const counts = diagnostic.structureCounts as Record<string, unknown>;
  const body = {
    schemaVersion: "stage2-alternative-source-decision-brief.v1" as const,
    decisionBriefId: `stage2-alternative-source-decision-${stableHash({
      briefHash: input.brief.briefHash,
      probe1RunEvidenceHash: input.probe1Run.evidenceHash,
      probe2RunEvidenceHash: input.probe2Run.evidenceHash,
      createdAt: input.createdAt,
    }).slice(0, 24)}`,
    status: "pending_user_decision" as const,
    createdAt: input.createdAt,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    probe1RunId: input.probe1Run.runId as string,
    probe1RunEvidenceHash: input.probe1Run.evidenceHash as string,
    probe2RunId: input.probe2Run.runId as string,
    probe2RunEvidenceHash: input.probe2Run.evidenceHash as string,
    currentConclusion: "unchanged_capability_probe_retry_not_supported" as const,
    observedFacts: {
      probe1: {
        status: input.probe1Run.status,
        classification: probe1Page.classification,
        reasonCodes: input.probe1Run.reasonCodes,
        allowedProductUrlCount: (input.probe1Run.allowedProductUrls as unknown[]).length,
      },
      probe2: {
        status: input.probe2Run.status,
        classification: probe2Page.classification,
        reasonCodes: input.probe2Run.reasonCodes,
        allowedProductUrlCount: (input.probe2Run.allowedProductUrls as unknown[]).length,
        diagnosticStatus: diagnostic.status,
        genericProductClassElementCount: counts.genericProductClassElementCount,
        exactAllowedProductPathCount: counts.exactAllowedProductPathCount,
        looseSameOriginProductPathCount: counts.looseSameOriginProductPathCount,
        supplierSubdomainProductPathCount: counts.supplierSubdomainProductPathCount,
      },
    },
    options: [
      {
        optionId: "stop_made_in_china_current_policy" as const,
        meaning: "停止按当前精确 Origin/路径策略使用 Made-in-China，不再原样重试。",
        requiresNewAuthorization: false as const,
        automaticallySelected: false as const,
      },
      {
        optionId: "design_supplier_subdomain_policy_probe" as const,
        meaning: "单独设计供应商子域名的政策、安全和可持续性探针；设计与任何真实访问均需新授权。",
        requiresNewAuthorization: true as const,
        automaticallySelected: false as const,
      },
      {
        optionId: "select_different_public_source" as const,
        meaning: "放弃当前来源，重新调查并冻结另一个公开来源 Brief；真实调查需新授权。",
        requiresNewAuthorization: true as const,
        automaticallySelected: false as const,
      },
    ],
    recommendedAction: "do_not_retry_unchanged_request_user_source_decision" as const,
    selectedOption: null,
    approvedBy: null,
    sourceCapabilityValidated: false as const,
    supplierSubdomainPolicyAuthorized: false as const,
    realSupplierEvidenceCollected: false as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    boundaries: [
      "supplier_subdomain_observation_is_not_policy_approval",
      "path_counts_do_not_prove_all_relevant_links_use_supplier_subdomains",
      "unknown_page_diagnostic_does_not_validate_source_capability",
      "historical_probe_failures_are_not_reclassified",
      "no_external_action_authorized_by_this_brief",
    ],
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function validateStage2AlternativeSourceDecisionBrief(input: {
  decisionBrief: unknown;
  brief: Stage2AlternativeSourceBrief;
  probe1Run: Evidence;
  probe2Run: Evidence;
}) {
  const reasons: string[] = [];
  if (!isRecord(input.decisionBrief)) {
    const body = {
      schemaVersion: "stage2-alternative-source-decision-brief-validation.v1" as const,
      status: "invalid" as const,
      decisionBriefId: null,
      reasonCodes: ["decision_brief_not_object"],
    };
    return { ...body, inputHash: stableHash(body) };
  }
  const decision = input.decisionBrief;
  if (!validProbe1(input.probe1Run, input.brief) || !validProbe2(input.probe2Run, input.brief)) {
    reasons.push("decision_source_evidence_invalid");
  }
  const { evidenceHash, ...bodyWithoutHash } = decision;
  if (typeof evidenceHash !== "string" || stableHash(bodyWithoutHash) !== evidenceHash) {
    reasons.push("decision_brief_hash_invalid");
  }
  if (decision.schemaVersion !== "stage2-alternative-source-decision-brief.v1"
    || decision.status !== "pending_user_decision") reasons.push("decision_brief_schema_or_status_invalid");
  if (decision.briefHash !== input.brief.briefHash
    || decision.probe1RunEvidenceHash !== input.probe1Run.evidenceHash
    || decision.probe2RunEvidenceHash !== input.probe2Run.evidenceHash) {
    reasons.push("decision_brief_evidence_binding_mismatch");
  }
  if (decision.selectedOption !== null || decision.approvedBy !== null) {
    reasons.push("decision_must_remain_unselected");
  }
  if (decision.sourceCapabilityValidated !== false
    || decision.supplierSubdomainPolicyAuthorized !== false
    || decision.realSupplierEvidenceCollected !== false) {
    reasons.push("decision_brief_overstates_validation");
  }
  const resultBody = {
    schemaVersion: "stage2-alternative-source-decision-brief-validation.v1" as const,
    status: reasons.length === 0 ? "valid_pending_user_decision" as const : "invalid" as const,
    decisionBriefId: typeof decision.decisionBriefId === "string" ? decision.decisionBriefId : null,
    briefHash: input.brief.briefHash,
    probe1RunEvidenceHash: input.probe1Run.evidenceHash,
    probe2RunEvidenceHash: input.probe2Run.evidenceHash,
    reasonCodes: [...new Set(reasons)],
  };
  return { ...resultBody, inputHash: stableHash(resultBody) };
}
