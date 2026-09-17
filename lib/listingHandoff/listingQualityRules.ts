export const LISTING_QUALITY_RISK_TERMS = [
  "best",
  "premium",
  "perfect",
  "no.1",
  "no 1",
  "guaranteed",
  "waterproof",
  "rustproof",
  "durable",
] as const;

export const LISTING_QUALITY_BENEFIT_TERMS = [
  "help", "keep", "organize", "separate", "simplify", "support", "reduce", "protect", "fit", "reach", "store", "save", "make", "designed", "convenient", "practical", "easy", "comfortable",
] as const;

export const LISTING_QUALITY_SCENARIO_TERMS = [
  "use", "used", "daily", "everyday", "kitchen", "counter", "countertop", "home", "office", "desk", "travel", "storage", "organize", "organization", "bathroom", "bedroom",
] as const;

export type QualityFact = { field?: string; label?: string; value: string };

export function normalizeQualityText(value: string): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[“”"'.,;:!?()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

export function qualityTokens(value: string): string[] {
  return normalizeQualityText(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
}

export function containsQualityTerm(text: string, term: string): boolean {
  const haystack = ` ${normalizeQualityText(text)} `;
  const needle = normalizeQualityText(term);
  return needle.length > 0 && haystack.includes(` ${needle} `);
}

export function factValueMentioned(text: string, value: string): boolean {
  const fact = qualityTokens(value);
  if (fact.length === 0) return false;
  const actual = new Set(qualityTokens(text));
  const overlap = fact.filter((token) => actual.has(token)).length;
  return fact.length === 1 ? overlap === 1 : overlap / fact.length >= 0.6;
}

export function supportedFactForText(text: string, facts: readonly QualityFact[]): QualityFact | undefined {
  return facts.find((fact) => factValueMentioned(text, fact.value));
}

export function hasAnyQualityTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => containsQualityTerm(text, term));
}

export function unsupportedRiskTerms(text: string, facts: readonly QualityFact[]): string[] {
  return LISTING_QUALITY_RISK_TERMS.filter((term) => containsQualityTerm(text, term) && !facts.some((fact) => containsQualityTerm(fact.value, term))).map(String);
}
