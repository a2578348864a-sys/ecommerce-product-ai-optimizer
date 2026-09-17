import {
  MARKETING_INSIGHT_REFERENCE_ONLY,
  MARKETING_INSIGHT_SCHEMA,
  type MarketingInsightConfidence,
  type MarketingInsightItem,
  type MarketingInsightV1,
  type MarketingResearchReference,
  type MarketingResearchReferenceText,
  type MarketingInsightSourceType,
} from "./types";
import { assertMarketingInsightV1 } from "./schema";

type VocTopic = { topic: string; terms: readonly string[]; pain: string; need: string };

const VOC_TOPICS: readonly VocTopic[] = [
  { topic: "organization_need", terms: ["messy", "clutter", "organize", "organization", "storage", "tidy"], pain: "用户关注杂乱、收纳或整理不便。", need: "用户需要更容易整理物品并保持空间有序。" },
  { topic: "access_need", terms: ["easy access", "access", "reach", "quickly", "convenient"], pain: "用户关注物品取用不便。", need: "用户需要在日常场景中更方便地取用物品。" },
  { topic: "setup_need", terms: ["install", "installation", "setup", "adhesive", "mount"], pain: "用户关注安装或设置过程。", need: "用户需要清晰、易理解的安装使用路径。" },
];

function textOf(value: MarketingResearchReferenceText): string {
  if (typeof value === "string") return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 300);
  return [value.theme, value.summary, value.keyword, value.note, value.title, ...(value.bullets ?? [])]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 300);
}

function lower(value: string): string {
  return value.toLocaleLowerCase();
}

function confidence(matches: number, total: number, strength?: string): MarketingInsightConfidence {
  if (strength === "recurring" || matches >= 2 || (total > 0 && matches / total >= 0.6)) return "high";
  if (matches === 1) return "medium";
  return "low";
}

function item(topic: string, summary: string, sourceType: MarketingInsightSourceType, level: MarketingInsightConfidence): MarketingInsightItem {
  return { topic, summary, sourceType, confidence: level, referenceOnly: MARKETING_INSIGHT_REFERENCE_ONLY };
}

function uniqueItems(items: readonly MarketingInsightItem[]): MarketingInsightItem[] {
  const seen = new Set<string>();
  return items.filter((entry) => {
    const key = `${entry.topic}|${entry.sourceType}|${entry.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function analyzeVoc(voc: readonly MarketingResearchReferenceText[]): Pick<MarketingInsightV1, "painPoints" | "customerNeeds"> {
  const texts = voc.map(textOf).filter(Boolean);
  const painPoints: MarketingInsightItem[] = [];
  const customerNeeds: MarketingInsightItem[] = [];
  for (const topic of VOC_TOPICS) {
    const matches = texts.filter((text) => topic.terms.some((term) => lower(text).includes(term))).length;
    if (matches === 0) continue;
    const strength = voc.find((entry) => typeof entry !== "string" && entry.strength === "recurring") ? "recurring" : undefined;
    const level = confidence(matches, texts.length, strength);
    painPoints.push(item(topic.topic, topic.pain, "VOC", level));
    customerNeeds.push(item(topic.topic, topic.need, "VOC", level));
  }
  return { painPoints: uniqueItems(painPoints), customerNeeds: uniqueItems(customerNeeds) };
}

function analyzeKeywords(keywords: readonly MarketingResearchReferenceText[]): Pick<MarketingInsightV1, "marketAngles" | "keywordThemes"> {
  const texts = keywords.map(textOf).filter(Boolean);
  const themes: Array<{ topic: string; terms: readonly string[]; label: string; summary: string }> = [
    { topic: "organization", terms: ["storage", "organizer", "organise", "organize"], label: "Organization", summary: "围绕收纳、整理和空间秩序组织市场表达。" },
    { topic: "kitchen_convenience", terms: ["kitchen", "counter", "countertop", "pantry"], label: "Kitchen Convenience", summary: "围绕厨房台面和日常取用便利组织市场表达。" },
    { topic: "access_intent", terms: ["easy access", "quick access", "reach"], label: "Easy Access", summary: "围绕快速取用这一搜索意图组织市场表达。" },
  ];
  const marketAngles: MarketingInsightItem[] = [];
  const keywordThemes: MarketingInsightItem[] = [];
  for (const theme of themes) {
    const matching = texts.filter((text) => theme.terms.some((term) => lower(text).includes(term)));
    if (matching.length === 0) continue;
    const level = confidence(matching.length, texts.length);
    marketAngles.push(item(theme.topic, theme.label, "keyword", level));
    keywordThemes.push(item(theme.topic, theme.summary, "keyword", level));
  }
  return { marketAngles: uniqueItems(marketAngles), keywordThemes: uniqueItems(keywordThemes) };
}

function analyzeCompetitors(competitors: readonly MarketingResearchReferenceText[]): MarketingInsightItem[] {
  const texts = competitors.map(textOf).filter(Boolean);
  if (texts.length === 0) return [];
  const all = lower(texts.join(" "));
  const patterns: MarketingInsightItem[] = [];
  if (/(help|keep|organize|separate|reduce|easy|convenient)/.test(all)) {
    patterns.push(item("feature_benefit_language", "竞品常用“产品特征 + 用户收益”的表达结构，适合作为趋势参考。", "competitor", confidence(texts.length, texts.length)));
  }
  if (/(kitchen|counter|bathroom|desk|home|office)/.test(all)) {
    patterns.push(item("scenario_led_language", "竞品常把产品特征放入具体使用场景中表达，适合作为结构参考。", "competitor", "medium"));
  }
  if (patterns.length === 0) patterns.push(item("common_positioning", "竞品资料可用于观察常见定位方向，不能直接复制其商品声明。", "competitor", "low"));
  return patterns;
}

function analyzeSourcing(sourcing: readonly MarketingResearchReferenceText[]): MarketingInsightItem[] {
  if (sourcing.every((entry) => textOf(entry).length === 0)) return [];
  return [item("feature_availability_reference", "供应资料仅用于观察潜在特征可得性；不能视为当前商品事实、成本或合规依据。", "sourcing", sourcing.length > 1 ? "medium" : "low")];
}

/**
 * Deterministic, reference-only marketing analysis. It never calls a Provider,
 * mutates the input, or returns product facts/claims.
 */
export function analyzeMarketingIntelligence(reference: MarketingResearchReference): MarketingInsightV1 {
  const voc = Array.isArray(reference?.voc) ? reference.voc : [];
  const keywords = Array.isArray(reference?.keywords) ? reference.keywords : [];
  const competitors = Array.isArray(reference?.competitors) ? reference.competitors : [];
  const sourcing = Array.isArray(reference?.sourcing) ? reference.sourcing : [];
  const vocResult = analyzeVoc(voc);
  const keywordResult = analyzeKeywords(keywords);
  const competitorPatterns = analyzeCompetitors(competitors);
  const sourcingPatterns = analyzeSourcing(sourcing);
  const recommendations: MarketingInsightItem[] = [];
  if (vocResult.painPoints.length > 0) recommendations.push(item("pain_point_first", "先回应研究中反复出现的用户痛点，再用已确认事实说明产品如何帮助用户。", "VOC", "medium"));
  if (keywordResult.marketAngles.length > 0) recommendations.push(item("search_intent_structure", "围绕关键词表达的搜索意图安排标题和卖点结构；关键词本身仅供策略参考。", "keyword", "medium"));
  if (competitorPatterns.length > 0) recommendations.push(item("original_expression", "可参考竞品的表达结构，但每条商品陈述都必须回到当前商品的事实与证据。", "competitor", "medium"));
  if (sourcingPatterns.length > 0) recommendations.push(item("availability_check", "供应资料只用于评估特征可得性，不能视为当前商品事实，使用前仍需单独完成事实确认。", "sourcing", "low"));

  const report: MarketingInsightV1 = {
    version: MARKETING_INSIGHT_SCHEMA,
    referenceOnly: MARKETING_INSIGHT_REFERENCE_ONLY,
    painPoints: vocResult.painPoints,
    customerNeeds: vocResult.customerNeeds,
    marketAngles: keywordResult.marketAngles,
    keywordThemes: keywordResult.keywordThemes,
    competitorPatterns,
    recommendations,
  };
  assertMarketingInsightV1(report);
  return report;
}
