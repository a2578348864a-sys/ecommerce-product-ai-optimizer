import { stableHash } from "../../lib/upstream/pipeline";
import {
  altReviewAuthorizationPhrase,
  assertStage15ShadowAltReviewAuthorizationIntegrity,
  assertStage15ShadowAltReviewBriefIntegrity,
  assertStage15ShadowAltReviewRegistryIntegrity,
  assertStage15ShadowAltReviewRequestIntegrity,
  type AltReviewAccessLogEntry,
  type AltReviewBatchStatus,
  type Stage15ShadowAltReviewAccessRequest,
  type Stage15ShadowAltReviewAuthorization,
  type Stage15ShadowAltReviewProbeBrief,
  type Stage15ShadowAltReviewSourceRegistry,
} from "./stage15-shadow-alt-review-contract";

export type Stage15ShadowAltReviewPreflightInput = {
  brief: Stage15ShadowAltReviewProbeBrief;
  registry: Stage15ShadowAltReviewSourceRegistry;
  request: Stage15ShadowAltReviewAccessRequest;
  authorization: Stage15ShadowAltReviewAuthorization | null;
  accessLog: AltReviewAccessLogEntry[];
};

export type Stage15ShadowAltReviewPreflightResult = {
  status: Extract<AltReviewBatchStatus, "pending_user_access_approval" | "probe_in_progress">;
  executionAllowed: boolean;
  remainingSearchQueries: number;
  remainingPageOpens: number;
  searchedProductKeys: string[];
  openedUrls: string[];
  quarantinedSourceIds: string[];
};

const STOP_SOURCE_OUTCOMES = new Set(["login_wall", "captcha", "access_denied"]);
const TERMINAL_PRODUCT_OUTCOMES = new Set(["identity_unverified"]);

function assertContractBindings(input: Stage15ShadowAltReviewPreflightInput): void {
  assertStage15ShadowAltReviewBriefIntegrity(input.brief);
  assertStage15ShadowAltReviewRegistryIntegrity(input.registry);
  assertStage15ShadowAltReviewRequestIntegrity(input.request);
  if (input.registry.batchId !== input.brief.batchId || input.registry.briefHash !== input.brief.briefHash
    || input.request.batchId !== input.brief.batchId || input.request.briefHash !== input.brief.briefHash
    || input.request.registryHash !== input.registry.registryHash
    || input.request.sourceManifestHash !== input.brief.sourceManifest.manifestHash
    || input.request.sourceManifestFileSha256 !== input.brief.sourceManifest.fileSha256) {
    throw new Error("SHADOW_ALT_REVIEW_REQUEST_DRIFT");
  }
}

function pendingResult(input: Stage15ShadowAltReviewPreflightInput): Stage15ShadowAltReviewPreflightResult {
  return {
    status: "pending_user_access_approval",
    executionAllowed: false,
    remainingSearchQueries: input.request.budget.maxSearchQueries,
    remainingPageOpens: input.request.budget.maxPageOpens,
    searchedProductKeys: [],
    openedUrls: [],
    quarantinedSourceIds: [],
  };
}

export function evaluateStage15ShadowAltReviewPreflight(
  input: Stage15ShadowAltReviewPreflightInput,
): Stage15ShadowAltReviewPreflightResult {
  assertContractBindings(input);
  if (!input.authorization) {
    if (input.accessLog.length > 0) throw new Error("SHADOW_ALT_REVIEW_ACCESS_WITHOUT_AUTHORIZATION");
    return pendingResult(input);
  }

  assertStage15ShadowAltReviewAuthorizationIntegrity(input.authorization);
  const expectedApprovalText = altReviewAuthorizationPhrase(input.request.requestHash, input.registry.registryHash);
  if (input.authorization.requestHash !== input.request.requestHash
    || input.authorization.registryHash !== input.registry.registryHash
    || stableHash(input.authorization.approvedBudget) !== stableHash(input.request.budget)
    || input.authorization.approvalTextHash !== stableHash(expectedApprovalText)) {
    throw new Error("SHADOW_ALT_REVIEW_AUTHORIZATION_DRIFT");
  }

  const sampleKeys = new Set(input.brief.samples.map((sample) => sample.productKey));
  const frozenQueries = new Map(input.request.queries.map((query) => [query.productKey, query.query]));
  const sources = new Map(input.registry.entries.map((entry) => [entry.sourceId, entry]));
  const searchLogs = input.accessLog.filter((entry) => entry.kind === "search_query");
  const pageLogs = input.accessLog.filter((entry) => entry.kind === "page_open");

  if (input.accessLog.some((entry) => entry.attempt !== 1)) {
    throw new Error("SHADOW_ALT_REVIEW_RETRY_FORBIDDEN");
  }
  for (const entry of input.accessLog) {
    if (!sampleKeys.has(entry.productKey)) throw new Error("SHADOW_ALT_REVIEW_PRODUCT_NOT_FROZEN");
    if (Number.isNaN(Date.parse(entry.requestedAt))) throw new Error("SHADOW_ALT_REVIEW_LOG_TIME_INVALID");
    if (Date.parse(entry.requestedAt) < Date.parse(input.authorization.approvedAt)) {
      throw new Error("SHADOW_ALT_REVIEW_LOG_BEFORE_AUTHORIZATION");
    }
  }

  const searchedProductKeys = searchLogs.map((entry) => entry.productKey);
  if (new Set(searchedProductKeys).size !== searchedProductKeys.length) {
    throw new Error("SHADOW_ALT_REVIEW_DUPLICATE_QUERY");
  }
  if (searchLogs.length > input.request.budget.maxSearchQueries) {
    throw new Error("SHADOW_ALT_REVIEW_SEARCH_BUDGET_EXCEEDED");
  }
  for (const entry of searchLogs) {
    if (frozenQueries.get(entry.productKey) !== entry.query) {
      throw new Error("SHADOW_ALT_REVIEW_QUERY_NOT_FROZEN");
    }
  }

  const openedUrls: string[] = [];
  const pageCounts = new Map<string, number>();
  const quarantined = new Set<string>();
  const productTerminal = new Set<string>();
  for (const entry of pageLogs) {
    if (quarantined.has(entry.sourceId)) throw new Error("SHADOW_ALT_REVIEW_SOURCE_QUARANTINED");
    const source = sources.get(entry.sourceId);
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      throw new Error("SHADOW_ALT_REVIEW_URL_NOT_REGISTERED");
    }
    if (!source || url.protocol !== "https:" || url.username || url.password
      || url.origin !== source.origin
      || !source.allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
      throw new Error("SHADOW_ALT_REVIEW_URL_NOT_REGISTERED");
    }
    const canonicalUrl = url.href;
    if (openedUrls.includes(canonicalUrl)) throw new Error("SHADOW_ALT_REVIEW_DUPLICATE_URL");
    openedUrls.push(canonicalUrl);
    pageCounts.set(entry.productKey, (pageCounts.get(entry.productKey) ?? 0) + 1);
    if ((pageCounts.get(entry.productKey) ?? 0) > input.request.budget.maxPagesPerProduct) {
      throw new Error("SHADOW_ALT_REVIEW_PRODUCT_PAGE_BUDGET_EXCEEDED");
    }
    if (STOP_SOURCE_OUTCOMES.has(entry.outcome)) quarantined.add(entry.sourceId);
    if (TERMINAL_PRODUCT_OUTCOMES.has(entry.outcome)) productTerminal.add(entry.productKey);
  }
  if (pageLogs.length > input.request.budget.maxPageOpens) {
    throw new Error("SHADOW_ALT_REVIEW_PAGE_BUDGET_EXCEEDED");
  }
  const searchIndexByProduct = new Map<string, number>();
  input.accessLog.forEach((entry, index) => {
    if (entry.kind === "search_query") searchIndexByProduct.set(entry.productKey, index);
  });
  input.accessLog.forEach((entry, index) => {
    if (entry.kind === "page_open" && (searchIndexByProduct.get(entry.productKey) ?? Number.POSITIVE_INFINITY) >= index) {
      throw new Error("SHADOW_ALT_REVIEW_PAGE_BEFORE_QUERY");
    }
  });

  const searchesByProduct = new Map(searchLogs.map((entry) => [entry.productKey, entry]));
  const unsearchedActionExists = input.brief.samples.some((sample) => !searchesByProduct.has(sample.productKey));
  const pageActionExists = input.brief.samples.some((sample) => {
    const search = searchesByProduct.get(sample.productKey);
    if (!search || search.outcome !== "success" || productTerminal.has(sample.productKey)) return false;
    if ((pageCounts.get(sample.productKey) ?? 0) >= input.request.budget.maxPagesPerProduct) return false;
    return input.registry.entries.some((source) => !quarantined.has(source.sourceId));
  });
  const executionAllowed = unsearchedActionExists || pageActionExists;

  return {
    status: "probe_in_progress",
    executionAllowed,
    remainingSearchQueries: input.request.budget.maxSearchQueries - searchLogs.length,
    remainingPageOpens: input.request.budget.maxPageOpens - pageLogs.length,
    searchedProductKeys,
    openedUrls,
    quarantinedSourceIds: [...quarantined].sort(),
  };
}
