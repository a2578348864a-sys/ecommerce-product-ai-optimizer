import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { StudioListingPreferences } from "@/lib/studioListingInput";

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function includesTerm(text: string, term: string) {
  return text.normalize("NFKC").toLocaleLowerCase().includes(
    term.normalize("NFKC").toLocaleLowerCase(),
  );
}

function matchingTerms(text: string, terms: string[]) {
  return terms.filter((term) => includesTerm(text, term));
}

function countOccurrences(text: string, term: string) {
  const source = text.normalize("NFKC").toLocaleLowerCase();
  const needle = term.normalize("NFKC").toLocaleLowerCase();
  if (!needle) return 0;
  let count = 0;
  let start = 0;
  while ((start = source.indexOf(needle, start)) >= 0) {
    count += 1;
    start += needle.length;
  }
  return count;
}

export function buildListingStudioReview(
  listingPack: AiListingPackDraft,
  preferences: StudioListingPreferences,
) {
  const title = listingPack.titles[0] ?? "";
  const targets = unique([
    ...preferences.primaryKeywords,
    ...preferences.secondaryKeywords,
  ]);
  const competitorTerms = unique(preferences.competitorKeywords);
  const generatedCopy = [
    title,
    ...listingPack.bullets,
    listingPack.description,
    ...listingPack.keywords,
  ].join(" ");
  const sellingPointReferences = unique([
    preferences.coreFunction,
    preferences.problemSolved,
    ...preferences.differentiators,
    ...listingPack.sellingPoints,
  ]);
  const covered = matchingTerms(generatedCopy, targets);
  const uncovered = targets.filter((term) => !covered.includes(term));
  const bulletsText = listingPack.bullets.join("\n");
  const searchTermsText = listingPack.keywords.join("\n");
  const primaryKeys = new Set(
    preferences.primaryKeywords.map((term) => term.normalize("NFKC").toLocaleLowerCase()),
  );
  const matrix = targets.map((keyword) => {
    const titleCount = countOccurrences(title, keyword);
    const bulletCount = countOccurrences(bulletsText, keyword);
    const descriptionCount = countOccurrences(listingPack.description, keyword);
    const searchTermsCount = countOccurrences(searchTermsText, keyword);
    return {
      keyword,
      kind: primaryKeys.has(keyword.normalize("NFKC").toLocaleLowerCase()) ? "primary" as const : "secondary" as const,
      title: titleCount,
      bullet: bulletCount,
      description: descriptionCount,
      searchTerms: searchTermsCount,
      total: titleCount + bulletCount + descriptionCount + searchTermsCount,
    };
  });

  return {
    title: {
      characterCount: title.length,
      coveredKeywords: matchingTerms(title, targets),
      primaryKeywordCovered: preferences.primaryKeywords.length > 0
        ? matchingTerms(title, preferences.primaryKeywords).length > 0
        : null,
    },
    bullets: listingPack.bullets.map((bullet) => ({
      text: bullet,
      matchedSellingPoints: matchingTerms(bullet, sellingPointReferences),
      coveredKeywords: matchingTerms(bullet, targets),
    })),
    description: {
      characterCount: listingPack.description.length,
      coveredKeywords: matchingTerms(listingPack.description, targets),
      coreFunctionCovered: preferences.coreFunction
        ? includesTerm(listingPack.description, preferences.coreFunction)
        : null,
    },
    keywords: {
      targets,
      used: unique(listingPack.keywords),
      covered,
      uncovered,
      suggested: uncovered,
      matrix,
      competitorTerms,
      competitorLeaks: matchingTerms(generatedCopy, competitorTerms),
    },
    risk: {
      blockedClaims: unique(listingPack.blockedClaims),
      complianceWarnings: unique(listingPack.complianceWarnings),
      riskNotes: unique(listingPack.riskNotes),
      reviewChecklist: unique(listingPack.reviewChecklist),
    },
    missingFacts: [
      !preferences.coreFunction ? "coreFunction" : "",
      !preferences.targetAudience ? "targetAudience" : "",
      !preferences.problemSolved ? "problemSolved" : "",
      preferences.differentiators.length === 0 ? "differentiators" : "",
    ].filter(Boolean),
    humanReviewRequired: listingPack.humanReviewRequired === true,
  };
}

export type ListingReadinessKey =
  | "productName"
  | "description"
  | "confirmedFacts"
  | "coreFunction"
  | "targetMarket"
  | "outputLanguage"
  | "primaryKeywords"
  | "prohibitedClaims";

export type ListingGenerationReadinessInput = {
  productName: string;
  description: string;
  preferences: StudioListingPreferences;
};

export function buildListingGenerationReadiness(input: ListingGenerationReadinessInput) {
  const checks: Array<{ key: ListingReadinessKey; label: string; complete: boolean }> = [
    { key: "productName", label: "商品名称", complete: Boolean(input.productName.trim()) },
    { key: "description", label: "商品描述", complete: Boolean(input.description.trim()) },
    { key: "confirmedFacts", label: "已确认事实", complete: input.preferences.confirmedFacts.length > 0 },
    { key: "coreFunction", label: "核心功能", complete: Boolean(input.preferences.coreFunction.trim()) },
    { key: "targetMarket", label: "目标市场", complete: Boolean(input.preferences.targetMarket) },
    { key: "outputLanguage", label: "输出语言", complete: Boolean(input.preferences.outputLanguage) },
    { key: "primaryKeywords", label: "主关键词", complete: input.preferences.primaryKeywords.length > 0 },
    { key: "prohibitedClaims", label: "禁止声明", complete: input.preferences.prohibitedClaims.length > 0 },
  ];
  const completedCount = checks.filter((check) => check.complete).length;
  const totalCount = checks.length;

  return {
    checks,
    completedCount,
    totalCount,
    completionPercent: Math.round((completedCount / totalCount) * 100),
    missing: checks.filter((check) => !check.complete).map((check) => check.key),
    ready: completedCount === totalCount,
  };
}

export function buildListingTxtExport(listingPack: AiListingPackDraft) {
  return [
    "TITLE",
    listingPack.titles[0] ?? "",
    "",
    "BULLET POINTS",
    ...listingPack.bullets.map((bullet, index) => `${index + 1}. ${bullet}`),
    "",
    "DESCRIPTION",
    listingPack.description,
    "",
    "SEARCH TERMS",
    listingPack.keywords.join(", "),
    "",
    "HUMAN REVIEW",
    listingPack.humanReviewRequired ? "Required before publishing" : "Required by Studio policy",
  ].join("\n").trimEnd() + "\n";
}

export function buildListingJsonExport(listingPack: AiListingPackDraft) {
  return JSON.stringify(listingPack, null, 2);
}
