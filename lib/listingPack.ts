/**
 * Phase Core-4-Fix.0 — AI Listing Preparation Pack (Quality Fix)
 *
 * Generates structured listing prep drafts with improved content quality.
 * Uses rule-based fallback — no real AI calls in local dev.
 */

export type ListingPackKeyword = {
  keyword: string;
  intent: "core" | "long_tail" | "scenario" | "audience" | "feature";
};

export type ListingPackRiskTerm = {
  term: string;
  reason: string;
  saferAlternative: string;
};

export type ListingPack = {
  titleDrafts: string[];
  bulletPoints: string[];
  coreKeywords: ListingPackKeyword[];
  longTailKeywords: ListingPackKeyword[];
  scenarioKeywords: ListingPackKeyword[];
  audienceKeywords: ListingPackKeyword[];
  featureKeywords: ListingPackKeyword[];
  sellingPoints: string[];
  targetAudience: string[];
  imageRequirements: string[];
  priceSuggestion: string;
  riskTerms: ListingPackRiskTerm[];
  prePublishChecklist: string[];
  disclaimer: string;
  source: "rule_based" | "ai";
  generatedAt: string;
};

// ── Defaults with improved quality ───────────────

const RISK_TERMS: ListingPackRiskTerm[] = [
  { term: "100% 有效", reason: "绝对化承诺，容易违反广告法或平台规则", saferAlternative: "根据实际使用场景描述效果，避免绝对承诺" },
  { term: "稳赚 / 必赚", reason: "保证盈利属虚假承诺，平台可予以下架", saferAlternative: "提供成本、售价和利润估算供运营参考" },
  { term: "爆款必出", reason: "无法保证销售结果，虚假承诺风险高", saferAlternative: "展示选品依据、市场需求和风险分析" },
  { term: "官方授权 / 正品", reason: "如无品牌授权文件不得宣称，跨境场景尤需注意", saferAlternative: "取得授权后再添加；或使用品牌商品描述但注明待确认" },
  { term: "治疗 / 治愈", reason: "医疗功效宣称需 FDA/CE 等认证，无认证不得使用", saferAlternative: "描述产品使用场景，避免任何功效或治疗宣称" },
  { term: "无副作用 / 无毒", reason: "需临床或第三方检测报告支撑", saferAlternative: "使用\"使用注意事项\"\"材质安全信息待供应商确认\"" },
  { term: "永久 / 终身", reason: "绝对化用语，平台可能判定虚假宣传", saferAlternative: "使用\"耐用\"\"长期使用\"\"可重复使用\"" },
  { term: "最强 / 最好 / 第一", reason: "无法客观证明，违反多数平台规则", saferAlternative: "使用\"优质\"\"高性价比\"\"受市场欢迎\"" },
  { term: "唯一 / 独家", reason: "除非有独家授权证明，否则不可使用", saferAlternative: "使用\"独特设计\"\"特色功能\"" },
  { term: "免费送货 / 次日达", reason: "跨境物流无法保证时效，承诺风险高", saferAlternative: "根据实际物流方案描述配送方式和预计时效" },
  { term: "FDA 认证 / CE 认证", reason: "未经认证不得宣称，伪造认证属严重违规", saferAlternative: "取得认证文件后再添加；或注明\"认证状态待确认\"" },
  { term: "环保 / 可降解", reason: "需第三方检测报告支撑，否则属虚假宣传", saferAlternative: "描述材质成分，由买家自行判断；或注明\"材质声明待供应商确认\"" },
];

const IMAGE_REQUIREMENTS = [
  "白底主图：展示完整商品外观，纯白背景，不低于 1000×1000px，避免添加文字、边框或水印",
  "多角度图：正面、侧面、背面、顶部各一张，展示商品全貌",
  "尺寸/比例示意图：标注长宽高、直径、重量等关键参数，方便买家判断尺寸",
  "使用场景图：展示商品在真实场景中的使用方式，2-3 张",
  "细节/材质图：材质纹理、接口、按键、缝线等特写",
  "包装/配件图：包装外观、内含配件全家福",
  "对比图：与常见参照物对比，帮助买家直观理解尺寸",
];

const CHECKLIST = [
  "确认标题不包含未授权的品牌词、绝对化用语、医疗功效",
  "确认五点描述不包含虚假承诺或保证性语句",
  "确认关键词不包含竞品品牌词或高风险平台禁词",
  "确认图片不侵犯他人版权、不使用竞品图片",
  "确认价格包含采购成本、头程运费、平台佣金、尾程运费和预期利润",
  "确认产品必需认证文件齐全（如 CE / FCC / CPC / RoHS / MSDS 等）",
  "确认目标平台类目规则、禁售清单和上架要求",
  "确认售后政策、退货地址和客服联系方式",
];

// ── Helpers ─────────────────────────────────────

function text(v: unknown, fallback = ""): string { return typeof v === "string" && v.trim() ? v.trim() : fallback; }
function arr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []; }
function isRec(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }

// ── Contextual word lists ────────────────────────

const SCENARIO_WORDS = ["home", "office", "travel", "outdoor", "kitchen", "bathroom", "bedroom", "desk", "car", "camping", "garden", "storage", "organization", "decoration", "gift", "daily use", "cleaning", "cooking", "working", "studying", "sports", "fitness"];
const FEATURE_WORDS = ["portable", "foldable", "adjustable", "lightweight", "compact", "durable", "reusable", "easy to use", "multi-purpose", "space-saving", "waterproof", "non-slip", "soft", "sturdy", "breathable", "eco-friendly pending verification", "easy to clean"];
const AUDIENCE_WORDS = ["students", "office workers", "home users", "travelers", "parents", "pet owners", "small business owners", "beginners", "DIY enthusiasts"];

function extractWords(name: string): string[] {
  const parts = name.split(/[\s\-/.,;:!@#$%^&*()_+=]+/).filter(w => w.length > 1 && !/^(the|a|an|for|and|or|of|in|on|to|with|is|are|was)$/i.test(w));
  return [...new Set(parts)];
}

function pickContextual(list: string[], count: number, existing: Set<string>): string[] {
  const shuffled = [...list].sort(() => 0.5 - Math.random());
  const result: string[] = [];
  for (const w of shuffled) {
    if (result.length >= count) break;
    if (!existing.has(w.toLowerCase())) { result.push(w); existing.add(w.toLowerCase()); }
  }
  return result;
}

// ── Generator ───────────────────────────────────

export function buildFallbackListingPack(input: {
  productName?: string | null;
  resultJson?: unknown;
  riskReviewSnapshot?: unknown;
  profitSnapshot?: unknown;
}): ListingPack {
  const name = text(input.productName, "待分析商品");
  const result = isRec(input.resultJson) ? input.resultJson : null;
  const finalReport = result && isRec(result.finalReport) ? result.finalReport : null;
  const listingResult = result && isRec(result.listing) ? result.listing : null;
  const riskSnap = isRec(input.riskReviewSnapshot) ? input.riskReviewSnapshot : null;
  const profitSnap = isRec(input.profitSnapshot) ? input.profitSnapshot : null;

  const existingKeys = arr(listingResult?.keywords || result?.keywords || []);
  const nameWords = extractWords(name);
  const allSourceWords = [...new Set([...nameWords, ...existingKeys])];
  const usedSet = new Set(allSourceWords.map(w => w.toLowerCase()));

  // Keywords with proper layering
  const coreKw: ListingPackKeyword[] = allSourceWords.slice(0, 5).map(w => ({ keyword: w, intent: "core" }));
  const scenarioKw: ListingPackKeyword[] = pickContextual(SCENARIO_WORDS, 4, usedSet).map(w => ({ keyword: w, intent: "scenario" }));
  const featureKw: ListingPackKeyword[] = pickContextual(FEATURE_WORDS, 4, usedSet).map(w => ({ keyword: w, intent: "feature" }));
  const audienceKw: ListingPackKeyword[] = pickContextual(AUDIENCE_WORDS, 3, usedSet).map(w => ({ keyword: w, intent: "audience" }));

  const longTailKw: ListingPackKeyword[] = [];
  const kwPool = [...allSourceWords, ...scenarioKw.map(k => k.keyword), ...featureKw.map(k => k.keyword)];
  for (const a of audienceKw) { for (const k of kwPool.slice(0, 3)) { longTailKw.push({ keyword: `${k} for ${a.keyword}`, intent: "long_tail" }); } }
  for (const s of scenarioKw.slice(0, 3)) { for (const f of featureKw.slice(0, 2)) { longTailKw.push({ keyword: `${s.keyword} ${f.keyword} ${name}`, intent: "long_tail" }); } }

  // Title drafts — 3 styles
  const kwSample = allSourceWords.slice(0, 2).join(" ").trim() || name;
  const scenarioSample = scenarioKw.slice(0, 2).map(k => k.keyword).join(", ");
  const featureSample = featureKw.slice(0, 2).map(k => k.keyword).join(", ");
  const titleDrafts = [
    `${name}, ${featureSample || "Practical"} for ${scenarioSample || "Daily Use"} — Cross-border Listing Draft`,
    `${name} for ${audienceKw[0]?.keyword || "Users"}, ${featureKw[0]?.keyword || "Versatile"} and ${featureKw[1]?.keyword || "Convenient"} — Pending Supplier Confirmation`,
    `${name} — ${scenarioSample || "Multi-Scenario"} for Small Batch Testing and Listing Prep`,
  ];

  // Bullet points — usable copy, not "待人工补充"
  const bulletPoints = [
    `${name} is suitable for ${scenarioSample || "daily use"} scenarios such as ${scenarioKw.slice(0, 3).map(k => k.keyword).join(", ")}. Specific use cases should be confirmed with product samples before listing.`,
    `Key specifications including dimensions, weight, material composition and compatibility should be verified against supplier documentation. Do not publish unconfirmed specs on the listing.`,
    `Installation and usage instructions can be organized around ${featureSample || "key features"}. Avoid overstating unverified functionality or performance claims.`,
    `Package contents, included accessories and any gifted items must be confirmed with the supplier and clearly stated to avoid buyer disputes.`,
    `Warranty period, return policy and after-sales support details should be finalized before publishing. Include safety warnings per platform and regional requirements.`,
  ];

  // Selling points
  const verdict = text(finalReport?.finalVerdict || "");
  const sellingPoints = verdict
    ? [verdict, `Suitable for small batch testing to validate market fit`, `Clear use case for scenario-based listing photography`, `Moderate complexity — manageable for beginner cross-border sellers`, `Key risk areas identified — human review required before publishing`]
    : [`${name} — suitable for initial product validation and small batch testing`, `Practical use cases for listing visuals and marketing content`, `Manageable complexity for cross-border beginners`, `Risk areas flagged for human review before publishing`];

  // Target audience
  const targetAudience = [`Cross-border e-commerce sellers`, `Small batch testers and product scouts`, audienceKw.slice(0, 2).map(k => k.keyword).join(", ") || "General consumers"];

  // Price suggestion
  let priceSuggestion = "Current data lacks complete cost breakdown (purchase price, shipping, platform fees, estimated profit margin). Suggest filling in supplier quotes, freight costs and platform commission rates before setting a target price.";
  if (profitSnap && typeof (profitSnap as Record<string,unknown>).salePrice === "number") {
    const sp = (profitSnap as Record<string,unknown>).salePrice as number;
    const ec = (profitSnap as Record<string,unknown>).purchaseCost as number || 0;
    const ep = (profitSnap as Record<string,unknown>).estimatedProfit as number || 0;
    priceSuggestion = `Estimated sale price: ~¥${sp.toFixed(2)} (cost ~¥${ec.toFixed(2)}, profit ~¥${ep.toFixed(2)}). This is a rough estimate only — confirm real costs, shipping fees and platform fees before listing.`;
  }

  // Risk terms from existing risk data
  const riskWarnings = arr(riskSnap?.complianceWarnings || riskSnap?.blacklistMatches || []);
  const extraRisks: ListingPackRiskTerm[] = riskWarnings.slice(0, 3).map(w => ({ term: w, reason: "AI pre-check detected a potential risk term", saferAlternative: "Human review required before using this term in listing" }));

  return {
    titleDrafts,
    bulletPoints,
    coreKeywords: coreKw,
    longTailKeywords: longTailKw,
    scenarioKeywords: scenarioKw,
    audienceKeywords: audienceKw,
    featureKeywords: featureKw,
    sellingPoints,
    targetAudience,
    imageRequirements: IMAGE_REQUIREMENTS,
    priceSuggestion,
    riskTerms: [...RISK_TERMS, ...extraRisks],
    prePublishChecklist: CHECKLIST,
    disclaimer: "This is a rule-based draft listing preparation pack. It does NOT auto-publish to any platform. All content must be reviewed against platform rules, IP compliance, product authenticity, cost data and supplier documentation before publishing. AI assists — humans make the final decision.",
    source: "rule_based",
    generatedAt: new Date().toISOString(),
  };
}

// ── Markdown export ─────────────────────────────

export function listingPackToMarkdown(pack: ListingPack): string {
  const L = (s: string) => { lines.push(s); };
  const lines: string[] = [];
  const label = pack.source === "ai" ? "AI 生成" : "规则兜底草稿";

  L(`# Listing 准备包：${pack.titleDrafts[0] || "待分析商品"}`);
  L("");
  L(`> ⚠️ 当前为**${label}**，不会自动上架。发布前必须人工复核商品真实性、平台规则、侵权风险、成本利润和供应商资料。`);
  L("");

  L("## 标题草稿");
  L("### 搜索关键词型");
  L(`- ${pack.titleDrafts[0]}`);
  L("### 卖点表达型");
  L(`- ${pack.titleDrafts[1]}`);
  L("### 场景使用型");
  L(`- ${pack.titleDrafts[2]}`);
  L("");

  L("## 五点描述");
  pack.bulletPoints.forEach((b, i) => L(`${i + 1}. ${b}`));
  L("");

  L("## 关键词");
  if (pack.coreKeywords.length > 0) { L("### 核心关键词"); pack.coreKeywords.forEach(k => L(`- ${k.keyword}`)); L(""); }
  if (pack.longTailKeywords.length > 0) { L("### 长尾关键词"); pack.longTailKeywords.slice(0, 8).forEach(k => L(`- ${k.keyword}`)); L(""); }
  if (pack.scenarioKeywords.length > 0) { L("### 场景关键词"); pack.scenarioKeywords.forEach(k => L(`- ${k.keyword}（${k.intent}）`)); L(""); }
  if (pack.featureKeywords.length > 0) { L("### 功能关键词"); pack.featureKeywords.forEach(k => L(`- ${k.keyword}`)); L(""); }
  if (pack.audienceKeywords.length > 0) { L("### 人群关键词"); pack.audienceKeywords.forEach(k => L(`- ${k.keyword}`)); L(""); }

  L("## 卖点提炼");
  pack.sellingPoints.forEach(s => L(`- ${s}`));
  L("");

  L("## 目标用户");
  pack.targetAudience.forEach(a => L(`- ${a}`));
  L("");

  L("## 图片需求");
  pack.imageRequirements.forEach(r => L(`- ${r}`));
  L("");

  L("## 价格建议");
  L(pack.priceSuggestion);
  L("");

  L("## 风险用词提醒");
  L("以下词汇不建议直接用于 Listing，发布前需结合平台规则、品牌侵权和商品实物人工确认：");
  L("");
  pack.riskTerms.slice(0, 10).forEach(r => L(`- ⚠️ **${r.term}** → ${r.saferAlternative}`));
  L("");

  L("## 上架前检查清单");
  pack.prePublishChecklist.forEach(c => L(`- [ ] ${c}`));
  L("");
  L("---");
  L(`> ${pack.disclaimer}`);
  L(`> 生成方式：${label} · ${pack.generatedAt}`);

  return lines.join("\n");
}
