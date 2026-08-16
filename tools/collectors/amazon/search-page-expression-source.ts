/**
 * V3 Final Operability Correction — P1-A：搜索页表达式自包含工件
 *
 * 与 detail-page-expression-source.ts 同机制：浏览器端 helper 以固定名显式
 * 定义（function 声明）、互调固定名、无模块级依赖 → MINIFICATION-SAFE。
 * 与 extract-search-page.ts 的 Node 侧函数保持行为一致（同步测试锁定）。
 */

export type AmazonSearchExpressionOptions = {
  query: string;
  page: number;
  maxAppearances: number;
  capturedAt: string;
  requested: Record<string, unknown>;
  observed: Record<string, unknown>;
};

/** 搜索页提取表达式源码工件（__OPTIONS__ 为占位） */
export const AMAZON_SEARCH_PAGE_EXTRACTOR_SOURCE = [
  "(() => {",
  "function sanitizeCollectorText(value, maxLength) {",
  "  if (typeof value !== 'string') return null;",
  "  const normalized = value.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim();",
  "  return normalized ? normalized.slice(0, maxLength) : null;",
  "}",
  "function buildCanonicalAmazonProductUrl(asin) {",
  "  const normalized = asin.trim().toUpperCase();",
  "  if (!/^[A-Z0-9]{10}$/.test(normalized)) throw new Error('AMAZON_ASIN_INVALID');",
  "  return 'https://www.amazon.com/dp/' + normalized;",
  "}",
  "function detectPriceCurrency(priceText) {",
  "  if (!priceText) return null;",
  "  const normalized = priceText.trim().toUpperCase();",
  "  if (/\\bJPY\\b|[\\u00A5\\uFFE5]/.test(normalized)) return 'JPY';",
  "  if (/\\bUSD\\b|US\\$|^\\$/.test(normalized)) return 'USD';",
  "  return null;",
  "}",
  "function detectPageStatus(bodySample, cardCount) {",
  "  if (/captcha|robot check|enter the characters you see|type the characters you see|验证码|机器人/i.test(bodySample)) return 'captcha';",
  "  if (/sign in to continue|login to continue|please sign in|登录后继续/i.test(bodySample)) return 'login_wall';",
  "  if (/sorry[, ]+something went wrong|service unavailable|internal server error|页面出错/i.test(bodySample)) return 'error_page';",
  "  return cardCount > 0 ? 'ok' : 'unknown_page';",
  "}",
  "function extractSponsoredPlacementDiagnostic(card, asin) {",
  "  const knownMarkers = [",
  "    { selector: '[aria-label=\"Sponsored\"], [aria-label^=\"Sponsored\"]', selectorCategory: 'aria_label_sponsored' },",
  "    { selector: '.puis-sponsored-label-text', selectorCategory: 'sponsored_label_class' },",
  "    { selector: '[data-component-type=\"s-sponsored-label-marker\"]', selectorCategory: 'sponsored_component_marker' },",
  "  ];",
  "  for (const knownMarker of knownMarkers) {",
  "    const marker = card.querySelector(knownMarker.selector);",
  "    if (!marker) continue;",
  "    return { schemaVersion: 'amazon-sponsored-placement-diagnostic.v1', state: true, markerSource: 'known_dom_selector', selectorCategory: knownMarker.selectorCategory, reasonCode: 'sponsored_marker_present', matchedText: sanitizeCollectorText(marker.getAttribute ? marker.getAttribute('aria-label') : marker.textContent, 80) };",
  "  }",
  "  const visibleText = sanitizeCollectorText(card.innerText || card.textContent, 500) || '';",
  "  const ambiguousAdTextMatch = visibleText.match(/\\b(?:sponsored|promoted|advertisement|ad)\\b|广告|推广/i);",
  "  const ambiguousAdText = ambiguousAdTextMatch ? ambiguousAdTextMatch[0] : null;",
  "  if (ambiguousAdText) {",
  "    return { schemaVersion: 'amazon-sponsored-placement-diagnostic.v1', state: null, markerSource: 'visible_text', selectorCategory: 'ambiguous_ad_text', reasonCode: 'ambiguous_ad_text_without_known_marker', matchedText: sanitizeCollectorText(ambiguousAdText, 40) };",
  "  }",
  "  const knownOrganicStructure = asin !== null && (card.querySelector('h2 a span') !== null || card.querySelector('h2 span') !== null) && (card.querySelector('.a-price .a-offscreen') !== null || card.querySelector('img.s-image') !== null);",
  "  if (knownOrganicStructure) {",
  "    return { schemaVersion: 'amazon-sponsored-placement-diagnostic.v1', state: false, markerSource: 'known_card_structure', selectorCategory: 'standard_search_result_card', reasonCode: 'known_organic_structure', matchedText: null };",
  "  }",
  "  return { schemaVersion: 'amazon-sponsored-placement-diagnostic.v1', state: null, markerSource: 'none', selectorCategory: 'unrecognized_card_structure', reasonCode: 'insufficient_sponsored_evidence', matchedText: null };",
  "}",
  "function extractAmazonSearchPage(root, options) {",
  "  if (!options.query.trim()) throw new Error('COLLECTOR_QUERY_REQUIRED');",
  "  if (!Number.isInteger(options.page) || options.page < 1 || options.page > 2) throw new Error('COLLECTOR_PAGE_OUT_OF_RANGE');",
  "  if (!Number.isInteger(options.maxAppearances) || options.maxAppearances < 1 || options.maxAppearances > 60) throw new Error('COLLECTOR_SAMPLE_BUDGET_INVALID');",
  "  const bodySample = sanitizeCollectorText(root.body && root.body.innerText, 4000) || '';",
  "  const allCards = Array.from(root.querySelectorAll('[data-component-type=\"s-search-result\"]'));",
  "  const pageStatus = detectPageStatus(bodySample, allCards.length);",
  "  const observations = allCards.slice(0, options.maxAppearances).map(function (card, index) {",
  "    const rawAsin = sanitizeCollectorText(card.getAttribute('data-asin'), 20);",
  "    const asin = rawAsin && /^[A-Z0-9]{10}$/i.test(rawAsin) ? rawAsin.toUpperCase() : null;",
  "    const priceText = sanitizeCollectorText(card.querySelector('.a-price .a-offscreen') && card.querySelector('.a-price .a-offscreen').textContent, 60);",
  "    const ratingText = sanitizeCollectorText(card.querySelector('.a-icon-alt') && card.querySelector('.a-icon-alt').textContent, 80);",
  "    const reviewNode = card.querySelector('a[href*=\"customerReviews\"] span, a[href*=\"#customerReviews\"] span');",
  "    const imageNode = card.querySelector('img.s-image');",
  "    const sponsoredDiagnostic = extractSponsoredPlacementDiagnostic(card, asin);",
  "    const titleNode = card.querySelector('h2 a span') || card.querySelector('h2 span');",
  "    const fieldMissingReasons = { brand: 'not_exposed_on_search_card' };",
  "    if (sponsoredDiagnostic.state === null) fieldMissingReasons.sponsored = 'not_determined';",
  "    if (!priceText) fieldMissingReasons.price = 'not_visible';",
  "    if (!ratingText) fieldMissingReasons.rating = 'not_visible';",
  "    if (!reviewNode) fieldMissingReasons.reviewCount = 'not_visible';",
  "    if (!imageNode) fieldMissingReasons.imageUrl = 'not_visible';",
  "    return {",
  "      appearanceKey: 'canary-p' + options.page + '-' + String(index + 1).padStart(2, '0'),",
  "      page: options.page, position: index + 1,",
  "      sponsored: sponsoredDiagnostic.state, sponsoredDiagnostic,",
  "      asin, identityMissingReason: asin ? null : 'asin_not_found',",
  "      title: sanitizeCollectorText(titleNode && titleNode.textContent, 300),",
  "      priceText, priceCurrency: detectPriceCurrency(priceText),",
  "      ratingText, reviewCountText: sanitizeCollectorText(reviewNode && reviewNode.textContent, 60),",
  "      brand: null, productUrl: asin ? buildCanonicalAmazonProductUrl(asin) : null,",
  "      imageUrl: sanitizeCollectorText(imageNode && imageNode.getAttribute('src'), 2048),",
  "      capturedAt: options.capturedAt,",
  "      fieldMissingReasons,",
  "    };",
  "  });",
  "  return {",
  "    schemaVersion: 'amazon-search-page-extraction.v2',",
  "    requested: Object.assign({}, options.requested),",
  "    observed: Object.assign({}, options.observed),",
  "    query: options.query.trim(), page: options.page, capturedAt: options.capturedAt,",
  "    pageStatus, blocked: pageStatus !== 'ok', keyContainerFound: allCards.length > 0,",
  "    rawCardCount: allCards.length, sampledObservationIds: observations.map(function (item) { return item.appearanceKey; }),",
  "    diagnosticVisiblePriceNodeCount: root.querySelectorAll('.a-price .a-offscreen').length, observations,",
  "  };",
  "}",
  "return extractAmazonSearchPage(document, __OPTIONS__);",
  "})()",
].join("\n");

/** 页面上下文表达式（搜索流程导航后诊断用） */
export const AMAZON_PAGE_CONTEXT_SOURCE = [
  "(() => {",
  "function sanitizeCollectorText(value, maxLength) {",
  "  if (typeof value !== 'string') return null;",
  "  const normalized = value.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim();",
  "  return normalized ? normalized.slice(0, maxLength) : null;",
  "}",
  "function inspectAmazonPageContext(root, pageUrl) {",
  "  const deliveryNode = root.querySelector ? root.querySelector('#glow-ingress-line2, #glow-ingress-block') : null;",
  "  const brandMarker = root.querySelector ? root.querySelector('#nav-logo, [aria-label=\\'Amazon\\'], [aria-label^=\\'Amazon\\']') : null;",
  "  return {",
  "    pageUrl,",
  "    amazonBrandMarkerPresent: brandMarker !== null && brandMarker !== undefined,",
  "    deliveryRegion: sanitizeCollectorText(deliveryNode && deliveryNode.textContent, 160),",
  "    language: sanitizeCollectorText(root.documentElement && root.documentElement.getAttribute ? root.documentElement.getAttribute('lang') : null, 40) ? (sanitizeCollectorText(root.documentElement && root.documentElement.getAttribute ? root.documentElement.getAttribute('lang') : null, 40) || '').toLowerCase() : null,",
  "  };",
  "}",
  "return inspectAmazonPageContext(document, location.href);",
  "})()",
].join("\n");

export function buildAmazonSearchPageExtractionExpression(options: AmazonSearchExpressionOptions): string {
  return AMAZON_SEARCH_PAGE_EXTRACTOR_SOURCE.replace("__OPTIONS__", JSON.stringify(options));
}

export function buildAmazonPageContextExpression(): string {
  return AMAZON_PAGE_CONTEXT_SOURCE;
}
