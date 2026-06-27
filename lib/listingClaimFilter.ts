import type { AiListingPackDraft } from "@/lib/aiListingDraft";

type ClaimRule = {
  label: string;
  pattern: RegExp;
  replacement: string;
};

export const LISTING_CLAIM_RULES: ClaimRule[] = [
  { label: "FDA Approved", pattern: /\bFDA\s+(?:Approved|Certified|Cleared|Registered)\b/gi, replacement: "supplier compliance documents required" },
  { label: "LFGB Certified", pattern: /\bLFGB\s+(?:Certified|Approved)\b/gi, replacement: "supplier compliance documents required" },
  { label: "PFOA-Free", pattern: /\bPFOA[-\s]?Free\b/gi, replacement: "material details require supplier verification" },
  { label: "BPA Free", pattern: /\bBPA[-\s]?Free\b/gi, replacement: "material details require supplier verification" },
  { label: "100% Safe", pattern: /\b100%\s*Safe\b/gi, replacement: "safety details require test reports and human review" },
  { label: "Medical Grade", pattern: /\bMedical\s+Grade\b/gi, replacement: "material grade requires supplier documentation" },
  { label: "Food grade", pattern: /\bFood\s+grade\b/gi, replacement: "food-contact status requires supplier documentation" },
  { label: "Non-toxic", pattern: /\bNon[-\s]?toxic\b/gi, replacement: "material safety requires supplier documentation" },
  { label: "Eco-friendly", pattern: /\bEco[-\s]?friendly\b/gi, replacement: "environmental claims require documentation" },
  { label: "Child safe", pattern: /\bChild[-\s]?safe\b/gi, replacement: "child safety requirements require manual review" },
  { label: "Health certified", pattern: /\bHealth\s+certified\b/gi, replacement: "health claims require certification review" },
  { label: "Guaranteed profit", pattern: /\bGuaranteed\s+profit\b/gi, replacement: "profit outcome must not be promised" },
  { label: "Best seller guaranteed", pattern: /\bBest\s+seller\s+guaranteed\b/gi, replacement: "sales outcome must not be promised" },
  { label: "自动上架成功", pattern: /自动上架成功/g, replacement: "上架动作需人工确认" },
  { label: "稳赚", pattern: /稳赚/g, replacement: "利润需按真实成本复核" },
  { label: "爆款必出", pattern: /爆款必出/g, replacement: "市场表现需小批量验证" },
  { label: "保证盈利", pattern: /保证盈利/g, replacement: "利润需按真实成本复核" },
  { label: "一键上架", pattern: /一键上架/g, replacement: "上架前需人工复核" },
  { label: "平台认证已通过", pattern: /平台认证已通过/g, replacement: "平台认证状态需人工核验" },
];

const WARNING = "Blocked unverified listing claims. Human review is required before publishing.";

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function detectListingClaims(text: string): string[] {
  const matches: string[] = [];
  for (const rule of LISTING_CLAIM_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) matches.push(rule.label);
  }
  return unique(matches);
}

export function containsListingBannedClaim(text: string) {
  return detectListingClaims(text).length > 0;
}

function cleanText(text: string, blockedClaims: string[]) {
  let cleaned = text;
  for (const rule of LISTING_CLAIM_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(cleaned)) {
      blockedClaims.push(rule.label);
      rule.pattern.lastIndex = 0;
      cleaned = cleaned.replace(rule.pattern, rule.replacement);
    }
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function cleanStringArray(values: string[], blockedClaims: string[]) {
  return values.map((value) => cleanText(value, blockedClaims)).filter(Boolean);
}

export function filterListingClaims(draft: AiListingPackDraft): {
  cleaned: AiListingPackDraft;
  blockedClaims: string[];
  complianceWarnings: string[];
} {
  const blockedClaims: string[] = [];

  const cleaned: AiListingPackDraft = {
    ...draft,
    titles: cleanStringArray(draft.titles, blockedClaims),
    bullets: cleanStringArray(draft.bullets, blockedClaims),
    description: cleanText(draft.description, blockedClaims),
    keywords: cleanStringArray(draft.keywords, blockedClaims),
    sellingPoints: cleanStringArray(draft.sellingPoints, blockedClaims),
    riskNotes: cleanStringArray(draft.riskNotes, blockedClaims),
    reviewChecklist: cleanStringArray(draft.reviewChecklist, blockedClaims),
    complianceWarnings: cleanStringArray(draft.complianceWarnings, blockedClaims),
    blockedClaims: unique([...draft.blockedClaims, ...blockedClaims]),
  };

  const warnings = blockedClaims.length > 0
    ? unique([...cleaned.complianceWarnings, WARNING])
    : cleaned.complianceWarnings;

  cleaned.complianceWarnings = warnings;

  return {
    cleaned,
    blockedClaims: unique(blockedClaims),
    complianceWarnings: warnings,
  };
}
