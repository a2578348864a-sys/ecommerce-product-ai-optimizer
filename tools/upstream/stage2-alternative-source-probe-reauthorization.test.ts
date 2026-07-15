import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourceProbeReauthorizationGrant,
  buildStage2AlternativeSourceProbeReauthorizationRequest,
  consumeStage2AlternativeSourceProbeReauthorization,
  validateStage2AlternativeSourceProbeReauthorizationRequest,
} from "./stage2-alternative-source-probe-reauthorization";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), "utf8")) as T;
const brief = readJson<Stage2AlternativeSourceBrief>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json",
);
const baselineOfflineValidation = readJson<Record<string, unknown>>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json",
);
const priorAuthorization = readJson<Record<string, unknown>>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-authorization.v1.json",
);
const priorRun = readJson<Record<string, unknown>>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json",
);
const unknownPageDiagnosticValidation = readJson<Record<string, unknown>>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Unknown-Page-Diagnostic-Offline-01/stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1.json",
);

const evidence = () => ({
  brief,
  baselineOfflineValidation,
  priorAuthorization,
  priorRun,
  unknownPageDiagnosticValidation,
});

describe("Stage 2 alternative-source capability Probe-02 reauthorization", () => {
  it("binds the Brief, consumed Probe-01 failure, and unknown-page diagnostic without granting access", () => {
    const request = buildStage2AlternativeSourceProbeReauthorizationRequest({
      ...evidence(),
      createdAt: "2026-07-15T04:30:00.000Z",
    });
    expect(request).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v2",
      status: "pending_user_authorization",
      purpose: "public_source_unknown_page_revalidation_only",
      briefHash: brief.briefHash,
      baselineOfflineValidationEvidenceHash: baselineOfflineValidation.evidenceHash,
      priorAuthorizationEvidenceHash: priorAuthorization.evidenceHash,
      priorRunEvidenceHash: priorRun.evidenceHash,
      priorRunId: priorRun.runId,
      unknownPageDiagnosticValidationEvidenceHash: unknownPageDiagnosticValidation.evidenceHash,
      browserScope: {
        maximumSearchPageNavigations: 1,
        maximumProductPageNavigations: 0,
        maximumTotalNavigations: 1,
      },
      automaticRetryCount: 0,
      supplierFieldsCollected: 0,
      authorization: { status: "not_granted", authorizedAt: null, authorizedBy: null },
      boundary: {
        thisRequestIsNotAuthorization: true,
        userMustAuthorizeInCurrentConversation: true,
        singleUseOnly: true,
        diagnosticCannotAuthorizeCollection: true,
      },
    });
    expect(validateStage2AlternativeSourceProbeReauthorizationRequest({
      request,
      ...evidence(),
    })).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-validation.v2",
      status: "valid_pending_user_authorization",
      reasonCodes: [],
    });
  });

  it("rejects stale or forged evidence and any request that claims authorization", () => {
    const request = buildStage2AlternativeSourceProbeReauthorizationRequest({
      ...evidence(), createdAt: "2026-07-15T04:30:00.000Z",
    });
    const forgedRun = { ...priorRun, evidenceHash: "0".repeat(64) };
    expect(validateStage2AlternativeSourceProbeReauthorizationRequest({
      request, ...evidence(), priorRun: forgedRun,
    }).reasonCodes).toContain("prior_probe_failure_evidence_invalid");
    const forgedDiagnostic = { ...unknownPageDiagnosticValidation, evidenceHash: "1".repeat(64) };
    expect(validateStage2AlternativeSourceProbeReauthorizationRequest({
      request, ...evidence(), unknownPageDiagnosticValidation: forgedDiagnostic,
    }).reasonCodes).toContain("unknown_page_diagnostic_evidence_invalid");
    const { requestHash: _hash, ...body } = request;
    const falselyGrantedBody = {
      ...body,
      authorization: { status: "granted", authorizedAt: request.createdAt, authorizedBy: "user" },
    };
    const falselyGranted = { ...falselyGrantedBody, requestHash: stableHash(falselyGrantedBody) };
    expect(validateStage2AlternativeSourceProbeReauthorizationRequest({
      request: falselyGranted, ...evidence(),
    }).reasonCodes).toContain("authorization_request_must_remain_not_granted");
  });

  it("creates and consumes a grant only from the exact Probe-02 phrase", () => {
    const request = buildStage2AlternativeSourceProbeReauthorizationRequest({
      ...evidence(), createdAt: "2026-07-15T04:30:00.000Z",
    });
    const grant = buildStage2AlternativeSourceProbeReauthorizationGrant({
      request,
      ...evidence(),
      authorizationPhrase: request.authorizationPhrase,
      authorizedAt: "2026-07-15T04:35:00.000Z",
    });
    expect(grant).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization.v2",
      status: "granted_single_use",
      authorizationRequestHash: request.requestHash,
      priorRunEvidenceHash: priorRun.evidenceHash,
      unknownPageDiagnosticValidationEvidenceHash: unknownPageDiagnosticValidation.evidenceHash,
      scope: { policyRequests: 1, searchPageNavigations: 1, productPageNavigations: 0, automaticRetries: 0 },
      consumption: { status: "not_consumed", consumedAt: null, runId: null },
    });
    expect(() => buildStage2AlternativeSourceProbeReauthorizationGrant({
      request,
      ...evidence(),
      authorizationPhrase: `${request.authorizationPhrase} `,
      authorizedAt: "2026-07-15T04:35:00.000Z",
    })).toThrow("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_PHRASE_MISMATCH");
    const consumed = consumeStage2AlternativeSourceProbeReauthorization({
      authorization: grant,
      consumedAt: "2026-07-15T04:36:00.000Z",
      runId: "probe-real-02",
    });
    expect(consumed.consumption.status).toBe("consumed");
    expect(() => consumeStage2AlternativeSourceProbeReauthorization({
      authorization: consumed,
      consumedAt: "2026-07-15T04:37:00.000Z",
      runId: "probe-real-03",
    })).toThrow("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_NOT_CONSUMABLE");
  });
});
