import { stableHash } from "../../lib/upstream/pipeline";
import type { NoviceMarketScreeningItem, NoviceMarketScreeningRun } from "./novice-market-screening";

const PROTOCOL_VERSION = "stage15-effectiveness-pilot-protocol.v1" as const;
const BLIND_PACKET_VERSION = "stage15-effectiveness-pilot-blind-packet.v1" as const;
const RESULT_TEMPLATE_VERSION = "stage15-effectiveness-pilot-result-template.v1" as const;
const COMPARABLE_CONTROL_REASON = "top_k_quota_not_allocated";

type PilotVisualItem = {
  blindItemId: string;
  title: string | null;
  sourceUrl: string;
  capturedAt: string;
  image: {
    imageUrl: string | null;
    sourceType: "direct_observation";
    capturedAt: string;
    missingReason: string | null;
    localAsset?: unknown;
  };
  chinesePresentation: {
    productTypeZh: string;
    primaryUseZh: string;
    sourceType: "ai_generated";
    status: "presentation_aid_not_source_fact";
    basedOnFields: string[];
  };
  [key: string]: unknown;
};

export type Stage15PilotVisualPacket = {
  schemaVersion: "solo-novice-visual-blind-review-packet.v2";
  sourceBlindReviewId: string;
  sourceEvidenceHash: string;
  items: PilotVisualItem[];
  packetHash: string;
  [key: string]: unknown;
};

export type Stage15EffectivenessPilotInput = {
  screeningRun: NoviceMarketScreeningRun;
  visualPacket: Stage15PilotVisualPacket;
  createdAt: string;
};

type PilotGroup = "advance" | "control";

function withoutHash<T extends Record<string, unknown>, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function verifySource(input: Stage15EffectivenessPilotInput) {
  const { screeningRun, visualPacket } = input;
  if (screeningRun.schemaVersion !== "novice-market-screening-run.v1") {
    throw new Error("STAGE15_PILOT_SOURCE_SCREENING_SCHEMA_INVALID");
  }
  if (stableHash(withoutHash(screeningRun, "screeningHash")) !== screeningRun.screeningHash) {
    throw new Error("STAGE15_PILOT_SOURCE_SCREENING_HASH_INVALID");
  }
  if (visualPacket.schemaVersion !== "solo-novice-visual-blind-review-packet.v2") {
    throw new Error("STAGE15_PILOT_VISUAL_SCHEMA_INVALID");
  }
  if (stableHash(withoutHash(visualPacket, "packetHash")) !== visualPacket.packetHash) {
    throw new Error("STAGE15_PILOT_VISUAL_HASH_INVALID");
  }
  if (!input.createdAt || Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error("STAGE15_PILOT_CREATED_AT_INVALID");
  }
}

function stableRank(left: NoviceMarketScreeningItem, right: NoviceMarketScreeningItem) {
  return (left.stage1Rank ?? Number.MAX_SAFE_INTEGER) - (right.stage1Rank ?? Number.MAX_SAFE_INTEGER)
    || left.productKey.localeCompare(right.productKey);
}

function isComparableControl(item: NoviceMarketScreeningItem) {
  return item.status === "watch"
    && item.screeningEvidenceSufficient
    && item.stage1PromotionDecision === "promoted"
    && item.userUnderstandsProduct
    && item.willingToContinueResearch
    && item.humanGateReasons.length === 1
    && item.humanGateReasons[0] === COMPARABLE_CONTROL_REASON;
}

function selectionDigest(sourceInputHash: string, item: NoviceMarketScreeningItem) {
  return stableHash({
    protocolVersion: PROTOCOL_VERSION,
    samplingMethod: "stable_hash_without_replacement",
    sourceInputHash,
    productKey: item.productKey,
  });
}

function pilotItemId(sourceInputHash: string, productKey: string) {
  return `pilot-${stableHash({ protocolVersion: PROTOCOL_VERSION, sourceInputHash, productKey }).slice(0, 16)}`;
}

function assignment(
  item: NoviceMarketScreeningItem,
  group: PilotGroup,
  sourceInputHash: string,
) {
  if (!item.rawHumanAnswer.blindItemId) throw new Error("STAGE15_PILOT_BLIND_ITEM_BINDING_MISSING");
  return {
    pilotItemId: pilotItemId(sourceInputHash, item.productKey),
    group,
    productKey: item.productKey,
    blindItemId: item.rawHumanAnswer.blindItemId,
    selectionDigest: selectionDigest(sourceInputHash, item),
  };
}

function visualMap(packet: Stage15PilotVisualPacket) {
  const map = new Map<string, PilotVisualItem>();
  for (const item of packet.items) {
    if (!item.blindItemId || map.has(item.blindItemId)) {
      throw new Error("STAGE15_PILOT_VISUAL_BINDING_INVALID");
    }
    map.set(item.blindItemId, item);
  }
  return map;
}

export function buildStage15EffectivenessPilot(input: Stage15EffectivenessPilotInput) {
  verifySource(input);
  const advance = input.screeningRun.items
    .filter((item) => item.status === "advance")
    .sort(stableRank);
  if (advance.length !== 5) throw new Error("STAGE15_PILOT_ADVANCE_SAMPLE_INVALID");

  const controlPool = input.screeningRun.items.filter(isComparableControl);
  if (controlPool.length < 5) throw new Error("STAGE15_PILOT_CONTROL_POOL_INSUFFICIENT");
  const selectedControls = [...controlPool]
    .sort((left, right) => selectionDigest(input.screeningRun.inputHash, left)
      .localeCompare(selectionDigest(input.screeningRun.inputHash, right))
      || left.productKey.localeCompare(right.productKey))
    .slice(0, 5);
  const assignments = [
    ...advance.map((item) => assignment(item, "advance", input.screeningRun.inputHash)),
    ...selectedControls.map((item) => assignment(item, "control", input.screeningRun.inputHash)),
  ].sort((left, right) => left.productKey.localeCompare(right.productKey));
  if (new Set(assignments.map((entry) => entry.productKey)).size !== 10) {
    throw new Error("STAGE15_PILOT_ASSIGNMENT_DUPLICATE");
  }

  const evidencePolicy = {
    requiredChecklist: [
      "identity_reconfirmed_by_new_traceable_evidence",
      "product_function_and_variant_clarified",
      "dimensions_weight_or_missing_reason_recorded",
      "material_construction_or_missing_reason_recorded",
      "assembly_usage_and_execution_risks_checked",
      "independent_counter_evidence_checked",
    ],
    allowedEvidence: [
      "new_observation_captured_after_locked_source_run",
      "traceable_public_product_fact_not_consumed_by_stage1_5",
      "independent_manual_fact_with_source_and_capture_time",
    ],
    prohibitedInputs: [
      "same_snapshot_price_rating_review_or_sponsored",
      "stage1_rank_or_score",
      "stage1_5_status_or_group_during_blind_review",
      "locked_human_answers",
      "stage2_cost_profit_or_supplier_fields",
      "ai_generated_inference_as_source_fact",
    ],
    allowedOutcomes: [
      "continue_after_revalidation",
      "stop_after_revalidation",
      "still_insufficient",
    ],
    missingOutcome: "missing",
  } as const;
  const protocolBody = {
    schemaVersion: PROTOCOL_VERSION,
    status: "engineering_frozen_pending_independent_evidence" as const,
    sourceScreeningHash: input.screeningRun.screeningHash,
    sourceInputHash: input.screeningRun.inputHash,
    sourceVisualPacketHash: input.visualPacket.packetHash,
    createdAt: input.createdAt,
    sampling: {
      method: "stable_hash_without_replacement" as const,
      seedBoundary: "protocol_version_source_input_hash_product_key" as const,
      advanceRule: "all_current_advance" as const,
      controlEligibility: "watch_only_top_k_quota_not_allocated_with_all_three_gates_true" as const,
      controlLimit: 5 as const,
      controlPoolProductKeys: controlPool.map((item) => item.productKey).sort(),
    },
    sampleSummary: {
      advanceCount: advance.length,
      comparableControlPoolCount: controlPool.length,
      selectedControlCount: selectedControls.length,
      blindedItemCount: assignments.length,
    },
    assignments,
    evidencePolicy,
    pilotAcceptance: {
      requiredResolvedItems: 10 as const,
      identicalChecklistForBothGroups: true as const,
      reviewerGroupBlindRequired: true as const,
      traceableNewEvidenceRequired: true as const,
      prohibitedInputLeakageAllowed: false as const,
      completedMeaning: "effectiveness_pilot_completed_not_screening_effectiveness_validated" as const,
      directionalThresholds: null,
      metrics: [
        "advance_continue_rate",
        "control_continue_rate",
        "missed_control_count",
        "investigation_scope_reduction",
        "evidence_resolution_rate",
      ],
    },
    stage1OrStage15RulesModified: false as const,
    stage2FieldsConsumed: false as const,
    externalWebsiteAccessed: false as const,
    productionDatabaseWritten: false as const,
    formalCandidateGenerated: false as const,
  };
  const protocol = { ...protocolBody, protocolHash: stableHash(protocolBody) };

  const visuals = visualMap(input.visualPacket);
  const blindItems = assignments.map((entry) => {
    const visual = visuals.get(entry.blindItemId);
    if (!visual) throw new Error("STAGE15_PILOT_VISUAL_BINDING_INVALID");
    return {
      pilotItemId: entry.pilotItemId,
      title: visual.title,
      sourceUrl: visual.sourceUrl,
      sourceCapturedAt: visual.capturedAt,
      image: visual.image,
      chinesePresentation: visual.chinesePresentation,
      checklist: evidencePolicy.requiredChecklist.map((checkId) => ({
        checkId,
        status: "missing" as const,
        evidenceRefs: [] as string[],
        missingReason: "independent_evidence_not_collected" as const,
      })),
    };
  }).sort((left, right) => stableHash({ sourceInputHash: input.screeningRun.inputHash, pilotItemId: left.pilotItemId })
    .localeCompare(stableHash({ sourceInputHash: input.screeningRun.inputHash, pilotItemId: right.pilotItemId }))
    || left.pilotItemId.localeCompare(right.pilotItemId));
  const blindPacketBody = {
    schemaVersion: BLIND_PACKET_VERSION,
    status: "pending_independent_evidence" as const,
    sourceProtocolHash: protocol.protocolHash,
    reviewerBoundary: {
      groupAssignmentHidden: true as const,
      stage1RankAndScoreHidden: true as const,
      lockedMarketMetricsHidden: true as const,
      lockedHumanAnswersHidden: true as const,
      chinesePresentationIsNotSourceFact: true as const,
    },
    items: blindItems,
  };
  const blindPacket = { ...blindPacketBody, packetHash: stableHash(blindPacketBody) };
  const resultTemplateBody = {
    schemaVersion: RESULT_TEMPLATE_VERSION,
    status: "pending_evidence" as const,
    sourceProtocolHash: protocol.protocolHash,
    sourceBlindPacketHash: blindPacket.packetHash,
    items: blindPacket.items.map((entry) => ({
      pilotItemId: entry.pilotItemId,
      checklist: entry.checklist.map((check) => ({ ...check })),
      outcome: "missing" as const,
      evidenceRefs: [] as string[],
      reasonCodes: ["independent_evidence_not_collected"],
    })),
    metrics: {
      advanceContinueRate: null,
      controlContinueRate: null,
      missedControlCount: null,
      investigationScopeReduction: 0.75,
      evidenceResolutionRate: null,
    },
    pilotConclusion: "effectiveness_pilot_not_started" as const,
    effectivenessConclusion: "screening_effectiveness_not_validated" as const,
    stage2FieldsConsumed: false as const,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
  };
  const resultTemplate = { ...resultTemplateBody, evidenceHash: stableHash(resultTemplateBody) };
  return { protocol, blindPacket, resultTemplate };
}

export type Stage15PilotChecklistResponse = {
  checkId: string;
  status: "confirmed" | "not_confirmed" | "missing";
  evidenceRefs: string[];
  missingReason: string | null;
};

export type Stage15PilotItemResponse = {
  pilotItemId: string;
  checklist: Stage15PilotChecklistResponse[];
  outcome: "continue_after_revalidation" | "stop_after_revalidation" | "still_insufficient" | "missing";
  evidenceRefs: string[];
  reasonCodes: string[];
};

export function buildStage15EffectivenessPilotResult(
  protocol: ReturnType<typeof buildStage15EffectivenessPilot>["protocol"],
  blindPacket: ReturnType<typeof buildStage15EffectivenessPilot>["blindPacket"],
  responses: readonly Stage15PilotItemResponse[],
) {
  if (stableHash(withoutHash(protocol, "protocolHash")) !== protocol.protocolHash) {
    throw new Error("STAGE15_PILOT_PROTOCOL_HASH_INVALID");
  }
  if (stableHash(withoutHash(blindPacket, "packetHash")) !== blindPacket.packetHash
    || blindPacket.sourceProtocolHash !== protocol.protocolHash) {
    throw new Error("STAGE15_PILOT_BLIND_PACKET_HASH_INVALID");
  }
  const assignments = new Map(protocol.assignments.map((entry) => [entry.pilotItemId, entry]));
  const responseIds = responses.map((entry) => entry.pilotItemId);
  if (responses.length !== assignments.size
    || new Set(responseIds).size !== assignments.size
    || responseIds.some((id) => !assignments.has(id))) {
    throw new Error("STAGE15_PILOT_RESULT_PARTITION_INVALID");
  }
  const requiredChecks: string[] = [...protocol.evidencePolicy.requiredChecklist];
  const normalized = [...responses].map((response) => {
    const checkIds = response.checklist.map((check) => check.checkId);
    if (checkIds.length !== requiredChecks.length
      || new Set(checkIds).size !== requiredChecks.length
      || requiredChecks.some((checkId) => !checkIds.includes(checkId))) {
      throw new Error("STAGE15_PILOT_CHECKLIST_INVALID");
    }
    const checklist = [...response.checklist].sort((left, right) => requiredChecks.indexOf(left.checkId)
      - requiredChecks.indexOf(right.checkId));
    if (response.outcome === "continue_after_revalidation" || response.outcome === "stop_after_revalidation") {
      const evidenceInvalid = response.evidenceRefs.length === 0 || checklist.some((check) =>
        check.status === "missing" || check.evidenceRefs.length === 0 || check.missingReason !== null);
      if (evidenceInvalid) throw new Error("STAGE15_PILOT_COMPLETED_OUTCOME_EVIDENCE_INVALID");
    }
    if (response.outcome === "still_insufficient") {
      const insufficiencyInvalid = response.reasonCodes.length === 0
        || !checklist.some((check) => check.status === "missing" && Boolean(check.missingReason));
      if (insufficiencyInvalid) throw new Error("STAGE15_PILOT_INSUFFICIENT_OUTCOME_INVALID");
    }
    return {
      pilotItemId: response.pilotItemId,
      checklist,
      outcome: response.outcome,
      evidenceRefs: [...response.evidenceRefs],
      reasonCodes: [...response.reasonCodes],
    };
  }).sort((left, right) => left.pilotItemId.localeCompare(right.pilotItemId));
  const completedCount = normalized.filter((entry) => entry.outcome !== "missing").length;
  const completed = completedCount === normalized.length;
  const groupItems = (group: PilotGroup) => normalized.filter((response) =>
    assignments.get(response.pilotItemId)?.group === group);
  const advanceItems = groupItems("advance");
  const controlItems = groupItems("control");
  const continueCount = (items: typeof normalized) => items
    .filter((entry) => entry.outcome === "continue_after_revalidation").length;
  const resolvedCount = normalized.filter((entry) =>
    entry.outcome === "continue_after_revalidation" || entry.outcome === "stop_after_revalidation").length;
  const metrics = completed
    ? {
        advanceContinueRate: continueCount(advanceItems) / advanceItems.length,
        controlContinueRate: continueCount(controlItems) / controlItems.length,
        missedControlCount: continueCount(controlItems),
        investigationScopeReduction: 0.75,
        evidenceResolutionRate: resolvedCount / normalized.length,
      }
    : {
        advanceContinueRate: null,
        controlContinueRate: null,
        missedControlCount: null,
        investigationScopeReduction: 0.75,
        evidenceResolutionRate: null,
      };
  const body = {
    schemaVersion: "stage15-effectiveness-pilot-result.v1" as const,
    sourceProtocolHash: protocol.protocolHash,
    sourceBlindPacketHash: blindPacket.packetHash,
    status: completed ? "completed" as const : "pending_evidence" as const,
    items: normalized,
    metrics,
    pilotConclusion: completed
      ? "effectiveness_pilot_completed" as const
      : completedCount === 0
        ? "effectiveness_pilot_not_started" as const
        : "effectiveness_pilot_in_progress" as const,
    directionalSignal: completed ? "descriptive_only_no_approved_thresholds" as const : "not_available" as const,
    effectivenessConclusion: "screening_effectiveness_not_validated" as const,
    stage2FieldsConsumed: false as const,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
  };
  return { ...body, resultHash: stableHash(body) };
}

export function buildStage15EffectivenessRevalidationBrief(
  protocol: ReturnType<typeof buildStage15EffectivenessPilot>["protocol"],
  blindPacket: ReturnType<typeof buildStage15EffectivenessPilot>["blindPacket"],
  createdAt: string,
) {
  if (stableHash(withoutHash(protocol, "protocolHash")) !== protocol.protocolHash) {
    throw new Error("STAGE15_REVALIDATION_PROTOCOL_HASH_INVALID");
  }
  if (stableHash(withoutHash(blindPacket, "packetHash")) !== blindPacket.packetHash
    || blindPacket.sourceProtocolHash !== protocol.protocolHash) {
    throw new Error("STAGE15_REVALIDATION_BLIND_PACKET_HASH_INVALID");
  }
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("STAGE15_REVALIDATION_CREATED_AT_INVALID");
  }
  const assignments = new Map(protocol.assignments.map((entry) => [entry.pilotItemId, entry]));
  if (blindPacket.items.length !== assignments.size
    || new Set(blindPacket.items.map((item) => item.pilotItemId)).size !== assignments.size) {
    throw new Error("STAGE15_REVALIDATION_TARGET_BINDING_INVALID");
  }
  const targets = blindPacket.items.map((item) => {
    const assignment = assignments.get(item.pilotItemId);
    if (!assignment) throw new Error("STAGE15_REVALIDATION_TARGET_BINDING_INVALID");
    let url: URL;
    try {
      url = new URL(item.sourceUrl);
    } catch {
      throw new Error("STAGE15_REVALIDATION_TARGET_URL_INVALID");
    }
    const asin = assignment.productKey.split(":").at(-1);
    if (url.origin !== "https://www.amazon.com"
      || url.search !== ""
      || url.hash !== ""
      || !asin
      || !/^[A-Z0-9]{10}$/.test(asin)
      || url.pathname !== `/dp/${asin}`) {
      throw new Error("STAGE15_REVALIDATION_TARGET_URL_INVALID");
    }
    return {
      pilotItemId: item.pilotItemId,
      origin: url.origin,
      safePath: url.pathname,
      sourceUrlHash: stableHash({ origin: url.origin, safePath: url.pathname }),
    };
  }).sort((left, right) => left.pilotItemId.localeCompare(right.pilotItemId));
  if (targets.length !== 10 || new Set(targets.map((target) => target.safePath)).size !== 10) {
    throw new Error("STAGE15_REVALIDATION_TARGET_COUNT_INVALID");
  }
  const body = {
    schemaVersion: "stage15-effectiveness-revalidation-brief.v1" as const,
    briefId: `stage15-revalidation-${stableHash({ protocolHash: protocol.protocolHash, version: 1 }).slice(0, 20)}`,
    status: "pending_user_authorization" as const,
    sourceProtocolHash: protocol.protocolHash,
    sourceBlindPacketHash: blindPacket.packetHash,
    createdAt,
    browserIsolation: {
      browser: "system_chrome" as const,
      profile: "new_temporary_anonymous_profile" as const,
      control: "loopback_dynamic_cdp" as const,
      initialPage: "about:blank" as const,
      dailyProfileForbidden: true as const,
      loginForbidden: true as const,
    },
    accessBudget: {
      runs: 1 as const,
      initialPages: 1 as const,
      productDetailNavigations: 10 as const,
      searchNavigations: 0 as const,
      retries: 0 as const,
    },
    allowedScope: {
      origin: "https://www.amazon.com" as const,
      pathPattern: "/dp/{boundASIN}" as const,
      targetCount: 10 as const,
      redirectsOutsideOriginAllowed: false as const,
      productVariantsOrAdditionalLinksAllowed: false as const,
    },
    targets,
    evidenceWhitelist: [...protocol.evidencePolicy.requiredChecklist],
    prohibitedInputs: [
      ...protocol.evidencePolicy.prohibitedInputs,
      "full_html_or_full_page_text",
      "cookie_token_authorization_or_browser_storage",
      "account_order_address_or_private_data",
      "unbound_links_search_results_or_product_recommendations",
    ],
    stopConditions: [
      "captcha_or_robot_check",
      "login_wall",
      "access_denied_or_service_unavailable",
      "unexpected_origin_or_path_redirect",
      "unknown_page_or_layout",
      "private_or_account_data_visible",
      "browser_cleanup_incomplete",
    ],
    outputBoundary: {
      evidenceOnly: true as const,
      outcomeAutoDecisionAllowed: false as const,
      stage1OrStage15MutationAllowed: false as const,
      stage2OrCandidateCreationAllowed: false as const,
      databaseWriteAllowed: false as const,
    },
    cleanupRequired: [
      "close_pages_and_browser",
      "release_dynamic_port",
      "delete_temporary_profile",
      "restore_chrome_process_baseline",
    ],
    userAuthorization: null,
    externalWebsiteAccessed: false as const,
    stage2FieldsConsumed: false as const,
    productionDatabaseWritten: false as const,
    externalAiApiCalled: false as const,
  };
  return { ...body, briefHash: stableHash(body) };
}
