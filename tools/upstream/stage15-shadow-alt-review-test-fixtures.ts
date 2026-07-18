import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage15ShadowDetailAccessRequest,
  evaluateStage15ShadowDetailAccessPreflight,
} from "./stage15-shadow-detail-access";
import {
  altReviewAuthorizationPhrase,
  buildStage15ShadowAltReviewAccessRequest,
  buildStage15ShadowAltReviewAuthorization,
  buildStage15ShadowAltReviewProbeBrief,
  buildStage15ShadowAltReviewSourceRegistry,
  type AltReviewAccessLogEntry,
  type AltReviewCapture,
  type AltReviewPageLogEntry,
  type AltReviewRegistryEntry,
  type AltReviewSearchLogEntry,
  type BuildAltReviewEvidenceInput,
  type BuildAltReviewRegistryInput,
  type Stage15ShadowAltReviewAccessRequest,
  type Stage15ShadowAltReviewAuthorization,
  type Stage15ShadowAltReviewProbeBrief,
  type Stage15ShadowAltReviewSourceRegistry,
} from "./stage15-shadow-alt-review-contract";
import { generateStage15ShadowAltReviewPreparation } from "./generate-stage15-shadow-alt-review-preparation";

export type PreparedAltReviewFixture = {
  batchDirectory: string;
  authorization: Stage15ShadowAltReviewAuthorization;
  completeAccessLog: AltReviewAccessLogEntry[];
  eligibleA: AltReviewCapture;
  eligibleB: AltReviewCapture;
  identityConflictC: AltReviewCapture;
};

export const REAL_BATCH_C_PRODUCT_KEYS = [
  "amazon:US:B0D7Q1DWPF", "amazon:US:B0044UP39U", "amazon:US:B0CNXF7SVS", "amazon:US:B0C2ZBBPY9",
  "amazon:US:B0CMHLG55T", "amazon:US:B0CLKM68WJ", "amazon:US:B08RPB6LRS", "amazon:US:B08W9N38PC",
  "amazon:US:B0CS9QQ563", "amazon:US:B0887ZVX4H", "amazon:US:B09Y1SPGVC", "amazon:US:B0D98Q9HXK",
  "amazon:US:B0002LCRMG", "amazon:US:B08M94BTYC", "amazon:US:B06X3W3YQD", "amazon:US:B0C4DCT1ZY",
  "amazon:US:B0BZR3TKSR", "amazon:US:B0CWNXRH32", "amazon:US:B000VPBL1Q", "amazon:US:B07Q79ZZJ6",
];

export const fixtureRegistryEntries: AltReviewRegistryEntry[] = [
  {
    sourceId: "public-retailer-a",
    sourceKind: "public_retailer",
    origin: "https://retailer-a.example.test",
    allowedPathPrefixes: ["/product/"],
    publicBuyerReviewsRequired: true,
    loginRequired: false,
  },
  {
    sourceId: "brand-storefront-b",
    sourceKind: "brand_storefront",
    origin: "https://brand-b.example.test",
    allowedPathPrefixes: ["/products/"],
    publicBuyerReviewsRequired: true,
    loginRequired: false,
  },
];

export const fixtureQueries = [
  { productKey: "amazon:US:B0D7Q1DWPF", query: "fixture brand model one reviews" },
  { productKey: "amazon:US:B0044UP39U", query: "fixture brand model two reviews" },
  { productKey: "amazon:US:B0CNXF7SVS", query: "fixture brand model three reviews" },
];

export function registryInput(entries: AltReviewRegistryEntry[]): BuildAltReviewRegistryInput {
  return {
    batchId: "stage15-shadow-calibration-c-20260717-01",
    briefHash: fixtureBrief().briefHash,
    entries,
    createdAt: "2026-07-17T09:01:00.000Z",
  };
}

export function fixtureBrief(): Stage15ShadowAltReviewProbeBrief {
  return buildStage15ShadowAltReviewProbeBrief({
    batchId: "stage15-shadow-calibration-c-20260717-01",
    role: "calibration",
    sourceManifest: { manifestId: "manifest-c", manifestHash: "a".repeat(64), fileSha256: "b".repeat(64) },
    productKeys: REAL_BATCH_C_PRODUCT_KEYS,
    createdAt: "2026-07-17T09:00:00.000Z",
  });
}

export function fixtureRegistry(): Stage15ShadowAltReviewSourceRegistry {
  return buildStage15ShadowAltReviewSourceRegistry(registryInput(fixtureRegistryEntries));
}

export function fixtureRequest(): Stage15ShadowAltReviewAccessRequest {
  const brief = fixtureBrief();
  return buildStage15ShadowAltReviewAccessRequest({
    brief,
    registry: fixtureRegistry(),
    queries: fixtureQueries,
    createdAt: "2026-07-17T09:02:00.000Z",
  });
}

export function fixtureAuthorization(): Stage15ShadowAltReviewAuthorization {
  const request = fixtureRequest();
  const registry = fixtureRegistry();
  return buildStage15ShadowAltReviewAuthorization({
    request,
    registry,
    approvalText: altReviewAuthorizationPhrase(request.requestHash, registry.registryHash),
    approvedAt: "2026-07-17T09:03:00.000Z",
  });
}

export function completeFixtureAccessLog(): AltReviewAccessLogEntry[] {
  return fixtureQueries.flatMap((query, index) => {
    const minute = 4 + (index * 2);
    const asin = query.productKey.slice("amazon:US:".length);
    return [
      { kind: "search_query", ...query, attempt: 1, outcome: "success", requestedAt: `2026-07-17T09:0${minute}:00.000Z` },
      {
        kind: "page_open",
        productKey: query.productKey,
        sourceId: "public-retailer-a",
        url: `https://retailer-a.example.test/product/${asin}`,
        attempt: 1,
        outcome: "success",
        requestedAt: `2026-07-17T09:0${minute + 1}:00.000Z`,
      },
    ] as AltReviewAccessLogEntry[];
  });
}

export function fixtureSearchLog(): AltReviewSearchLogEntry {
  return completeFixtureAccessLog()[0] as AltReviewSearchLogEntry;
}

export function fixturePageLog(): AltReviewPageLogEntry {
  return completeFixtureAccessLog()[1] as AltReviewPageLogEntry;
}

export function positiveReview(): AltReviewCapture["reviews"][number] {
  return { sentiment: "positive", rating: 5, reviewedAt: "2026-06-01", theme: "stable synthetic positive theme", evidenceRefs: ["alt-review-capture:fixture#positive"] };
}

export function secondPositiveReview(): AltReviewCapture["reviews"][number] {
  return { sentiment: "positive", rating: 4, reviewedAt: "2026-06-02", theme: "second synthetic positive theme", evidenceRefs: ["alt-review-capture:fixture#positive-2"] };
}

export function negativeReview(): AltReviewCapture["reviews"][number] {
  return { sentiment: "negative", rating: 1, reviewedAt: "2026-06-03", theme: "stable synthetic negative theme", evidenceRefs: ["alt-review-capture:fixture#negative"] };
}

function captureWithHash(body: Omit<AltReviewCapture, "captureHash">): AltReviewCapture {
  return { ...body, captureHash: stableHash(body) };
}

export function eligibleCapture(productKey: string): AltReviewCapture {
  const asin = productKey.slice("amazon:US:".length);
  const relativePath = `captures/${asin}.json`;
  return captureWithHash({
    schemaVersion: "stage15-shadow-alt-review-capture.v1",
    productKey,
    sourceId: "public-retailer-a",
    sourceUrl: `https://retailer-a.example.test/product/${asin}`,
    sourceCapture: { relativePath, fileSha256: "c".repeat(64), capturedAt: "2026-07-17T09:10:00.000Z" },
    identityBinding: {
      status: "exact",
      brand: "Fixture Brand",
      model: asin,
      stableIdentifiers: [{ kind: "mpn", value: `MPN-${asin}` }],
      variantSignature: [{ dimension: "model", value: asin }],
      evidenceRefs: [`alt-review-capture:${relativePath}#identity`],
    },
    aggregate: { rating: 4.2, reviewCount: 12 },
    reviews: [positiveReview(), negativeReview()],
    privacy: { personalDataStored: false },
  });
}

export function captureWithReviews(reviews: AltReviewCapture["reviews"]): AltReviewCapture {
  const { captureHash: _captureHash, ...body } = eligibleCapture(REAL_BATCH_C_PRODUCT_KEYS[0]);
  return captureWithHash({ ...body, reviews });
}

export function mixedVariantCapture(): AltReviewCapture {
  const { captureHash: _captureHash, ...body } = eligibleCapture(REAL_BATCH_C_PRODUCT_KEYS[0]);
  return captureWithHash({ ...body, identityBinding: { ...body.identityBinding, status: "mixed_variant" } });
}

export function identityConflictCapture(): AltReviewCapture {
  const { captureHash: _captureHash, ...body } = eligibleCapture(REAL_BATCH_C_PRODUCT_KEYS[2]);
  return captureWithHash({ ...body, identityBinding: { ...body.identityBinding, status: "conflict" } });
}

export function inputWithCaptures(captures: AltReviewCapture[]): BuildAltReviewEvidenceInput {
  return {
    brief: fixtureBrief(),
    registry: fixtureRegistry(),
    request: fixtureRequest(),
    authorization: fixtureAuthorization(),
    accessLog: completeFixtureAccessLog(),
    captures,
    createdAt: "2026-07-17T10:00:00.000Z",
  };
}

export function inputWithSingleTerminalCapture(capture: AltReviewCapture): BuildAltReviewEvidenceInput {
  return inputWithCaptures([capture]);
}

function materializeCapture(batchDirectory: string, capture: AltReviewCapture): AltReviewCapture {
  const path = join(batchDirectory, capture.sourceCapture.relativePath);
  mkdirSync(join(batchDirectory, "captures"), { recursive: true });
  const content = `synthetic public review capture for ${capture.productKey}\n`;
  writeFileSync(path, content, "utf8");
  const { captureHash: _captureHash, ...body } = capture;
  const updated = {
    ...body,
    sourceCapture: {
      ...body.sourceCapture,
      fileSha256: createHash("sha256").update(content, "utf8").digest("hex"),
    },
  };
  return { ...updated, captureHash: stableHash(updated) };
}

export function preparedFixture(): PreparedAltReviewFixture {
  const batchDirectory = fixtureBatchC();
  const preparation = generateStage15ShadowAltReviewPreparation({
    batchDirectory,
    registryEntries: fixtureRegistryEntries,
    queries: fixtureQueries,
    createdAt: "2026-07-17T09:00:00.000Z",
  });
  const approvalText = altReviewAuthorizationPhrase(preparation.request.requestHash, preparation.registry.registryHash);
  const authorization = buildStage15ShadowAltReviewAuthorization({
    request: preparation.request,
    registry: preparation.registry,
    approvalText,
    approvedAt: "2026-07-17T09:03:00.000Z",
  });
  return {
    batchDirectory,
    authorization,
    completeAccessLog: completeFixtureAccessLog(),
    eligibleA: materializeCapture(batchDirectory, eligibleCapture("amazon:US:B0D7Q1DWPF")),
    eligibleB: materializeCapture(batchDirectory, eligibleCapture("amazon:US:B0044UP39U")),
    identityConflictC: materializeCapture(batchDirectory, identityConflictCapture()),
  };
}

export function fixtureBatchC(): string {
  const directory = mkdtempSync(join(tmpdir(), "stage15-shadow-alt-review-batch-c-"));
  const batchId = "stage15-shadow-calibration-c-20260717-01";
  const packetBody = { schemaVersion: "fixture-packet.v1", batchId, items: REAL_BATCH_C_PRODUCT_KEYS };
  const packet = { ...packetBody, packetHash: stableHash(packetBody) };
  const bindingsBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-bindings.private.v1",
    batchId,
    packetHash: packet.packetHash,
    bindings: REAL_BATCH_C_PRODUCT_KEYS.map((productKey, index) => {
      const platformProductId = productKey.slice("amazon:US:".length);
      return {
        evaluationItemId: `C-${String(index + 1).padStart(2, "0")}`,
        productKey,
        candidateId: `fixture-candidate-${index + 1}`,
        evidenceSnapshotId: `fixture-evidence-${index + 1}`,
        platformProductId,
        sourceUrl: `https://www.amazon.com/dp/${platformProductId}`,
      };
    }),
  };
  const bindings = { ...bindingsBody, bindingHash: stableHash(bindingsBody) };
  const accessBudget = {
    schemaVersion: "stage15-shadow-access-budget.v1",
    batchId,
    detailEvidence: {
      exactVariantReviewCoverage: { covered: 0, required: 10 },
    },
  };
  const upstreamValues: Record<string, unknown> = {
    "selection-brief.v1.json": { schemaVersion: "fixture-selection-brief.v1", batchId },
    "stage15-shadow-access-budget.v1.json": accessBudget,
    "collection-run.v2.json": { schemaVersion: "fixture-collection-run.v2", batchId },
    "source-adapter-result.v1.json": { schemaVersion: "fixture-source-adapter-result.v1", batchId },
    "import-package.v1.json": { schemaVersion: "fixture-import-package.v1", batchId },
    "ranking-run.v1.json": { schemaVersion: "fixture-ranking-run.v1", batchId },
    "stage15-shadow-observations.v1.json": { schemaVersion: "fixture-observations.v1", batchId },
    "stage15-shadow-visual-reference-packet.v1.json": { schemaVersion: "fixture-visual-packet.v1", batchId },
    "stage15-shadow-combined-human-evaluation-packet.v1.json": packet,
    "stage15-shadow-combined-human-evaluation-bindings.private.v1.json": bindings,
    "stage15-shadow-combined-human-evaluation-result-template.v1.json": { schemaVersion: "fixture-result-template.v1", batchId },
    "generation-summary.stage15-shadow-public-upstream.v1.json": { schemaVersion: "fixture-upstream-summary.v1", batchId },
  };
  const markdownValues: Record<string, string> = {
    "source-capture.amazon-bestsellers.md": "# Synthetic source capture\n",
    "human-evaluation-form.md": "# Synthetic human evaluation form\n",
  };
  for (const [relativePath, value] of Object.entries(upstreamValues)) {
    writeFileSync(join(directory, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  for (const [relativePath, value] of Object.entries(markdownValues)) writeFileSync(join(directory, relativePath), value, "utf8");

  const shaFile = (relativePath: string) => createHash("sha256").update(readFileSync(join(directory, relativePath))).digest("hex");
  const artifacts = [
    ...Object.keys(upstreamValues).map((relativePath) => ({
      relativePath,
      sha256: shaFile(relativePath),
      canonicalStableHash: stableHash(upstreamValues[relativePath]),
    })),
    ...Object.keys(markdownValues).map((relativePath) => ({ relativePath, sha256: shaFile(relativePath), canonicalStableHash: null })),
  ];
  const manifestBody = {
    schemaVersion: "stage15-shadow-upstream-manifest.v1",
    manifestId: "fixture-manifest-c",
    batchId,
    role: "calibration",
    frozenValidationBatch: true,
    environment: "local_evidence_workspace",
    explicitPathOnly: true,
    automaticLatestSelectionAllowed: false,
    crossBatchArtifactFallbackAllowed: false,
    readiness: "upstream_only",
    artifacts,
    identity: { count: 20, productKeysHash: stableHash([...REAL_BATCH_C_PRODUCT_KEYS].sort()) },
    boundary: { candidateGenerated: false, databaseWritten: false, productionEffect: false, stage1OrStage15WeightsChanged: false },
    createdAt: "2026-07-17T04:54:03.000Z",
  };
  const manifest = { ...manifestBody, manifestHash: stableHash(manifestBody) };
  writeFileSync(join(directory, "stage15-shadow-upstream-manifest.v1.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestSha = shaFile("stage15-shadow-upstream-manifest.v1.json");
  const request = buildStage15ShadowDetailAccessRequest({
    schemaVersion: "stage15-shadow-detail-access-request-input.v1",
    batchId,
    role: "calibration",
    sourceManifest: { manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, fileSha256: manifestSha },
    targets: REAL_BATCH_C_PRODUCT_KEYS.map((productKey) => {
      const platformProductId = productKey.slice("amazon:US:".length);
      return { productKey, platformProductId, sourceUrl: `https://www.amazon.com/dp/${platformProductId}` };
    }),
    proposedBudget: { maxDetailPageRequests: 20, maxRequestsPerProduct: 1, maxAutomaticRetries: 0, maxImageDownloads: 0 },
    createdAt: "2026-07-17T05:55:32.000Z",
  });
  writeFileSync(join(directory, "stage15-shadow-detail-access-request.v1.json"), `${JSON.stringify(request, null, 2)}\n`, "utf8");
  const requestSha = shaFile("stage15-shadow-detail-access-request.v1.json");
  writeFileSync(join(directory, "stage15-shadow-detail-access-request.v1.sha256"), `${requestSha}  stage15-shadow-detail-access-request.v1.json\n`, "utf8");
  const authorization = {
    schemaVersion: "stage15-shadow-detail-access-authorization.v1" as const,
    batchId,
    requestHash: request.requestHash,
    status: "approved" as const,
    approvedAt: "2026-07-17T06:22:43.000Z",
    approvedBudget: request.proposedBudget,
  };
  writeFileSync(join(directory, "stage15-shadow-detail-access-authorization.v1.json"), `${JSON.stringify(authorization, null, 2)}\n`, "utf8");
  const accessEntry = {
    productKey: "amazon:US:B0044UP39U",
    sourceUrl: "https://www.amazon.com/dp/B0044UP39U",
    attempt: 1,
    outcome: "login_wall" as const,
    requestedAt: "2026-07-17T06:24:03.000Z",
  };
  const accessLog = {
    schemaVersion: "stage15-shadow-detail-access-log.v1",
    batchId,
    requestHash: request.requestHash,
    authorizationFile: "stage15-shadow-detail-access-authorization.v1.json",
    entries: [accessEntry],
    summary: { completedRequests: 1, remainingBudget: 19, automaticRetries: 0, batchStopped: true, stopCondition: "login_wall", stoppedProductKey: accessEntry.productKey, unvisitedTargetCount: 19 },
  };
  writeFileSync(join(directory, "stage15-shadow-detail-access-log.v1.json"), `${JSON.stringify(accessLog, null, 2)}\n`, "utf8");
  const preflight = evaluateStage15ShadowDetailAccessPreflight({ request, authorization, accessLog: [accessEntry] });
  writeFileSync(join(directory, "stage15-shadow-detail-access-preflight.v1.json"), `${JSON.stringify(preflight, null, 2)}\n`, "utf8");
  const initialGateBody = {
    schemaVersion: "stage15-shadow-human-evaluation-start-gate.v1",
    batchId,
    sourceManifestHash: manifest.manifestHash,
    sourcePacketHash: packet.packetHash,
    sourceDetailAccessRequestHash: request.requestHash,
    status: "hold_pending_detail_access_decision",
    humanEvaluationAllowed: false,
    policyCandidateCanFreeze: false,
  };
  const initialGate = { ...initialGateBody, gateHash: stableHash(initialGateBody) };
  writeFileSync(join(directory, "stage15-shadow-human-evaluation-start-gate.v1.json"), `${JSON.stringify(initialGate, null, 2)}\n`, "utf8");
  const requestSummaryBody = {
    schemaVersion: "generation-summary.stage15-shadow-detail-access-request.v1",
    batchId,
    status: "pending_user_approval",
    sourceManifestHash: manifest.manifestHash,
    requestHash: request.requestHash,
  };
  writeFileSync(join(directory, "generation-summary.stage15-shadow-detail-access-request.v1.json"), `${JSON.stringify({ ...requestSummaryBody, summaryHash: stableHash(requestSummaryBody) }, null, 2)}\n`, "utf8");
  mkdirSync(join(directory, "detail-captures"));
  writeFileSync(join(directory, "detail-captures", "B0044UP39U.md"), "# Synthetic login wall capture\n", "utf8");
  const captureSha = createHash("sha256").update(readFileSync(join(directory, "detail-captures", "B0044UP39U.md"))).digest("hex");
  const stopBody = {
    schemaVersion: "stage15-shadow-detail-access-stop-evidence.v1",
    batchId,
    requestHash: request.requestHash,
    authorizationHash: stableHash(authorization),
    productKey: accessEntry.productKey,
    sourceUrl: accessEntry.sourceUrl,
    requestedAt: accessEntry.requestedAt,
    recordedAt: "2026-07-17T06:35:09.000Z",
    accessOutcome: "login_wall",
    capture: { relativePath: "detail-captures/B0044UP39U.md", fileSha256: captureSha },
    rawVisibleDiagnostics: { exactVariantPositiveReviews: null, exactVariantNegativeReviews: null },
    continuation: { allowed: false, unvisitedTargetCount: 19 },
  };
  const stopEvidence = { ...stopBody, evidenceHash: stableHash(stopBody) };
  writeFileSync(join(directory, "stage15-shadow-detail-access-stop-evidence.v1.json"), `${JSON.stringify(stopEvidence, null, 2)}\n`, "utf8");
  const detailGateBody = {
    schemaVersion: "stage15-shadow-human-evaluation-start-gate.v1",
    batchId,
    sourceManifestHash: manifest.manifestHash,
    sourcePacketHash: packet.packetHash,
    sourceDetailAccessRequestHash: request.requestHash,
    sourceDetailAccessPreflightHash: preflight.preflightHash,
    sourceDetailAccessStopEvidenceHash: stopEvidence.evidenceHash,
    previousGateHash: initialGate.gateHash,
    status: "hold_detail_access_stopped_login_wall",
    humanEvaluationAllowed: false,
    policyCandidateCanFreeze: false,
    reasonCodes: ["detail_access_stopped_login_wall", "exact_variant_review_coverage_0_of_10", "detail_enriched_packet_not_generated"],
  };
  writeFileSync(join(directory, "stage15-shadow-human-evaluation-start-gate.detail-stop.v1.json"), `${JSON.stringify({ ...detailGateBody, gateHash: stableHash(detailGateBody) }, null, 2)}\n`, "utf8");
  return directory;
}

export function hashEveryTopLevelFile(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const content = createHash("sha256").update(readFileSync(join(directory, entry.name)));
      return [entry.name, content.digest("hex")];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}
