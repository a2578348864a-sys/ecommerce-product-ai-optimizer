import {
  LISTING_QUALITY_BENEFIT_TERMS,
  LISTING_QUALITY_RISK_TERMS,
  LISTING_QUALITY_SCENARIO_TERMS,
  type QualityFact,
  factValueMentioned,
  hasAnyQualityTerm,
  normalizeQualityText,
  qualityTokens,
  supportedFactForText,
  unsupportedRiskTerms,
} from "./listingQualityRules";

export type ListingQualitySection = "title" | "bullet" | "description" | "compliance";
export type ListingQualityIssue = {
  code: string;
  section: ListingQualitySection;
  severity: "issue" | "suggestion";
  message: string;
  suggestion?: string;
  bulletIndex?: number;
  factValue?: string;
};

export type ListingQualityReport = {
  titleScore: number;
  bulletScore: number;
  descriptionScore: number;
  complianceScore: number;
  overallScore: number;
  missingSections: string[];
  issues: ListingQualityIssue[];
  suggestions: ListingQualityIssue[];
  requiresHumanReview: true;
};

export type ListingQualityPolicyInput = {
  title: string;
  bullets: readonly string[];
  description: string;
  facts: readonly QualityFact[];
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function issue(input: Omit<ListingQualityIssue, "severity">): ListingQualityIssue {
  return { ...input, severity: "issue" };
}

function suggestion(input: Omit<ListingQualityIssue, "severity">): ListingQualityIssue {
  return { ...input, severity: "suggestion" };
}

function titleRepeatedAttributes(title: string, facts: readonly QualityFact[]): string[] {
  const normalized = normalizeQualityText(title);
  return facts
    .map((fact) => normalizeQualityText(fact.value))
    .filter((value) => value.length >= 3 && normalized.split(value).length > 2);
}

function duplicateTitleTokens(title: string): string[] {
  const counts = new Map<string, number>();
  for (const token of qualityTokens(title)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([token]) => token);
}

function productTypeFact(facts: readonly QualityFact[]): QualityFact | undefined {
  return facts.find((fact) => fact.field === "product_type") ?? facts.find((fact) => /product.?type|category|商品类型/i.test(`${fact.field ?? ""} ${fact.label ?? ""}`));
}

function scenarioFact(facts: readonly QualityFact[]): QualityFact | undefined {
  return facts.find((fact) => ["usage", "use_case", "application", "scenario"].includes(String(fact.field))) ?? facts.find((fact) => /usage|scenario|用途|场景/i.test(`${fact.field ?? ""} ${fact.label ?? ""}`));
}

function nonIdentityFact(facts: readonly QualityFact[]): QualityFact | undefined {
  return facts.find((fact) => !["brand", "product_type", "series_or_model"].includes(String(fact.field)));
}

function evaluateTitle(title: string, facts: readonly QualityFact[], issues: ListingQualityIssue[], suggestions: ListingQualityIssue[]): number {
  let score = 100;
  if (!title.trim()) {
    issues.push(issue({ code: "title_empty", section: "title", message: "标题为空。" }));
    return 0;
  }
  const repeated = titleRepeatedAttributes(title, facts);
  if (repeated.length > 0 || duplicateTitleTokens(title).length > 0) {
    score -= 25;
    issues.push(issue({ code: "title_repeated_attribute", section: "title", message: "标题重复了属性或词语，请保留一次即可。" }));
  }
  const type = productTypeFact(facts);
  if (type && !factValueMentioned(title, type.value)) {
    score -= 25;
    issues.push(issue({ code: "title_missing_product_type", section: "title", message: "标题缺少已确认的品类词。", factValue: type.value }));
  }
  if (title.length > 200 || /^[,.;:|/-]/.test(title.trim()) || /[,|/]{3,}/.test(title)) {
    score -= 20;
    issues.push(issue({ code: "title_structure", section: "title", message: "标题结构异常（长度、开头标点或分隔符使用异常）。" }));
  }
  const tokens = qualityTokens(title);
  if (tokens.length >= 18 || duplicateTitleTokens(title).length >= 2) {
    score -= 20;
    issues.push(issue({ code: "title_keyword_stacking", section: "title", message: "标题可能存在关键词堆叠，建议改为自然语序。" }));
  }
  const brand = facts.find((fact) => fact.field === "brand");
  const quantity = facts.find((fact) => fact.field === "quantity_or_pack_size" || /quantity|pack|数量|包装/i.test(`${fact.field ?? ""} ${fact.label ?? ""}`));
  const scenario = scenarioFact(facts);
  if (brand && !factValueMentioned(title, brand.value)) suggestions.push(suggestion({ code: "title_brand_suggestion", section: "title", message: `建议在标题前部使用已确认品牌“${brand.value}”。`, factValue: brand.value }));
  if (scenario && !factValueMentioned(title, scenario.value)) suggestions.push(suggestion({ code: "title_use_case_suggestion", section: "title", message: `可考虑加入已确认使用场景“${scenario.value}”。`, factValue: scenario.value }));
  if (quantity && !factValueMentioned(title, quantity.value)) suggestions.push(suggestion({ code: "title_quantity_suggestion", section: "title", message: `可考虑加入已确认包装数量“${quantity.value}”。`, factValue: quantity.value }));
  return clampScore(score);
}

function evaluateBullets(bullets: readonly string[], facts: readonly QualityFact[], issues: ListingQualityIssue[], suggestions: ListingQualityIssue[]): number {
  if (bullets.length === 0) return 0;
  const scores = bullets.map((bullet, index) => {
    let score = 100;
    const anchored = supportedFactForText(bullet, facts);
    const hasBenefit = hasAnyQualityTerm(bullet, LISTING_QUALITY_BENEFIT_TERMS);
    const scenario = hasAnyQualityTerm(bullet, LISTING_QUALITY_SCENARIO_TERMS) || (scenarioFact(facts) ? factValueMentioned(bullet, scenarioFact(facts)!.value) : false);
    if (!anchored) {
      score -= 40;
      issues.push(issue({ code: "bullet_missing_feature", section: "bullet", bulletIndex: index, message: `第 ${index + 1} 条卖点没有找到已确认事实锚点。` }));
    }
    if (!hasBenefit) {
      score -= 25;
      const factValue = anchored?.value ?? nonIdentityFact(facts)?.value;
      issues.push(issue({ code: "bullet_missing_benefit", section: "bullet", bulletIndex: index, message: `第 ${index + 1} 条卖点只有属性表达，缺少购买价值。`, factValue }));
      if (factValue) suggestions.push(suggestion({ code: "bullet_benefit_suggestion", section: "bullet", bulletIndex: index, message: `围绕已确认事实“${factValue}”补充用户收益和使用结果。`, suggestion: `Use the confirmed fact “${factValue}” to explain how it helps the buyer in the stated use context.`, factValue }));
    }
    if (!scenario) {
      score -= 20;
      const factValue = scenarioFact(facts)?.value ?? anchored?.value;
      issues.push(issue({ code: "bullet_missing_scenario", section: "bullet", bulletIndex: index, message: `第 ${index + 1} 条卖点缺少使用场景。`, factValue }));
      if (factValue) suggestions.push(suggestion({ code: "bullet_scenario_suggestion", section: "bullet", bulletIndex: index, message: `结合已确认事实“${factValue}”说明适用场景。`, factValue }));
    }
    return clampScore(score);
  });
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function evaluateDescription(description: string, facts: readonly QualityFact[], issues: ListingQualityIssue[], suggestions: ListingQualityIssue[]): { score: number; missing: string[] } {
  const missing: string[] = [];
  const type = productTypeFact(facts);
  const scenario = scenarioFact(facts);
  const feature = nonIdentityFact(facts);
  const hasProduct = Boolean(type && factValueMentioned(description, type.value));
  const hasScenario = Boolean((scenario && factValueMentioned(description, scenario.value)) || hasAnyQualityTerm(description, LISTING_QUALITY_SCENARIO_TERMS));
  const hasValue = hasAnyQualityTerm(description, LISTING_QUALITY_BENEFIT_TERMS);
  const hasFeature = Boolean(feature && factValueMentioned(description, feature.value));
  if (!hasProduct) missing.push("product");
  if (!hasScenario) missing.push("scenario");
  if (!hasValue) missing.push("value");
  if (!hasFeature) missing.push("confirmed_feature");
  if (missing.length > 0) {
    issues.push(issue({ code: "description_missing_sections", section: "description", message: `商品描述缺少：${missing.join("、")}。` }));
    const anchor = scenario ?? feature ?? type;
    if (anchor) suggestions.push(suggestion({ code: "description_completion_suggestion", section: "description", message: `可围绕已确认事实“${anchor.value}”补充缺失段落。`, factValue: anchor.value }));
  }
  return { score: clampScore(100 - missing.length * 25), missing };
}

export function evaluateListingQualityPolicy(input: ListingQualityPolicyInput): ListingQualityReport {
  const issues: ListingQualityIssue[] = [];
  const suggestions: ListingQualityIssue[] = [];
  const titleScore = evaluateTitle(input.title, input.facts, issues, suggestions);
  const bulletScore = evaluateBullets(input.bullets, input.facts, issues, suggestions);
  const description = evaluateDescription(input.description, input.facts, issues, suggestions);
  const allText = [input.title, ...input.bullets, input.description].join(" ");
  const unsupported = unsupportedRiskTerms(allText, input.facts);
  if (unsupported.length > 0) {
    issues.push(issue({ code: "unsupported_compliance_risk", section: "compliance", message: `检测到未被已确认事实支持的风险词：${unsupported.join("、")}。` }));
  }
  const complianceScore = clampScore(100 - unsupported.length * 20);
  const overallScore = clampScore(titleScore * 0.25 + bulletScore * 0.45 + description.score * 0.2 + complianceScore * 0.1);
  return {
    titleScore,
    bulletScore,
    descriptionScore: description.score,
    complianceScore,
    overallScore,
    missingSections: description.missing,
    issues,
    suggestions,
    requiresHumanReview: true,
  };
}

export function parseListingQualityReport(value: unknown): ListingQualityReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const score = (key: string) => typeof raw[key] === "number" && Number.isFinite(raw[key]) ? clampScore(raw[key] as number) : null;
  const titleScore = score("titleScore");
  const bulletScore = score("bulletScore");
  const descriptionScore = score("descriptionScore");
  const complianceScore = score("complianceScore");
  const overallScore = score("overallScore");
  if ([titleScore, bulletScore, descriptionScore, complianceScore, overallScore].some((item) => item === null) || raw.requiresHumanReview !== true) return undefined;
  const parseItems = (key: string): ListingQualityIssue[] => Array.isArray(raw[key]) ? raw[key].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, 30).map((item) => ({
    code: typeof item.code === "string" ? item.code.slice(0, 64) : "unknown",
    section: (item.section === "title" || item.section === "bullet" || item.section === "description" || item.section === "compliance" ? item.section : "description") as ListingQualitySection,
    severity: (item.severity === "suggestion" ? "suggestion" : "issue") as "suggestion" | "issue",
    message: typeof item.message === "string" ? item.message.slice(0, 240) : "",
    ...(typeof item.suggestion === "string" ? { suggestion: item.suggestion.slice(0, 240) } : {}),
    ...(typeof item.bulletIndex === "number" ? { bulletIndex: Math.max(0, Math.min(4, Math.trunc(item.bulletIndex))) } : {}),
    ...(typeof item.factValue === "string" ? { factValue: item.factValue.slice(0, 200) } : {}),
  })).filter((item) => item.message.length > 0) : [];
  return {
    titleScore: titleScore!, bulletScore: bulletScore!, descriptionScore: descriptionScore!, complianceScore: complianceScore!, overallScore: overallScore!,
    missingSections: Array.isArray(raw.missingSections) ? raw.missingSections.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    issues: parseItems("issues"), suggestions: parseItems("suggestions"), requiresHumanReview: true,
  };
}
