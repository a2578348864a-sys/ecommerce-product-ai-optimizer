/**
 * Phase Candidate-Quality-M.1 — Candidate Quality Precheck
 *
 * Pure functions — no side effects, no API calls, no DB, no AI.
 * Evaluates candidate quality from title/name/url/snippet/candidateType,
 * producing a quality level, score, and actionable reasons.
 *
 * This module does NOT:
 * - Call AI
 * - Write to database
 * - Modify candidate status
 * - Delete candidates
 * - Require schema changes
 */

// ── Types ───────────────────────────────────────

export type CandidateQualityLevel =
  | "recommended"
  | "caution"
  | "not_recommended"
  | "rejected";

export interface CandidateQualityInput {
  title?: string | null;
  name?: string | null;
  url?: string | null;
  snippet?: string | null;
  sourceTitle?: string | null;
  sourceType?: string | null;
  candidateType?: string | null;
}

export interface CandidateQualityResult {
  level: CandidateQualityLevel;
  score: number; // 0-100, higher = better fit for candidate pool
  label: string;
  reasons: string[];
  flags: string[];
  shouldShowInPreview: boolean;
  shouldAllowImport: boolean;
  suggestedAction: string;
}

// ── Constants ───────────────────────────────────

/** Patterns indicating an error / invalid page */
const ERROR_PAGE_PATTERNS: RegExp[] = [
  /error\s*page/i,
  /out\s*of\s*service/i,
  /service\s*unavailable/i,
  /\b404\b/,
  /\b403\b/,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /page\s*not\s*found/i,
  /access\s*denied/i,
  /just\s*a\s*moment/i,
  /checking\s*your\s*browser/i,
  /please\s*enable\s*(javascript|cookies)/i,
];

/** Patterns indicating a homepage / category / search page (not a product) */
const NON_PRODUCT_PAGE_PATTERNS: RegExp[] = [
  /^home\s*page$/i,
  /^home$/i,
  /^welcome/i,
  /^index$/i,
  /^main\s*page$/i,
  /^(?:shop|store)\s*home\s*page$/i,
  /^home\s*(?:-|\|)\s*[\w\s]+$/i,
  /^category\s*:/i,
  /^browse\s+category/i,
  /^search\s*results?\s*(?:for|:)/i,
  /^all\s+products?$/i,
  /^products?\s*$/i,
  /^collections?\s*$/i,
  /catalog\s*$/i,
  /^shop\s+all$/i,
  /^new\s+arrivals?\s*$/i,
  /^featured\s+products?\s*$/i,
  // Platform homepages (with or without .com)
  /^(?:amazon|ebay|walmart|aliexpress|shopify|etsy|taobao|jd|tmall)(?:\.\w+)?(?:\s+home)?(?:\s+page)?$/i,
  /^(?:amazon|ebay|walmart|aliexpress|shopify|etsy)(?:\s+home)?(?:\s+page)?$/i,
  // Chinese platform homepages
  /^(?:京东|淘宝|天猫)(?:首页)?$/,
  /^[一-鿿]{1,4}首页$/,
];

/** High-risk regulated / dangerous goods — directly rejected */
const HIGH_RISK_KEYWORDS: RegExp[] = [
  // Weapons & self-defense
  /防狼喷雾/i, /pepper\s*spray/i, /stun\s*gun/i, /taser/i,
  /tactical\s*knife/i, /combat\s*knife/i, /self\s*defense\s*weapon/i,
  /\bweapon\b/i, /\bmace\b/i, /brass\s*knuckle/i, /switchblade/i,
  // Adult
  /成人用品/i, /sex\s*toy/i, /vibrator/i, /dildo/i,
  // Drugs / controlled substances
  /\bvape\b/i, /\bnicotine\b/i, /\bCBD\b/i, /\bTHC\b/i, /cannabis/i,
  /\bdrug\b/i, /\bpesticide\b/i, /\bherbicide\b/i, /rat\s*poison/i,
  // Pharmaceuticals
  /\bsupplement\b/i, /\bmedicine\b/i, /medical\s*device/i,
  /\binsulin\b/i, /prescription/i, /\bpharma/i,
  // Dangerous items
  /laser\s*pointer.*high\s*power/i, /high\s*power\s*laser/i,
  /\bfireworks?\b/i, /explosive/i, /gunpowder/i, /ammunition/i,
  /fuel\s*canister/i, /gasoline/i, /propane/i,
];

/** Caution-level keywords — may involve certifications, materials, platform rules */
const CAUTION_KEYWORDS: RegExp[] = [
  // Electronics / battery
  /\bcharger\b/i, /power\s*bank/i, /power\s*supply/i, /adapter/i,
  /\bbattery\b/i, /rechargeable/i, /\belectronic\b/i,
  /\bplug\b/i, /heated/i, /\belectric\b/i, /\bUSB\s*charger/i,
  /\bwireless\s*charg/i, /\bcable\b.*\bcharge/i,
  // Kids / baby
  /\bbaby\b/i, /\bkids?\b/i, /children/i, /infant/i, /toddler/i,
  /nursery/i, /stroller/i, /pacifier/i,
  // Food contact / ingestion
  /food\s*container/i, /food\s*storage/i, /water\s*bottle/i,
  /lunch\s*box/i, /bento/i, /thermos/i, /tumbler.*drink/i,
  /\bkitchen\b.*\btool\b/i, /cooking\s*utensil/i, /cutting\s*board/i,
  // Cosmetics / skin
  /cosmetic/i, /skin\s*care/i, /makeup/i, /lotion/i, /cream/i,
  /essential\s*oil/i, /perfume/i, /fragrance/i, /lip\s*balm/i,
  // Fragile / sharp
  /glass\s*bottle/i, /glass\s*jar/i, /glass\s*container/i,
  /ceramic/i, /porcelain/i, /\bsharp\b/i, /\bknife\b(?!.*tactical)/i,
  // Magnet / chemical
  /\bmagnet\b/i, /neodymium/i, /adhesive\s*chemical/i,
  /epoxy/i, /resin\s*craft/i,
  // Pet food / accessories (regulatory)
  /pet\s*food/i, /dog\s*treat/i, /cat\s*treat/i,
  // LED / lamp (may have certification requirements)
  /\bLED\b.*(?:lamp|light|bulb)/i, /\blamp\b.*\bLED\b/i,
  /desk\s*lamp/i, /table\s*lamp/i, /night\s*light/i,
  // Clothing/textiles (flammability)
  /children.*clothing/i, /baby.*clothing/i, /infant.*wear/i,
];

/** Beginner-friendly product keywords — recommended */
const BEGINNER_FRIENDLY_KEYWORDS: RegExp[] = [
  /桌面收纳盒/i, /desk\s*organizer/i,
  /桌面手机支架/i, /phone\s*stand/i, /cell\s*phone\s*stand/i,
  /电脑理线夹/i, /cable\s*organizer/i, /cord\s*organizer/i,
  /笔筒收纳/i, /pen\s*holder/i, /pencil\s*holder/i,
  /drawer\s*organizer/i, /storage\s*box/i, /storage\s*bin/i,
  /laptop\s*stand/i, /monitor\s*stand/i, /monitor\s*riser/i,
  /silicone\s*cable\s*tie/i, /cable\s*clip/i, /cord\s*clip/i,
  /book\s*stand/i, /bookend/i,
  /\bhook\b.*(?:organizer|rack|hanger)/i,
  /shelf\s*organizer/i, /closet\s*organizer/i,
  /key\s*holder/i, /key\s*rack/i,
  /mail\s*organizer/i, /letter\s*holder/i,
  /makeup\s*organizer/i, /cosmetic\s*organizer/i,
  /jewelry\s*organizer/i, /jewelry\s*box/i,
  /bathroom\s*organizer/i, /shower\s*caddy/i,
  /kitchen\s*organizer/i, /spice\s*rack/i,
  /remote\s*control\s*holder/i,
  /headphone\s*stand/i, /headphone\s*hanger/i,
  /charging\s*station/i, /charging\s*dock/i,
];

/** Brand / IP risk keywords */
const BRAND_RISK_KEYWORDS: RegExp[] = [
  /\bDisney\b/i, /\bPok[eé]mon\b/i, /\bMarvel\b/i, /\bDC\s*Comics\b/i,
  /\bApple\b\s*(?!compatible)/i, /\bNike\b/i, /\bAdidas\b/i,
  /\bLEGO\b/i, /\bStanley\b\s*(?:cup|tumbler)/i,
  /\bGucci\b/i, /\bLouis\s*Vuitton\b/i, /\bChanel\b/i,
  /\bHerm[eè]s\b/i, /\bRolex\b/i, /\bCartier\b/i,
  /\bSupreme\b/i, /\bYeezy\b/i, /\bJordan\b(?:\s*brand)?/i,
  /\bBarbie\b/i, /\bHot\s*Wheels\b/i, /\bFunko\s*Pop\b/i,
  /\bAnime\b.*(?:figure|figurine)/i, /\bmanga\b.*(?:figure)/i,
  /\breplica\b/i, /\bdupe\b/i, /\bknock-?off\b/i, /\bcounterfeit\b/i,
  /\binspired\b(?:\s*by)?(?:.*(?:design|brand|style))/i,
  /\btrademark\b/i, /\bcopyright\b/i,
  /\blicensed\b/i, /\bofficial\s*merch/i,
];

// ── Helpers ─────────────────────────────────────

function normalize(text?: string | null): string {
  if (!text) return "";
  return text.trim().replace(/\s+/g, " ");
}

function matchAny(text: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) {
    if (p.test(text)) return p;
  }
  return null;
}

function effectiveTitle(input: CandidateQualityInput): string {
  return normalize(input.title || input.name || input.sourceTitle || "");
}

function effectiveUrl(input: CandidateQualityInput): string {
  return normalize(input.url || "");
}

function effectiveSnippet(input: CandidateQualityInput): string {
  return normalize(input.snippet || "");
}

function isShortText(text: string, minLen = 3): boolean {
  return text.length < minLen;
}

// ── Rule: Error / Invalid Pages ────────────────

function checkErrorPage(input: CandidateQualityInput): CandidateQualityResult | null {
  const title = effectiveTitle(input);
  const snippet = effectiveSnippet(input);
  const combined = `${title} ${snippet}`;

  const matched = matchAny(combined, ERROR_PAGE_PATTERNS);
  if (matched) {
    return {
      level: "rejected",
      score: 5,
      label: "页面异常",
      reasons: [`页面可能是错误页或验证页（匹配: ${matched.source.slice(0, 50)}）`],
      flags: ["error_page", matched.source],
      shouldShowInPreview: false,
      shouldAllowImport: false,
      suggestedAction: "该页面不是正常商品页，跳过",
    };
  }

  // Empty or very short title
  if (!title || isShortText(title, 2)) {
    return {
      level: "rejected",
      score: 10,
      label: "信息不足",
      reasons: ["标题为空或过短，无法判断是否为商品候选"],
      flags: ["empty_title"],
      shouldShowInPreview: false,
      shouldAllowImport: false,
      suggestedAction: "标题不足，无法识别为有效候选",
    };
  }

  return null;
}

// ── Rule: Homepage / Category / Search Page ─────

function checkNonProductPage(input: CandidateQualityInput): CandidateQualityResult | null {
  const title = effectiveTitle(input);
  const url = effectiveUrl(input);

  // Check URL for homepage/category patterns
  const urlLower = url.toLowerCase();
  const isHomeUrl =
    urlLower === "https://www.amazon.com/" ||
    urlLower === "https://www.amazon.com" ||
    urlLower === "https://www.ebay.com/" ||
    urlLower === "https://www.ebay.com" ||
    urlLower === "https://www.walmart.com/" ||
    urlLower === "https://www.aliexpress.com/" ||
    urlLower === "https://www.etsy.com/" ||
    urlLower === "https://www.jd.com/" ||
    /^https?:\/\/[^/]+\/?$/.test(urlLower) && isShortText(title, 5);

  if (isHomeUrl && (isShortText(title, 5) || title === "")) {
    return {
      level: "rejected",
      score: 15,
      label: "平台首页",
      reasons: ["该 URL 或标题是平台首页，无法提取具体商品候选"],
      flags: ["homepage_url"],
      shouldShowInPreview: false,
      shouldAllowImport: false,
      suggestedAction: "平台首页无法直接生成商品候选，建议使用具体商品或类目页面",
    };
  }

  const matched = matchAny(title, NON_PRODUCT_PAGE_PATTERNS);
  if (matched) {
    const isCategory = /category|collection|browse|search|all\s+products?/i.test(matched.source);
    return {
      level: "not_recommended",
      score: isCategory ? 25 : 20,
      label: isCategory ? "类目/搜索页" : "非商品页",
      reasons: [`标题匹配非商品页模式: ${matched.source.slice(0, 50)}`],
      flags: ["non_product_page", matched.source],
      shouldShowInPreview: false,
      shouldAllowImport: false,
      suggestedAction: "不是具体商品候选，无法直接进入 Agent 主链路",
    };
  }

  return null;
}

// ── Rule: High-Risk / Regulated Goods ───────────

function checkHighRisk(input: CandidateQualityInput): CandidateQualityResult | null {
  const title = effectiveTitle(input);
  const snippet = effectiveSnippet(input);
  const combined = `${title} ${snippet}`;

  const matched = matchAny(combined, HIGH_RISK_KEYWORDS);
  if (matched) {
    return {
      level: "rejected",
      score: 8,
      label: "高风险商品",
      reasons: [
        `涉及平台/物流/合规高风险商品（匹配: ${matched.source.slice(0, 40)}）`,
        "不适合新手候选，建议避开此类商品",
      ],
      flags: ["high_risk_goods", matched.source],
      shouldShowInPreview: false,
      shouldAllowImport: false,
      suggestedAction: "涉及高风险品类，不建议进入候选池",
    };
  }
  return null;
}

// ── Rule: Brand / IP Risk ───────────────────────

function checkBrandRisk(input: CandidateQualityInput): CandidateQualityResult | null {
  const title = effectiveTitle(input);
  const snippet = effectiveSnippet(input);
  const combined = `${title} ${snippet}`;

  const matched = matchAny(combined, BRAND_RISK_KEYWORDS);
  if (!matched) return null;

  // "Apple compatible" without "Apple" branded product → caution
  if (/compatible\s*(with|for)?/i.test(combined) && /\bApple\b/i.test(combined)) {
    return {
      level: "caution",
      score: 45,
      label: "品牌配件",
      reasons: ["第三方兼容配件，需确认不侵犯外观专利和商标"],
      flags: ["brand_compatible", "apple"],
      shouldShowInPreview: true,
      shouldAllowImport: true,
      suggestedAction: "兼容配件需人工确认外观设计和商标风险",
    };
  }

  // Replica / knockoff / counterfeit → rejected
  if (/\b(replica|dupe|knock-?off|counterfeit|fake)\b/i.test(combined)) {
    return {
      level: "rejected",
      score: 5,
      label: "仿冒风险",
      reasons: ["明确标注 replica/dupe/仿品，存在严重商标/外观侵权风险"],
      flags: ["counterfeit", matched.source],
      shouldShowInPreview: false,
      shouldAllowImport: false,
      suggestedAction: "仿品/仿冒品不建议进入候选池",
    };
  }

  // Brand name in title → rejected
  return {
    level: "rejected",
    score: 12,
    label: "品牌侵权风险",
    reasons: [
      `疑似涉及知名品牌/IP（匹配: ${matched.source.slice(0, 30)}），存在商标/外观侵权风险`,
    ],
    flags: ["brand_risk", matched.source],
    shouldShowInPreview: false,
    shouldAllowImport: false,
    suggestedAction: "涉及知名品牌或IP，不建议进入候选池",
  };
}

// ── Rule: Caution Goods ─────────────────────────

function checkCaution(input: CandidateQualityInput): CandidateQualityResult | null {
  const title = effectiveTitle(input);
  const snippet = effectiveSnippet(input);
  const combined = `${title} ${snippet}`;

  const matches: RegExp[] = [];
  for (const p of CAUTION_KEYWORDS) {
    if (p.test(combined)) matches.push(p);
  }
  if (matches.length === 0) return null;

  const reasons: string[] = [];
  const flags: string[] = ["caution_goods"];

  // Test directly against combined text for flag assignment
  if (/charger|power\s*bank|power\s*supply|adapter|rechargeable|wireless\s*charg/i.test(combined)) {
    reasons.push("带电/插电商品可能涉及 FCC/CE/UL 认证要求");
    flags.push("electronic");
  }
  if (/battery|electronic|electric|plug|heated|USB\s*charger/i.test(combined) && !flags.includes("electronic")) {
    reasons.push("带电/插电商品可能涉及 FCC/CE/UL 认证要求");
    flags.push("electronic");
  }
  if (/baby|kids?|children|infant|toddler|nursery|stroller|pacifier/i.test(combined)) {
    reasons.push("儿童用品涉及 CPSIA/CPC 认证和安全标准");
    flags.push("children");
  }
  if (/food\s*(?:container|storage)|water\s*bottle|lunch\s*box|bento|thermos|kitchen.*tool|cooking\s*utensil|cutting\s*board/i.test(combined)) {
    reasons.push("食品接触材料涉及 FDA/LFGB 合规要求");
    flags.push("food_contact");
  }
  if (/cosmetic|skin\s*care|makeup|lotion|cream|essential\s*oil|lip\s*balm|perfume|fragrance/i.test(combined)) {
    reasons.push("化妆品/护肤品涉及 FDA 注册和成分合规");
    flags.push("cosmetic");
  }
  if (/glass\s*(?:bottle|jar|container)|ceramic|porcelain/i.test(combined)) {
    reasons.push("易碎品涉及物流损耗和包装成本");
    flags.push("fragile");
  }
  if (/magnet|neodymium/i.test(combined)) {
    reasons.push("含磁铁商品涉及运输安全和警告标签要求");
    flags.push("magnet");
  }
  if (/LED.*(?:lamp|light|bulb)|desk\s*lamp|table\s*lamp|night\s*light/i.test(combined)) {
    reasons.push("灯具/LED 商品涉及能效认证和电气安全");
    flags.push("lighting");
  }
  if (/pet\s*food|dog\s*treat|cat\s*treat/i.test(combined)) {
    reasons.push("宠物食品涉及 FDA/AAFCO 监管要求");
    flags.push("pet_food");
  }
  if (/children.*clothing|baby.*clothing|infant.*wear/i.test(combined)) {
    reasons.push("儿童服装涉及易燃性标准 (16 CFR 1610)");
    flags.push("children_textile");
  }

  if (reasons.length === 0) {
    reasons.push("可能涉及认证/材质/平台规则，需人工复核");
  }

  return {
    level: "caution",
    score: 50,
    label: "谨慎入池",
    reasons,
    flags,
    shouldShowInPreview: true,
    shouldAllowImport: true,
    suggestedAction: "建议人工复核认证要求和平台规则后再进入 Agent 主链路",
  };
}

// ── Rule: Beginner Friendly ─────────────────────

function checkBeginnerFriendly(input: CandidateQualityInput): CandidateQualityResult | null {
  const title = effectiveTitle(input);
  const snippet = effectiveSnippet(input);
  const combined = `${title} ${snippet}`;

  const matched = matchAny(combined, BEGINNER_FRIENDLY_KEYWORDS);
  if (!matched) return null;

  return {
    level: "recommended",
    score: 80,
    label: "推荐入池",
    reasons: [
      "非带电、非食品接触、非医疗、非儿童、非明显品牌的小件用品",
      "适合进入 Agent 主流程做人工复核",
    ],
    flags: ["beginner_friendly", matched.source],
    shouldShowInPreview: true,
    shouldAllowImport: true,
    suggestedAction: "低复杂度候选，适合进入 Agent 主流程做人工复核",
  };
}

// ── Main Entry Point ────────────────────────────

export function evaluateCandidateQuality(input: CandidateQualityInput): CandidateQualityResult {
  // Check rules in priority order. First match wins.

  // 1. Error pages → rejected immediately
  const errorResult = checkErrorPage(input);
  if (errorResult) return errorResult;

  // 2. Homepage / non-product page
  const nonProductResult = checkNonProductPage(input);
  if (nonProductResult) return nonProductResult;

  // 3. High-risk / regulated goods
  const highRiskResult = checkHighRisk(input);
  if (highRiskResult) return highRiskResult;

  // 4. Brand / IP risk
  const brandResult = checkBrandRisk(input);
  if (brandResult) return brandResult;

  // 5. Caution goods
  const cautionResult = checkCaution(input);
  if (cautionResult) return cautionResult;

  // 6. Beginner friendly
  const beginnerResult = checkBeginnerFriendly(input);
  if (beginnerResult) return beginnerResult;

  // 7. Default: neutral — show in preview, allow import
  const title = effectiveTitle(input);
  return {
    level: "recommended",
    score: 65,
    label: "可入池",
    reasons: ["未命中高风险或异常规则，建议人工复核"],
    flags: ["default_pass"],
    shouldShowInPreview: true,
    shouldAllowImport: true,
    suggestedAction: title
      ? `"${title}" 未命中高风险规则，可以进入 Agent 主链路做人工复核`
      : "可以进入 Agent 主链路做人工复核",
  };
}

/**
 * Batch evaluate multiple candidates.
 * Returns results in the same order, with summary stats.
 */
export function evaluateCandidatesQuality(
  inputs: CandidateQualityInput[],
): { results: CandidateQualityResult[]; summary: QualitySummary } {
  const results = inputs.map(evaluateCandidateQuality);
  return { results, summary: summarizeQuality(results) };
}

export interface QualitySummary {
  total: number;
  recommended: number;
  caution: number;
  notRecommended: number;
  rejected: number;
  shouldShowInPreview: number;
  shouldAllowImport: number;
}

function summarizeQuality(results: CandidateQualityResult[]): QualitySummary {
  let recommended = 0;
  let caution = 0;
  let notRecommended = 0;
  let rejected = 0;
  let shouldShowInPreview = 0;
  let shouldAllowImport = 0;

  for (const r of results) {
    if (r.level === "recommended") recommended++;
    else if (r.level === "caution") caution++;
    else if (r.level === "not_recommended") notRecommended++;
    else rejected++;

    if (r.shouldShowInPreview) shouldShowInPreview++;
    if (r.shouldAllowImport) shouldAllowImport++;
  }

  return {
    total: results.length,
    recommended,
    caution,
    notRecommended,
    rejected,
    shouldShowInPreview,
    shouldAllowImport,
  };
}

// ── Phase Core-2: Commercialized Quality Model ──

export type CandidateQualityTier = "recommended" | "caution" | "not_recommended";

export const QUALITY_TIER_LABELS: Record<CandidateQualityTier, string> = {
  recommended: "推荐分析",
  caution: "谨慎观察",
  not_recommended: "不建议",
};

export const QUALITY_TIER_TONES: Record<CandidateQualityTier, string> = {
  recommended: "border-emerald-200 bg-emerald-50 text-emerald-700",
  caution: "border-amber-200 bg-amber-50 text-amber-700",
  not_recommended: "border-slate-200 bg-slate-50 text-slate-500",
};

export type CandidatePageType =
  | "product_candidate"
  | "category_hint"
  | "navigation_page"
  | "sitemap_page"
  | "error_page"
  | "content_page"
  | "unknown";

export const PAGE_TYPE_LABELS: Record<CandidatePageType, string> = {
  product_candidate: "商品候选",
  category_hint: "类目线索",
  navigation_page: "导航页",
  sitemap_page: "站点地图页",
  error_page: "错误页",
  content_page: "内容页",
  unknown: "未知类型",
};

export const PAGE_TYPE_DESCRIPTIONS: Record<CandidatePageType, string> = {
  product_candidate: "可以进入单品分析",
  category_hint: "适合继续找具体商品，不建议直接分析",
  navigation_page: "通常不是商品，建议过滤",
  sitemap_page: "用于发现链接，不适合直接分析",
  error_page: "页面不可用，不建议分析",
  content_page: "可作为趋势参考，但需要人工提炼商品",
  unknown: "信息不足，建议谨慎",
};

/** Detect page type from candidate quality input */
export function detectPageType(input: CandidateQualityInput): CandidatePageType {
  const ct = (input.candidateType || "").toLowerCase();
  if (ct === "product_candidate") return "product_candidate";
  if (ct === "category_hint") return "category_hint";

  const title = (input.title || input.name || "").toLowerCase();
  const url = (input.url || "").toLowerCase();

  // Sitemap patterns
  if (/sitemap/i.test(title) || /sitemap/i.test(url)) return "sitemap_page";
  if (/\.xml(\?|$)/.test(url)) return "sitemap_page";

  // Category/navigation
  if (/category|categories|collection|all products|shop all/i.test(title)) return "category_hint";
  if (/\/collections\/|\/category\/|\/categories\/|\/c\//i.test(url)) return "category_hint";
  if (/\/$/.test(url) && !/\/products\/|\/item\/|\/detail\//i.test(url)) return "navigation_page";

  // Error
  if (/error|not found|404|403|500|unavailable/i.test(title)) return "error_page";

  // Content
  if (/blog|post|article|news|guide|how.to/i.test(title) || /\/blog\/|\/post\/|\/article\//i.test(url)) return "content_page";

  // Product-like
  if (/product|item|detail|goods/i.test(title) || /\/products\/|\/item\/|\/detail\//i.test(url)) return "product_candidate";

  return "unknown";
}

export interface CandidateQualityDisplay {
  tier: CandidateQualityTier;
  tierLabel: string;
  tierTone: string;
  score: number;
  pageType: CandidatePageType;
  pageTypeLabel: string;
  pageTypeDescription: string;
  allowAnalysis: boolean;
  primaryReason: string;
  reasons: string[];
  nextActionLabel: string;
}

/** Get display-friendly quality info for a candidate */
export function getCandidateQualityDisplay(result: CandidateQualityResult, input?: CandidateQualityInput): CandidateQualityDisplay {
  const tier: CandidateQualityTier =
    result.level === "rejected" ? "not_recommended" :
    result.level === "not_recommended" ? "not_recommended" :
    result.level === "caution" ? "caution" : "recommended";

  const pageType = input ? detectPageType(input) : "unknown";
  const reasons = result.reasons.length > 0 ? result.reasons : ["暂无详细理由"];

  let nextActionLabel = "查看详情";
  if (tier === "recommended") nextActionLabel = "进入 AI 分析";
  else if (tier === "caution") nextActionLabel = "谨慎评估";
  else nextActionLabel = "不建议分析";

  return {
    tier,
    tierLabel: QUALITY_TIER_LABELS[tier],
    tierTone: QUALITY_TIER_TONES[tier],
    score: result.score,
    pageType,
    pageTypeLabel: PAGE_TYPE_LABELS[pageType],
    pageTypeDescription: PAGE_TYPE_DESCRIPTIONS[pageType],
    allowAnalysis: tier === "recommended" || (tier === "caution" && result.shouldAllowImport),
    primaryReason: reasons[0] || "",
    reasons,
    nextActionLabel,
  };
}
