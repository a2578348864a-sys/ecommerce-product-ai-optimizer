import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { buildStage2GlobalSourcesDiscoveryBriefR1 } from "./stage2-global-sources-discovery-r1";
import {
  GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE,
  buildStage2GlobalSourcesDiscoveryAuthorizationGrant,
  buildStage2GlobalSourcesDiscoveryAuthorizationRequest,
  consumeStage2GlobalSourcesDiscoveryAuthorization,
  validateStage2GlobalSourcesDiscoveryAuthorizationRequest,
} from "./stage2-global-sources-discovery-r1-authorization";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), "utf8")) as Record<string, unknown>;

function brief() {
  return buildStage2GlobalSourcesDiscoveryBriefR1({
    selection: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-alternative-source-selection.v1.json"),
    historicalBrief: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-global-sources-discovery-brief.v1.json"),
    createdAt: "2026-07-15T06:00:00.000Z",
  });
}

function offlineValidation() {
  const b = brief();
  const body = {
    schemaVersion: "stage2-global-sources-discovery-offline-validation.v1" as const,
    status: "offline_validation_passed" as const,
    proofLevel: "offline_fixture_only" as const,
    briefId: b.briefId,
    briefHash: b.briefHash,
    fixtureSchemaVersion: "stage2-global-sources-discovery-r1-fixture.v1" as const,
    scenarioCount: 14,
    passedScenarioCount: 14,
    failedScenarioIds: [] as string[],
    realWebsiteAccessed: false as const,
    runtimeDiscoveryExecuted: false as const,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

function request() {
  return buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
    brief: brief(),
    offlineValidation: offlineValidation(),
    createdAt: "2026-07-15T06:10:00.000Z",
  });
}

describe("Global Sources C1A-R1 single-use authorization", () => {
  it("creates a not-granted request bound to the R1 brief and offline validation", () => {
    const b = brief();
    const offline = offlineValidation();
    const value = buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
      brief: b, offlineValidation: offline, createdAt: "2026-07-15T06:10:00.000Z",
    });
    expect(value).toMatchObject({
      schemaVersion: "stage2-global-sources-discovery-authorization-request.v1",
      status: "pending_user_authorization",
      briefId: b.briefId,
      briefHash: b.briefHash,
      offlineValidationEvidenceHash: offline.evidenceHash,
      selectedOrigin: "https://www.globalsources.com",
      policyRequest: { maximumRequests: 1 },
      browserScope: {
        maximumHomepageNavigations: 1,
        maximumSearchPageNavigations: 0,
        maximumProductPageNavigations: 0,
      },
      maximumTotalExternalActions: 2,
      automaticRetryCount: 0,
      supplierFieldsCollected: 0,
      authorization: { status: "not_granted", authorizedAt: null, authorizedBy: null },
    });
    expect(validateStage2GlobalSourcesDiscoveryAuthorizationRequest({
      request: value, brief: b, offlineValidation: offline,
    })).toMatchObject({ status: "valid_pending_user_authorization", reasonCodes: [] });
  });

  it("fails closed when request scope is expanded", () => {
    const value = request();
    const tampered = {
      ...value,
      browserScope: { ...value.browserScope, maximumSearchPageNavigations: 1 },
    };
    const result = validateStage2GlobalSourcesDiscoveryAuthorizationRequest({
      request: tampered, brief: brief(), offlineValidation: offlineValidation(),
    });
    expect(result.status).toBe("invalid");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["authorization_request_hash_invalid", "browser_scope_invalid"]));
  });

  it("rejects a re-hashed authorization request whose deterministic identity was replaced", () => {
    const original = request();
    const { requestHash: _oldHash, ...originalBody } = original;
    const tamperedBody = { ...originalBody, authorizationRequestId: "stage2-global-sources-discovery-r1-auth-forged" };
    const tampered = { ...tamperedBody, requestHash: stableHash(tamperedBody) } as typeof original;
    const result = validateStage2GlobalSourcesDiscoveryAuthorizationRequest({
      request: tampered, brief: brief(), offlineValidation: offlineValidation(),
    });
    expect(result.status).toBe("invalid");
    expect(result.reasonCodes).toContain("authorization_request_semantics_invalid");
  });

  it("rejects a re-hashed offline validation that did not execute the canonical fixture set", () => {
    const b = brief();
    const original = offlineValidation();
    const { evidenceHash: _oldHash, ...originalBody } = original;
    const tamperedBody = { ...originalBody, scenarioCount: 0, passedScenarioCount: 0 };
    const tampered = { ...tamperedBody, evidenceHash: stableHash(tamperedBody) };
    expect(() => buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
      brief: b,
      offlineValidation: tampered,
      createdAt: "2026-07-15T06:10:00.000Z",
    })).toThrowError("STAGE2_GLOBAL_SOURCES_R1_OFFLINE_VALIDATION_INVALID");
  });

  it("rejects a re-hashed R1 brief whose live scope was expanded", () => {
    const original = brief();
    const { briefHash: _oldHash, ...originalBody } = original;
    const tamperedBody = {
      ...originalBody,
      requestedScope: { ...original.requestedScope, maxSearchPageNavigations: 1 },
    };
    const tampered = { ...tamperedBody, briefHash: stableHash(tamperedBody) } as typeof original;
    const offlineBody = {
      schemaVersion: "stage2-global-sources-discovery-offline-validation.v1",
      status: "offline_validation_passed",
      proofLevel: "offline_fixture_only",
      briefId: tampered.briefId,
      briefHash: tampered.briefHash,
      fixtureSchemaVersion: "stage2-global-sources-discovery-r1-fixture.v1",
      scenarioCount: 14,
      passedScenarioCount: 14,
      failedScenarioIds: [],
      realWebsiteAccessed: false,
      runtimeDiscoveryExecuted: false,
    };
    const tamperedOffline = { ...offlineBody, evidenceHash: stableHash(offlineBody) };
    expect(() => buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
      brief: tampered,
      offlineValidation: tamperedOffline,
      createdAt: "2026-07-15T06:10:00.000Z",
    })).toThrowError("STAGE2_GLOBAL_SOURCES_R1_BRIEF_INVALID");
  });

  it("rejects a re-hashed R1 brief whose stop conditions were replaced", () => {
    const original = brief();
    const { briefHash: _oldHash, ...originalBody } = original;
    const tamperedBody = {
      ...originalBody,
      stopConditions: Array.from({ length: 10 }, (_, index) => `replacement_${index + 1}`),
    };
    const tampered = { ...tamperedBody, briefHash: stableHash(tamperedBody) } as typeof original;
    const offlineBody = {
      schemaVersion: "stage2-global-sources-discovery-offline-validation.v1",
      status: "offline_validation_passed",
      proofLevel: "offline_fixture_only",
      briefId: tampered.briefId,
      briefHash: tampered.briefHash,
      fixtureSchemaVersion: "stage2-global-sources-discovery-r1-fixture.v1",
      scenarioCount: 14,
      passedScenarioCount: 14,
      failedScenarioIds: [],
      realWebsiteAccessed: false,
      runtimeDiscoveryExecuted: false,
    };
    const tamperedOffline = { ...offlineBody, evidenceHash: stableHash(offlineBody) };
    expect(() => buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
      brief: tampered,
      offlineValidation: tamperedOffline,
      createdAt: "2026-07-15T06:10:00.000Z",
    })).toThrowError("STAGE2_GLOBAL_SOURCES_R1_BRIEF_INVALID");
  });

  it("rejects a re-hashed R1 brief whose provenance identity was replaced", () => {
    const original = brief();
    const { briefHash: _oldHash, ...originalBody } = original;
    const tamperedBody = { ...originalBody, briefId: "stage2-global-sources-discovery-r1-forged" };
    const tampered = { ...tamperedBody, briefHash: stableHash(tamperedBody) } as typeof original;
    const offlineBody = {
      schemaVersion: "stage2-global-sources-discovery-offline-validation.v1",
      status: "offline_validation_passed",
      proofLevel: "offline_fixture_only",
      briefId: tampered.briefId,
      briefHash: tampered.briefHash,
      fixtureSchemaVersion: "stage2-global-sources-discovery-r1-fixture.v1",
      scenarioCount: 14,
      passedScenarioCount: 14,
      failedScenarioIds: [],
      realWebsiteAccessed: false,
      runtimeDiscoveryExecuted: false,
    };
    const tamperedOffline = { ...offlineBody, evidenceHash: stableHash(offlineBody) };
    expect(() => buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
      brief: tampered,
      offlineValidation: tamperedOffline,
      createdAt: "2026-07-15T06:10:00.000Z",
    })).toThrowError("STAGE2_GLOBAL_SOURCES_R1_BRIEF_INVALID");
  });

  it("requires the exact authorization phrase before creating a grant", () => {
    expect(() => buildStage2GlobalSourcesDiscoveryAuthorizationGrant({
      request: request(), brief: brief(), offlineValidation: offlineValidation(),
      authorizationPhrase: "确认 C1A-R1",
      authorizedAt: "2026-07-15T06:20:00.000Z",
    })).toThrowError("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_PHRASE_MISMATCH");
  });

  it("grants once, binds the run, and rejects a second consumption", () => {
    const grant = buildStage2GlobalSourcesDiscoveryAuthorizationGrant({
      request: request(), brief: brief(), offlineValidation: offlineValidation(),
      authorizationPhrase: GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE,
      authorizedAt: "2026-07-15T06:20:00.000Z",
    });
    expect(grant).toMatchObject({
      status: "granted_single_use",
      consumption: { status: "not_consumed", consumedAt: null, runId: null },
    });
    const consumed = consumeStage2GlobalSourcesDiscoveryAuthorization({
      authorization: grant,
      consumedAt: "2026-07-15T06:20:01.000Z",
      runId: "stage2-global-sources-real-test",
    });
    expect(consumed.consumption).toEqual({
      status: "consumed",
      consumedAt: "2026-07-15T06:20:01.000Z",
      runId: "stage2-global-sources-real-test",
    });
    expect(consumed.evidenceHash).not.toBe(grant.evidenceHash);
    expect(() => consumeStage2GlobalSourcesDiscoveryAuthorization({
      authorization: consumed,
      consumedAt: "2026-07-15T06:20:02.000Z",
      runId: "stage2-global-sources-real-test-2",
    })).toThrowError("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_ALREADY_CONSUMED_OR_INVALID");
  });
});
