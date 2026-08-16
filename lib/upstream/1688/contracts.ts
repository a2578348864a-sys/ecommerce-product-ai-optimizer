/**
 * V3.5 — 1688 Sourcing Acquisition 契约（sourcing-acquisition-contract.v1）
 *
 * 只读获取契约：业务层只接触本文件定义的类型，不接触 1688-cli / OpenCLI 原始输出、
 * CDP selector、Shadow DOM class（V3.5 Pre-Implementation Contract §26）。
 */

export const SOURCING_EVIDENCE_SCHEMA = "sourcing-evidence.v1" as const;
export const ACQUISITION_CANDIDATE_SCHEMA = "acquisition-candidate.v1" as const;

/**
 * V3 Final R13（§202/§203）：Sourcing API 唯一 canonical operation。
 * UI / route / driver 必须共用本类型，禁止散落裸字符串（keyword_search / sourcing_search 等漂移）。
 */
export const SOURCING_OPERATIONS = ["search", "image", "url", "detail", "save"] as const;
export type SourcingOperation = (typeof SOURCING_OPERATIONS)[number];

/** 获取方式 */
export type AcquisitionMethod = "keyword" | "image" | "url";

/** 候选在任务中的角色（Contract §21：sourceProductRole 必要时） */
export type SourceProductRole = "candidate" | "similar" | "unknown";

/** Evidence 分类（Contract §14，六类冻结） */
export type EvidenceClass =
  | "source_snapshot" // 抓取时刻原始快照
  | "platform_metadata" // 平台展示元数据（仅展示，不评分）
  | "seller_claim" // 卖家自报（≠ 事实）
  | "derived_deterministic" // 确定性派生
  | "human_confirmed" // 人工确认观察
  | "unknown_conflict"; // 未知/冲突

/** 价格语义（Contract §16/§22：displayedPrice/priceRange/priceTiers 分离，禁止 purchaseCost） */
export type PriceNature = "displayed_price" | "price_range" | "price_tier";

/** MOQ 语义（Contract §17/§23：displayedMOQ 优先，未知=needs_confirmation） */
export type MoqNature = "displayed_moq" | "needs_confirmation";

/** 图片匹配状态（Contract §19/§30：五态，禁止百分比） */
export type ImageMatchState = "exact_match" | "likely_similar" | "partial_match" | "different" | "unknown";

/** 展示价格（页面显示价，非采购成本） */
export type DisplayedPrice = {
  text: string;
  nature: PriceNature;
};

/** 价格区间（页面显示区间） */
export type PriceRange = {
  min: number | null;
  max: number | null;
  text: string;
};

/** 数量阶梯价 */
export type PriceTier = {
  minQty: number;
  price: number;
  text: string;
};

/** 展示 MOQ（起批量） */
export type DisplayedMoq = {
  text: string;
  value: number | null;
  nature: MoqNature;
};

/** SKU/规格（展示信息，规格文本视为卖家自报级） */
export type SkuSpec = {
  skuId: string;
  specs: string;
  price: number | null;
  multiPrice: number | null;
  stock: number | null;
};

/** 卖家自报字段（Seller Claim ≠ Confirmed Fact） */
export type SellerClaimField = {
  name: string;
  value: string;
  evidenceClass: "seller_claim";
};

/** 平台元数据（Platform Metadata ≠ Supplier Reliability） */
export type PlatformMetadataField = {
  name: string;
  value: string;
  evidenceClass: "platform_metadata";
};

/** 统一候选（Contract §13/§21：稳定身份 + 字段分类） */
export type AcquisitionCandidate = {
  schema: typeof ACQUISITION_CANDIDATE_SCHEMA;
  source: "1688";
  offerId: string;
  sourceUrl: string;
  capturedAt: string;
  acquisitionMethod: AcquisitionMethod;
  sourceProductRole: SourceProductRole;
  title: string;
  images: string[];
  displayedPrice: DisplayedPrice | null;
  priceRange: PriceRange | null;
  priceTiers: PriceTier[];
  displayedMoq: DisplayedMoq | null;
  skuSpecs: SkuSpec[];
  sellerClaims: SellerClaimField[];
  platformMetadata: PlatformMetadataField[];
  supplierDisplayName: string;
  /** 图片获取时的匹配状态；关键词/URL 获取为 null */
  matchState: ImageMatchState | null;
};

/** 详情（offer detail：主 + 次驱动统一输出） */
export type OfferDetail = {
  offerId: string;
  sourceUrl: string;
  capturedAt: string;
  title: string;
  mainImages: string[];
  displayedPrice: DisplayedPrice | null;
  priceRange: PriceRange | null;
  priceTiers: PriceTier[];
  displayedMoq: DisplayedMoq | null;
  skuSpecs: SkuSpec[];
  sellerClaims: SellerClaimField[];
  platformMetadata: PlatformMetadataField[];
  supplierDisplayName: string;
};

/** 获取运行轨迹（Contract §49；不记录 Cookie/Token） */
export type AcquisitionRunTrace = {
  source: "1688";
  method: AcquisitionMethod;
  query: string;
  timestamp: string;
  driverVersion: string;
  resolverVersion: string | null;
  success: boolean;
  failClosedReason: string | null;
};

/** 人工确认记录 */
export type HumanConfirmedEntry = {
  offerId: string;
  confirmedAt: string;
  note: string | null;
};

/** Sourcing Evidence v1（存储于 taskResultJson.sourcingEvidence，writer 所有权） */
export type SourcingEvidenceV1 = {
  schema: typeof SOURCING_EVIDENCE_SCHEMA;
  taskId: string;
  capturedAt: string;
  acquisition: {
    method: AcquisitionMethod;
    query: string;
    runTrace: AcquisitionRunTrace;
  };
  candidates: AcquisitionCandidate[];
  humanConfirmed: HumanConfirmedEntry[];
  updatedAt: string;
};

/** 只读命令 allowlist（Contract §25：业务层不可达任何写命令） */
export const READ_ONLY_COMMANDS = ["search", "offer", "whoami"] as const;
export type ReadOnlyCommand = (typeof READ_ONLY_COMMANDS)[number];

/** 写命令（存在但业务层禁止调用；仅用于 deny 校验与文档） */
export const FORBIDDEN_COMMANDS = [
  "login",
  "logout",
  "inquiry",
  "cart",
  "order",
  "checkout",
  "seller",
  "inbox",
  "shipped",
  "stuck",
  "fake-shipped",
  "seller-history",
  "image-search",
  "similar",
] as const;

export class SourcingAcquisitionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SourcingAcquisitionError";
  }
}
