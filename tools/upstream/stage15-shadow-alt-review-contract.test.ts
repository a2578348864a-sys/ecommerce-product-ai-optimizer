import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  altReviewAuthorizationPhrase,
  buildStage15ShadowAltReviewAccessRequest,
  buildStage15ShadowAltReviewAuthorization,
  buildStage15ShadowAltReviewProbeBrief,
  buildStage15ShadowAltReviewSourceRegistry,
  selectStage15ShadowAltReviewSamples,
  type AltReviewRegistryEntry,
} from "./stage15-shadow-alt-review-contract";
import {
  REAL_BATCH_C_PRODUCT_KEYS,
  fixtureQueries,
  fixtureRegistryEntries,
  registryInput,
} from "./stage15-shadow-alt-review-test-fixtures";

describe("Stage 1.5 alternative review probe contract", () => {
  it("selects the frozen Batch C top three from raw UTF-8 SHA-256", () => {
    expect(selectStage15ShadowAltReviewSamples(REAL_BATCH_C_PRODUCT_KEYS)).toEqual([
      {
        productKey: "amazon:US:B0D7Q1DWPF",
        selectionHash: "156e27867bf367e565f2d444fc898cc3b2b4870128f6d8137fa20c4cfb307bdb",
      },
      {
        productKey: "amazon:US:B0044UP39U",
        selectionHash: "1651a88fea4ddca1904a9550c8be0fabc325d86ddb79b6d9921a5f7c57686646",
      },
      {
        productKey: "amazon:US:B0CNXF7SVS",
        selectionHash: "1dbe0f0263f408a8c6a381ad5c7c4adbadaeb008fb573ba5a59249a3616352cf",
      },
    ]);
  });

  it.each([
    ["nineteen products", REAL_BATCH_C_PRODUCT_KEYS.slice(0, 19)],
    ["duplicate product", [...REAL_BATCH_C_PRODUCT_KEYS.slice(0, 19), REAL_BATCH_C_PRODUCT_KEYS[0]]],
    ["invalid identity", [...REAL_BATCH_C_PRODUCT_KEYS.slice(0, 19), "amazon:US:not-an-asin"]],
  ])("rejects an invalid Batch C set: %s", (_label, productKeys) => {
    expect(() => selectStage15ShadowAltReviewSamples(productKeys)).toThrow("SHADOW_ALT_REVIEW_BATCH_INVALID");
  });

  it.each([
    ["amazon origin", [{ sourceId: "amazon", sourceKind: "public_retailer", origin: "https://www.amazon.com", allowedPathPrefixes: ["/dp/"], publicBuyerReviewsRequired: true, loginRequired: false }]],
    ["http origin", [{ sourceId: "unsafe", sourceKind: "public_retailer", origin: "http://example.test", allowedPathPrefixes: ["/p/"], publicBuyerReviewsRequired: true, loginRequired: false }]],
    ["query-bearing prefix", [{ sourceId: "query", sourceKind: "public_retailer", origin: "https://shop.example.test", allowedPathPrefixes: ["/p/?x=1"], publicBuyerReviewsRequired: true, loginRequired: false }]],
    ["duplicate source id", [fixtureRegistryEntries[0], { ...fixtureRegistryEntries[1], sourceId: fixtureRegistryEntries[0].sourceId }]],
  ])("rejects invalid registry: %s", (_label, entries) => {
    expect(() => buildStage15ShadowAltReviewSourceRegistry(registryInput(entries as AltReviewRegistryEntry[])))
      .toThrow("SHADOW_ALT_REVIEW_REGISTRY_INVALID");
  });

  it("builds a deterministic brief, registry, request and authorization chain", () => {
    const brief = buildStage15ShadowAltReviewProbeBrief({
      batchId: "stage15-shadow-calibration-c-20260717-01",
      role: "calibration",
      sourceManifest: {
        manifestId: "manifest-c",
        manifestHash: "a".repeat(64),
        fileSha256: "b".repeat(64),
      },
      productKeys: REAL_BATCH_C_PRODUCT_KEYS,
      createdAt: "2026-07-17T09:00:00.000Z",
    });
    const registry = buildStage15ShadowAltReviewSourceRegistry({
      batchId: brief.batchId,
      briefHash: brief.briefHash,
      entries: fixtureRegistryEntries,
      createdAt: "2026-07-17T09:01:00.000Z",
    });
    const request = buildStage15ShadowAltReviewAccessRequest({
      brief,
      registry,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:02:00.000Z",
    });
    const approvalText = altReviewAuthorizationPhrase(request.requestHash, registry.registryHash);
    const authorization = buildStage15ShadowAltReviewAuthorization({
      request,
      registry,
      approvalText,
      approvedAt: "2026-07-17T09:03:00.000Z",
    });

    expect(brief.samples.map((item) => item.productKey)).toEqual([
      "amazon:US:B0D7Q1DWPF",
      "amazon:US:B0044UP39U",
      "amazon:US:B0CNXF7SVS",
    ]);
    expect(request).toMatchObject({
      authorizationStatus: "pending_user_approval",
      executionAllowed: false,
      budget: { maxSearchQueries: 3, maxPageOpens: 6, maxAutomaticRetries: 0 },
    });
    expect(request.queries.map((item) => item.productKey)).toEqual(brief.samples.map((item) => item.productKey));
    expect(authorization).toMatchObject({
      requestHash: request.requestHash,
      registryHash: registry.registryHash,
      status: "approved",
    });
    expect(authorization.approvalTextHash).toBe(stableHash(approvalText));
    expect(JSON.stringify(authorization)).not.toContain(approvalText);
  });

  it("rejects query and authorization drift", () => {
    const brief = buildStage15ShadowAltReviewProbeBrief({
      batchId: "stage15-shadow-calibration-c-20260717-01",
      role: "calibration",
      sourceManifest: { manifestId: "manifest-c", manifestHash: "a".repeat(64), fileSha256: "b".repeat(64) },
      productKeys: REAL_BATCH_C_PRODUCT_KEYS,
      createdAt: "2026-07-17T09:00:00.000Z",
    });
    const registry = buildStage15ShadowAltReviewSourceRegistry({
      batchId: brief.batchId,
      briefHash: brief.briefHash,
      entries: fixtureRegistryEntries,
      createdAt: "2026-07-17T09:01:00.000Z",
    });

    expect(() => buildStage15ShadowAltReviewAccessRequest({
      brief,
      registry,
      queries: [fixtureQueries[0], fixtureQueries[0], fixtureQueries[2]],
      createdAt: "2026-07-17T09:02:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_QUERY_INVALID");

    const request = buildStage15ShadowAltReviewAccessRequest({
      brief,
      registry,
      queries: fixtureQueries,
      createdAt: "2026-07-17T09:02:00.000Z",
    });
    expect(() => buildStage15ShadowAltReviewAuthorization({
      request,
      registry,
      approvalText: `${altReviewAuthorizationPhrase(request.requestHash, registry.registryHash)} changed`,
      approvedAt: "2026-07-17T09:03:00.000Z",
    })).toThrow("SHADOW_ALT_REVIEW_AUTHORIZATION_TEXT_MISMATCH");
  });
});
