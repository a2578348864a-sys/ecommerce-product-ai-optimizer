/**
 * Phase 1E — Radar Scorer
 * 规则评分，不调用 AI。输出 demand/supply/risk/beginnerFit/final 分数。
 */

import type { CandidateItem } from "./radarNormalize";

export type ScoreResult = {
  demandSignalScore: number;   // 0-100
  supplyEaseScore: number;     // 0-100
  riskScore: number;           // 0-100 (higher = more risk)
  beginnerFitScore: number;    // 0-100
  finalScore: number;          // 0-100 weighted composite
};

// -- Keyword dictionaries --

// Higher demand signal
const HIGH_DEMAND_WORDS = [
  "kitchen", "cook", "bake", "food storage", "container",
  "organizer", "storage", "shelf", "rack", "holder", "stand",
  "desk", "office", "camping", "hiking", "outdoor", "travel",
  "pet", "dog", "cat", "phone stand", "cable", "usb",
  "portable", "foldable", "collapsible", "compact", "lightweight",
  "gift", "aesthetic", "cute", "minimalist", "trending",
  "tiktok made me buy", "viral", "amazon best seller",
  "home organization", "cleaning", "laundry", "bathroom",
  "fitness", "gym", "yoga", "exercise", "workout",
  "baby shower", "baby registry", "newborn",
];

// Higher risk — requires scrutiny
const HIGH_RISK_WORDS = [
  "baby", "kids", "child", "toddler", "infant", "newborn",
  "magnetic", "magnet",
  "battery", "rechargeable", "electric", "usb powered", "plug in",
  "heated", "heating", "warming",
  "food grade", "bpa free", "silicone", "food contact",
  "pet bowl", "pet feeder", "pet toy", "dog chew", "cat toy",
  "medical", "health", "supplement", "treatment", "therapy",
  "cosmetic", "skincare", "cream", "serum", "face mask",
  "essential oil", "diffuser", "aromatherapy",
  "candle", "incense", "wax melt",
  "sharp", "knife", "blade", "cutter",
];

// Famous brands/IP — potential infringement risk
const BRAND_WORDS = [
  "disney", "nike", "pokémon", "pokemon", "apple inc", "marvel",
  "star wars", "harry potter", "anime", "manga", "sanrio",
  "hello kitty", "minions", "pixar", "dreamworks",
  "barbie", "hot wheels", "lego", "fisher price",
  "nintendo", "playstation", "xbox", "roblox", "minecraft",
  "stanley", "yeti", "hydro flask", "owala",
  "dyson", "apple airpods", "samsung galaxy",
  "louis vuitton", "gucci", "chanel", "hermes",
];

// Beginner-friendly indicators
const BEGINNER_FRIENDLY_WORDS = [
  "no battery", "no electric", "simple", "lightweight",
  "small parcel", "easy ship", "low return", "low after sales",
  "standard material", "plastic", "silicone", "wood", "metal",
  "unisex", "one size", "universal", "generic",
];

const BEGINNER_UNFRIENDLY_WORDS = [
  "battery", "electric", "rechargeable", "certification",
  "fda", "lfgb", "cpc", "astm", "cpsia", "ce marking",
  "patent", "trademark", "ip risk", "license",
  "fragile", "glass", "heavy", "oversized", "bulky",
  "seasonal", "perishable", "custom", "personalized",
];

function countMatches(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase())).length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Score a single candidate item.
 * Pure rules — no AI, no I/O.
 */
export function scoreCandidate(item: CandidateItem): ScoreResult {
  const searchText = `${item.title} ${item.signalText} ${item.categoryHint} ${item.riskHint}`.toLowerCase();

  // Demand signal: more keyword matches = higher demand likelihood
  const demandMatches = countMatches(searchText, HIGH_DEMAND_WORDS);
  const demandSignalScore = clamp(30 + demandMatches * 8, 0, 100);

  // Supply ease: inverse of complexity signals, plus general availability
  const supplyMatches = countMatches(searchText, [
    "standard", "generic", "common", "widely available",
    "plastic", "silicone", "wood", "metal", "fabric",
    "simple", "easy find", "mass produced",
  ]);
  const supplyEaseScore = clamp(35 + supplyMatches * 10, 0, 100);

  // Risk: more high-risk and brand words = higher risk
  const riskMatches = countMatches(searchText, HIGH_RISK_WORDS);
  const brandMatches = countMatches(searchText, BRAND_WORDS);
  const riskScore = clamp(15 + riskMatches * 10 + brandMatches * 18, 0, 100);

  // Beginner fit: friendly minus unfriendly
  const friendly = countMatches(searchText, BEGINNER_FRIENDLY_WORDS);
  const unfriendly = countMatches(searchText, BEGINNER_UNFRIENDLY_WORDS);
  const riskPenalty = riskScore > 50 ? Math.round((riskScore - 50) * 0.6) : 0;
  const beginnerFitScore = clamp(50 + friendly * 8 - unfriendly * 8 - riskPenalty, 0, 100);

  // Final weighted composite
  const finalScore = clamp(
    Math.round(
      demandSignalScore * 0.30 +
      supplyEaseScore * 0.20 +
      (100 - riskScore) * 0.30 +
      beginnerFitScore * 0.20,
    ),
    0,
    100,
  );

  return {
    demandSignalScore,
    supplyEaseScore,
    riskScore,
    beginnerFitScore,
    finalScore,
  };
}

/**
 * Score all candidates, return sorted by finalScore descending.
 */
export function scoreCandidates(items: CandidateItem[]): Array<CandidateItem & { scores: ScoreResult }> {
  return items
    .map((item) => ({ ...item, scores: scoreCandidate(item) }))
    .sort((a, b) => b.scores.finalScore - a.scores.finalScore);
}
