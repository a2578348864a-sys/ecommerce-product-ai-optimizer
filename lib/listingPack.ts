/**
 * Phase Core-4 — AI Listing Preparation Pack
 *
 * Generates a structured listing preparation draft from existing task/analysis data.
 * Uses rule-based fallback — no real AI calls in local dev.
 *
 * Does NOT:
 * - Call real AI (local dev uses fallback only)
 * - Write to database
 * - Publish to platforms
 * - Guarantee compliance or profitability
 */

// ── Types ───────────────────────────────────────

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
  sellingPoints: string[];
  targetAudience: string[];
  imageRequirements: string[];
  priceSuggestion: string;
  riskTerms: ListingPackRiskTerm[];
  prePublishChecklist: string[];
  disclaimer: string;
  source: "fallback" | "ai";
  generatedAt: string;
};

// ── Risk terms ──────────────────────────────────

const DEFAULT_RISK_TERMS: ListingPackRiskTerm[] = [
  { term: "100% 有效", reason: "绝对化承诺违反广告法和平台规则", saferAlternative: "描述具体功效或参考用户反馈" },
  { term: "稳赚", reason: "保证盈利属虚假承诺", saferAlternative: "提供成本/售价/利润估算供参考" },
  { term: "爆款必出", reason: "无法保证销售结果", saferAlternative: "展示选品依据和市场需求分析" },
  { term: "官方授权", reason: "如无授权文件不得宣称", saferAlternative: "在获得授权后再添加" },
  { term: "正品", reason: "在跨境场景中需有品牌授权支撑", saferAlternative: "使用\"品牌商品\"或省略" },
  { term: "治疗", reason: "医疗功效宣称需认证", saferAlternative: "避免功效宣称，使用\"适用场景\"" },
  { term: "治愈", reason: "医疗功效宣称需认证", saferAlternative: "避免功效宣称" },
  { term: "无副作用", reason: "需临床验证", saferAlternative: "使用\"使用注意事项\"" },
  { term: "永久", reason: "绝对化用语", saferAlternative: "使用\"耐用\"\"长期\"" },
  { term: "最强", reason: "绝对化用语违规", saferAlternative: "使用\"优质\"\"高性价比\"" },
  { term: "第一", reason: "无法证明", saferAlternative: "使用\"受欢迎\"\"热销\"" },
  { term: "唯一", reason: "无法证明", saferAlternative: "使用\"独特\"\"特色\"" },
];

const DEFAULT_IMAGE_REQUIREMENTS = [
  "主图：白底产品图，展示产品全貌，至少 1000×1000px",
  "场景图：产品在实际使用场景中的展示，2-3 张",
  "尺寸/参数图：标注关键尺寸、重量、规格参数",
  "细节图：材质纹理、接口、按键等特写",
  "包装/配件图：包装外观、内含配件全家福",
];

const DEFAULT_CHECKLIST = [
  "确认标题不含品牌词、绝对化用语、医疗功效",
  "确认五点描述不含虚假承诺",
  "确认关键词不包含竞品品牌词",
  "确认图片不侵犯他人版权",
  "确认价格包含所有成本和运费",
  "确认产品认证文件齐全（CE/FCC/CPC 等）",
  "确认平台类目规则和禁售清单",
  "确认售后和退货政策",
];

// ── Helpers ─────────────────────────────────────

function text(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Fallback generator ──────────────────────────

export function buildFallbackListingPack(input: {
  productName?: string | null;
  resultJson?: unknown;
  riskReviewSnapshot?: unknown;
  profitSnapshot?: unknown;
}): ListingPack {
  const name = text(input.productName, "待分析商品");
  const result = isRecord(input.resultJson) ? input.resultJson : null;
  const finalReport = result && isRecord(result.finalReport) ? result.finalReport : null;
  const listingResult = result && isRecord(result.listing) ? result.listing : null;
  const riskSnap = isRecord(input.riskReviewSnapshot) ? input.riskReviewSnapshot : null;
  const profitSnap = isRecord(input.profitSnapshot) ? input.profitSnapshot : null;

  // Keywords from existing listing data
  const existingKeywords = arr(listingResult?.keywords || result?.keywords || []);
  const keywords = existingKeywords.length > 0
    ? existingKeywords
    : [name, ...name.split(/[\s\-/]+/).filter(w => w.length > 1)];

  const coreKw = keywords.slice(0, 5).map(k => ({ keyword: k, intent: "core" as const }));
  const longTailKw = keywords.slice(5, 10).map(k => ({ keyword: k, intent: "long_tail" as const }));

  // Title drafts
  const titleDrafts = [
    `${name} — 高品质跨境电商商品`,
    `${name} — 适合多场景使用的实用产品`,
    `${name} — 精选材质，可靠耐用`,
  ];

  // Bullet points
  const bulletPoints = [
    `【核心使用场景】${name} 适用于${keywords.slice(0, 3).join("、") || "多场景"} — 待人工确认具体场景和卖点`,
    `【材质与规格】待人工补充精确的尺寸、材质、重量和适配型号`,
    `【安装与使用】待人工补充使用步骤、便利性说明`,
    `【包装内容】待人工补充包装清单、配件和赠品信息`,
    `【售后与注意事项】待人工补充质保期、退换货政策和安全提醒`,
  ];

  // Selling points
  const verdict = text(finalReport?.finalVerdict || finalReport?.beginnerFit || "");
  const sellingPoints = verdict ? [verdict] : [`${name} — 待人工提炼核心卖点`];

  // Target audience
  const targetAudience = ["跨境电商买家", "根据商品类型进一步细化 — 待人工确认"];

  // Price suggestion
  let priceSuggestion = "待补充成本、售价和运费信息后生成价格建议。";
  if (profitSnap && typeof (profitSnap as Record<string,unknown>).salePrice === "number") {
    const sp = (profitSnap as Record<string,unknown>).salePrice as number;
    priceSuggestion = `建议售价参考：¥${sp.toFixed(2)}。此为估算值，需人工确认真实成本、运费和平台费用。`;
  }

  // Risk terms from existing risk data
  const riskWarnings = arr(riskSnap?.complianceWarnings || riskSnap?.blacklistMatches || []);
  const extraRiskTerms: ListingPackRiskTerm[] = riskWarnings.slice(0, 3).map(w => ({
    term: w,
    reason: "AI 预筛中检测到可能的风险词",
    saferAlternative: "请人工确认后决定是否使用",
  }));

  return {
    titleDrafts,
    bulletPoints,
    coreKeywords: coreKw,
    longTailKeywords: longTailKw,
    sellingPoints,
    targetAudience,
    imageRequirements: DEFAULT_IMAGE_REQUIREMENTS,
    priceSuggestion,
    riskTerms: [...DEFAULT_RISK_TERMS, ...extraRiskTerms],
    prePublishChecklist: DEFAULT_CHECKLIST,
    disclaimer: "本内容为 AI 草稿，不会自动上架。发布前必须人工复核平台规则、侵权、合规、成本和真实商品信息。AI 生成，人负责最终确认。",
    source: "fallback",
    generatedAt: new Date().toISOString(),
  };
}

// ── Markdown export ─────────────────────────────

export function listingPackToMarkdown(pack: ListingPack): string {
  const lines: string[] = [];
  lines.push(`# AI Listing 包：${pack.titleDrafts[0] || "待分析商品"}`);
  lines.push("");
  lines.push("## 标题草稿");
  pack.titleDrafts.forEach(t => lines.push(`- ${t}`));
  lines.push("");
  lines.push("## 五点描述");
  pack.bulletPoints.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
  lines.push("");
  lines.push("## 核心关键词");
  pack.coreKeywords.forEach(k => lines.push(`- ${k.keyword}（${k.intent === "core" ? "核心词" : ""}）`));
  lines.push("");
  if (pack.longTailKeywords.length > 0) {
    lines.push("## 长尾关键词");
    pack.longTailKeywords.forEach(k => lines.push(`- ${k.keyword}`));
    lines.push("");
  }
  lines.push("## 卖点提炼");
  pack.sellingPoints.forEach(s => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## 目标用户");
  pack.targetAudience.forEach(a => lines.push(`- ${a}`));
  lines.push("");
  lines.push("## 图片需求");
  pack.imageRequirements.forEach(r => lines.push(`- ${r}`));
  lines.push("");
  lines.push("## 价格建议");
  lines.push(pack.priceSuggestion);
  lines.push("");
  lines.push("## 风险用词提醒");
  pack.riskTerms.slice(0, 8).forEach(r => {
    lines.push(`- ⚠️ **${r.term}**：${r.reason} → 建议：${r.saferAlternative}`);
  });
  lines.push("");
  lines.push("## 上架前检查清单");
  pack.prePublishChecklist.forEach(c => lines.push(`- [ ] ${c}`));
  lines.push("");
  lines.push("---");
  lines.push(`> ${pack.disclaimer}`);
  lines.push(`> 生成方式：${pack.source === "ai" ? "AI 生成" : "规则兜底草稿"} · ${pack.generatedAt}`);
  return lines.join("\n");
}
