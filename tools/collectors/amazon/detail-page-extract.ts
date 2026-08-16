/**
 * V3.1 Spike — Amazon 商品详情页（/dp/ASIN）确定性提取器
 *
 * 铁律：页面上看得到 ≠ 可保存为结构化 Evidence。
 * 只有能证明 field → current entity（URL ASIN 与页面 ASIN 锚点双一致）
 * 才允许认定有效；证明不了 → null/unknown + reason，不猜、不跨商品补值。
 *
 * 只提取 6 个白名单字段：ASIN / title / price / BSR / rating / review count。
 * 不使用 LLM 猜字段；页面结构变化 → fail-closed。
 */

export type AmazonDetailPageStatus = "ok" | "captcha" | "login_wall" | "error_page" | "unknown_page";

export type AmazonDetailFieldStatus = "correct" | "unknown";

export type AmazonDetailFieldValue = {
  field: "asin" | "title" | "price" | "bsr" | "rating" | "reviews";
  value: string | number | null;
  status: AmazonDetailFieldStatus;
  reason: string | null;
};

export type AmazonDetailPageExtraction = {
  schemaVersion: "amazon-detail-page-extraction.v1";
  expectedAsin: string | null;
  urlAsin: string | null;
  pageAsin: string | null;
  entityBound: boolean;
  bindingProof: {
    urlMatchesExpected: boolean;
    pageAnchorMatchesExpected: boolean;
    productContainerFound: boolean;
  };
  pageStatus: AmazonDetailPageStatus;
  fields: Record<AmazonDetailFieldValue["field"], AmazonDetailFieldValue>;
  capturedAt: string;
  collectorVersion: string;
};

export type AmazonDetailPageExtractionOptions = {
  expectedAsin: string | null;
  capturedAt: string;
  collectorVersion: string;
};

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export function normalizeAsin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

/** 从商品详情 URL 提取 ASIN（/dp/{ASIN}、/gp/aw/d/{ASIN}、/gp/product/{ASIN}、/product/{ASIN}）；仅允许 amazon.com 主机 */
export function parseAsinFromDetailUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "www.amazon.com" && hostname !== "amazon.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index] === "dp" || segments[index] === "product") {
        const candidate = normalizeAsin(segments[index + 1]);
        if (candidate) return candidate;
      }
      if (segments[index] === "aw" && segments[index + 1] === "d" && segments[index + 2]) {
        const candidate = normalizeAsin(segments[index + 2]);
        if (candidate) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeDetailText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

/** "$48.95" / "$48.95 USD" / "US$1,234.56" → 48.95/1234.56；仅接受 USD 币种（JPY/其他 → null，防止跨币种错存） */
export function parseDetailPrice(value: string | null | undefined): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\s*(?:US\$|\$)/i.test(text)) return null;
  const match = /^\s*(?:US\$|\$)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:USD)?\s*$/i.exec(text);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** 检测页面价格币种（诊断用；非 USD 时 price 不保存） */
export function detectDetailPriceCurrency(value: string | null | undefined): "USD" | "JPY" | "other" | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\s*(?:US\$|\$)/i.test(text)) return "USD";
  if (/^\s*(?:JPY|￥|¥)/i.test(text)) return "JPY";
  if (/^\s*(?:[A-Z]{3}|€|£)/i.test(text)) return "other";
  return text ? null : null;
}

/** "4.2 out of 5 stars" / "4.2" → 4.2；范围校验 [0,5] */
export function parseDetailRating(value: string | null | undefined): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)/.exec(text);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

/** "4,958 ratings" / "(4,958)" / "4,958 条评分" → 4958 */
export function parseDetailReviewCount(value: string | null | undefined): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^\s*\(?\s*([0-9][0-9,]*)/.exec(text);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** "Best Sellers Rank: #2,541 in Kitchen & Dining" / "#2,541 in …" → 2541（取首个排名数字） */
export function parseDetailBsr(value: string | null | undefined): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /#\s*([0-9][0-9,]*)/.exec(text);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * 详情页分类（fail-closed）：
 * - captcha / login_wall / error_page：文本信号
 * - ok：商品主容器 `#productTitle` 存在
 * - 其余 unknown_page
 */
export function detectDetailPageStatus(root: {
  body?: { innerText?: string | null } | null;
  querySelector: (selector: string) => unknown;
}): AmazonDetailPageStatus {
  const bodyText = sanitizeDetailText(root.body?.innerText, 4000) ?? "";
  if (/captcha|robot check|enter the characters you see|type the characters you see|验证码|机器人/i.test(bodyText)) {
    return "captcha";
  }
  if (/sign in to continue|login to continue|please sign in|登录后继续/i.test(bodyText)) {
    return "login_wall";
  }
  if (/sorry[, ]+something went wrong|service unavailable|internal server error|页面出错/i.test(bodyText)) {
    return "error_page";
  }
  return root.querySelector("#productTitle") ? "ok" : "unknown_page";
}

/** 从详情子弹表提取 ASIN 锚点（"ASIN" 行值）；找不到 → null */
export function readDetailPageAsinAnchor(root: {
  querySelector: (selector: string) => unknown;
  querySelectorAll: (selector: string) => ReadonlyArray<unknown>;
}): string | null {
  const containers = [
    "#detailBullets_feature_div",
    "#productDetails_detailBullets_sections1",
    "#prodDetails",
    "#detailBulletsWrapper_feature_div",
  ];
  for (const containerSelector of containers) {
    const container = root.querySelector(containerSelector);
    if (!container) continue;
    const rows = (container as { querySelectorAll?: (s: string) => ReadonlyArray<unknown> })
      .querySelectorAll?.("tr, li") ?? [];
    for (const row of rows) {
      const text = sanitizeDetailText((row as { textContent?: string | null }).textContent, 240) ?? "";
      const asinMatch = /(?:^|\s)ASIN\s*[:：]\s*([A-Z0-9]{10})(?:\s|$)/i.exec(text);
      if (asinMatch) return asinMatch[1].toUpperCase();
      const valueOnly = /(?:^|\s)([A-Z0-9]{10})(?:\s|$)/.exec(text);
      const label = /ASIN/i.test(text);
      if (label && valueOnly) return valueOnly[1].toUpperCase();
    }
  }
  return null;
}

/** 从详情子弹表提取 "Best Sellers Rank" 文本（可能含多类目排名，返回拼接后首个 # 数字） */
export function readDetailPageBsrText(root: {
  querySelector: (selector: string) => unknown;
  querySelectorAll: (selector: string) => ReadonlyArray<unknown>;
}): string | null {
  const containers = [
    "#detailBullets_feature_div",
    "#productDetails_detailBullets_sections1",
    "#prodDetails",
    "#detailBulletsWrapper_feature_div",
  ];
  for (const containerSelector of containers) {
    const container = root.querySelector(containerSelector);
    if (!container) continue;
    const rows = (container as { querySelectorAll?: (s: string) => ReadonlyArray<unknown> })
      .querySelectorAll?.("tr, li") ?? [];
    for (const row of rows) {
      const text = sanitizeDetailText((row as { textContent?: string | null }).textContent, 400) ?? "";
      if (/best sellers rank/i.test(text)) {
        return text;
      }
    }
  }
  return null;
}

function unknownField(field: AmazonDetailFieldValue["field"], reason: string): AmazonDetailFieldValue {
  return { field, value: null, status: "unknown", reason };
}

function correctField(field: AmazonDetailFieldValue["field"], value: string | number): AmazonDetailFieldValue {
  return { field, value, status: "correct", reason: null };
}

export type AmazonDetailDomRoot = {
  body?: { innerText?: string | null } | null;
  querySelector: (selector: string) => {
    textContent?: string | null;
    querySelector?: (selector: string) => { textContent?: string | null } | null;
  } | null;
  querySelectorAll: (selector: string) => ReadonlyArray<unknown>;
};

/**
 * 详情页 6 字段提取（确定性锚点；实体绑定失败 → 全字段 unknown）。
 * 价格/评分/评论数/BSR 仅从主容器已知锚点读取，推荐/广告卡片不进入。
 */
export function extractAmazonDetailPage(
  root: AmazonDetailDomRoot,
  pageUrl: string,
  options: AmazonDetailPageExtractionOptions,
): AmazonDetailPageExtraction {
  const pageStatus = detectDetailPageStatus(root);
  const urlAsin = parseAsinFromDetailUrl(pageUrl);
  const pageAsin = readDetailPageAsinAnchor(root);
  const expectedAsin = normalizeAsin(options.expectedAsin);
  const productContainerFound = root.querySelector("#productTitle") !== null;
  const urlMatchesExpected = expectedAsin !== null && urlAsin === expectedAsin;
  const pageAnchorMatchesExpected = expectedAsin !== null && pageAsin === expectedAsin;
  const entityBound = pageStatus === "ok"
    && productContainerFound
    && urlMatchesExpected
    && pageAnchorMatchesExpected;

  const bindingReason = !entityBound
    ? (pageStatus !== "ok"
      ? `page_status_${pageStatus}`
      : !urlMatchesExpected
        ? "url_asin_mismatch"
        : !pageAnchorMatchesExpected
          ? "page_asin_anchor_mismatch"
          : "product_container_not_found")
    : null;

  const fields: AmazonDetailPageExtraction["fields"] = {
    asin: unknownField("asin", "entity_binding_unproven"),
    title: unknownField("title", "entity_binding_unproven"),
    price: unknownField("price", "entity_binding_unproven"),
    bsr: unknownField("bsr", "entity_binding_unproven"),
    rating: unknownField("rating", "entity_binding_unproven"),
    reviews: unknownField("reviews", "entity_binding_unproven"),
  };

  if (entityBound && expectedAsin !== null) {
    const titleNode = root.querySelector("#productTitle");
    const title = sanitizeDetailText(titleNode?.textContent, 500);
    fields.asin = correctField("asin", expectedAsin);
    fields.title = title
      ? correctField("title", title)
      : unknownField("title", "selector_not_found");

    const priceText = sanitizeDetailText(readFirstText(root, [
      "#corePrice_feature_div .a-offscreen",
      ".priceToPay .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
    ]), 60);
    const price = parseDetailPrice(priceText);
    const priceCurrency = detectDetailPriceCurrency(priceText);
    fields.price = price !== null
      ? correctField("price", price)
      : unknownField("price", priceText
        ? (priceCurrency === "JPY" || priceCurrency === "other"
          ? `currency_not_usd:${priceCurrency}`
          : "format_invalid")
        : "selector_not_found");

    const bsrText = readDetailPageBsrText(root);
    const bsr = parseDetailBsr(bsrText);
    fields.bsr = bsr !== null
      ? correctField("bsr", bsr)
      : unknownField("bsr", bsrText ? "format_invalid" : "selector_not_found");

    const ratingText = sanitizeDetailText(root.querySelector("#acrPopover .a-icon-alt")?.textContent, 60);
    const rating = parseDetailRating(ratingText);
    fields.rating = rating !== null
      ? correctField("rating", rating)
      : unknownField("rating", ratingText ? "format_invalid" : "selector_not_found");

    const reviewsText = sanitizeDetailText(root.querySelector("#acrCustomerReviewText")?.textContent, 60);
    const reviews = parseDetailReviewCount(reviewsText);
    fields.reviews = reviews !== null
      ? correctField("reviews", reviews)
      : unknownField("reviews", reviewsText ? "format_invalid" : "selector_not_found");
  } else {
    for (const field of Object.keys(fields) as Array<AmazonDetailFieldValue["field"]>) {
      fields[field] = { field, value: null, status: "unknown", reason: bindingReason ?? "entity_binding_unproven" };
    }
  }

  return {
    schemaVersion: "amazon-detail-page-extraction.v1",
    expectedAsin,
    urlAsin,
    pageAsin,
    entityBound,
    bindingProof: {
      urlMatchesExpected,
      pageAnchorMatchesExpected,
      productContainerFound,
    },
    pageStatus,
    fields,
    capturedAt: options.capturedAt,
    collectorVersion: options.collectorVersion,
  };
}

function readFirstText(
  root: AmazonDetailDomRoot,
  selectors: readonly string[],
): string | null {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node?.textContent) return node.textContent;
  }
  return null;
}

/**
 * CDP Runtime.evaluate 表达式（浏览器内执行；只读 DOM，不触碰存储/凭据）。
 * P1-A：改为 self-contained 字符串工件（detail-page-expression-source.ts）——
 * 不再用 fn.toString() 序列化模块函数（生产 minify 会重命名标识符导致
 * ReferenceError: s is not defined）；API 与返回格式完全兼容。
 */
export { buildAmazonDetailPageExtractionExpression } from "@/tools/collectors/amazon/detail-page-expression-source";
export type { AmazonDetailPageExpressionOptions } from "@/tools/collectors/amazon/detail-page-expression-source";
