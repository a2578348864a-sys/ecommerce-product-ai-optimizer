import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import type { buildStage2PublicRevalidationResult } from "./stage2-public-revalidation-result";
import {
  buildStage2AlternativeSourceBrief,
  validateStage2AlternativeSourceBrief,
} from "./stage2-alternative-source-brief";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const ORIGINAL_BRIEF = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/08-Stage2-high-01取证授权材料/stage2-evidence-collection-brief.v1.json");
const FAILED_RESULT = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Public-Revalidation-01/stage2-public-revalidation-result.v1.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function build() {
  return buildStage2AlternativeSourceBrief({
    originalBrief: readJson<Stage2EvidenceCollectionBrief>(ORIGINAL_BRIEF),
    failedRevalidation: readJson<ReturnType<typeof buildStage2PublicRevalidationResult>>(FAILED_RESULT),
    createdAt: "2026-07-15T03:00:00.000Z",
  });
}

describe("Stage 2 alternative public source brief", () => {
  it("freezes Made-in-China to one exact HTTPS origin without granting collection authorization", () => {
    const brief = build();

    expect(brief).toMatchObject({
      schemaVersion: "stage2-alternative-source-brief.v1",
      status: "pending_user_authorization",
      sample: {
        sampleId: "stage2-high-01",
        productKey: "amazon:US:B07SYPLVTG",
        evaluationVariantStatus: "requires_same_variant_confirmation",
      },
      sourceDecision: {
        selectedPlatform: "made_in_china",
        selectedOrigin: "https://www.made-in-china.com",
        priorBlockedOrigin: "https://www.alibaba.com",
        evidenceClass: "public_platform_capability_only",
        supplierClaimsRequireIndependentVerification: true,
      },
      requestedScope: {
        allowedOrigins: ["https://www.made-in-china.com"],
        maxTotalNavigations: 3,
        maxPolicyRequests: 1,
        maxTotalExternalRequests: 4,
        maxSearchResultPages: 1,
        maxSupplierProductPages: 2,
        maxSamples: 1,
        automaticRetryCount: 0,
      },
      authorization: { status: "not_granted", authorizedAt: null, authorizedBy: null },
    });
    expect(brief.search.startUrl).toMatch(/^https:\/\/www\.made-in-china\.com\//);
    expect(brief.search.query).toBe("6 shelf hanging closet organizer grey");
    expect(brief.search.allowedProductPathPatterns).toEqual([
      "^/price/prodetail_[A-Za-z0-9_-]+\\.html$",
      "^/showroom/[A-Za-z0-9_-]+/product-detail[A-Za-z0-9_-]+/China-[^/?#]+\\.html$",
    ]);
    expect(brief.search.forbiddenOriginPatterns).toEqual([
      "http://*",
      "https://*.en.made-in-china.com",
    ]);
    expect(validateStage2AlternativeSourceBrief(brief)).toMatchObject({
      status: "valid_pending_authorization",
      reasonCodes: [],
    });
  });

  it("keeps public listing claims separate from confirmed quotation and same-variant evidence", () => {
    const brief = build();

    expect(brief.evidencePolicy).toEqual({
      acceptedSourceType: "direct_observation",
      publicListingIsSupplierConfirmation: false,
      publicPriceIsConfirmedQuotation: false,
      missingValuesRemainNullWithReason: true,
      noCurrencyConversionToFillMissingCost: true,
      noAmazonSignalInference: true,
    });
    expect(brief.identityPolicy).toMatchObject({
      sameVariantRequired: true,
      titleSimilarityIsInsufficient: true,
      attributeMatchAloneConfirmsVariant: false,
      explicitSupplierLinkageRequired: true,
      targetObservedAttributes: {
        tierCount: { value: 6, source: "amazon_observed_title" },
        color: { value: "grey", source: "amazon_observed_title" },
        hangingConfiguration: { value: true, source: "amazon_observed_title" },
        material: { value: null, missingReason: "not_observed_in_amazon_source_title" },
      },
      requiredComparableAttributes: ["tier_count", "color", "hanging_configuration"],
    });
    expect(brief.policyPreflight).toEqual({
      termsUrl: "https://www.made-in-china.com/help/terms/",
      robotsUrl: "https://www.made-in-china.com/robots.txt",
      robotsStatus: "unknown_pending_runtime_check",
      robotsUnknownOrDisallowsBlocksProbe: true,
    });
    expect(brief.boundary).toMatchObject({
      thisBriefIsNotAuthorization: true,
      noAutomaticWebsiteAccess: true,
      noLoginOrInquiry: true,
      noCandidateCreation: true,
      noDatabaseWrite: true,
      runtimePolicyPreflightRequired: true,
    });
  });

  it("changes hash and fails validation when the exact origin or navigation budget is changed", () => {
    const brief = build();
    const originalHash = brief.briefHash;

    brief.requestedScope.allowedOrigins = ["https://supplier.en.made-in-china.com"] as unknown as [
      "https://www.made-in-china.com",
    ];
    brief.requestedScope.maxTotalNavigations = 4 as 3;

    expect(brief.briefHash).toBe(originalHash);
    expect(validateStage2AlternativeSourceBrief(brief)).toMatchObject({
      status: "invalid_hash",
      reasonCodes: expect.arrayContaining(["brief_hash_mismatch", "navigation_scope_invalid"]),
    });
  });
});
