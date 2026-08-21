/**
 * V4 P2 — Amazon Bounded Browser Adapter（A worktree，P2_CONTRACT D1/D2/D3/D4）。
 *
 * ToolCallEnvelope → ToolResultEnvelope。复用 tools/collectors/amazon 作为 live 执行层
 * （import 复用，不改动这些文件）；recorded 模式从脱敏 fixture 确定性回放。
 *
 * 边界（D4 / 06_TOOL_CONTRACTS / RESEARCH_SKILLS_SPEC amazon-competitor-research）：
 * - 每次导航后实体校验（host / marketplace / ASIN 或关键词 / 页面类型），不匹配立即停。
 * - 字段白名单（requestedFields ∩ 内置白名单），禁无限滚动、禁自动登录。
 * - 推荐位 / 相似商品不得误收（sponsored=true 从目标集合排除，仅记 adPlacements）。
 * - 网页内容一律视为不可信数据：只做字段提取，注入文本进入 rawArtifact 而非指令。
 *
 * 失败路径映射（D2）：AUTH_REQUIRED / CAPTCHA_OR_BOT_CHECK → waiting_auth(wait_human)；
 * WRONG_ENTITY / DOM_CHANGED → stopped_error(stop)；RATE_LIMITED / TIMEOUT →
 * stopped_error(retry)；BUDGET_EXCEEDED → budget_exceeded(wait_human)；no_results →
 * no_results(revise_plan)。
 */
import "server-only";

import { createHash } from "node:crypto";

import type {
  RawArtifactRef,
  ToolCallEnvelope,
  ToolResultEnvelope,
  ToolStatus,
  ToolWarning,
} from "@/lib/v4/tools/envelope";
import { validateToolResult } from "@/lib/v4/tools/envelope";
import type { ResearchRunErrorCode } from "@/lib/v4/contracts";
import { ERROR_CODES } from "@/lib/v4/contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AMAZON_ADAPTER_TOOL_NAME = "amazon_bounded_browser";
export const AMAZON_ADAPTER_VERSION = "amazon-bounded-browser.v1";
export const AMAZON_BOUNDED_DATA_SCHEMA = "amazon-bounded.v1";
export const AMAZON_RECORDED_FIXTURE_SCHEMA = "amazon-recorded.v1";

/** 域名白名单（仅 amazon.com 系公开页）。 */
export const AMAZON_ALLOWED_DOMAINS = ["amazon.com", "www.amazon.com"] as const;

/** 采集字段白名单（D4 / 06_TOOL_CONTRACTS Amazon Bounded Browser）。 */
export const AMAZON_FIELD_WHITELIST = [
  "asin",
  "title",
  "price",
  "rating",
  "reviewCount",
  "bsr",
  "sellingPoints",
  "productUrl",
  "pageUrl",
  "capturedAt",
] as const;
export type AmazonFieldName = (typeof AMAZON_FIELD_WHITELIST)[number];

/** live 模式服务端开关（默认关；D3 经服务端开关控制）。 */
export const AMAZON_LIVE_FEATURE_FLAG = "QX_V4_AMAZON_LIVE_ENABLED";

/** 采集身份字段：无论 requestedFields 如何，始终保留（Evidence 身份 + locator 必需）。 */
const IDENTITY_FIELDS = new Set<keyof AmazonBoundedObservation>(["asin", "productUrl", "capturedAt"]);

/** 白名单字段 → 观测字段映射（pageUrl 属于页面级 data，不逐条观测）。 */
const OBSERVATION_FIELD_MAP: Partial<Record<AmazonFieldName, keyof AmazonBoundedObservation>> = {
  asin: "asin",
  title: "title",
  price: "price",
  rating: "rating",
  reviewCount: "reviewCount",
  bsr: "bsr",
  sellingPoints: "sellingPoints",
  productUrl: "productUrl",
  capturedAt: "capturedAt",
};

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AmazonAdapterMode = "recorded" | "live";

export type AmazonEntityType = "search_results" | "product_detail";

export type AmazonSponsoredState = "organic" | "ad" | "unknown";

/** 与 evidence-and-feasibility.schema.json 对齐的观测级证据元数据。 */
export type AmazonEvidenceMeta = {
  kind: "source_fact" | "platform_metadata" | "signal" | "unknown";
  sourceType: "amazon";
  sampleSize: number | null;
  confidenceDimensions: Record<string, number>;
  contentHash: string;
};

export type AmazonSponsoredDiagnostic = {
  state: boolean | null;
  reasonCode: string | null;
  matchedText: string | null;
};

export type AmazonBoundedObservation = {
  asin: string | null;
  title: string | null;
  price: number | null;
  priceCurrency: "USD" | "JPY" | null;
  rating: number | null;
  reviewCount: number | null;
  bsr: number | null;
  /** 可见卖点（当前 collectors 详情页未暴露；字段白名单预留，缺失为 unknown）。 */
  sellingPoints: string[];
  productUrl: string | null;
  imageUrl: string | null;
  position: number;
  sponsored: boolean | null;
  /** 推荐位/赞助位状态（deriveSponsoredState 归一：organic/ad/unknown；缺省时由 adapter 计算）。 */
  sponsoredState?: AmazonSponsoredState;
  /** 原始赞助诊断（用于 WE-1 非标准赞助标记判定；可选，recorded 可省略）。 */
  sponsoredDiagnostic?: AmazonSponsoredDiagnostic | null;
  /** 证据元数据（与 evidence schema 对齐；缺省时由 adapter 计算）。 */
  evidence?: AmazonEvidenceMeta;
  capturedAt: string;
};

export type AmazonObservedContext = {
  host: string;
  marketplace: string;
  pageUrl: string;
  /** collector 页面分类：amazon_normal / amazon_normal_variant / ok / captcha / login_wall / … */
  pageStatus: string;
  observedMarket: string | null;
  observedCurrency: string | null;
  deliveryRegion: string | null;
  language: string | null;
  amazonBrandMarkerPresent: boolean;
};

/** adapter 统一的“已观测页面”输入（recorded fixture 或 live collectors 归一化后）。 */
export type AmazonExtraction = {
  entityType: AmazonEntityType;
  /** 页面上实际观测到的实体：search → 关键词；detail → ASIN。 */
  observedEntity: string;
  context: AmazonObservedContext;
  /** 自然位（sponsored=false / null）观测集合，用于目标证据。 */
  observations: AmazonBoundedObservation[];
  /** 推荐位 / 赞助位（sponsored=true），不得作为目标证据。 */
  adPlacements: AmazonBoundedObservation[];
  /** product_detail 单商品观测（仅当 entityType=product_detail 且实体绑定通过）。 */
  detail: AmazonBoundedObservation | null;
  rawCardCount: number;
  keyContainerFound: boolean;
  /** 脱敏页面样本（仅作为 rawArtifact 内容，绝不进入指令 / 计划）。 */
  rawArtifactSample: string | null;
  cost: { usedBrowserSteps: number; usedCost: number; currency: string };
};

/** recorded fixture 文件结构（脱敏）。 */
export type AmazonRecordedFixture = {
  schemaVersion: typeof AMAZON_RECORDED_FIXTURE_SCHEMA;
  match: { inputHash?: string; query?: string; asin?: string; marketplace?: string };
  extraction: AmazonExtraction;
};

export type AmazonAdapterOptions = {
  /** 默认 "recorded"（测试 / CI 确定性回放）。 */
  mode?: AmazonAdapterMode;
  /** recorded fixture 目录（相对 cwd 或绝对路径）。 */
  fixturesDir?: string;
  /** live 服务端开关；缺省读环境变量 QX_V4_AMAZON_LIVE_ENABLED（默认关）。 */
  liveEnabled?: boolean;
  /** live 执行器注入点（测试 / Lead 接线用）；缺省用 collectors 默认实现。 */
  liveExecutor?: AmazonLiveExecutor;
  /** 时钟注入（确定性 capturedAt）。 */
  now?: () => string;
};

/** live 执行器：一次“导航 + 分类 + 提取”，产出 AmazonExtraction。 */
export type AmazonLiveExecutor = {
  run(envelope: ToolCallEnvelope, maxAppearances: number): Promise<AmazonExtraction>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** 解析 targetEntity：ASIN（10 位字母数字）或关键词。 */
export function parseTargetEntity(targetEntity: string): { kind: "asin" | "keyword"; value: string } {
  const trimmed = (targetEntity ?? "").trim();
  if (ASIN_PATTERN.test(trimmed.toUpperCase())) return { kind: "asin", value: trimmed.toUpperCase() };
  return { kind: "keyword", value: trimmed };
}

export function isAsin(value: string | null | undefined): boolean {
  return typeof value === "string" && ASIN_PATTERN.test(value.trim().toUpperCase());
}

function normalizeHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function normalizedAllowedDomains(envelope: ToolCallEnvelope): Set<string> {
  const raw = envelope.allowedDomains && envelope.allowedDomains.length > 0
    ? envelope.allowedDomains
    : [...AMAZON_ALLOWED_DOMAINS];
  return new Set(raw.map((domain) => domain.toLowerCase().replace(/^www\./, "")));
}

function isAllowedHost(host: string, allowed: Set<string>): boolean {
  const bare = host.toLowerCase().replace(/^www\./, "");
  return allowed.has(bare);
}

export type AmazonEntityErrorCode = "WRONG_ENTITY";

export function validateEntity(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
): { code: "WRONG_ENTITY"; reason: string } | null {
  const allowed = normalizedAllowedDomains(envelope);
  const host = extraction.context.host?.toLowerCase();
  const hostOk = !!host && isAllowedHost(host, allowed);
  if (!hostOk) {
    return { code: "WRONG_ENTITY", reason: "host_not_allowed:" + (host ?? "unknown") };
  }

  const marketplace = extraction.context.marketplace?.toLowerCase();
  const expectedMarketplace = envelope.marketplace?.toLowerCase();
  if (!marketplace || !expectedMarketplace || marketplace !== expectedMarketplace) {
    return { code: "WRONG_ENTITY", reason: "marketplace_mismatch:" + (marketplace ?? "unknown") };
  }

  const target = parseTargetEntity(envelope.targetEntity);

  if (target.kind === "asin") {
    if (extraction.entityType === "product_detail") {
      const observedAsin = extraction.observedEntity?.toUpperCase();
      if (observedAsin !== target.value) {
        return { code: "WRONG_ENTITY", reason: "asin_mismatch:expected_" + target.value + ",observed_" + (observedAsin ?? "unknown") };
      }
      const detailAsin = extraction.detail?.asin?.toUpperCase();
      if (!detailAsin || detailAsin !== target.value) {
        return { code: "WRONG_ENTITY", reason: "asin_binding_unproven:expected_" + target.value + ",observed_" + (detailAsin ?? "unknown") };
      }
      return null;
    }
    // ASIN on search_results：目标卡必须是自然位（WE-1 推荐位/相似商品不得误收）。
    if (extraction.entityType !== "search_results") {
      return { code: "WRONG_ENTITY", reason: "entity_type_mismatch:expected_product_detail_or_search_results,got_" + extraction.entityType };
    }
    const targetObs = extraction.observations.filter((observation) => observation.asin?.toUpperCase() === target.value);
    if (targetObs.length === 0) {
      return { code: "WRONG_ENTITY", reason: "target_card_not_found_in_search:" + target.value };
    }
    const hasOrganic = targetObs.some((observation) => (observation.sponsoredState ?? deriveSponsoredState(observation.sponsored, observation.sponsoredDiagnostic)) === "organic");
    if (!hasOrganic) {
      return { code: "WRONG_ENTITY", reason: "target_card_not_organic:" + target.value };
    }
    return null;
  }

  // keyword target → search_results
  if (extraction.entityType !== "search_results") {
    return { code: "WRONG_ENTITY", reason: "entity_type_mismatch:expected_search_results,got_" + extraction.entityType };
  }
  const observedQuery = extraction.observedEntity?.toLowerCase() ?? "";
  const expectedKeyword = target.value.toLowerCase();
  if (!observedQuery || (observedQuery !== expectedKeyword && !observedQuery.includes(expectedKeyword))) {
    return { code: "WRONG_ENTITY", reason: "keyword_mismatch:expected_" + target.value + ",observed_" + (observedQuery ?? "unknown") };
  }
  return null;
}

export type PageStatusError = {
  code: ResearchRunErrorCode;
  status: ToolStatus;
  nextAction: ToolResultEnvelope["nextAction"];
  reason: string;
};

/**
 * 页面分类 → 错误码映射（D2）。
 * 仅对无法继续采样的页面分类返回错误；可继续的 ok / amazon_normal* 返回 null。
 */
export function mapPageStatusToError(pageStatus: string): PageStatusError | null {
  const status = pageStatus?.toLowerCase();
  switch (status) {
    case "captcha":
    case "access_denied":
      return { code: "CAPTCHA_OR_BOT_CHECK", status: "waiting_auth", nextAction: "wait_human", reason: "captcha_or_bot_check" };
    case "login_wall":
      return { code: "AUTH_REQUIRED", status: "waiting_auth", nextAction: "wait_human", reason: "login_wall" };
    case "region_selection":
    case "unexpected_redirect":
      return { code: "WRONG_ENTITY", status: "stopped_error", nextAction: "stop", reason: "region_or_redirect_mismatch" };
    case "loading":
      return { code: "TIMEOUT", status: "stopped_error", nextAction: "retry", reason: "page_loading" };
    case "error_page":
      return { code: "RATE_LIMITED", status: "stopped_error", nextAction: "retry", reason: "amazon_error_page" };
    case "privacy_prompt_visible":
    case "privacy_prompt_unknown":
    case "browser_error_page":
    case "blank_page":
    case "unknown_page":
    case "dom_changed":
      return { code: "DOM_CHANGED", status: "stopped_error", nextAction: "stop", reason: "page_structure_unexpected" };
    case "amazon_normal":
    case "amazon_normal_variant":
    case "ok":
      return null;
    default:
      // 未知分类 fail-closed
      return { code: "DOM_CHANGED", status: "stopped_error", nextAction: "stop", reason: "unknown_page_classification" };
  }
}

/** 环境校验：observed market / currency 必须与目标（US / USD）一致；否则 stop。 */
export function validateEnvironment(
  extraction: AmazonExtraction,
): { code: "WRONG_ENTITY"; reason: string } | null {
  const observedMarket = extraction.context.observedMarket?.toUpperCase() ?? null;
  const observedCurrency = extraction.context.observedCurrency?.toUpperCase() ?? null;
  if (observedMarket && observedMarket !== "US") {
    return { code: "WRONG_ENTITY", reason: "market_mismatch:" + observedMarket };
  }
  if (observedCurrency && observedCurrency !== "USD") {
    return { code: "WRONG_ENTITY", reason: "currency_mismatch:" + observedCurrency };
  }
  // 未确认（null）不阻断，但记为警告（由 buildWarnings 处理）。
  return null;
}

/** 预算校验：usedBrowserSteps / usedCost 超出 envelope.budget → BUDGET_EXCEEDED。 */
export function checkBudget(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
): { code: "BUDGET_EXCEEDED"; reason: string } | null {
  const steps = extraction.cost.usedBrowserSteps;
  const cost = extraction.cost.usedCost;
  const budget = envelope.budget;
  if (budget && steps > budget.maxBrowserSteps) {
    return { code: "BUDGET_EXCEEDED", reason: "browser_steps_exceeded:" + steps + ">" + budget.maxBrowserSteps };
  }
  if (budget && cost > budget.maxCost) {
    return { code: "BUDGET_EXCEEDED", reason: "cost_exceeded:" + cost + ">" + budget.maxCost };
  }
  return null;
}

/**
 * 赞助/推荐位判定（WE-1）：sponsored=true → ad；false → organic；
 * sponsored=null 时结合赞助诊断——命中已知有机结构 → organic；命中模糊广告文案/标记 → ad；
 * 其余 → unknown（保留在 organic 集合但记警告，不默认当作自然位）。
 */
export function deriveSponsoredState(
  sponsored: boolean | null,
  diagnostic?: AmazonSponsoredDiagnostic | null,
): AmazonSponsoredState {
  if (sponsored === true) return "ad";
  if (sponsored === false) return "organic";
  const reason = diagnostic?.reasonCode ?? "";
  const matched = diagnostic?.matchedText ?? "";
  if (reason === "ambiguous_ad_text_without_known_marker" || /(?:sponsored|promoted|advertisement|ad)|广告|推广/i.test(matched)) {
    return "ad";
  }
  if (reason === "known_organic_structure") return "organic";
  return "unknown";
}

/** 观测级证据元数据（与 evidence schema 对齐，contentHash 确定性计算）。 */
export function buildEvidenceMeta(observation: Pick<AmazonBoundedObservation, "asin" | "title" | "price" | "rating" | "reviewCount" | "bsr">): AmazonEvidenceMeta {
  const payload = JSON.stringify({
    asin: observation.asin,
    title: observation.title,
    price: observation.price,
    rating: observation.rating,
    reviewCount: observation.reviewCount,
    bsr: observation.bsr,
  });
  const contentHash = createHash("sha256").update(payload).digest("hex");
  const confidenceDimensions: Record<string, number> = {
    entity: observation.asin ? 1 : 0,
    price: observation.price != null ? 1 : 0,
    rating: observation.rating != null ? 1 : 0,
  };
  // kind 反映置信度：有身份且有价格/评分 → source_fact；有身份但关键字段缺失 → signal；无身份 → unknown。
  const kind: AmazonEvidenceMeta["kind"] = !observation.asin
    ? "unknown"
    : (observation.price != null && observation.rating != null)
      ? "source_fact"
      : "signal";
  return {
    kind,
    sourceType: "amazon",
    sampleSize: observation.asin ? 1 : null,
    confidenceDimensions,
    contentHash,
  };
}

/** 把 ad 位（含模糊广告标记）从目标集合剥离到 adPlacements；organic 保留，unknown 保留但记警告。 */
export function splitAdPlacements(
  observations: AmazonBoundedObservation[],
): { observations: AmazonBoundedObservation[]; adPlacements: AmazonBoundedObservation[] } {
  const adPlacements: AmazonBoundedObservation[] = [];
  const organic: AmazonBoundedObservation[] = [];
  for (const observation of observations) {
    const state = observation.sponsoredState ?? deriveSponsoredState(observation.sponsored, observation.sponsoredDiagnostic);
    if (state === "ad") {
      adPlacements.push(observation);
    } else {
      organic.push(observation);
    }
  }
  return { observations: organic, adPlacements };
}

/** requestedFields ∩ 白名单；不在白名单的字段记录为警告。 */
export function resolveRequestedFields(envelope: ToolCallEnvelope): {
  allowed: Set<AmazonFieldName>;
  rejected: string[];
  empty: boolean;
} {
  const raw = envelope.requestedFields && envelope.requestedFields.length > 0
    ? envelope.requestedFields
    : [...AMAZON_FIELD_WHITELIST];
  const rejected: string[] = [];
  const allowed = new Set<AmazonFieldName>();
  for (const field of raw) {
    if ((AMAZON_FIELD_WHITELIST as readonly string[]).includes(field)) {
      allowed.add(field as AmazonFieldName);
    } else {
      rejected.push(field);
    }
  }
  return { allowed, rejected, empty: raw.length === 0 };
}

function filterObservation(
  observation: AmazonBoundedObservation,
  allowed: Set<AmazonFieldName>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // 身份 / locator 字段始终保留
  for (const field of IDENTITY_FIELDS) out[field] = observation[field];
  // 推荐位状态 + 证据元数据始终保留（与 evidence schema 对齐，缺省时计算）
  out.sponsoredState = observation.sponsoredState ?? deriveSponsoredState(observation.sponsored, observation.sponsoredDiagnostic);
  out.evidence = observation.evidence ?? buildEvidenceMeta(observation);
  for (const field of allowed) {
    const obsKey = OBSERVATION_FIELD_MAP[field];
    if (!obsKey || IDENTITY_FIELDS.has(obsKey)) continue;
    out[field] = observation[obsKey];
  }
  return out;
}

export type AmazonBoundedData = {
  schemaVersion: string;
  entityType: AmazonEntityType;
  targetEntity: string;
  marketplace: string;
  query: string | null;
  asin: string | null;
  pageUrl: string | null;
  sampleFrame: { observed: number; requested: number; page: number };
  observations: Record<string, unknown>[];
  missingFields: Record<string, string>;
};

export function buildBoundedData(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
): { data: AmazonBoundedData; missingFields: Record<string, string> } {
  const { allowed } = resolveRequestedFields(envelope);
  // product_detail 时把单商品观测放入 observations；search_results 时用自然位集合。
  const sourceObservations = extraction.entityType === "product_detail"
    ? (extraction.detail ? [extraction.detail] : [])
    : extraction.observations;
  const observations = sourceObservations.map((observation) => filterObservation(observation, allowed));
  const missingFields: Record<string, string> = {};
  if (extraction.entityType === "search_results") {
    if (observations.length === 0) missingFields["observations"] = "no_organic_results";
    if (!extraction.keyContainerFound) missingFields["keyContainer"] = "search_result_container_not_found";
  } else {
    if (!extraction.detail) missingFields["detail"] = "detail_entity_not_bound";
  }
  // 请求了但所有观测都为空的字段 → 记为 unknown（绝不补成 source_fact 值）。
  for (const field of allowed) {
    const obsKey = OBSERVATION_FIELD_MAP[field];
    if (!obsKey) continue;
    const allNull = observations.every((observation) => observation[obsKey] == null);
    if (allNull) missingFields[field] = "missing_on_all_observations";
  }

  const target = parseTargetEntity(envelope.targetEntity);
  const data: AmazonBoundedData = {
    schemaVersion: AMAZON_BOUNDED_DATA_SCHEMA,
    entityType: extraction.entityType,
    targetEntity: envelope.targetEntity,
    marketplace: extraction.context.marketplace,
    query: target.kind === "keyword" ? target.value : null,
    asin: target.kind === "asin" ? target.value : null,
    pageUrl: extraction.context.pageUrl,
    sampleFrame: {
      observed: observations.length,
      requested: envelope.maxSteps,
      page: 1,
    },
    observations,
    missingFields,
  };
  return { data, missingFields };
}

function buildWarnings(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
  rejectedFields: string[],
): ToolWarning[] {
  const warnings: ToolWarning[] = [];
  if (extraction.context.observedMarket == null) warnings.push({ code: "MARKET_UNCONFIRMED", message: "observed market not confirmed" });
  if (extraction.context.observedCurrency == null) warnings.push({ code: "CURRENCY_UNCONFIRMED", message: "observed currency not confirmed" });
  if (extraction.adPlacements.length > 0) {
    warnings.push({
      code: "AD_PLACEMENTS_EXCLUDED",
      message: extraction.adPlacements.length + " sponsored/recommended placement(s) excluded from target evidence",
    });
  }
  const unknownSponsored = extraction.observations.filter((observation) => observation.sponsored === null).length;
  if (unknownSponsored > 0) warnings.push({ code: "SPONSORED_UNKNOWN", message: unknownSponsored + " observation(s) with unknown sponsored state kept in organic set" });
  if (rejectedFields.length > 0) warnings.push({ code: "FIELD_NOT_ALLOWED", message: "fields rejected (not in whitelist): " + rejectedFields.join(", ") });
  if (extraction.rawArtifactSample && /ignore\s+(all\s+)?(previous|prior)\s+instructions|disregard\s+prior|system\s+prompt|you\s+are\s+now\b/i.test(extraction.rawArtifactSample)) {
    warnings.push({ code: "INJECTION_TEXT_CAPTURED_AS_DATA", message: "possible prompt-injection text captured as page data; treated as untrusted field content only" });
  }
  return warnings;
}

function buildRawArtifactRefs(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
  now: string,
): RawArtifactRef[] {
  const refs: RawArtifactRef[] = [];
  const contentHash = createHash("sha256").update(extraction.rawArtifactSample ?? JSON.stringify(extraction.observations)).digest("hex");
  const observedEntity = extraction.observedEntity ? "-" + sanitizeRefSegment(extraction.observedEntity) : "";
  const ref = "v4/amazon/" + extraction.entityType + observedEntity + "-" + contentHash.slice(0, 16);
  refs.push({ kind: extraction.entityType === "product_detail" ? "page_snapshot" : "recorded", ref, capturedAt: now });
  if (extraction.rawArtifactSample) {
    refs.push({ kind: "page_snapshot", ref: ref + ".snapshot", capturedAt: now });
  }
  return refs;
}

function sanitizeRefSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
}

function buildErrorEnvelope(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
  error: { code: ResearchRunErrorCode; status: ToolStatus; nextAction: ToolResultEnvelope["nextAction"]; reason: string },
  now: string,
): ToolResultEnvelope {
  return {
    status: error.status,
    observedEntity: extraction.observedEntity,
    data: null,
    rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now),
    capturedAt: now,
    cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
    warnings: buildWarnings(envelope, extraction, []),
    errors: [{ code: error.code, safeMessage: error.reason }],
    nextAction: error.nextAction,
  };
}

// ---------------------------------------------------------------------------
// Core: buildToolResult
// ---------------------------------------------------------------------------

/**
 * 纯核心：把“已观测页面”(AmazonExtraction) 转换为 ToolResultEnvelope。
 * 不依赖浏览器 / collectors，可在 node 环境完全测试。
 */
export function buildToolResult(
  envelope: ToolCallEnvelope,
  extraction: AmazonExtraction,
  options: { now?: () => string } = {},
): ToolResultEnvelope {
  const now = options.now ?? (() => new Date().toISOString());

  // 1. 实体校验（host / marketplace / ASIN 或关键词 / 页面类型）
  const entityError = validateEntity(envelope, extraction);
  if (entityError) {
    return buildErrorEnvelope(
      envelope, extraction,
      { code: "WRONG_ENTITY", status: "stopped_error", nextAction: "stop", reason: entityError.reason },
      now(),
    );
  }

  // 2. 页面分类 → 错误码
  const pageError = mapPageStatusToError(extraction.context.pageStatus);
  if (pageError) {
    return buildErrorEnvelope(envelope, extraction, pageError, now());
  }

  // 3. 环境校验（地区 / 币种）
  const envError = validateEnvironment(extraction);
  if (envError) {
    return buildErrorEnvelope(
      envelope, extraction,
      { code: "WRONG_ENTITY", status: "stopped_error", nextAction: "stop", reason: envError.reason },
      now(),
    );
  }

  // 4. no_results
  if (!extraction.keyContainerFound && extraction.observations.length === 0) {
    return {
      status: "no_results",
      observedEntity: extraction.observedEntity,
      data: null,
      rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now()),
      capturedAt: now(),
      cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
      warnings: buildWarnings(envelope, extraction, []),
      errors: [],
      nextAction: "revise_plan",
    };
  }

  // 5. 预算校验
  const budgetError = checkBudget(envelope, extraction);
  if (budgetError) {
    return buildErrorEnvelope(
      envelope, extraction,
      { code: "BUDGET_EXCEEDED", status: "budget_exceeded", nextAction: "wait_human", reason: budgetError.reason },
      now(),
    );
  }

  // 6. 推荐位剥离 + 字段白名单 + 组装 data
  const { observations, adPlacements } = splitAdPlacements(extraction.observations);
  const extracted: AmazonExtraction = { ...extraction, observations, adPlacements };
  const { rejected } = resolveRequestedFields(envelope);
  const { data } = buildBoundedData(envelope, extracted);

  const result: ToolResultEnvelope = {
    status: "ok",
    observedEntity: extraction.observedEntity,
    data,
    rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now()),
    capturedAt: now(),
    cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
    warnings: buildWarnings(envelope, extracted, rejected),
    errors: [],
    nextAction: "continue",
  };
  return result;
}

// ---------------------------------------------------------------------------
// Recorded mode: fixture loading
// ---------------------------------------------------------------------------

export function defaultFixturesDir(): string {
  return "lib/v4/adapters/fixtures/amazon-recorded";
}

/** 计算 fixture 文件名候选：优先 inputHash，其次 query/ASIN。 */
export function fixtureFileNameCandidates(envelope: ToolCallEnvelope): string[] {
  const candidates: string[] = [];
  if (envelope.inputHash) candidates.push(envelope.inputHash + ".json");
  const target = parseTargetEntity(envelope.targetEntity);
  const slug = sanitizeRefSegment(target.value);
  if (slug) candidates.push(slug + ".json");
  candidates.push(target.kind + ".json");
  return candidates;
}

export async function loadRecordedExtraction(
  envelope: ToolCallEnvelope,
  fixturesDir?: string,
): Promise<AmazonRecordedFixture | null> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const baseDir = fixturesDir ?? defaultFixturesDir();
  const candidates = fixtureFileNameCandidates(envelope);
  for (const name of candidates) {
    const filePath = join(baseDir, name);
    try {
      const raw = await readFile(filePath, "utf8");
      const fixture = JSON.parse(raw) as AmazonRecordedFixture;
      if (fixture && fixture.schemaVersion === AMAZON_RECORDED_FIXTURE_SCHEMA && fixture.extraction) {
        return fixture;
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Live mode gate
// ---------------------------------------------------------------------------

export function isAmazonLiveEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;
  const raw = process.env[AMAZON_LIVE_FEATURE_FLAG];
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const AMAZON_LIVE_DISABLED = "AMAZON_LIVE_DISABLED";

// ---------------------------------------------------------------------------
// Live executor (reuse tools/collectors/amazon — import only, never modified)
// ---------------------------------------------------------------------------

/**
 * 默认 live 执行器：复用 collectors 的 browser-control / environment-gate /
 * page-diagnostics / extract-*。仅当服务端开关开启且 Owner 授权时使用；
 * 遇登录 / 验证码立即转 waiting_auth，绝不绕过。
 *
 * 说明：此路径需要真实浏览器 + 单次访问授权，不在单元测试覆盖范围
 * （P2_CONTRACT §2 必测 #6 由 Lead E2E 覆盖）。
 */
export const defaultAmazonLiveExecutor: AmazonLiveExecutor = {
  async run(envelope, maxAppearances): Promise<AmazonExtraction> {
    const browserControl = await import("@/tools/collectors/amazon/browser-control");
    const environmentGate = await import("@/tools/collectors/amazon/environment-gate");
    const pageDiagnostics = await import("@/tools/collectors/amazon/page-diagnostics");
    const searchExtract = await import("@/tools/collectors/amazon/extract-search-page");
    const detailExtract = await import("@/tools/collectors/amazon/detail-page-extract");
    const searchExpression = await import("@/tools/collectors/amazon/search-page-expression-source");
    const detailExpression = await import("@/tools/collectors/amazon/detail-page-expression-source");

    const browser = browserControl.resolveSystemBrowser();
    if (!browser) {
      throw new Error("AMAZON_LIVE_NO_BROWSER");
    }

    const target = parseTargetEntity(envelope.targetEntity);
    const allowedOrigins = [...normalizedAllowedDomains(envelope)].map((domain) => "https://www." + domain);
    const session = await browserControl.openIsolatedPublicBrowserSession({
      browser,
      allowedOrigins,
      maxNavigations: Math.max(1, Math.min(10, envelope.maxSteps)),
      headless: true,
      calibrateEnvironment: { postalCode: "10001" },
    });

    try {
      // 每次导航后才评估页面 DOM 信号与提取（实体校验在 buildToolResult 层执行）。
      const buildDiagnostic = (
        requestedUrl: string,
        nav: { finalUrl: string; mainDocumentHttpStatus: number | null; mainDocumentContentType: string | null; navigationElapsedMs: number; domWaitElapsedMs: number },
        domSignals: Record<string, unknown>,
      ) => pageDiagnostics.buildAmazonPageDiagnostic({
        requestedUrl,
        finalUrl: nav.finalUrl,
        redirectUrls: [],
        mainDocumentHttpStatus: nav.mainDocumentHttpStatus,
        mainDocumentContentType: nav.mainDocumentContentType,
        navigationElapsedMs: nav.navigationElapsedMs,
        domWaitElapsedMs: nav.domWaitElapsedMs,
        readyState: (domSignals.readyState as string | null) ?? null,
        title: (domSignals.title as string | null) ?? null,
        visibleText: (domSignals.visibleText as string) ?? "",
        visibleTextLength: domSignals.visibleTextLength as number | undefined,
        markerSources: domSignals.markerSources as never,
        markers: domSignals.markers as never,
      });

      if (target.kind === "asin") {
        const url = "https://www.amazon.com/dp/" + target.value;
        const nav = await session.navigate(url);
        const domSignals = await session.evaluateDomByValue<Record<string, unknown>>(pageDiagnostics.buildAmazonPageDiagnosticDomExpression());
        const diagnostic = buildDiagnostic(url, nav, domSignals);
        const extractionResult = await session.evaluateDomByValue<
          ReturnType<typeof detailExtract.extractAmazonDetailPage>
        >(detailExpression.buildAmazonDetailPageExtractionExpression({
          expectedAsin: target.value,
          capturedAt: new Date().toISOString(),
          collectorVersion: AMAZON_ADAPTER_VERSION,
        }));
        return translateDetailExtraction(target.value, url, nav.finalUrl, diagnostic, extractionResult);
      }

      const url = browserControl.buildAmazonSearchCanaryUrl(target.value);
      const nav = await session.navigate(url);
      const domSignals = await session.evaluateDomByValue<Record<string, unknown>>(pageDiagnostics.buildAmazonPageDiagnosticDomExpression());
      const diagnostic = buildDiagnostic(url, nav, domSignals);
      const extractionResult = await session.evaluateDomByValue<
        ReturnType<typeof searchExtract.extractAmazonSearchPage>
      >(searchExpression.buildAmazonSearchPageExtractionExpression({
        query: target.value,
        page: 1,
        maxAppearances: Math.max(1, Math.min(60, maxAppearances)),
        capturedAt: new Date().toISOString(),
        requested: { marketplace: "amazon.com", market: "US", currency: "USD" },
        observed: { marketplace: "amazon.com", market: "US", currency: "USD", deliveryRegion: null, deliveryRegionMarket: null, language: null },
      }));
      return translateSearchExtraction(target.value, url, nav.finalUrl, diagnostic, environmentGate, extractionResult);
    } finally {
      await session.close();
    }
  },
};

function translateDetailExtraction(
  expectedAsin: string,
  pageUrl: string,
  finalUrl: string,
  diagnostic: { classification: string; loginWallMarker: boolean; captchaRobotCheckMarker: boolean },
  extraction: {
    pageStatus: string;
    entityBound: boolean;
    urlAsin: string | null;
    pageAsin: string | null;
    fields: Record<string, { value: string | number | null; status: string }>;
  },
): AmazonExtraction {
  // 以更权威的 page-diagnostics 分类为准；仅当分类为 normal 时信任 entityBound。
  const classification = diagnostic.classification;
  const pageStatus = (classification === "amazon_normal" || classification === "amazon_normal_variant")
    ? (extraction.entityBound ? "amazon_normal" : "unknown_page")
    : classification;
  const context: AmazonObservedContext = {
    host: normalizeHost(finalUrl) ?? "www.amazon.com",
    marketplace: "amazon.com",
    pageUrl,
    pageStatus,
    observedMarket: "US",
    observedCurrency: "USD",
    deliveryRegion: null,
    language: "en-us",
    amazonBrandMarkerPresent: true,
  };
  const asin = extraction.urlAsin ?? expectedAsin;
  const detail: AmazonBoundedObservation = {
    asin,
    title: typeof extraction.fields.title?.value === "string" ? extraction.fields.title.value : null,
    price: typeof extraction.fields.price?.value === "number" ? extraction.fields.price.value : null,
    priceCurrency: extraction.fields.price?.value ? "USD" : null,
    rating: typeof extraction.fields.rating?.value === "number" ? extraction.fields.rating.value : null,
    reviewCount: typeof extraction.fields.reviews?.value === "number" ? extraction.fields.reviews.value : null,
    bsr: typeof extraction.fields.bsr?.value === "number" ? extraction.fields.bsr.value : null,
    sellingPoints: [],
    productUrl: pageUrl,
    imageUrl: null,
    position: 1,
    sponsored: false,
    capturedAt: new Date().toISOString(),
  };
  return {
    entityType: "product_detail",
    observedEntity: expectedAsin,
    context,
    observations: [],
    adPlacements: [],
    detail,
    rawCardCount: 1,
    keyContainerFound: extraction.entityBound,
    rawArtifactSample: null,
    cost: { usedBrowserSteps: 1, usedCost: 0.05, currency: "USD" },
  };
}

function translateSearchExtraction(
  query: string,
  pageUrl: string,
  finalUrl: string,
  diagnostic: { classification: string },
  environmentGate: typeof import("@/tools/collectors/amazon/environment-gate"),
  extraction: {
    pageStatus: string;
    observed: { marketplace: string | null; market: string | null; currency: string | null; deliveryRegion: string | null; language: string | null };
    rawCardCount: number;
    keyContainerFound: boolean;
    observations: Array<{
      asin: string | null;
      title: string | null;
      priceText: string | null;
      priceCurrency: "USD" | "JPY" | null;
      ratingText: string | null;
      reviewCountText: string | null;
      brand: string | null;
      productUrl: string | null;
      imageUrl: string | null;
      position: number;
      sponsored: boolean | null;
      sponsoredDiagnostic: { state: boolean | null; reasonCode: string; matchedText: string | null } | null;
      capturedAt: string;
    }>;
  },
): AmazonExtraction {
  // 以更权威的 page-diagnostics 分类为准；仅当分类为 normal 时信任 extraction。
  const classification = diagnostic.classification;
  const pageStatus = (classification === "amazon_normal" || classification === "amazon_normal_variant")
    ? (extraction.pageStatus === "ok" ? "amazon_normal" : "unknown_page")
    : classification;
  const observations: AmazonBoundedObservation[] = extraction.observations.map((observation) => ({
    asin: observation.asin,
    title: observation.title,
    price: parsePriceText(observation.priceText),
    priceCurrency: observation.priceCurrency,
    rating: parseRatingText(observation.ratingText),
    reviewCount: parseReviewCountText(observation.reviewCountText),
    bsr: null,
    sellingPoints: [],
    productUrl: observation.productUrl,
    imageUrl: observation.imageUrl,
    position: observation.position,
    sponsored: observation.sponsored,
    sponsoredState: deriveSponsoredState(observation.sponsored, observation.sponsoredDiagnostic),
    sponsoredDiagnostic: observation.sponsoredDiagnostic,
    capturedAt: observation.capturedAt,
  }));
  const gate = environmentGate.evaluateAmazonEnvironment({
    pageStatus: extraction.pageStatus === "ok" ? "ok" : "unknown_page",
    pageUrl,
    amazonBrandMarkerPresent: true,
    deliveryRegion: extraction.observed.deliveryRegion,
    language: extraction.observed.language,
    currencyPreference: extraction.observed.currency,
  });
  const context: AmazonObservedContext = {
    host: normalizeHost(finalUrl) ?? "www.amazon.com",
    marketplace: extraction.observed.marketplace ?? "amazon.com",
    pageUrl,
    pageStatus,
    observedMarket: gate.observed.market,
    observedCurrency: gate.observed.currency,
    deliveryRegion: gate.observed.deliveryRegion,
    language: gate.observed.language,
    amazonBrandMarkerPresent: true,
  };
  return {
    entityType: "search_results",
    observedEntity: query,
    context,
    observations,
    adPlacements: [],
    detail: null,
    rawCardCount: extraction.rawCardCount,
    keyContainerFound: extraction.keyContainerFound,
    rawArtifactSample: null,
    cost: { usedBrowserSteps: 1, usedCost: 0.05, currency: "USD" },
  };
}

function parsePriceText(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(?:US\$|\$)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRatingText(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

function parseReviewCountText(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*\(?\s*([0-9][0-9,]*)/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** 进程内幂等缓存：同 idempotencyKey + inputHash → 返回已记录结果，不重放真实副作用。 */
const idempotencyCache = new Map<string, ToolResultEnvelope>();
const IDEMPOTENCY_CACHE_LIMIT = 200;

function idempotencyKeyOf(envelope: ToolCallEnvelope): string {
  return envelope.idempotencyKey + "|" + envelope.inputHash;
}

export function __resetAmazonAdapterCacheForTest(): void {
  idempotencyCache.clear();
}

/**
 * 主入口：ToolCallEnvelope → ToolResultEnvelope。
 * - recorded：从 fixture 确定性回放（按 inputHash / query 匹配，缺失 → no_results）。
 * - live：服务端开关控制（默认关）；开 + 注入执行器 → 复用 collectors。
 */
export async function runAmazonAdapter(
  envelope: ToolCallEnvelope,
  options: AmazonAdapterOptions = {},
): Promise<ToolResultEnvelope> {
  const now = options.now ?? (() => new Date().toISOString());

  // 幂等：同 idempotencyKey + 同 inputHash → 返回已记录结果，不重放真实副作用。
  const cacheKey = idempotencyKeyOf(envelope);
  const cached = idempotencyCache.get(cacheKey);
  if (cached) {
    return { ...cached, capturedAt: cached.capturedAt, warnings: [...cached.warnings] };
  }

  const mode = options.mode ?? "recorded";

  if (mode === "recorded") {
    const fixture = await loadRecordedExtraction(envelope, options.fixturesDir);
    if (!fixture) {
      const result: ToolResultEnvelope = {
        status: "no_results",
        observedEntity: envelope.targetEntity,
        data: null,
        rawArtifactRefs: [],
        capturedAt: now(),
        cost: { usedCost: 0, currency: envelope.budget?.currency ?? "USD", usedBrowserSteps: 0 },
        warnings: [{ code: "FIXTURE_NOT_FOUND", message: "no recorded fixture for inputHash=" + envelope.inputHash }],
        errors: [],
        nextAction: "revise_plan",
      };
      idempotencyCache.set(cacheKey, result);
      return result;
    }
    const result = buildToolResult(envelope, fixture.extraction, { now });
    idempotencyCache.set(cacheKey, result);
    return result;
  }

  // live mode
  const liveEnabled = isAmazonLiveEnabled(options.liveEnabled);
  if (!liveEnabled) {
    const result: ToolResultEnvelope = {
      status: "stopped_error",
      observedEntity: envelope.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt: now(),
      cost: { usedCost: 0, currency: envelope.budget?.currency ?? "USD", usedBrowserSteps: 0 },
      warnings: [{ code: "LIVE_DISABLED", message: "live mode disabled by server switch (default off)" }],
      errors: [{ code: "PERMISSION_DENIED", safeMessage: AMAZON_LIVE_DISABLED }],
      nextAction: "stop",
    };
    idempotencyCache.set(cacheKey, result);
    return result;
  }

  const executor = options.liveExecutor ?? defaultAmazonLiveExecutor;
  let extraction: AmazonExtraction;
  try {
    const maxAppearances = Math.min(60, Math.max(1, envelope.maxSteps || 20));
    extraction = await executor.run(envelope, maxAppearances);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAuth = /auth|login|sign in/i.test(message);
    const isBot = /captcha|robot|bot/i.test(message);
    const code: ResearchRunErrorCode = isAuth ? "AUTH_REQUIRED" : isBot ? "CAPTCHA_OR_BOT_CHECK" : "UNKNOWN_RECOVERABLE";
    const result: ToolResultEnvelope = {
      status: isAuth || isBot ? "waiting_auth" : "stopped_error",
      observedEntity: envelope.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt: now(),
      cost: { usedCost: 0, currency: envelope.budget?.currency ?? "USD", usedBrowserSteps: 0 },
      warnings: [{ code: "LIVE_EXECUTOR_ERROR", message: "live executor failed: " + message }],
      errors: [{ code, safeMessage: message }],
      nextAction: isAuth || isBot ? "wait_human" : "retry",
    };
    idempotencyCache.set(cacheKey, result);
    return result;
  }

  const result = buildToolResult(envelope, extraction, { now });
  // 缓存前先过信封校验
  const validation = validateToolResult(result);
  if (!validation.ok) {
    const safeResult: ToolResultEnvelope = {
      status: "stopped_error",
      observedEntity: extraction.observedEntity,
      data: null,
      rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now()),
      capturedAt: now(),
      cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
      warnings: [{ code: "ENVELOPE_VALIDATION_FAILED", message: validation.reason }],
      errors: [{ code: "SCHEMA_INVALID", safeMessage: validation.reason }],
      nextAction: "stop",
    };
    idempotencyCache.set(cacheKey, safeResult);
    return safeResult;
  }

  if (idempotencyCache.size >= IDEMPOTENCY_CACHE_LIMIT) {
    const firstKey = idempotencyCache.keys().next().value as string | undefined;
    if (firstKey) idempotencyCache.delete(firstKey);
  }
  idempotencyCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Contract helper
// ---------------------------------------------------------------------------

export { validateToolResult };

/** 供测试断言使用的错误码集合（确保已定义全部 13 个）。 */
export const AMAZON_ADAPTER_ERROR_CODES = ERROR_CODES;
