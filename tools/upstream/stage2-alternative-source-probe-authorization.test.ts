import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourceProbeAuthorizationGrant,
  buildStage2AlternativeSourceProbeAuthorizationRequest,
  consumeStage2AlternativeSourceProbeAuthorization,
  validateStage2AlternativeSourceProbeAuthorizationRequest,
} from "./stage2-alternative-source-probe-authorization";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const brief = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
"utf8")) as Stage2AlternativeSourceBrief;
const offlineValidation = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json"),
"utf8")) as Record<string, unknown>;

describe("Stage 2 alternative source capability probe authorization request", () => {
  it("freezes a narrower single-use capability-only scope without granting authorization", () => {
    const request = buildStage2AlternativeSourceProbeAuthorizationRequest({
      brief,
      offlineValidation,
      createdAt: "2026-07-15T03:00:00.000Z",
    });

    expect(request).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v1",
      status: "pending_user_authorization",
      briefId: brief.briefId,
      briefHash: brief.briefHash,
      offlineValidationEvidenceHash: offlineValidation.evidenceHash,
      purpose: "public_source_capability_probe_only",
      selectedOrigin: "https://www.made-in-china.com",
      policyRequest: {
        url: "https://www.made-in-china.com/robots.txt",
        maximumRequests: 1,
      },
      browserScope: {
        startUrl: brief.search.startUrl,
        maximumSearchPageNavigations: 1,
        maximumProductPageNavigations: 0,
        maximumTotalNavigations: 1,
      },
      maximumTotalExternalRequests: 2,
      automaticRetryCount: 0,
      supplierFieldsCollected: 0,
      authorization: {
        status: "not_granted",
        authorizedAt: null,
        authorizedBy: null,
      },
      boundary: {
        thisRequestIsNotAuthorization: true,
        userMustAuthorizeInCurrentConversation: true,
        singleUseOnly: true,
        noProductPageNavigation: true,
        noSupplierFieldCollection: true,
        noLoginOrInquiry: true,
        noCaptchaHandling: true,
        noAutomaticRetry: true,
        noDatabaseWrite: true,
        noCandidateCreation: true,
        noExternalAiOrPaidApi: true,
      },
    });
    expect(request.authorizationPhrase).toContain("最多1次 robots 请求、1次搜索页导航、0次商品页、0次重试");
    expect(validateStage2AlternativeSourceProbeAuthorizationRequest({
      request,
      brief,
      offlineValidation,
    })).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-validation.v1",
      status: "valid_pending_user_authorization",
      authorizationRequestId: request.authorizationRequestId,
      requestHash: request.requestHash,
      briefHash: brief.briefHash,
      offlineValidationEvidenceHash: offlineValidation.evidenceHash,
      reasonCodes: [],
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects mutation, stale offline proof, and any request that claims authorization", () => {
    const request = buildStage2AlternativeSourceProbeAuthorizationRequest({
      brief,
      offlineValidation,
      createdAt: "2026-07-15T03:00:00.000Z",
    });
    const mutated = {
      ...request,
      browserScope: { ...request.browserScope, maximumProductPageNavigations: 1 },
    };
    expect(validateStage2AlternativeSourceProbeAuthorizationRequest({
      request: mutated,
      brief,
      offlineValidation,
    }).reasonCodes).toEqual(expect.arrayContaining([
      "authorization_request_hash_mismatch",
      "product_page_navigation_not_allowed",
    ]));

    const staleProof = { ...offlineValidation, evidenceHash: "0".repeat(64) };
    expect(validateStage2AlternativeSourceProbeAuthorizationRequest({
      request,
      brief,
      offlineValidation: staleProof,
    }).reasonCodes).toContain("offline_validation_evidence_hash_mismatch");

    const falselyGranted = {
      ...request,
      authorization: {
        status: "granted" as const,
        authorizedAt: "2026-07-15T03:01:00.000Z",
        authorizedBy: "user",
      },
    };
    expect(validateStage2AlternativeSourceProbeAuthorizationRequest({
      request: falselyGranted,
      brief,
      offlineValidation,
    }).reasonCodes).toContain("authorization_request_must_remain_not_granted");
  });

  it("rejects a hash-consistent request whose purpose or discovery boundary was expanded", () => {
    const request = buildStage2AlternativeSourceProbeAuthorizationRequest({
      brief,
      offlineValidation,
      createdAt: "2026-07-15T03:00:00.000Z",
    });
    const { requestHash: _requestHash, ...body } = request;
    const forgedBody = {
      ...body,
      purpose: "supplier_field_collection",
      maximumDiscoveredProductUrls: 20,
      boundary: { ...body.boundary, noLoginOrInquiry: false },
    };
    const forged = { ...forgedBody, requestHash: stableHash(forgedBody) };
    const validation = validateStage2AlternativeSourceProbeAuthorizationRequest({
      request: forged,
      brief,
      offlineValidation,
    });
    expect(validation.status).toBe("invalid");
    expect(validation.reasonCodes).toEqual(expect.arrayContaining([
      "authorization_request_purpose_invalid",
      "discovered_product_url_limit_invalid",
      "authorization_request_boundary_invalid",
    ]));
  });

  it("turns only the exact current-conversation phrase into a single-use, hash-bound grant", () => {
    const request = buildStage2AlternativeSourceProbeAuthorizationRequest({
      brief,
      offlineValidation,
      createdAt: "2026-07-15T03:00:00.000Z",
    });
    const grant = buildStage2AlternativeSourceProbeAuthorizationGrant({
      request,
      brief,
      offlineValidation,
      authorizationPhrase: request.authorizationPhrase,
      authorizedAt: "2026-07-15T04:00:00.000Z",
    });
    expect(grant).toMatchObject({
      status: "granted_single_use",
      authorizedBy: "user_current_conversation",
      authorizationRequestHash: request.requestHash,
      scope: {
        policyRequests: 1,
        searchPageNavigations: 1,
        productPageNavigations: 0,
        automaticRetries: 0,
        supplierFieldsCollected: 0,
        maximumTotalExternalActions: 2,
      },
      consumption: { status: "not_consumed", consumedAt: null, runId: null },
    });
    expect(grant.authorizationPhraseHash).toBe(stableHash(request.authorizationPhrase));
    const consumed = consumeStage2AlternativeSourceProbeAuthorization({
      authorization: grant,
      consumedAt: "2026-07-15T04:00:01.000Z",
      runId: "probe-real-01",
    });
    expect(consumed.consumption).toEqual({
      status: "consumed",
      consumedAt: "2026-07-15T04:00:01.000Z",
      runId: "probe-real-01",
    });
    expect(() => consumeStage2AlternativeSourceProbeAuthorization({
      authorization: consumed,
      consumedAt: "2026-07-15T04:00:02.000Z",
      runId: "probe-real-02",
    })).toThrow("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZATION_NOT_CONSUMABLE");
    expect(() => buildStage2AlternativeSourceProbeAuthorizationGrant({
      request,
      brief,
      offlineValidation,
      authorizationPhrase: `${request.authorizationPhrase} `,
      authorizedAt: "2026-07-15T04:00:00.000Z",
    })).toThrow("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZATION_PHRASE_MISMATCH");
  });
});
