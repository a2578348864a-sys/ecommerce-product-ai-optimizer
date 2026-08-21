
/**
 * V4 P3 — 1688 Offer/Variant Identity Adapter（A worktree，P3_CONTRACT D3/D4）。
 *
 * ToolCallEnvelope → ToolResultEnvelope。复用 lib/upstream/1688 contracts 类型
 * （SOURCING_OPERATIONS / EvidenceClass / SellerClaimField / PriceNature / MoqNature），
 * 复用 lib/upstream/1688/normalize 作为 live 执行层的规范化入口（import 复用，不改动）。
 *
 * 边界（P3_CONTRACT D3/D4 / 06_TOOL_CONTRACTS 1688 Supplier Tool / RESEARCH_SKILLS_SPEC supplier-research）：
 * - offer/variant identity 稳定：offerIdentity = offerId；variantKey = 规格组合的稳定指纹；
 *   错配 → WRONG_ENTITY + nextAction=stop + 不产出 evidence。
 * - 价格梯度/阶梯价不归一：displayed_price / price_range / price_tier 三语义分离保留。
 * - MOQ 语义：displayed_moq / needs_confirmation，未知不推断。
 * - 页面宣传 304 只进 SupplierClaim（claimType 标注），绝不进入 confirmed 语义。
 * - 注入安全：页面文本只进入 rawArtifact / 结构化 data 字段，绝不进入指令面。
 * - 双模式 recorded/live：live 由服务端开关 QX_V4_TOOL_LIVE 门控（默认关）；
 *   遇登录/验证码 → waiting_auth(wait_human)，绝不绕过。
 * - 幂等：同 idempotencyKey + 同 inputHash → 返回已记录结果，不重放真实副作用。
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
import {
  SOURCING_OPERATIONS,
  SourcingAcquisitionError,
  type AcquisitionCandidate,
  type AcquisitionMethod,
  type DisplayedMoq,
  type DisplayedPrice,
  type EvidenceClass,
  type ImageMatchState,
  type MoqNature,
  type OfferDetail,
  type PlatformMetadataField,
  type PriceNature,
  type PriceRange,
  type PriceTier,
  type SellerClaimField,
  type SkuSpec,
  type SourceProductRole,
} from "@/lib/upstream/1688/contracts";
import {
  normalizeOfferDetail,
  normalizeSearchOffers,
} from "@/lib/upstream/1688/normalize";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUPPLIER_ADAPTER_TOOL_NAME = "supplier_1688";
export const SUPPLIER_ADAPTER_VERSION = "1688-supplier.v1";
export const SUPPLIER_DATA_SCHEMA = "1688-supplier-research.v1";
export const SUPPLIER_RECORDED_FIXTURE_SCHEMA = "1688-recorded.v1";

/** 1688 offer 页面域名白名单（与 entityBinding.ALLOWED_1688_OFFER_HOSTS 一致）。 */
export const SUPPLIER_ALLOWED_DOMAINS = ["detail.1688.com", "m.1688.com", "www.1688.com", "1688.com"] as const;

/** 供适配器支持的 Sourcing 操作（复用 SOURCING_OPERATIONS 类型；不含写操作 save）。 */
export const SUPPLIER_OPERATIONS = SOURCING_OPERATIONS.filter((op) => op !== "save") as readonly SourcingOperation[];
export type SourcingOperation = (typeof SOURCING_OPERATIONS)[number];

/** live 模式服务端开关（与 registry.isMarketToolLiveEnabled 同源；默认关）。 */
export const SUPPLIER_LIVE_FEATURE_FLAG = "QX_V4_TOOL_LIVE";

/** 单一 SKU / 无规格变体的稳定 variantKey。 */
export const UNSPECIFIED_VARIANT_KEY = "unspecified";

/** 采集字段白名单（06_TOOL_CONTRACTS 1688 Supplier Tool：offerIdentity/URL/店铺/价格梯度/MOQ/发货地/Claim/图片/待询问题）。 */
export const SUPPLIER_FIELD_WHITELIST = [
  "offerIdentity",
  "url",
  "shop",
  "displayedPrice",
  "priceRange",
  "priceTiers",
  "moq",
  "shippingLocation",
  "sellerClaims",
  "images",
  "questions",
] as const;
export type SupplierFieldName = (typeof SUPPLIER_FIELD_WHITELIST)[number];

/** 复用 upstream/1688 contracts 的 PriceNature（价格语义：displayed_price/price_range/price_tier）。 */
export type SupplierPriceNature = PriceNature;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SupplierAdapterMode = "recorded" | "live";

export type Supplier1688Operation = "search" | "detail";

/** 发货地（页面展示，不归一）。 */
export type ShippingLocation = {
  province: string | null;
  city: string | null;
  text: string;
};

export type SupplierVariant = {
  variantKey: string;
  skuId: string;
  specs: string;
  price: number | null;
  multiPrice: number | null;
  stock: number | null;
};

export type SupplierCandidate = {
  offerIdentity: string;
  offerUrl: string;
  shopName: string | null;
  title: string;
  displayedPrice: DisplayedPrice | null;
  priceRange: PriceRange | null;
  priceTiers: PriceTier[];
  moq: DisplayedMoq | null;
  shippingLocation: ShippingLocation | null;
  images: string[];
  sellerClaims: SellerClaimField[];
  platformMetadata: PlatformMetadataField[];
  sourceProductRole: SourceProductRole;
  matchState: ImageMatchState | null;
};

export type SupplierOffer = {
  offerIdentity: string;
  offerUrl: string;
  shopName: string | null;
  title: string;
  displayedPrice: DisplayedPrice | null;
  priceRange: PriceRange | null;
  priceTiers: PriceTier[];
  moq: DisplayedMoq | null;
  shippingLocation: ShippingLocation | null;
  images: string[];
  sellerClaims: SellerClaimField[];
  platformMetadata: PlatformMetadataField[];
  skuSpecs: SkuSpec[];
  variants: SupplierVariant[];
};

/** SupplierClaim 分类（页面宣传/卖家自报 ≠ 事实；claimType 用于 Fact Gate 分组）。 */
export type SupplierClaimType =
  | "material"
  | "size"
  | "color"
  | "feature"
  | "packaging"
  | "quantity"
  | "accessory"
  | "restriction"
  | "lead_time"
  | "other";

export type SupplierClaim = {
  claimId: string;
  offerIdentity: string;
  field: string;
  value: string;
  claimType: SupplierClaimType;
  evidenceClass: "seller_claim";
  variantKey: string | null;
  sourceRef: string;
};

export type SupplierQuestion = {
  questionId: string;
  field: string;
  reason:
    | "moq_unknown"
    | "material_grade_unconfirmed"
    | "claim_needs_confirmation"
    | "price_tier_conflict"
    | "shipping_unknown"
    | "custom";
  text: string;
  variantKey: string | null;
};

export type EvidenceRef = {
  evidenceId: string;
  offerIdentity: string | null;
  kind: EvidenceClass;
  sourceType: "1688";
  sourceUrl: string | null;
  sourceLocator: string | null;
  contentHash: string;
  capturedAt: string;
};

/** adapter 的“已观测页面”输入（recorded fixture 或 live 归一化后）。 */
export type Supplier1688Extraction = {
  operation: Supplier1688Operation;
  /** search: 关键词；detail: offerId。 */
  observedEntity: string;
  context: {
    host: string;
    pageUrl: string;
    /** ok | login_wall | captcha | unknown_page | error_page | loading | dom_changed */
    pageStatus: string;
    /** 人工在 Preview 选定的 variant（来自上一阶段），用于 detail 错配校验。 */
    selectedVariantKey?: string | null;
    shippingLocation?: ShippingLocation | null;
    capturedAt: string;
  };
  /** search 结果（复用 upstream AcquisitionCandidate 类型）。 */
  candidates: AcquisitionCandidate[];
  /** detail 结果（复用 upstream OfferDetail 类型）。 */
  detail: OfferDetail | null;
  rawCardCount: number;
  /** 脱敏页面样本（仅作为 rawArtifact 内容，绝不进入指令/计划）。 */
  rawArtifactSample: string | null;
  cost: { usedBrowserSteps: number; usedCost: number; currency: string };
};

/** recorded fixture 文件结构（脱敏）。 */
export type Supplier1688RecordedFixture = {
  schemaVersion: typeof SUPPLIER_RECORDED_FIXTURE_SCHEMA;
  match: { inputHash?: string; offerId?: string; keyword?: string; operation?: Supplier1688Operation };
  extraction: Supplier1688Extraction;
};

export type Supplier1688AdapterOptions = {
  mode?: SupplierAdapterMode;
  fixturesDir?: string;
  liveEnabled?: boolean;
  liveExecutor?: Supplier1688LiveExecutor;
  now?: () => string;
};

/** live 执行器：一次“获取 + 归一化”，产出 Supplier1688Extraction。 */
export type Supplier1688LiveExecutor = {
  run(envelope: ToolCallEnvelope): Promise<Supplier1688Extraction>;
};

export type SupplierResearchData = {
  schemaVersion: string;
  operation: Supplier1688Operation;
  offerIdentity: string | null;
  url: string | null;
  shop: string | null;
  supplierCandidates: SupplierCandidate[];
  selectedOffer: SupplierOffer | null;
  supplierClaims: SupplierClaim[];
  priceTiers: PriceTier[];
  moq: DisplayedMoq | null;
  moqNature: MoqNature;
  shippingLocation: ShippingLocation | null;
  images: string[];
  leadTimeClaims: SupplierClaim[];
  questions: SupplierQuestion[];
  evidenceRefs: EvidenceRef[];
};

export type SupplierEntityError = { code: "WRONG_ENTITY"; reason: string };

export type SupplierPageStatusError = {
  code: ResearchRunErrorCode;
  status: ToolStatus;
  nextAction: ToolResultEnvelope["nextAction"];
  reason: string;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function normalizedAllowedDomains(envelope: ToolCallEnvelope): Set<string> {
  const raw = envelope.allowedDomains && envelope.allowedDomains.length > 0
    ? envelope.allowedDomains
    : [...SUPPLIER_ALLOWED_DOMAINS];
  return new Set(raw.map((domain) => domain.toLowerCase().replace(/^www\./, "")));
}

function isAllowedHost(host: string, allowed: Set<string>): boolean {
  const bare = host.toLowerCase().replace(/^www\./, "");
  return allowed.has(bare);
}

/**
 * 解析 targetEntity：详情 = offerId（可附 variantKey），搜索 = 关键词。
 * 支持 "offerId" 或 "offerId#sk-<hash>" 两种形式；其余视为关键词。
 */
export function parseTargetEntity(targetEntity: string): {
  offerId: string | null;
  variantKey: string | null;
  keyword: string | null;
} {
  const trimmed = (targetEntity ?? "").trim();
  const variantMatch = /^(\d{5,20})#(sk-[0-9a-f]{16})$/i.exec(trimmed);
  if (variantMatch) return { offerId: variantMatch[1], variantKey: variantMatch[2], keyword: null };
  if (/^\d{5,20}$/.test(trimmed)) return { offerId: trimmed, variantKey: null, keyword: null };
  return { offerId: null, variantKey: null, keyword: trimmed };
}

/**
 * variantKey 稳定指纹（规格组合）：把 specs 归一化（&gt; → >），按维度分隔，
 * 去空后排序拼接再哈希。排序保证同一组合（如 颜色>容量 与 容量>颜色）同 key。
 */
export function deriveVariantKey(specs: string | null | undefined): string {
  if (specs == null) return UNSPECIFIED_VARIANT_KEY;
  const normalized = String(specs).replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  const parts = normalized
    .split(/[>|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return UNSPECIFIED_VARIANT_KEY;
  const canonical = [...parts].sort().join(">");
  return "sk-" + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function buildVariants(detail: OfferDetail | null): SupplierVariant[] {
  if (!detail) return [];
  if (!detail.skuSpecs || detail.skuSpecs.length === 0) {
    return [{ variantKey: UNSPECIFIED_VARIANT_KEY, skuId: "unspecified", specs: "", price: null, multiPrice: null, stock: null }];
  }
  return detail.skuSpecs.map((sku) => ({
    variantKey: deriveVariantKey(sku.specs),
    skuId: sku.skuId,
    specs: sku.specs,
    price: sku.price,
    multiPrice: sku.multiPrice,
    stock: sku.stock,
  }));
}

function extractShippingLocation(metadata: PlatformMetadataField[]): ShippingLocation | null {
  const locationField = metadata.find((field) => field.name === "location");
  if (!locationField) return null;
  const text = locationField.value.trim();
  if (!text) return null;
  const parts = text.split(/\s+/).filter(Boolean);
  return { province: parts[0] ?? null, city: parts[1] ?? null, text };
}

/** 把 upstream AcquisitionCandidate → 适配器 SupplierCandidate（复用 contracts 类型）。 */
export function toSupplierCandidate(
  candidate: AcquisitionCandidate,
  context: Supplier1688Extraction["context"],
): SupplierCandidate {
  return {
    offerIdentity: candidate.offerId,
    offerUrl: candidate.sourceUrl,
    shopName: candidate.supplierDisplayName || null,
    title: candidate.title,
    displayedPrice: candidate.displayedPrice,
    priceRange: candidate.priceRange,
    priceTiers: candidate.priceTiers,
    moq: candidate.displayedMoq,
    shippingLocation: extractShippingLocation(candidate.platformMetadata) ?? context.shippingLocation ?? null,
    images: candidate.images,
    sellerClaims: candidate.sellerClaims,
    platformMetadata: candidate.platformMetadata,
    sourceProductRole: candidate.sourceProductRole,
    matchState: candidate.matchState,
  };
}

/** 把 upstream OfferDetail → 适配器 SupplierOffer（复用 contracts 类型）。 */
export function toSupplierOffer(
  detail: OfferDetail,
  context: Supplier1688Extraction["context"],
): SupplierOffer {
  return {
    offerIdentity: detail.offerId,
    offerUrl: detail.sourceUrl,
    shopName: detail.supplierDisplayName || null,
    title: detail.title,
    displayedPrice: detail.displayedPrice,
    priceRange: detail.priceRange,
    priceTiers: detail.priceTiers,
    moq: detail.displayedMoq,
    shippingLocation: context.shippingLocation ?? null,
    images: detail.mainImages,
    sellerClaims: detail.sellerClaims,
    platformMetadata: detail.platformMetadata,
    skuSpecs: detail.skuSpecs,
    variants: buildVariants(detail),
  };
}

// ---------------------------------------------------------------------------
// Normalize reuse (import from upstream/1688/normalize — never modified)
// ---------------------------------------------------------------------------

/**
 * 把 1688-cli search 原始输出（offers[]）经 upstream normalize 规范化为适配器 extraction。
 * 供 Lead 的 live 获取层复用；fail-closed（结构不满足即抛 SourcingAcquisitionError）。
 */
export function normalizeSearchToExtraction(
  offers: unknown,
  input: {
    method: AcquisitionMethod;
    query: string;
    capturedAt: string;
    host: string;
    pageUrl: string;
    pageStatus: string;
  },
): Supplier1688Extraction {
  const candidates = normalizeSearchOffers(offers, { method: input.method, query: input.query, capturedAt: input.capturedAt });
  return {
    operation: "search",
    observedEntity: input.query,
    context: { host: input.host, pageUrl: input.pageUrl, pageStatus: input.pageStatus, capturedAt: input.capturedAt },
    candidates,
    detail: null,
    rawCardCount: candidates.length,
    rawArtifactSample: null,
    cost: { usedBrowserSteps: 1, usedCost: 0.05, currency: "USD" },
  };
}

/**
 * 把 1688-cli offer 原始输出（单个对象）经 upstream normalize 规范化为适配器 extraction。
 * 供 Lead 的 live 获取层复用；fail-closed（结构不满足即抛 SourcingAcquisitionError）。
 */
export function normalizeDetailToExtraction(
  offer: unknown,
  input: {
    capturedAt: string;
    host: string;
    pageUrl: string;
    pageStatus: string;
    selectedVariantKey?: string | null;
    shippingLocation?: ShippingLocation | null;
  },
): Supplier1688Extraction {
  const detail = normalizeOfferDetail(offer, { capturedAt: input.capturedAt });
  return {
    operation: "detail",
    observedEntity: detail.offerId,
    context: {
      host: input.host,
      pageUrl: input.pageUrl,
      pageStatus: input.pageStatus,
      selectedVariantKey: input.selectedVariantKey ?? null,
      shippingLocation: input.shippingLocation ?? null,
      capturedAt: input.capturedAt,
    },
    candidates: [],
    detail,
    rawCardCount: 1,
    rawArtifactSample: null,
    cost: { usedBrowserSteps: 1, usedCost: 0.05, currency: "USD" },
  };
}

/** 根据 claim 名称/取值判定 claimType（用于 Fact Gate 分组 + 304 宣传标注）。 */
export function classifyClaimType(name: string, value: string): SupplierClaimType {
  const n = name.toLowerCase();
  const v = value.toLowerCase();
  if (/材质|内胆|外壳|主体|不锈钢|susc|304|316|201|#201|#304|#316/.test(n) || /材质|不锈钢|304|316|201/.test(v)) return "material";
  if (/尺寸|容量|规格|长宽高|大小|体积/.test(n)) return "size";
  if (/颜色|色彩|色号/.test(n)) return "color";
  if (/功能|特性|特点|工艺|保温|便携|防摔/.test(n)) return "feature";
  if (/包装|外箱|装箱/.test(n)) return "packaging";
  if (/数量|件数|套装|组合/.test(n)) return "quantity";
  if (/配件|赠品|附件/.test(n)) return "accessory";
  if (/定制|加印|logo|加工|是否|限制|检测报告|认证/.test(n)) return "restriction";
  if (/交期|货期|发货时间|生产周期|交付/.test(n)) return "lead_time";
  return "other";
}

const MATERIAL_GRADE_PATTERN = /(?:SUS|s)304|(?:SUS|s)316|(?:SUS|s)201|304不锈钢|316不锈钢|201不锈钢|304|316|201/g;

/**
 * 页面宣传材质等级（如 304/316）只进 SupplierClaim，绝不进入 confirmed 语义。
 * 从 sellerClaims + title 提取材质等级相关声明，全部标注 claimType="material"。
 */
export function buildClaims(detail: OfferDetail, variants: SupplierVariant[]): SupplierClaim[] {
  const claims: SupplierClaim[] = [];
  const sourceRef = detail.sourceUrl;
  const offerIdentity = detail.offerId;

  for (const claim of detail.sellerClaims) {
    claims.push({
      claimId: "claim-" + stableId(offerIdentity + "|" + claim.name + "|" + claim.value),
      offerIdentity,
      field: claim.name,
      value: claim.value,
      claimType: classifyClaimType(claim.name, claim.value),
      evidenceClass: "seller_claim",
      variantKey: null,
      sourceRef,
    });
  }

  // 页面宣传标题含材质等级 → 作为 SupplierClaim（不确认）。
  const titleGrade = detail.title.match(MATERIAL_GRADE_PATTERN)?.[0] ?? null;
  if (titleGrade) {
    claims.push({
      claimId: "claim-" + stableId(offerIdentity + "|title_material_grade|" + titleGrade),
      offerIdentity,
      field: "title_material_grade",
      value: titleGrade,
      claimType: "material",
      evidenceClass: "seller_claim",
      variantKey: null,
      sourceRef,
    });
  }

  // 有界：最多保留 60 条 claim。
  return claims.slice(0, 60);
}

/**
 * 待询问题：从未知/需确认项推导（MOQ、材质等级、claim 需人工确认、价格梯度、发货地）。
 * 这些是“待人工确认/向供应商询问”的问题，不是已确认事实。
 */
export function buildQuestions(
  detail: OfferDetail | null,
  claims: SupplierClaim[],
  variants: SupplierVariant[],
  context: Supplier1688Extraction["context"],
): SupplierQuestion[] {
  const questions: SupplierQuestion[] = [];
  if (!detail) return questions;

  const moq = detail.displayedMoq;
  if (moq == null || moq.nature === "needs_confirmation" || moq.value == null) {
    questions.push({
      questionId: "q-" + stableId(detail.offerId + "|moq"),
      field: "moq",
      reason: "moq_unknown",
      text: "页面未明确展示最低起订量（MOQ）或需确认，请向供应商确认起批量与计价单位。",
      variantKey: null,
    });
  }

  const hasMaterialGrade = claims.some(
    (claim) => claim.claimType === "material" && /304|316|201|不锈钢/.test(claim.value),
  );
  if (hasMaterialGrade) {
    questions.push({
      questionId: "q-" + stableId(detail.offerId + "|material_grade"),
      field: "材质等级",
      reason: "material_grade_unconfirmed",
      text: "页面标注 304/316/201 等材质等级，属卖家自报；请向供应商确认并提供材质证明/检测报告。",
      variantKey: null,
    });
  }

  const materialClaims = claims.filter((claim) => claim.claimType === "material" || claim.claimType === "feature");
  if (materialClaims.length > 0) {
    questions.push({
      questionId: "q-" + stableId(detail.offerId + "|claim_confirm"),
      field: "材质/功能",
      reason: "claim_needs_confirmation",
      text: "页面声明（材质/功能）为卖家自报，需人工确认（样品/规格书/检测报告）后才能成为自有产品事实。",
      variantKey: null,
    });
  }

  const tier = tierPriceOf(detail);
  const displayed = displayedNumber(detail.displayedPrice);
  const rangeMin = detail.priceRange?.min ?? null;
  const hasTierGap = detail.priceTiers.length > 0
    && ((displayed != null && tier != null && Math.abs(tier - displayed) > 1e-9)
      || (rangeMin != null && tier != null && Math.abs(rangeMin - tier) > 1e-9));
  if (hasTierGap) {
    questions.push({
      questionId: "q-" + stableId(detail.offerId + "|price_tier"),
      field: "价格",
      reason: "price_tier_conflict",
      text: "页面显示价与数量阶梯价不一致，请确认具体变体适用的采购价（不自动归一为单价）。",
      variantKey: null,
    });
  }

  const shipping = context.shippingLocation;
  if (!shipping || !shipping.text) {
    questions.push({
      questionId: "q-" + stableId(detail.offerId + "|shipping"),
      field: "发货地",
      reason: "shipping_unknown",
      text: "发货地未确认，请向供应商确认发货地址与物流方式。",
      variantKey: null,
    });
  }

  return questions.slice(0, 20);
}

function displayedNumber(price: DisplayedPrice | null): number | null {
  if (!price) return null;
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(price.text.replace(/[￥¥,\s]/g, ""));
  return match ? Number(match[1]) : null;
}

function tierPriceOf(detail: OfferDetail): number | null {
  return detail.priceTiers.length > 0 ? detail.priceTiers[0].price : null;
}

export function buildEvidenceRefs(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
  claims: SupplierClaim[],
  now: string,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const sourceUrl = extraction.detail?.sourceUrl ?? extraction.candidates[0]?.sourceUrl ?? null;
  const sourceSnapshotHash = createHash("sha256")
    .update(extraction.rawArtifactSample ?? JSON.stringify(extraction.candidates))
    .digest("hex");
  refs.push({
    evidenceId: "ev-" + sourceSnapshotHash.slice(0, 16),
    offerIdentity: extraction.detail?.offerId ?? extraction.candidates[0]?.offerId ?? null,
    kind: "source_snapshot",
    sourceType: "1688",
    sourceUrl,
    sourceLocator: "capture",
    contentHash: sourceSnapshotHash,
    capturedAt: now,
  });
  for (const claim of claims) {
    const hash = createHash("sha256")
      .update(claim.offerIdentity + "|" + claim.field + "|" + claim.value + "|" + claim.claimType)
      .digest("hex");
    refs.push({
      evidenceId: "ev-" + hash.slice(0, 16),
      offerIdentity: claim.offerIdentity,
      kind: "seller_claim",
      sourceType: "1688",
      sourceUrl,
      sourceLocator: claim.sourceRef,
      contentHash: hash,
      capturedAt: now,
    });
  }
  return refs.slice(0, 61);
}

function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateEntity(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
): SupplierEntityError | null {
  const allowed = normalizedAllowedDomains(envelope);
  const host = extraction.context.host?.toLowerCase();
  const hostOk = !!host && isAllowedHost(host, allowed);
  if (!hostOk) {
    return { code: "WRONG_ENTITY", reason: "host_not_allowed:" + (host ?? "unknown") };
  }

  const target = parseTargetEntity(envelope.targetEntity);

  if (extraction.operation === "detail") {
    if (!target.offerId) {
      return { code: "WRONG_ENTITY", reason: "target_must_be_offerId:" + envelope.targetEntity };
    }
    const observed = extraction.detail?.offerId;
    if (!observed || observed !== target.offerId) {
      return { code: "WRONG_ENTITY", reason: "offerId_mismatch:expected_" + target.offerId + ",observed_" + (observed ?? "unknown") };
    }
    const variants = buildVariants(extraction.detail);
    const expectedVariantKey = target.variantKey ?? extraction.context.selectedVariantKey ?? null;
    if (expectedVariantKey && expectedVariantKey !== UNSPECIFIED_VARIANT_KEY) {
      const matched = variants.some((variant) => variant.variantKey === expectedVariantKey);
      if (!matched) {
        return { code: "WRONG_ENTITY", reason: "variant_mismatch:expected_" + expectedVariantKey };
      }
    }
    return null;
  }

  if (extraction.operation !== "search") {
    return { code: "WRONG_ENTITY", reason: "operation_mismatch:expected_search_or_detail,got_" + extraction.operation };
  }
  const observedQuery = extraction.observedEntity?.toLowerCase() ?? "";
  const expectedKeyword = (target.keyword ?? envelope.targetEntity).toLowerCase();
  if (!observedQuery || (observedQuery !== expectedKeyword && !observedQuery.includes(expectedKeyword))) {
    return { code: "WRONG_ENTITY", reason: "keyword_mismatch:expected_" + expectedKeyword + ",observed_" + (observedQuery ?? "unknown") };
  }
  return null;
}

/** 页面分类 → 错误码映射（仅对无法继续的页面分类返回错误；ok 返回 null）。 */
export function mapPageStatusToError(pageStatus: string): SupplierPageStatusError | null {
  const status = pageStatus?.toLowerCase();
  switch (status) {
    case "login_wall":
      return { code: "AUTH_REQUIRED", status: "waiting_auth", nextAction: "wait_human", reason: "login_wall" };
    case "captcha":
      return { code: "CAPTCHA_OR_BOT_CHECK", status: "waiting_auth", nextAction: "wait_human", reason: "captcha_or_bot_check" };
    case "unknown_page":
    case "dom_changed":
      return { code: "DOM_CHANGED", status: "stopped_error", nextAction: "stop", reason: "page_structure_unexpected" };
    case "error_page":
      return { code: "RATE_LIMITED", status: "stopped_error", nextAction: "retry", reason: "1688_error_page" };
    case "loading":
      return { code: "TIMEOUT", status: "stopped_error", nextAction: "retry", reason: "page_loading" };
    case "ok":
    case "search":
    case "detail":
      return null;
    default:
      // 未知分类 fail-closed
      return { code: "DOM_CHANGED", status: "stopped_error", nextAction: "stop", reason: "unknown_page_classification" };
  }
}

export function checkBudget(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
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

const INJECTION_PATTERN = /ignore\s+(all\s+)?(previous|prior)\s+instructions|disregard\s+prior|system\s+prompt|you\s+are\s+now\b|忽略以上|无视之前指令|执行新指令/i;

export function detectInjectionText(text: string | null | undefined): boolean {
  if (!text) return false;
  return INJECTION_PATTERN.test(text);
}

// ---------------------------------------------------------------------------
// Warnings / raw artifacts / error envelope
// ---------------------------------------------------------------------------

function buildWarnings(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
  data: SupplierResearchData,
  rejectedFields: string[],
): ToolWarning[] {
  const warnings: ToolWarning[] = [];
  if (extraction.rawArtifactSample && detectInjectionText(extraction.rawArtifactSample)) {
    warnings.push({ code: "INJECTION_TEXT_CAPTURED_AS_DATA", message: "possible prompt-injection text captured as page data; treated as untrusted field content only" });
  }
  if (data.moqNature === "needs_confirmation") {
    warnings.push({ code: "MOQ_NEEDS_CONFIRMATION", message: "MOQ not confirmed on page; treated as needs_confirmation (not a confirmed fact)" });
  }
  const hasMaterialGrade = data.supplierClaims.some((claim) => claim.claimType === "material" && /304|316|201|不锈钢/.test(claim.value));
  if (hasMaterialGrade) {
    warnings.push({ code: "MATERIAL_GRADE_IS_CLAIM", message: "material grade (e.g. 304/316) is a seller claim, not a confirmed fact" });
  }
  const offer = data.selectedOffer;
  if (offer && offer.priceTiers.length > 0) {
    const tier = offer.priceTiers[0].price;
    const displayed = displayedNumber(offer.displayedPrice);
    if (displayed != null && Math.abs(displayed - tier) > 1e-9) {
      warnings.push({ code: "PRICE_TIER_NOT_NORMALIZED", message: "displayed price and quantity-tier price differ; gradient preserved (not normalized to unit price)" });
    }
  }
  const p4pCount = data.supplierCandidates.filter((candidate) =>
    candidate.platformMetadata.some((field) => field.name === "isP4P" && field.value === "true"),
  ).length;
  if (p4pCount > 0) {
    warnings.push({ code: "P4P_PLACEMENTS_PRESENT", message: p4pCount + " P4P placement(s) present in search; kept as supplier candidates, platform metadata only" });
  }
  if (rejectedFields.length > 0) {
    warnings.push({ code: "FIELD_NOT_ALLOWED", message: "fields rejected (not in whitelist): " + rejectedFields.join(", ") });
  }
  return warnings;
}

function sanitizeRefSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
}

function buildRawArtifactRefs(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
  now: string,
): RawArtifactRef[] {
  const refs: RawArtifactRef[] = [];
  const contentHash = createHash("sha256")
    .update(extraction.rawArtifactSample ?? JSON.stringify(extraction.candidates ?? extraction.detail ?? {}))
    .digest("hex");
  const observedEntity = extraction.observedEntity ? "-" + sanitizeRefSegment(extraction.observedEntity) : "";
  const ref = "v4/1688/" + extraction.operation + observedEntity + "-" + contentHash.slice(0, 16);
  refs.push({ kind: extraction.operation === "detail" ? "page_snapshot" : "recorded", ref, capturedAt: now });
  if (extraction.rawArtifactSample) {
    refs.push({ kind: "page_snapshot", ref: ref + ".snapshot", capturedAt: now });
  }
  return refs;
}

function buildErrorEnvelope(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
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
    warnings: buildWarnings(envelope, extraction, emptyData(), []),
    errors: [{ code: error.code, safeMessage: error.reason }],
    nextAction: error.nextAction,
  };
}

function emptyData(): SupplierResearchData {
  return {
    schemaVersion: SUPPLIER_DATA_SCHEMA,
    operation: "search",
    offerIdentity: null,
    url: null,
    shop: null,
    supplierCandidates: [],
    selectedOffer: null,
    supplierClaims: [],
    priceTiers: [],
    moq: null,
    moqNature: "needs_confirmation",
    shippingLocation: null,
    images: [],
    leadTimeClaims: [],
    questions: [],
    evidenceRefs: [],
  };
}

// ---------------------------------------------------------------------------
// Core: buildSupplierResearchData
// ---------------------------------------------------------------------------

export function buildSupplierResearchData(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
  now: string,
): SupplierResearchData {
  const data = emptyData();
  data.operation = extraction.operation;
  data.offerIdentity = extraction.detail?.offerId ?? null;
  data.url = extraction.detail?.sourceUrl ?? null;
  data.shop = extraction.detail?.supplierDisplayName ?? null;
  data.supplierCandidates = extraction.candidates.map((candidate) => toSupplierCandidate(candidate, extraction.context));

  if (extraction.detail) {
    const offer = toSupplierOffer(extraction.detail, extraction.context);
    data.selectedOffer = offer;
    data.offerIdentity = offer.offerIdentity;
    data.url = offer.offerUrl;
    data.shop = offer.shopName;
    data.priceTiers = offer.priceTiers;
    data.moq = offer.moq;
    data.moqNature = offer.moq?.nature ?? "needs_confirmation";
    data.shippingLocation = offer.shippingLocation;
    data.images = offer.images;
    data.supplierClaims = buildClaims(extraction.detail, offer.variants);
    data.leadTimeClaims = data.supplierClaims.filter((claim) => claim.claimType === "lead_time");
    data.questions = buildQuestions(extraction.detail, data.supplierClaims, offer.variants, extraction.context);
    data.evidenceRefs = buildEvidenceRefs(envelope, extraction, data.supplierClaims, now);
  }

  return data;
}

/** 纯核心：把“已观测页面”(Supplier1688Extraction) 转换为 ToolResultEnvelope。 */
export function buildToolResult(
  envelope: ToolCallEnvelope,
  extraction: Supplier1688Extraction,
  options: { now?: () => string } = {},
): ToolResultEnvelope {
  const now = options.now ?? (() => new Date().toISOString());

  // 1. 页面分类 → 错误码（登录/验证码/结构异常优先：此时实体无法证明，不做 WRONG_ENTITY 判定）
  const pageError = mapPageStatusToError(extraction.context.pageStatus);
  if (pageError) {
    return buildErrorEnvelope(envelope, extraction, pageError, now());
  }

  // 2. 实体校验（host / offerId 或关键词 / variant）
  const entityError = validateEntity(envelope, extraction);
  if (entityError) {
    return buildErrorEnvelope(
      envelope, extraction,
      { code: "WRONG_ENTITY", status: "stopped_error", nextAction: "stop", reason: entityError.reason },
      now(),
    );
  }

  // 3. no_results
  if (extraction.operation === "search" && extraction.candidates.length === 0) {
    return {
      status: "no_results",
      observedEntity: extraction.observedEntity,
      data: null,
      rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now()),
      capturedAt: now(),
      cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
      warnings: [{ code: "NO_RESULTS", message: "no supplier candidates found" }],
      errors: [],
      nextAction: "revise_plan",
    };
  }
  if (extraction.operation === "detail" && !extraction.detail) {
    return {
      status: "no_results",
      observedEntity: extraction.observedEntity,
      data: null,
      rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now()),
      capturedAt: now(),
      cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
      warnings: [{ code: "NO_RESULTS", message: "detail not bound" }],
      errors: [],
      nextAction: "revise_plan",
    };
  }

  // 4. 预算校验
  const budgetError = checkBudget(envelope, extraction);
  if (budgetError) {
    return buildErrorEnvelope(
      envelope, extraction,
      { code: "BUDGET_EXCEEDED", status: "budget_exceeded", nextAction: "wait_human", reason: budgetError.reason },
      now(),
    );
  }

  // 5. 组装 data
  const data = buildSupplierResearchData(envelope, extraction, now());
  const rejectedFields = resolveRequestedFields(envelope).rejected;
  const result: ToolResultEnvelope = {
    status: "ok",
    observedEntity: extraction.observedEntity,
    data,
    rawArtifactRefs: buildRawArtifactRefs(envelope, extraction, now()),
    capturedAt: now(),
    cost: { usedCost: extraction.cost.usedCost, currency: extraction.cost.currency, usedBrowserSteps: extraction.cost.usedBrowserSteps },
    warnings: buildWarnings(envelope, extraction, data, rejectedFields),
    errors: [],
    nextAction: "continue",
  };
  return result;
}

// ---------------------------------------------------------------------------
// Field whitelist
// ---------------------------------------------------------------------------

export function resolveRequestedFields(envelope: ToolCallEnvelope): {
  allowed: Set<SupplierFieldName>;
  rejected: string[];
  empty: boolean;
} {
  const raw = envelope.requestedFields && envelope.requestedFields.length > 0
    ? envelope.requestedFields
    : [...SUPPLIER_FIELD_WHITELIST];
  const rejected: string[] = [];
  const allowed = new Set<SupplierFieldName>();
  for (const field of raw) {
    if ((SUPPLIER_FIELD_WHITELIST as readonly string[]).includes(field)) {
      allowed.add(field as SupplierFieldName);
    } else {
      rejected.push(field);
    }
  }
  return { allowed, rejected, empty: raw.length === 0 };
}

// ---------------------------------------------------------------------------
// Recorded mode: fixture loading
// ---------------------------------------------------------------------------

export function defaultFixturesDir(): string {
  return "lib/v4/adapters/fixtures/1688-recorded";
}

export function fixtureFileNameCandidates(envelope: ToolCallEnvelope): string[] {
  const candidates: string[] = [];
  if (envelope.inputHash) candidates.push(envelope.inputHash + ".json");
  const target = parseTargetEntity(envelope.targetEntity);
  if (target.offerId) candidates.push(target.offerId + ".json");
  const slug = sanitizeRefSegment(target.keyword ?? "");
  if (slug) candidates.push(slug + ".json");
  return candidates;
}

export async function loadRecordedExtraction(
  envelope: ToolCallEnvelope,
  fixturesDir?: string,
): Promise<Supplier1688RecordedFixture | null> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const baseDir = fixturesDir ?? defaultFixturesDir();
  const candidates = fixtureFileNameCandidates(envelope);
  for (const name of candidates) {
    const filePath = join(baseDir, name);
    try {
      const raw = await readFile(filePath, "utf8");
      const fixture = JSON.parse(raw) as Supplier1688RecordedFixture;
      if (fixture && fixture.schemaVersion === SUPPLIER_RECORDED_FIXTURE_SCHEMA && fixture.extraction) {
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

export function is1688LiveEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;
  const raw = process.env[SUPPLIER_LIVE_FEATURE_FLAG];
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const SUPPLIER_LIVE_DISABLED = "SUPPLIER_LIVE_DISABLED";

// ---------------------------------------------------------------------------
// Live executor (reuse upstream/1688 normalize — import only, never modified)
// ---------------------------------------------------------------------------

/**
 * 默认 live 执行器：复用 lib/upstream/1688/normalize 做 fail-closed 规范化。
 * 真实的 1688 搜索/详情获取由 Lead 在真实浏览器/登录态下提供（不在本适配器单测范围，
 * 也不允许在测试中触发真实 1688 抓取）。本默认执行器在没有注入 raw 数据源时 fail-closed。
 *
 * 说明：此路径需要真实浏览器/登录态 + 单次访问授权；遇登录/验证码 → waiting_auth，绝不绕过。
 */
export const default1688LiveExecutor: Supplier1688LiveExecutor = {
  async run(envelope): Promise<Supplier1688Extraction> {
    // 真实获取层（1688-cli / 扩展驱动）未在本适配器内接线；需要注入 raw 数据源。
    throw new SourcingAcquisitionError("live_driver_not_configured", 422, "1688 live 获取驱动未配置；recorded 模式可用，live 需 Lead 注入执行器。");
  },
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** 进程内幂等缓存：同 idempotencyKey + inputHash → 返回已记录结果，不重放真实副作用。 */
const idempotencyCache = new Map<string, ToolResultEnvelope>();
const IDEMPOTENCY_CACHE_LIMIT = 200;

function idempotencyKeyOf(envelope: ToolCallEnvelope): string {
  return envelope.idempotencyKey + "|" + envelope.inputHash;
}

export function __resetSupplierAdapterCacheForTest(): void {
  idempotencyCache.clear();
}

/**
 * 主入口：ToolCallEnvelope → ToolResultEnvelope。
 * - recorded：从 fixture 确定性回放（按 inputHash / offerId / keyword 匹配，缺失 → no_results）。
 * - live：服务端开关 QX_V4_TOOL_LIVE 控制（默认关）；开 + 注入执行器 → 复用 upstream/1688 normalize。
 */
export async function run1688Adapter(
  envelope: ToolCallEnvelope,
  options: Supplier1688AdapterOptions = {},
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
  const liveEnabled = is1688LiveEnabled(options.liveEnabled);
  if (!liveEnabled) {
    const result: ToolResultEnvelope = {
      status: "stopped_error",
      observedEntity: envelope.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt: now(),
      cost: { usedCost: 0, currency: envelope.budget?.currency ?? "USD", usedBrowserSteps: 0 },
      warnings: [{ code: "LIVE_DISABLED", message: "live mode disabled by server switch (default off)" }],
      errors: [{ code: "PERMISSION_DENIED", safeMessage: SUPPLIER_LIVE_DISABLED }],
      nextAction: "stop",
    };
    idempotencyCache.set(cacheKey, result);
    return result;
  }

  const executor = options.liveExecutor ?? default1688LiveExecutor;
  let extraction: Supplier1688Extraction;
  try {
    extraction = await executor.run(envelope);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAuth = /auth|login|sign in/i.test(message);
    const isBot = /captcha|robot|bot|风险控制|滑块/i.test(message);
    const code: ResearchRunErrorCode = isAuth ? "AUTH_REQUIRED" : isBot ? "CAPTCHA_OR_BOT_CHECK" : "UNKNOWN_RECOVERABLE";
    const result: ToolResultEnvelope = {
      status: isAuth || isBot ? "waiting_auth" : "stopped_error",
      observedEntity: envelope.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt: now(),
      cost: { usedCost: 0, currency: envelope.budget?.currency ?? "USD", usedBrowserSteps: 0 },
      warnings: [{ code: "LIVE_EXECUTOR_ERROR", message: "live executor failed: " + message.slice(0, 200) }],
      errors: [{ code, safeMessage: message.slice(0, 200) }],
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
export const SUPPLIER_ADAPTER_ERROR_CODES = ERROR_CODES;
