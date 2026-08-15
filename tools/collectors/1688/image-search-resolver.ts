/**
 * V3.5 — 1688 图搜 Resolver（版本化纯函数；选择器/DOM 语义集中在 resolver，不进业务层）
 *
 * Contract §35/§36/§38：
 * - 每个 resolver 带版本常量，页面改版时 bump 版本并重新确认 invariant。
 * - 基于 Spike A.1/A.2/A.3 已证明能力（s.1688.com 相机入口、input#img-search-upload、
 *   search-btn class + elementFromPoint proof、air.1688.com 结果页 ?tab=imageSearch&imageId=），
 *   但以"DOM 语义 + 证明"实现，不硬复制临时脚本。
 * - 所有证明函数 fail-closed：无法证明 → reasonCodes 非空 → 调用方拒绝继续。
 *
 * 本模块只包含：
 *   1) DOM 表达式字符串（在浏览器页面内运行，返回原始报告 JSON）
 *   2) 报告解析器（纯函数，fixture 可测：把原始报告 → 类型化 Proof / 卡片 / 分类）
 */

import {
  IMAGE_RESULT_EXTRACTOR_VERSION,
  IMAGE_SUBMIT_RESOLVER_VERSION,
  IMAGE_UPLOAD_RESOLVER_VERSION,
  type ImageSearchResultCard,
  type ResultPageProof,
  type SubmitTargetProof,
  type UploadStateProof,
  type UploadTargetProof,
} from "./image-search-contract";

/** 允许的图搜相关域（s.1688.com 上传入口 / air.1688.com 结果页 / 1688.com 兜底） */
export const ALLOWED_IMAGE_SEARCH_HOSTS = ["s.1688.com", "air.1688.com", "www.1688.com", "1688.com"] as const;

export function isAllowedImageSearchPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (ALLOWED_IMAGE_SEARCH_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/** 上传页判定：s.1688.com（spike 实测含 ?t= 参数） */
export function isUploadPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "s.1688.com";
  } catch {
    return false;
  }
}

/** 结果页判定：air.1688.com 且 query 含 tab=imageSearch（spike 实测跳转目标） */
export function isResultPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "air.1688.com" || url.hostname === "s.1688.com")
      && url.searchParams.get("tab") === "imageSearch";
  } catch {
    return false;
  }
}

// ── DOM 表达式（浏览器内执行） ─────────────────────────────

/**
 * 上传目标证明表达式（A.3 UPLOAD_TARGET_PROOF）：
 * page=正确搜索页；target=input[type=file]#img-search-upload；unique（页面唯一 file input）；
 * visible（rect 有效）；enabled（可 focus）；box_valid（width/height>0）；坐标来自 live geometry。
 */
export function buildUploadTargetProofExpression(): string {
  const host = JSON.stringify("s.1688.com");
  return `(() => {
    const pageUrl = location.href;
    const pageUrlAllowed = ${host} === new URL(pageUrl).hostname;
    const fileInputs = Array.from(document.querySelectorAll('input[type=file]'));
    const target = document.querySelector('input[type=file]#img-search-upload');
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
    const found = target instanceof HTMLInputElement;
    const unique = fileInputs.length === 1 && fileInputs[0] === target;
    const visible = found && rect !== null && rect.width > 0 && rect.height > 0;
    const enabled = found && !target.disabled;
    const reasonCodes = [];
    if (!found) reasonCodes.push('upload_target_not_found');
    if (found && !unique) reasonCodes.push('upload_target_not_unique');
    if (found && !visible) reasonCodes.push('upload_target_not_visible');
    if (found && !enabled) reasonCodes.push('upload_target_disabled');
    if (!pageUrlAllowed) reasonCodes.push('page_url_not_allowed');
    return {
      found, unique, visible, enabled,
      tagName: found ? target.tagName : null,
      accept: found ? target.accept : null,
      pageUrlAllowed,
      x: found && rect ? Math.round(rect.x + rect.width / 2) : null,
      y: found && rect ? Math.round(rect.y + rect.height / 2) : null,
      width: found && rect ? Math.round(rect.width) : null,
      height: found && rect ? Math.round(rect.height) : null,
      reasonCodes,
    };
  })()`;
}

/**
 * 搜索触发目标表达式（A.2 class 扫描 resolver）：
 * 递归穿透 open/closed shadow root 扫描 .search-btn；elementFromPoint 命中验证；
 * 文本含"搜索图片"；unique + visible + enabled；坐标来自 live geometry（禁止固定坐标）。
 */
export function buildSubmitTargetProofExpression(): string {
  const host = JSON.stringify("s.1688.com");
  return `(() => {
    const pageUrl = location.href;
    const pageUrlAllowed = ${host} === new URL(pageUrl).hostname;
    const reasonCodes = [];
    if (!pageUrlAllowed) reasonCodes.push('page_url_not_allowed');
    const hits = [];
    const seen = new Set();
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (typeof el.className === 'string' && el.className.split(/\\s+/).includes('search-btn')) hits.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    let best = null;
    for (const el of hits) {
      if (!(el instanceof HTMLElement)) continue;
      const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!text.includes('搜索图片')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const atPoint = document.elementFromPoint(cx, cy);
      const hit = atPoint === el || (atPoint !== null && el.contains(atPoint));
      if (!hit) continue;
      best = { el, text, rect, cx, cy };
      break;
    }
    const found = best !== null;
    const allMatches = hits.filter((el) => el instanceof HTMLElement
      && (el.innerText || '').replace(/\\s+/g, ' ').trim().includes('搜索图片')).length;
    const unique = allMatches === 1;
    if (found && !unique) reasonCodes.push('submit_target_not_unique');
    if (!found) reasonCodes.push('submit_target_not_found');
    return {
      found,
      unique,
      visible: found,
      enabled: found,
      tagName: found ? best.el.tagName : null,
      text: found ? best.text : null,
      pageUrlAllowed,
      x: found ? Math.round(best.cx) : null,
      y: found ? Math.round(best.cy) : null,
      width: found ? Math.round(best.rect.width) : null,
      height: found ? Math.round(best.rect.height) : null,
      reasonCodes,
    };
  })()`;
}

/**
 * 上传状态证明表达式（A.3 UPLOAD_STATE_PROOF）：
 * 预览图出现（图片 dataURL/src）+ "搜索图片"按钮出现（提交目标命中）→ 上传状态已激活。
 */
export function buildUploadStateProofExpression(): string {
  return `(() => {
    const pageUrl = location.href;
    const previewImages = Array.from(document.querySelectorAll('img')).filter((img) => {
      const src = img.currentSrc || img.src || '';
      return src.startsWith('data:image/') || /image-search|img-search|upload/i.test(src);
    });
    const previewCount = previewImages.length;
    const previewSrc = previewCount > 0 ? (previewImages[0].currentSrc || previewImages[0].src || '').slice(0, 200) : null;
    const reasonCodes = [];
    if (previewCount === 0) reasonCodes.push('upload_state_not_confirmed');
    return {
      confirmed: previewCount > 0,
      previewImageCount: previewCount,
      previewImageSrc: previewSrc,
      selectedFileName: null,
      pageUrl,
      reasonCodes,
    };
  })()`;
}

/**
 * 结果页分类表达式（§38 Fallback Recommendation ≠ Native Result）：
 * URL 含 imageId + tab=imageSearch → native 结果页；否则 fallback/unknown。
 */
export function buildResultPageClassificationExpression(): string {
  return `(() => {
    const pageUrl = location.href;
    const url = new URL(pageUrl);
    const tabImageSearch = url.searchParams.get('tab') === 'imageSearch';
    const imageIdInUrl = /imageId=[0-9]{10,}/.test(pageUrl);
    const bodyText = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 4000);
    const fallbackMarkers = ['热门推荐', '大家都在搜', '猜你喜欢'];
    const hasFallbackMarker = fallbackMarkers.some((marker) => bodyText.includes(marker));
    const reasonCodes = [];
    if (!tabImageSearch) reasonCodes.push('result_tab_missing');
    if (!imageIdInUrl) reasonCodes.push('image_id_missing');
    if (hasFallbackMarker) reasonCodes.push('fallback_marker_present');
    return {
      resultsReady: tabImageSearch && imageIdInUrl && !hasFallbackMarker,
      isFallbackRecommendation: !tabImageSearch || !imageIdInUrl || hasFallbackMarker,
      imageIdInUrl,
      resultCount: 0,
      pageUrl,
      reasonCodes,
    };
  })()`;
}

/**
 * 结果卡片提取表达式（同卡片实体绑定）：
 * 以 detail.1688.com/offer/<digits>.html 链接为实体锚，从锚所在卡片容器提取
 * title/price/MOQ/supplier/image（全部来自同一卡片节点 → entityBound=true）。
 */
export function buildResultCardsExtractionExpression(): string {
  return `(() => {
    const cards = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="detail.1688.com/offer/"]'));
    for (const anchor of anchors) {
      const href = anchor.href || '';
      const match = href.match(/\\/offer\\/(\\d{5,20})/);
      if (!match) continue;
      const offerId = match[1];
      if (seen.has(offerId)) continue;
      seen.add(offerId);
      let card = anchor;
      for (let depth = 0; depth < 4 && card && card.parentElement; depth++) card = card.parentElement;
      const text = (card.innerText || '').replace(/\\s+/g, ' ').trim();
      const img = card.querySelector('img');
      const priceMatch = text.match(/(?:¥|￥|CNY)\\s?\\d+(\\.\\d+)?/);
      const moqMatch = text.match(/\\d+\\s*件起批|起批\\s*\\d+|MOQ[^0-9]{0,6}\\d+/i);
      const lines = text.split(/\\s+/).filter(Boolean);
      const titleLine = lines.slice(0, Math.min(12, lines.length)).join(' ');
      cards.push({
        offerId,
        title: titleLine.slice(0, 200),
        priceText: priceMatch ? priceMatch[0] : null,
        moqText: moqMatch ? moqMatch[0] : null,
        supplierName: null,
        imageUrl: img ? (img.currentSrc || img.src || '').slice(0, 300) : null,
        detailUrl: href.slice(0, 300),
        entityBound: true,
      });
    }
    return { cards: cards.slice(0, 60) };
  })()`;
}

// ── 报告解析器（纯函数，fixture 可测） ─────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boolField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] as number : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" && record[key].trim() ? record[key] as string : null;
}

function reasonCodesOf(record: Record<string, unknown>): string[] {
  return Array.isArray(record.reasonCodes) ? record.reasonCodes.map(String) : [];
}

export function parseUploadTargetProof(raw: unknown): UploadTargetProof {
  if (!isRecord(raw)) {
    return {
      found: false, unique: false, visible: false, enabled: false,
      tagName: null, accept: null, pageUrlAllowed: false,
      x: null, y: null, width: null, height: null,
      reasonCodes: ["upload_target_report_invalid"],
    };
  }
  return {
    found: boolField(raw, "found"),
    unique: boolField(raw, "unique"),
    visible: boolField(raw, "visible"),
    enabled: boolField(raw, "enabled"),
    tagName: stringField(raw, "tagName"),
    accept: stringField(raw, "accept"),
    pageUrlAllowed: boolField(raw, "pageUrlAllowed"),
    x: numberField(raw, "x"),
    y: numberField(raw, "y"),
    width: numberField(raw, "width"),
    height: numberField(raw, "height"),
    reasonCodes: reasonCodesOf(raw),
  };
}

export function parseSubmitTargetProof(raw: unknown): SubmitTargetProof {
  if (!isRecord(raw)) {
    return {
      found: false, unique: false, visible: false, enabled: false,
      tagName: null, text: null, pageUrlAllowed: false,
      x: null, y: null, width: null, height: null,
      reasonCodes: ["submit_target_report_invalid"],
    };
  }
  return {
    found: boolField(raw, "found"),
    unique: boolField(raw, "unique"),
    visible: boolField(raw, "visible"),
    enabled: boolField(raw, "enabled"),
    tagName: stringField(raw, "tagName"),
    text: stringField(raw, "text"),
    pageUrlAllowed: boolField(raw, "pageUrlAllowed"),
    x: numberField(raw, "x"),
    y: numberField(raw, "y"),
    width: numberField(raw, "width"),
    height: numberField(raw, "height"),
    reasonCodes: reasonCodesOf(raw),
  };
}

export function parseUploadStateProof(raw: unknown): UploadStateProof {
  if (!isRecord(raw)) {
    return {
      confirmed: false, previewImageCount: 0, previewImageSrc: null,
      selectedFileName: null, pageUrl: "", reasonCodes: ["upload_state_report_invalid"],
    };
  }
  return {
    confirmed: boolField(raw, "confirmed"),
    previewImageCount: typeof raw.previewImageCount === "number" ? raw.previewImageCount : 0,
    previewImageSrc: stringField(raw, "previewImageSrc"),
    selectedFileName: stringField(raw, "selectedFileName"),
    pageUrl: stringField(raw, "pageUrl") ?? "",
    reasonCodes: reasonCodesOf(raw),
  };
}

export function parseResultPageClassification(raw: unknown): ResultPageProof {
  if (!isRecord(raw)) {
    return {
      resultsReady: false, isFallbackRecommendation: true, imageIdInUrl: false,
      resultCount: 0, pageUrl: "", reasonCodes: ["result_page_report_invalid"],
    };
  }
  return {
    resultsReady: boolField(raw, "resultsReady"),
    isFallbackRecommendation: boolField(raw, "isFallbackRecommendation"),
    imageIdInUrl: boolField(raw, "imageIdInUrl"),
    resultCount: typeof raw.resultCount === "number" ? raw.resultCount : 0,
    pageUrl: stringField(raw, "pageUrl") ?? "",
    reasonCodes: reasonCodesOf(raw),
  };
}

/** 卡片解析：offerId 必须合法；非法卡片丢弃（fail-closed，不猜） */
export function parseResultCards(raw: unknown): ImageSearchResultCard[] {
  if (!isRecord(raw) || !Array.isArray(raw.cards)) return [];
  const cards: ImageSearchResultCard[] = [];
  for (const item of raw.cards) {
    if (!isRecord(item)) continue;
    const offerId = stringField(item, "offerId");
    if (!offerId || !/^\d{5,20}$/.test(offerId)) continue;
    const title = stringField(item, "title");
    if (!title) continue;
    cards.push({
      offerId,
      title: title.slice(0, 200),
      priceText: stringField(item, "priceText"),
      moqText: stringField(item, "moqText"),
      supplierName: stringField(item, "supplierName"),
      imageUrl: stringField(item, "imageUrl"),
      detailUrl: stringField(item, "detailUrl"),
      entityBound: item.entityBound === true,
    });
  }
  return cards.slice(0, 60);
}

/** 图搜结果 → AcquisitionCandidate 的前置校验（空/超限 fail-closed） */
export function validateImageResultCards(cards: ImageSearchResultCard[]): void {
  if (cards.length === 0) {
    throw new Error("IMAGE_RESULTS_EMPTY");
  }
  if (cards.length > 60) {
    throw new Error("IMAGE_RESULTS_OVER_LIMIT");
  }
  const offerIds = new Set(cards.map((card) => card.offerId));
  if (offerIds.size !== cards.length) {
    throw new Error("IMAGE_RESULTS_DUPLICATE_OFFER_ID");
  }
}

export const RESOLVER_VERSIONS = {
  upload: IMAGE_UPLOAD_RESOLVER_VERSION,
  submit: IMAGE_SUBMIT_RESOLVER_VERSION,
  extract: IMAGE_RESULT_EXTRACTOR_VERSION,
} as const;
