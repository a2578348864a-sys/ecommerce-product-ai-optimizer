import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import { validateStage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import type { buildStage2PublicRevalidationResult } from "./stage2-public-revalidation-result";

type FailedRevalidation = ReturnType<typeof buildStage2PublicRevalidationResult>;

const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_ORIGIN = "https://www.made-in-china.com" as const;

export type Stage2AlternativeSourceBrief = {
  schemaVersion: "stage2-alternative-source-brief.v1";
  briefId: string;
  status: "pending_user_authorization";
  createdAt: string;
  sample: Stage2EvidenceCollectionBrief["sample"];
  sourceEvidence: {
    originalBriefId: string;
    originalBriefHash: string;
    failedRevalidationResultId: string;
    failedRevalidationEvidenceHash: string;
  };
  sourceDecision: {
    selectedPlatform: "made_in_china";
    selectedOrigin: typeof ALLOWED_ORIGIN;
    priorBlockedOrigin: "https://www.alibaba.com";
    evidenceClass: "public_platform_capability_only";
    supplierClaimsRequireIndependentVerification: true;
    officialSourceUrls: [string, string, string, string];
  };
  search: {
    query: "6 shelf hanging closet organizer grey";
    startUrl: "https://www.made-in-china.com/products-search/hot-china-products/Hanging_Organizer.html";
    allowedSearchPathPrefix: "/products-search/";
    allowedProductPathPatterns: [
      "^/price/prodetail_[A-Za-z0-9_-]+\\.html$",
      "^/showroom/[A-Za-z0-9_-]+/product-detail[A-Za-z0-9_-]+/China-[^/?#]+\\.html$",
    ];
    forbiddenOriginPatterns: ["http://*", "https://*.en.made-in-china.com"];
  };
  requestedEvidenceFields: Stage2EvidenceCollectionBrief["requestedEvidenceFields"];
  requestedScope: {
    allowedOrigins: [typeof ALLOWED_ORIGIN];
    maxTotalNavigations: 3;
    maxPolicyRequests: 1;
    maxTotalExternalRequests: 4;
    maxSearchResultPages: 1;
    maxSupplierProductPages: 2;
    maxSamples: 1;
    automaticRetryCount: 0;
  };
  identityPolicy: {
    sameVariantRequired: true;
    titleSimilarityIsInsufficient: true;
    attributeMatchAloneConfirmsVariant: false;
    explicitSupplierLinkageRequired: true;
    targetObservedAttributes: {
      tierCount: { value: 6; source: "amazon_observed_title" };
      color: { value: "grey"; source: "amazon_observed_title" };
      hangingConfiguration: { value: true; source: "amazon_observed_title" };
      material: { value: null; missingReason: "not_observed_in_amazon_source_title" };
    };
    requiredComparableAttributes: ["tier_count", "color", "hanging_configuration"];
    unresolvedIdentityResult: "variant_identity_cannot_be_confirmed";
  };
  policyPreflight: {
    termsUrl: "https://www.made-in-china.com/help/terms/";
    robotsUrl: "https://www.made-in-china.com/robots.txt";
    robotsStatus: "unknown_pending_runtime_check";
    robotsUnknownOrDisallowsBlocksProbe: true;
  };
  evidencePolicy: {
    acceptedSourceType: "direct_observation";
    publicListingIsSupplierConfirmation: false;
    publicPriceIsConfirmedQuotation: false;
    missingValuesRemainNullWithReason: true;
    noCurrencyConversionToFillMissingCost: true;
    noAmazonSignalInference: true;
  };
  stopConditions: Array<
    | "captcha_or_robot_check"
    | "login_wall_or_inquiry_required"
    | "access_denied_or_service_unavailable"
    | "unexpected_final_origin"
    | "unexpected_intermediate_redirect_origin"
    | "supplier_subdomain_not_allowed"
    | "browser_internal_error"
    | "unknown_page_state"
    | "variant_identity_cannot_be_confirmed"
    | "requested_navigation_budget_exhausted"
    | "robots_policy_unknown_or_disallows"
  >;
  authorization: {
    status: "not_granted";
    authorizedAt: null;
    authorizedBy: null;
  };
  boundary: {
    thisBriefIsNotAuthorization: true;
    noAutomaticWebsiteAccess: true;
    noLoginOrInquiry: true;
    noCookieOrStorageRead: true;
    noCaptchaBypass: true;
    noProxyOrAntiDetection: true;
    noPaidApiOrExternalAi: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage1Rewrite: true;
    noStage2SubmissionWithoutConfirmedVariant: true;
    runtimePolicyPreflightRequired: true;
  };
  briefHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertEvidenceHash(value: { evidenceHash: string }, code: string): void {
  const { evidenceHash, ...body } = value;
  if (!SHA256.test(evidenceHash) || stableHash(body) !== evidenceHash) throw new Error(code);
}

export function buildStage2AlternativeSourceBrief(input: {
  originalBrief: Stage2EvidenceCollectionBrief;
  failedRevalidation: FailedRevalidation;
  createdAt: string;
}): Stage2AlternativeSourceBrief {
  if (validateStage2EvidenceCollectionBrief(input.originalBrief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_ORIGINAL_BRIEF_INVALID");
  }
  assertEvidenceHash(input.failedRevalidation, "STAGE2_ALTERNATIVE_SOURCE_FAILED_RESULT_INVALID");
  if (!validIso(input.createdAt)) throw new Error("STAGE2_ALTERNATIVE_SOURCE_CREATED_AT_INVALID");
  if (input.failedRevalidation.status !== "failed_closed"
    || input.failedRevalidation.proofLevel !== "authoritative_failure_evidence"
    || input.failedRevalidation.stage2EvidenceReady !== false
    || input.failedRevalidation.stage2SubmissionGenerated !== false) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_FAILURE_LINKAGE_INVALID");
  }

  const sourceEvidence = {
    originalBriefId: input.originalBrief.briefId,
    originalBriefHash: input.originalBrief.briefHash,
    failedRevalidationResultId: input.failedRevalidation.resultId,
    failedRevalidationEvidenceHash: input.failedRevalidation.evidenceHash,
  };
  const body = {
    schemaVersion: "stage2-alternative-source-brief.v1" as const,
    briefId: `stage2-alternative-source-${stableHash(sourceEvidence).slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    sample: { ...input.originalBrief.sample },
    sourceEvidence,
    sourceDecision: {
      selectedPlatform: "made_in_china" as const,
      selectedOrigin: ALLOWED_ORIGIN,
      priorBlockedOrigin: "https://www.alibaba.com" as const,
      evidenceClass: "public_platform_capability_only" as const,
      supplierClaimsRequireIndependentVerification: true as const,
      officialSourceUrls: [
        "https://www.made-in-china.com/",
        "https://www.made-in-china.com/help/faq/",
        "https://www.made-in-china.com/help/terms/",
        "https://www.made-in-china.com/products-search/hot-china-products/Hanging_Organizer.html",
      ] as [string, string, string, string],
    },
    search: {
      query: "6 shelf hanging closet organizer grey" as const,
      startUrl: "https://www.made-in-china.com/products-search/hot-china-products/Hanging_Organizer.html" as const,
      allowedSearchPathPrefix: "/products-search/" as const,
      allowedProductPathPatterns: [
        "^/price/prodetail_[A-Za-z0-9_-]+\\.html$",
        "^/showroom/[A-Za-z0-9_-]+/product-detail[A-Za-z0-9_-]+/China-[^/?#]+\\.html$",
      ] as [
        "^/price/prodetail_[A-Za-z0-9_-]+\\.html$",
        "^/showroom/[A-Za-z0-9_-]+/product-detail[A-Za-z0-9_-]+/China-[^/?#]+\\.html$",
      ],
      forbiddenOriginPatterns: ["http://*", "https://*.en.made-in-china.com"] as [
        "http://*", "https://*.en.made-in-china.com",
      ],
    },
    requestedEvidenceFields: [...input.originalBrief.requestedEvidenceFields],
    requestedScope: {
      allowedOrigins: [ALLOWED_ORIGIN] as [typeof ALLOWED_ORIGIN],
      maxTotalNavigations: 3 as const,
      maxPolicyRequests: 1 as const,
      maxTotalExternalRequests: 4 as const,
      maxSearchResultPages: 1 as const,
      maxSupplierProductPages: 2 as const,
      maxSamples: 1 as const,
      automaticRetryCount: 0 as const,
    },
    identityPolicy: {
      sameVariantRequired: true as const,
      titleSimilarityIsInsufficient: true as const,
      attributeMatchAloneConfirmsVariant: false as const,
      explicitSupplierLinkageRequired: true as const,
      targetObservedAttributes: {
        tierCount: { value: 6 as const, source: "amazon_observed_title" as const },
        color: { value: "grey" as const, source: "amazon_observed_title" as const },
        hangingConfiguration: { value: true as const, source: "amazon_observed_title" as const },
        material: { value: null, missingReason: "not_observed_in_amazon_source_title" as const },
      },
      requiredComparableAttributes: ["tier_count", "color", "hanging_configuration"] as [
        "tier_count", "color", "hanging_configuration",
      ],
      unresolvedIdentityResult: "variant_identity_cannot_be_confirmed" as const,
    },
    policyPreflight: {
      termsUrl: "https://www.made-in-china.com/help/terms/" as const,
      robotsUrl: "https://www.made-in-china.com/robots.txt" as const,
      robotsStatus: "unknown_pending_runtime_check" as const,
      robotsUnknownOrDisallowsBlocksProbe: true as const,
    },
    evidencePolicy: {
      acceptedSourceType: "direct_observation" as const,
      publicListingIsSupplierConfirmation: false as const,
      publicPriceIsConfirmedQuotation: false as const,
      missingValuesRemainNullWithReason: true as const,
      noCurrencyConversionToFillMissingCost: true as const,
      noAmazonSignalInference: true as const,
    },
    stopConditions: [
      "captcha_or_robot_check",
      "login_wall_or_inquiry_required",
      "access_denied_or_service_unavailable",
      "unexpected_final_origin",
      "unexpected_intermediate_redirect_origin",
      "supplier_subdomain_not_allowed",
      "browser_internal_error",
      "unknown_page_state",
      "variant_identity_cannot_be_confirmed",
      "requested_navigation_budget_exhausted",
      "robots_policy_unknown_or_disallows",
    ] as Stage2AlternativeSourceBrief["stopConditions"],
    authorization: { status: "not_granted" as const, authorizedAt: null, authorizedBy: null },
    boundary: {
      thisBriefIsNotAuthorization: true as const,
      noAutomaticWebsiteAccess: true as const,
      noLoginOrInquiry: true as const,
      noCookieOrStorageRead: true as const,
      noCaptchaBypass: true as const,
      noProxyOrAntiDetection: true as const,
      noPaidApiOrExternalAi: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage1Rewrite: true as const,
      noStage2SubmissionWithoutConfirmedVariant: true as const,
      runtimePolicyPreflightRequired: true as const,
    },
  };
  return { ...body, briefHash: stableHash(body) };
}

export function validateStage2AlternativeSourceBrief(brief: Stage2AlternativeSourceBrief) {
  const reasonCodes: string[] = [];
  const { briefHash, ...body } = brief;
  if (!SHA256.test(briefHash) || stableHash(body) !== briefHash) reasonCodes.push("brief_hash_mismatch");
  if (brief.schemaVersion !== "stage2-alternative-source-brief.v1") reasonCodes.push("schema_version_invalid");
  if (!validIso(brief.createdAt)) reasonCodes.push("created_at_invalid");
  if (brief.status !== "pending_user_authorization"
    || brief.authorization.status !== "not_granted"
    || brief.authorization.authorizedAt !== null
    || brief.authorization.authorizedBy !== null) reasonCodes.push("authorization_state_invalid");
  if (brief.sample.sampleId !== "stage2-high-01"
    || brief.sample.evaluationVariantStatus !== "requires_same_variant_confirmation") {
    reasonCodes.push("sample_invalid");
  }
  if (brief.sourceDecision.selectedPlatform !== "made_in_china"
    || brief.sourceDecision.selectedOrigin !== ALLOWED_ORIGIN
    || brief.sourceDecision.evidenceClass !== "public_platform_capability_only"
    || !brief.sourceDecision.supplierClaimsRequireIndependentVerification) {
    reasonCodes.push("source_decision_invalid");
  }
  if (brief.requestedScope.allowedOrigins.length !== 1
    || brief.requestedScope.allowedOrigins[0] !== ALLOWED_ORIGIN
    || brief.requestedScope.maxTotalNavigations !== 3
    || brief.requestedScope.maxPolicyRequests !== 1
    || brief.requestedScope.maxTotalExternalRequests !== 4
    || brief.requestedScope.maxSearchResultPages !== 1
    || brief.requestedScope.maxSupplierProductPages !== 2
    || brief.requestedScope.maxSamples !== 1
    || brief.requestedScope.automaticRetryCount !== 0) reasonCodes.push("navigation_scope_invalid");
  if (!brief.search.startUrl.startsWith(`${ALLOWED_ORIGIN}${brief.search.allowedSearchPathPrefix}`)
    || brief.search.query !== "6 shelf hanging closet organizer grey"
    || brief.search.allowedProductPathPatterns.join("|") !== [
      "^/price/prodetail_[A-Za-z0-9_-]+\\.html$",
      "^/showroom/[A-Za-z0-9_-]+/product-detail[A-Za-z0-9_-]+/China-[^/?#]+\\.html$",
    ].join("|")) {
    reasonCodes.push("path_scope_invalid");
  }
  if (!brief.identityPolicy.sameVariantRequired
    || !brief.identityPolicy.titleSimilarityIsInsufficient
    || brief.identityPolicy.attributeMatchAloneConfirmsVariant
    || !brief.identityPolicy.explicitSupplierLinkageRequired
    || brief.identityPolicy.targetObservedAttributes.tierCount.value !== 6
    || brief.identityPolicy.targetObservedAttributes.color.value !== "grey"
    || brief.identityPolicy.targetObservedAttributes.hangingConfiguration.value !== true
    || brief.identityPolicy.targetObservedAttributes.material.value !== null
    || brief.identityPolicy.requiredComparableAttributes.join("|") !== "tier_count|color|hanging_configuration") {
    reasonCodes.push("identity_policy_invalid");
  }
  if (brief.policyPreflight.termsUrl !== `${ALLOWED_ORIGIN}/help/terms/`
    || brief.policyPreflight.robotsUrl !== `${ALLOWED_ORIGIN}/robots.txt`
    || brief.policyPreflight.robotsStatus !== "unknown_pending_runtime_check"
    || !brief.policyPreflight.robotsUnknownOrDisallowsBlocksProbe) reasonCodes.push("policy_preflight_invalid");
  if (brief.evidencePolicy.acceptedSourceType !== "direct_observation"
    || brief.evidencePolicy.publicListingIsSupplierConfirmation
    || brief.evidencePolicy.publicPriceIsConfirmedQuotation
    || !brief.evidencePolicy.missingValuesRemainNullWithReason) reasonCodes.push("evidence_policy_invalid");
  if (!brief.boundary.thisBriefIsNotAuthorization
    || !brief.boundary.noAutomaticWebsiteAccess
    || !brief.boundary.noLoginOrInquiry
    || !brief.boundary.noDatabaseWrite
    || !brief.boundary.noCandidateCreation
    || !brief.boundary.noStage2SubmissionWithoutConfirmedVariant
    || !brief.boundary.runtimePolicyPreflightRequired) reasonCodes.push("boundary_invalid");
  if (!SHA256.test(brief.sourceEvidence.originalBriefHash)
    || !SHA256.test(brief.sourceEvidence.failedRevalidationEvidenceHash)) reasonCodes.push("source_hash_invalid");

  return {
    schemaVersion: "stage2-alternative-source-brief-validation.v1" as const,
    status: reasonCodes.includes("brief_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_pending_authorization" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash, reasonCodes }),
  };
}
