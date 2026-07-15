import { stableHash } from "../../lib/upstream/pipeline";

const SHA256 = /^[a-f0-9]{64}$/;
const PRIMARY_ORIGIN = "https://www.globalsources.com" as const;
const HELP_ORIGIN = "https://s.globalsources.com" as const;
const HELP_PATH = "/HELP/GSOLHELP/SUPPTIP.HTM" as const;

type EvidenceRecord = Record<string, unknown>;

export type Stage2AlternativeSourceSelection = {
  schemaVersion: "stage2-alternative-source-selection.v1";
  selectionId: string;
  status: "selected_pending_source_discovery";
  approvedAt: string;
  approvedBy: "project_owner";
  userSelection: "C";
  selectedOption: "select_different_public_source";
  selectedApproach: "global_sources_minimal_discovery";
  selectedPlatform: "global_sources";
  sourceEvidence: {
    decisionBriefEvidenceHash: string;
    researchEvidenceHash: string;
    probe1RunEvidenceHash: string;
    probe2RunEvidenceHash: string;
  };
  sourceCapabilityValidated: false;
  realWebsiteAccessedDuringSelection: false;
  productPagesAccessed: 0;
  supplierFieldsCollected: 0;
  stage2SubmissionGenerated: false;
  candidateGenerated: false;
  databaseWritten: false;
  historicalEvidenceReclassified: false;
  boundaries: readonly string[];
  selectionHash: string;
};

export type Stage2GlobalSourcesDiscoveryBrief = {
  schemaVersion: "stage2-global-sources-discovery-brief.v1";
  briefId: string;
  status: "pending_user_authorization";
  createdAt: string;
  selectedPlatform: "global_sources";
  purpose: "public_source_discovery_only";
  selectionId: string;
  selectionHash: string;
  policyPreflight: {
    robotsUrl: "https://www.globalsources.com/robots.txt";
    robotsStatus: "unknown_pending_runtime_check";
    robotsUnknownOrDisallowsBlocksNavigation: true;
  };
  navigationTargets: [
    {
      purpose: "primary_homepage_capability";
      origin: typeof PRIMARY_ORIGIN;
      path: "/";
      url: "https://www.globalsources.com/";
    },
    {
      purpose: "official_supplier_search_help_reference";
      origin: typeof HELP_ORIGIN;
      path: typeof HELP_PATH;
      url: "https://s.globalsources.com/HELP/GSOLHELP/SUPPTIP.HTM";
    },
  ];
  requestedScope: {
    maxRobotsRequests: 1;
    maxBrowserNavigations: 2;
    maxTotalExternalRequests: 3;
    maxProductPageNavigations: 0;
    maxSupplierFields: 0;
    automaticRetryCount: 0;
  };
  outputPolicy: {
    allowedDiagnosticFields: readonly string[];
    maxCandidateSearchPaths: 5;
    safePathsExcludeQueryAndHash: true;
  };
  evidencePolicy: {
    existingHelpPageEvidenceClass: "offline_reference_only";
    capabilityMustBeObservedAtRuntime: true;
    publicSearchPathIsProductEvidence: false;
    missingValuesRemainNullWithReason: true;
  };
  stopConditions: readonly string[];
  authorization: {
    status: "not_granted";
    authorizedAt: null;
    authorizedBy: null;
  };
  boundary: {
    thisBriefIsNotAuthorization: true;
    noAutomaticWebsiteAccess: true;
    exactHttpsTargetsOnly: true;
    redirectsFailClosed: true;
    noLoginRegistrationOrInquiry: true;
    noCaptchaBypass: true;
    noCookieStorageOrCredentialRead: true;
    noProxyOrAntiDetection: true;
    noProductPageNavigation: true;
    noSupplierFieldCollection: true;
    noFullHtmlOrBodyStorage: true;
    noExternalAiOrPaidApi: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage2Submission: true;
  };
  sourceCapabilityValidated: false;
  briefHash: string;
};

function isRecord(value: unknown): value is EvidenceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validHashedRecord(value: unknown, hashKey: "evidenceHash" | "selectionHash" | "briefHash"): value is EvidenceRecord {
  if (!isRecord(value) || typeof value[hashKey] !== "string" || !SHA256.test(value[hashKey])) return false;
  const { [hashKey]: _hash, ...body } = value;
  return stableHash(body) === value[hashKey];
}

function globalSourcesCandidate(research: EvidenceRecord): EvidenceRecord | null {
  if (!Array.isArray(research.candidates)) return null;
  const candidate = research.candidates.find((value) => isRecord(value) && value.platform === "global_sources");
  return isRecord(candidate) ? candidate : null;
}

function validSourceEvidence(input: {
  decisionBrief: EvidenceRecord;
  research: EvidenceRecord;
  probe1Run: EvidenceRecord;
  probe2Run: EvidenceRecord;
}): boolean {
  if (!validHashedRecord(input.decisionBrief, "evidenceHash")
    || !validHashedRecord(input.research, "evidenceHash")
    || !validHashedRecord(input.probe1Run, "evidenceHash")
    || !validHashedRecord(input.probe2Run, "evidenceHash")) return false;
  if (input.decisionBrief.schemaVersion !== "stage2-alternative-source-decision-brief.v1"
    || input.decisionBrief.status !== "pending_user_decision"
    || input.decisionBrief.selectedOption !== null
    || input.decisionBrief.probe1RunEvidenceHash !== input.probe1Run.evidenceHash
    || input.decisionBrief.probe2RunEvidenceHash !== input.probe2Run.evidenceHash) return false;
  if (input.probe1Run.status !== "failed_closed" || input.probe2Run.status !== "failed_closed"
    || input.probe1Run.errorCode !== "unknown_page" || input.probe2Run.errorCode !== "unknown_page") return false;
  if (input.research.schemaVersion !== "stage2-alternative-source-research.v1"
    || input.research.realProductEvidenceCollected !== false) return false;
  const candidate = globalSourcesCandidate(input.research);
  if (!candidate || candidate.decision !== "deferred" || !Array.isArray(candidate.officialEvidence)) return false;
  return candidate.officialEvidence.some((value) => isRecord(value)
    && value.url === `${HELP_ORIGIN}${HELP_PATH}`
    && value.supports === "official_supplier_search_exists");
}

export function buildStage2AlternativeSourceSelection(input: {
  decisionBrief: EvidenceRecord;
  research: EvidenceRecord;
  probe1Run: EvidenceRecord;
  probe2Run: EvidenceRecord;
  approvedAt: string;
  approvedBy: "project_owner";
}): Stage2AlternativeSourceSelection {
  if (!validSourceEvidence(input)) throw new Error("STAGE2_GLOBAL_SOURCES_SOURCE_EVIDENCE_INVALID");
  if (!validIso(input.approvedAt) || input.approvedBy !== "project_owner") {
    throw new Error("STAGE2_GLOBAL_SOURCES_APPROVAL_INVALID");
  }
  const sourceEvidence = {
    decisionBriefEvidenceHash: input.decisionBrief.evidenceHash as string,
    researchEvidenceHash: input.research.evidenceHash as string,
    probe1RunEvidenceHash: input.probe1Run.evidenceHash as string,
    probe2RunEvidenceHash: input.probe2Run.evidenceHash as string,
  };
  const body = {
    schemaVersion: "stage2-alternative-source-selection.v1" as const,
    selectionId: `stage2-source-selection-${stableHash(sourceEvidence).slice(0, 24)}`,
    status: "selected_pending_source_discovery" as const,
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
    userSelection: "C" as const,
    selectedOption: "select_different_public_source" as const,
    selectedApproach: "global_sources_minimal_discovery" as const,
    selectedPlatform: "global_sources" as const,
    sourceEvidence,
    sourceCapabilityValidated: false as const,
    realWebsiteAccessedDuringSelection: false as const,
    productPagesAccessed: 0 as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    historicalEvidenceReclassified: false as const,
    boundaries: [
      "historical_decision_brief_remains_unselected",
      "made_in_china_probe_failures_are_not_reclassified",
      "global_sources_help_reference_does_not_validate_current_runtime_capability",
      "selection_does_not_authorize_external_access",
    ],
  };
  return { ...body, selectionHash: stableHash(body) };
}

export function buildStage2GlobalSourcesDiscoveryBrief(input: {
  selection: Stage2AlternativeSourceSelection;
  createdAt: string;
}): Stage2GlobalSourcesDiscoveryBrief {
  if (!validHashedRecord(input.selection, "selectionHash")
    || input.selection.selectedApproach !== "global_sources_minimal_discovery"
    || input.selection.sourceCapabilityValidated !== false) {
    throw new Error("STAGE2_GLOBAL_SOURCES_SELECTION_INVALID");
  }
  if (!validIso(input.createdAt)) throw new Error("STAGE2_GLOBAL_SOURCES_CREATED_AT_INVALID");
  const body = {
    schemaVersion: "stage2-global-sources-discovery-brief.v1" as const,
    briefId: `stage2-global-sources-discovery-${input.selection.selectionHash.slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    selectedPlatform: "global_sources" as const,
    purpose: "public_source_discovery_only" as const,
    selectionId: input.selection.selectionId,
    selectionHash: input.selection.selectionHash,
    policyPreflight: {
      robotsUrl: "https://www.globalsources.com/robots.txt" as const,
      robotsStatus: "unknown_pending_runtime_check" as const,
      robotsUnknownOrDisallowsBlocksNavigation: true as const,
    },
    navigationTargets: [
      {
        purpose: "primary_homepage_capability" as const,
        origin: PRIMARY_ORIGIN,
        path: "/" as const,
        url: "https://www.globalsources.com/" as const,
      },
      {
        purpose: "official_supplier_search_help_reference" as const,
        origin: HELP_ORIGIN,
        path: HELP_PATH,
        url: "https://s.globalsources.com/HELP/GSOLHELP/SUPPTIP.HTM" as const,
      },
    ] as Stage2GlobalSourcesDiscoveryBrief["navigationTargets"],
    requestedScope: {
      maxRobotsRequests: 1 as const,
      maxBrowserNavigations: 2 as const,
      maxTotalExternalRequests: 3 as const,
      maxProductPageNavigations: 0 as const,
      maxSupplierFields: 0 as const,
      automaticRetryCount: 0 as const,
    },
    outputPolicy: {
      allowedDiagnosticFields: [
        "requested_origin", "requested_path", "final_origin", "final_path", "redirect_count",
        "redirect_origins", "http_status", "content_type", "classification", "reason_codes",
        "search_marker", "form_marker", "registration_marker", "login_marker", "captcha_marker",
        "error_marker", "candidate_search_paths",
      ],
      maxCandidateSearchPaths: 5 as const,
      safePathsExcludeQueryAndHash: true as const,
    },
    evidencePolicy: {
      existingHelpPageEvidenceClass: "offline_reference_only" as const,
      capabilityMustBeObservedAtRuntime: true as const,
      publicSearchPathIsProductEvidence: false as const,
      missingValuesRemainNullWithReason: true as const,
    },
    stopConditions: [
      "robots_policy_unknown_or_disallows",
      "unexpected_final_origin_or_path",
      "unexpected_redirect",
      "login_registration_or_inquiry_required",
      "captcha_or_robot_check",
      "access_denied_or_service_unavailable",
      "browser_internal_error",
      "unknown_page_state",
      "external_request_budget_exhausted",
    ],
    authorization: { status: "not_granted" as const, authorizedAt: null, authorizedBy: null },
    boundary: {
      thisBriefIsNotAuthorization: true as const,
      noAutomaticWebsiteAccess: true as const,
      exactHttpsTargetsOnly: true as const,
      redirectsFailClosed: true as const,
      noLoginRegistrationOrInquiry: true as const,
      noCaptchaBypass: true as const,
      noCookieStorageOrCredentialRead: true as const,
      noProxyOrAntiDetection: true as const,
      noProductPageNavigation: true as const,
      noSupplierFieldCollection: true as const,
      noFullHtmlOrBodyStorage: true as const,
      noExternalAiOrPaidApi: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage2Submission: true as const,
    },
    sourceCapabilityValidated: false as const,
  };
  return { ...body, briefHash: stableHash(body) };
}

function sameTargets(brief: Stage2GlobalSourcesDiscoveryBrief): boolean {
  return JSON.stringify(brief.navigationTargets) === JSON.stringify([
    {
      purpose: "primary_homepage_capability",
      origin: PRIMARY_ORIGIN,
      path: "/",
      url: `${PRIMARY_ORIGIN}/`,
    },
    {
      purpose: "official_supplier_search_help_reference",
      origin: HELP_ORIGIN,
      path: HELP_PATH,
      url: `${HELP_ORIGIN}${HELP_PATH}`,
    },
  ]);
}

export function validateStage2GlobalSourcesDiscoveryPackage(input: {
  decisionBrief: EvidenceRecord;
  research: EvidenceRecord;
  probe1Run: EvidenceRecord;
  probe2Run: EvidenceRecord;
  selection: Stage2AlternativeSourceSelection;
  discoveryBrief: Stage2GlobalSourcesDiscoveryBrief;
}) {
  const reasonCodes: string[] = [];
  if (!validSourceEvidence(input)) reasonCodes.push("source_evidence_invalid");
  if (!validHashedRecord(input.selection, "selectionHash")) reasonCodes.push("selection_hash_invalid");
  if (!validHashedRecord(input.discoveryBrief, "briefHash")) reasonCodes.push("discovery_brief_hash_invalid");
  if (input.selection.schemaVersion !== "stage2-alternative-source-selection.v1"
    || input.selection.status !== "selected_pending_source_discovery"
    || input.selection.userSelection !== "C"
    || input.selection.selectedOption !== "select_different_public_source"
    || input.selection.selectedApproach !== "global_sources_minimal_discovery"
    || input.selection.selectedPlatform !== "global_sources"
    || input.selection.sourceCapabilityValidated !== false
    || input.selection.realWebsiteAccessedDuringSelection !== false
    || input.selection.productPagesAccessed !== 0
    || input.selection.supplierFieldsCollected !== 0
    || input.selection.historicalEvidenceReclassified !== false) reasonCodes.push("selection_semantics_invalid");
  if (input.selection.sourceEvidence.decisionBriefEvidenceHash !== input.decisionBrief.evidenceHash
    || input.selection.sourceEvidence.researchEvidenceHash !== input.research.evidenceHash
    || input.selection.sourceEvidence.probe1RunEvidenceHash !== input.probe1Run.evidenceHash
    || input.selection.sourceEvidence.probe2RunEvidenceHash !== input.probe2Run.evidenceHash) {
    reasonCodes.push("selection_evidence_binding_mismatch");
  }
  if (input.discoveryBrief.schemaVersion !== "stage2-global-sources-discovery-brief.v1"
    || input.discoveryBrief.status !== "pending_user_authorization"
    || input.discoveryBrief.selectedPlatform !== "global_sources"
    || input.discoveryBrief.purpose !== "public_source_discovery_only"
    || input.discoveryBrief.selectionId !== input.selection.selectionId
    || input.discoveryBrief.selectionHash !== input.selection.selectionHash
    || input.discoveryBrief.sourceCapabilityValidated !== false) reasonCodes.push("discovery_semantics_invalid");
  if (!sameTargets(input.discoveryBrief)
    || input.discoveryBrief.policyPreflight.robotsUrl !== `${PRIMARY_ORIGIN}/robots.txt`) {
    reasonCodes.push("discovery_targets_invalid");
  }
  const scope = input.discoveryBrief.requestedScope;
  if (scope.maxRobotsRequests !== 1 || scope.maxBrowserNavigations !== 2
    || scope.maxTotalExternalRequests !== 3 || scope.maxProductPageNavigations !== 0
    || scope.maxSupplierFields !== 0 || scope.automaticRetryCount !== 0) {
    reasonCodes.push("discovery_scope_invalid");
  }
  const boundary = input.discoveryBrief.boundary;
  if (!boundary.thisBriefIsNotAuthorization || !boundary.noAutomaticWebsiteAccess
    || !boundary.exactHttpsTargetsOnly || !boundary.redirectsFailClosed
    || !boundary.noLoginRegistrationOrInquiry || !boundary.noCaptchaBypass
    || !boundary.noCookieStorageOrCredentialRead || !boundary.noProxyOrAntiDetection
    || !boundary.noProductPageNavigation || !boundary.noSupplierFieldCollection
    || !boundary.noFullHtmlOrBodyStorage || !boundary.noExternalAiOrPaidApi
    || !boundary.noDatabaseWrite || !boundary.noCandidateCreation || !boundary.noStage2Submission
    || input.discoveryBrief.authorization.status !== "not_granted"
    || input.discoveryBrief.authorization.authorizedAt !== null
    || input.discoveryBrief.authorization.authorizedBy !== null) reasonCodes.push("discovery_boundary_invalid");
  const uniqueReasons = [...new Set(reasonCodes)];
  const body = {
    schemaVersion: "stage2-global-sources-discovery-validation.v1" as const,
    status: uniqueReasons.length === 0 ? "valid_pending_user_authorization" as const : "invalid" as const,
    selectionId: input.selection.selectionId,
    briefId: input.discoveryBrief.briefId,
    reasonCodes: uniqueReasons,
  };
  return { ...body, inputHash: stableHash(body) };
}
