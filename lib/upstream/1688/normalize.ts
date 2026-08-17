/**
 * V3.5 — 1688-cli 原始 JSON → AcquisitionCandidate / OfferDetail 规范化（fail-closed）
 *
 * 数据流（V3.5 Pre-Implementation Contract §14/§15）：
 *   External output → Raw Snapshot → Parse → Validate → Normalize → Entity Binding → Candidate
 *
 * 安全铁律：
 * - 敏感字段（receiveAddress / supplier.loginId / memberId / userId / 电话 / 地址）一律丢弃，
 *   绝不进入 Candidate / Detail / Evidence（Contract §25）。
 * - 卖家自报字段（attributes / packageInfo / 材质 / 尺寸 / 定制声明）→ seller_claim，≠ 事实。
 * - 平台展示元数据（verified / demand / isP4P / turnover / saledCount / years）→ platform_metadata，
 *   绝不转化为可靠性评分（Contract §24）。
 * - 价格只保留 displayedPrice / priceRange / priceTiers 语义，禁止 purchaseCost（Contract §22）。
 * - schema 不认识或必填字段缺失 → 抛错 fail-closed，禁止 silent parse（Contract §14）。
 */

import {
  ACQUISITION_CANDIDATE_SCHEMA,
  SourcingAcquisitionError,
  type AcquisitionCandidate,
  type AcquisitionMethod,
  type DisplayedMoq,
  type DisplayedPrice,
  type OfferDetail,
  type PlatformMetadataField,
  type PriceRange,
  type PriceTier,
  type SellerClaimField,
  type SkuSpec,
} from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return fallback;
}

/**
 * V3 Final R14（§4/§5）：候选商品图 URL 安全规范化（唯一 display 入口，组件不猜字段）。
 * - protocol-relative `//host/...` → `https://host/...`（仅当以 // 开头）；
 * - 仅接受 https 绝对 URL；相对路径（无 base 可证）→ null（禁止猜路径）；
 * - http / data: / javascript: / 空白 → null。
 */
export function normalizeCandidateImageUrl(raw: unknown): string | null {
  const value = asString(raw);
  if (!value) return null;
  const candidate = value.startsWith("//") ? `https:${value}` : value;
  if (!/^https:\/\/[^\s]+$/i.test(candidate)) return null;
  return candidate;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {    const parsed = Number(value.replace(/[￥¥,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePriceText(value: unknown): string {
  const text = asString(value);
  return text.replace(/\s+/g, " ").slice(0, 120);
}

/** 规范错误：任何结构不满足即抛（fail-closed） */
function fail(code: string, message: string): never {
  throw new SourcingAcquisitionError(code, 422, message);
}

/** 必填字符串字段（空值即拒绝） */
function requireString(value: unknown, fieldName: string, context: string): string {
  const text = asString(value);
  if (!text) fail("schema_unsupported", `${context} 缺少必填字段 ${fieldName}，已拒绝该记录。`);
  return text;
}

/** 必填数字字符串实体键（offerId 必须为数字字符串） */
function requireOfferId(value: unknown, context: string): string {
  const text = requireString(value, "offerId", context);
  if (!/^\d{5,20}$/.test(text)) {
    fail("schema_unsupported", `${context} offerId 非法（${text.slice(0, 40)}），已拒绝该记录。`);
  }
  return text;
}

/** 平台元数据（展示级；名称与取值均截断防超长） */
function platformField(name: string, value: unknown, maxLength = 200): PlatformMetadataField | null {
  const text = asString(value).replace(/\s+/g, " ").slice(0, maxLength);
  if (!text) return null;
  return { name, value: text, evidenceClass: "platform_metadata" };
}

/** 卖家自报字段（attributes / packageInfo 等；名称与取值均截断） */
function sellerClaim(name: string, value: unknown, maxLength = 300): SellerClaimField | null {
  const text = asString(value).replace(/\s+/g, " ").slice(0, maxLength);
  if (!text) return null;
  return { name, value: text, evidenceClass: "seller_claim" };
}

/** 从 {name,value} / {key,value} / {attrName,attrValue} 类对象提取属性名 */
function attributeName(record: Record<string, unknown>): string {
  for (const key of ["name", "attrName", "key", "title"]) {
    const text = asString(record[key]);
    if (text) return text.slice(0, 120);
  }
  return "";
}

function attributeValue(record: Record<string, unknown>): string {
  for (const key of ["value", "attrValue", "val"]) {
    if (record[key] !== undefined && record[key] !== null) {
      return asString(record[key]).slice(0, 300);
    }
  }
  return "";
}

/**
 * attributes[] / packageInfo[] → seller_claim 列表。
 * 1688 attributes 为卖家自报（含"是否有第三方检测报告"等），≠ 事实（Route B 实测）。
 */
function toSellerClaimFields(list: unknown): SellerClaimField[] {
  const claims: SellerClaimField[] = [];
  if (!Array.isArray(list)) return claims;
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = attributeName(item);
    const value = attributeValue(item);
    if (!name || !value) continue;
    claims.push({ name, value, evidenceClass: "seller_claim" });
  }
  // 有界：单条记录最多保留 40 项卖家自报
  return claims.slice(0, 40);
}

/**
 * ── Search 响应规范化 ──
 * 输入：1688-cli `search` 命令 stdout 中 `offers[]` 数组（ok:true 已由调用方校验）。
 * 输出：AcquisitionCandidate[]（关键词/URL 获取；matchState=null）。
 */
export function normalizeSearchOffers(
  offers: unknown,
  input: { method: AcquisitionMethod; query: string; capturedAt: string; sourceProductRole?: AcquisitionCandidate["sourceProductRole"] },
): AcquisitionCandidate[] {
  if (!Array.isArray(offers)) {
    fail("schema_unsupported", "search 输出缺少 offers 数组。");
  }
  if (offers.length > 100) {
    fail("schema_unsupported", "search 输出超出单次候选上限（100），已拒绝。");
  }
  const role = input.sourceProductRole ?? "candidate";
  const candidates: AcquisitionCandidate[] = [];
  for (const item of offers) {
    if (!isRecord(item)) {
      fail("schema_unsupported", "search 输出包含非对象 offer 记录，已拒绝。");
    }
    const offerId = requireOfferId(item.offerId, "search offer");
    const title = requireString(item.title, "title", `search offer ${offerId}`);
    const sourceUrl = requireString(item.url ?? item.detailUrl, "url", `search offer ${offerId}`);

    // 价格：displayedPrice 与 priceRange 分离（Contract §22）
    let displayedPrice: DisplayedPrice | null = null;
    let priceRange: PriceRange | null = null;
    if (isRecord(item.price)) {
      const text = parsePriceText(item.price.text);
      if (text) displayedPrice = { text, nature: "displayed_price" };
      const min = asNumber(item.price.min);
      const max = asNumber(item.price.max);
      if (min !== null || max !== null) {
        priceRange = { min, max, text: text || `${min ?? ""}~${max ?? ""}` };
      }
    }

    // 供应商：仅展示名；shopUrl 留作平台元数据，账号标识（loginId/memberId/userId）不存在于 search 输出
    let supplierDisplayName = "";
    let supplierShopUrl = "";
    if (isRecord(item.supplier)) {
      supplierDisplayName = asString(item.supplier.name).slice(0, 120);
      supplierShopUrl = asString(item.supplier.shopUrl).slice(0, 300);
    }

    // 平台元数据（展示级，不计分）
    const platformMetadata: PlatformMetadataField[] = [];
    const push = (name: string, value: unknown) => {
      const field = platformField(name, value);
      if (field) platformMetadata.push(field);
    };
    push("supplierYears", isRecord(item.supplier) ? item.supplier.years : null);
    push("supplierShopUrl", supplierShopUrl || null);
    if (isRecord(item.location)) {
      push("location", `${asString(item.location.province)} ${asString(item.location.city)}`.trim());
    }
    push("bizType", item.bizType);
    if (isRecord(item.verified)) {
      const verifiedKinds = Object.entries(item.verified)
        .filter(([, flag]) => flag === true)
        .map(([kind]) => kind);
      push("verified", verifiedKinds.length > 0 ? verifiedKinds.join(",") : null);
    }
    push("tags", Array.isArray(item.tags) ? item.tags.map((tag) => asString(tag)).filter(Boolean).join(",") : null);
    push("demandOrderCount", isRecord(item.demand) ? item.demand.orderCount : null);
    push("turnover", item.turnover);
    push("isP4P", typeof item.isP4P === "boolean" ? String(item.isP4P) : null);

    // image 实测为逗号分隔 URL 字符串（也可能为数组，防御两种）
    const images = Array.isArray(item.image)
      ? item.image
      : asString(item.image).split(",").map((part) => part.trim()).filter(Boolean);
    candidates.push({
      schema: ACQUISITION_CANDIDATE_SCHEMA,
      source: "1688",
      offerId,
      sourceUrl,
      capturedAt: input.capturedAt,
      acquisitionMethod: input.method,
      sourceProductRole: role,
      title,
      images: images.map((image) => normalizeCandidateImageUrl(image)).filter((v): v is string => v !== null).slice(0, 10),
      displayedPrice,
      priceRange,
      priceTiers: [],
      displayedMoq: null,
      skuSpecs: [],
      sellerClaims: [],
      platformMetadata: platformMetadata.slice(0, 20),
      supplierDisplayName,
      matchState: null,
    });
  }
  return candidates;
}

/**
 * ── Offer Detail 响应规范化 ──
 * 输入：1688-cli `offer` 命令 stdout 中 `offers[0]`（ok:true 已由调用方校验）。
 * 输出：OfferDetail。
 *
 * 丢弃清单（Contract §25，实测敏感字段）：
 * - freight.receiveAddress（用户默认收货地址 = PII）
 * - supplier.loginId / memberId / userId（卖家账号标识）
 * - 任何电话 / 地址字段
 */
export function normalizeOfferDetail(
  offer: unknown,
  input: { capturedAt: string },
): OfferDetail {
  if (!isRecord(offer)) {
    fail("schema_unsupported", "offer 输出缺少对象记录。");
  }
  const offerId = requireOfferId(offer.offerId, "offer detail");
  const title = requireString(offer.title, "title", `offer detail ${offerId}`);
  const sourceUrl = asString(offer.detailUrl ?? offer.url);
  if (!sourceUrl) fail("schema_unsupported", `offer detail ${offerId} 缺少 url。`);

  // 价格三语义分离（Route B 实测：priceRange=￥21.30 显示价 vs priceTiers[0]=16.5 阶梯价）
  let displayedPrice: DisplayedPrice | null = null;
  const rangeText = parsePriceText(offer.priceRange);
  if (rangeText) displayedPrice = { text: rangeText, nature: "displayed_price" };

  let priceRange: PriceRange | null = null;
  const priceMin = asNumber(offer.priceMin);
  const priceMax = asNumber(offer.priceMax);
  if (priceMin !== null || priceMax !== null) {
    priceRange = { min: priceMin, max: priceMax, text: rangeText || `${priceMin ?? ""}~${priceMax ?? ""}` };
  }

  const priceTiers: PriceTier[] = [];
  if (Array.isArray(offer.priceTiers)) {
    for (const tier of offer.priceTiers) {
      if (!isRecord(tier)) continue;
      const minQty = asNumber(tier.minQty);
      const price = asNumber(tier.price);
      if (minQty === null || price === null) continue;
      priceTiers.push({ minQty, price, text: `${minQty} 件起 ¥${price}` });
    }
  }
  if (priceTiers.length > 30) {
    fail("schema_unsupported", `offer detail ${offerId} 价格阶梯超出上限（30）。`);
  }

  // MOQ：displayedMOQ 语义，不做归一化/解释（Contract §23）
  let displayedMoq: DisplayedMoq | null = null;
  const moqValue = asNumber(offer.minOrderQty);
  const unitName = asString(offer.unitName);
  if (moqValue !== null) {
    displayedMoq = {
      text: unitName ? `${moqValue} ${unitName}` : String(moqValue),
      value: moqValue,
      nature: "displayed_moq",
    };
  } else if (offer.minOrderQty !== undefined) {
    const text = asString(offer.minOrderQty);
    if (text) displayedMoq = { text: text.slice(0, 60), value: null, nature: "displayed_moq" };
  }

  // SKU/规格（展示级；multiPrice 为阶梯实价，仍属展示信息）
  // 上限按真实多规格商品放宽（实测 offer 128 SKU：颜色×容量组合），仅防无限膨胀
  const skuSpecs: SkuSpec[] = [];
  if (Array.isArray(offer.skus)) {
    for (const sku of offer.skus) {
      if (!isRecord(sku)) continue;
      const skuId = asString(sku.skuId);
      if (!skuId) continue;
      skuSpecs.push({
        skuId: skuId.slice(0, 80),
        specs: asString(sku.specs).slice(0, 200),
        price: asNumber(sku.price),
        multiPrice: asNumber(sku.multiPrice),
        stock: asNumber(sku.stock),
      });
    }
  }
  if (skuSpecs.length > 500) {
    fail("schema_unsupported", `offer detail ${offerId} SKU 超出上限（500）。`);
  }

  // 卖家自报（attributes / packageInfo）——≠ 事实
  const sellerClaims: SellerClaimField[] = [
    ...toSellerClaimFields(offer.attributes),
    ...toSellerClaimFields(offer.packageInfo),
  ].slice(0, 60);

  // 供应商：仅展示名；loginId/memberId/userId 一律丢弃（敏感）
  let supplierDisplayName = "";
  if (isRecord(offer.supplier)) {
    supplierDisplayName = asString(offer.supplier.name).slice(0, 120);
  }

  // 平台元数据（展示级，不计分）
  const platformMetadata: PlatformMetadataField[] = [];
  const push = (name: string, value: unknown) => {
    const field = platformField(name, value);
    if (field) platformMetadata.push(field);
  };
  push("saledCount", offer.saledCount);
  push("categoryId", offer.categoryId);
  push("unitName", unitName || null);
  push("mixOrderQty", offer.mixOrderQty);
  // options[] 实测为 {prop, values:[{name,imageUrl}]} 结构，提取 prop → 名称列表
  if (Array.isArray(offer.options)) {
    const optionsText = offer.options
      .map((option) => {
        if (!isRecord(option)) return "";
        const names = Array.isArray(option.values)
          ? option.values.map((entry) => (isRecord(entry) ? asString(entry.name) : "")).filter(Boolean).join(",")
          : "";
        return asString(option.prop) ? `${asString(option.prop)}:${names}` : names;
      })
      .filter(Boolean)
      .join(" | ");
    push("options", optionsText || null);
  }
  push("packageInfoCount", Array.isArray(offer.packageInfo) ? String(offer.packageInfo.length) : null);

  const mainImages = [
    ...(asString(offer.mainImage) ? [asString(offer.mainImage)] : []),
    ...(Array.isArray(offer.images) ? offer.images.map((image) => asString(image)).filter(Boolean) : []),
  ].slice(0, 12);

  return {
    offerId,
    sourceUrl,
    capturedAt: input.capturedAt,
    title,
    mainImages,
    displayedPrice,
    priceRange,
    priceTiers,
    displayedMoq,
    skuSpecs,
    sellerClaims,
    platformMetadata: platformMetadata.slice(0, 20),
    supplierDisplayName,
  };
}
