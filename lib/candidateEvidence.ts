export type CandidateEvidenceDecision = "recommended" | "cautious" | "rejected";
export type CandidateEvidenceConfidence = "low" | "medium" | "high";

export type CandidateEvidenceSnapshot = {
  version: 1;
  sourceType: string;
  sourceName: string;
  sourceUrl?: string;
  evidenceItems: string[];
  extractionSignals: string[];
  qualityScore: number;
  confidence: CandidateEvidenceConfidence;
  riskFlags: string[];
  decision: CandidateEvidenceDecision;
  decisionReason: string;
  nextAction: string;
  generatedAt: string;
};

export type CandidateEvidenceInput = {
  title?: string | null;
  name?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  candidateType?: string | null;
  failureReason?: string | null;
  score?: number | null;
  demandSignalScore?: number | null;
  supplyEaseScore?: number | null;
  riskScore?: number | null;
  beginnerFitScore?: number | null;
  priceText?: string | null;
  hasImage?: boolean | null;
  riskHint?: string | null;
  riskFlags?: string[] | null;
  generatedAt?: string | null;
  [key: string]: unknown;
};

const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|cookie|authorization|api[-_]?key|apikey|session)/i;
const SENSITIVE_TEXT_PATTERN = /(password|passwd|secret|token|cookie|authorization|api[-_]?key|apikey|session)\s*[:=]/i;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function boundedScore(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.min(100, Math.max(0, Math.round(numberValue)));
}

function unique(values: string[], limit = 8) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = value.trim();
    if (!item || SENSITIVE_TEXT_PATTERN.test(item)) continue;
    const key = item.toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.slice(0, 80));
    if (out.length >= limit) break;
  }
  return out;
}

function safeUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function titleOf(input: CandidateEvidenceInput) {
  return text(input.title) || text(input.name);
}

function isRejectedPage(input: CandidateEvidenceInput) {
  const title = titleOf(input).toLowerCase();
  const url = safeUrl(input.sourceUrl).toLowerCase();
  const type = text(input.candidateType).toLowerCase();
  const failureReason = text(input.failureReason).toLowerCase();

  return type === "rejected"
    || type === "category_hint"
    || /sitemap|\.xml$/.test(title)
    || /sitemap|\.xml$/.test(url)
    || /\/collections\/|\/category\/|\/categories\/|\/search/.test(url)
    || /shop all|all products|category|collection|search results/.test(title)
    || /404|403|500|page not found|access denied|service unavailable/.test(title)
    || /login|required|sign in|captcha|blocked|timeout|http_error|login_required/.test(failureReason);
}

export function calculateCandidateQualityScore(input: CandidateEvidenceInput) {
  const direct = boundedScore(input.score);
  if (direct !== null) return direct;

  const demand = boundedScore(input.demandSignalScore) ?? 50;
  const supply = boundedScore(input.supplyEaseScore) ?? 50;
  const beginner = boundedScore(input.beginnerFitScore) ?? 50;
  const risk = boundedScore(input.riskScore) ?? 50;
  return Math.min(100, Math.max(0, Math.round(demand * 0.25 + supply * 0.2 + beginner * 0.3 + (100 - risk) * 0.25)));
}

export function deriveCandidateRiskFlags(input: CandidateEvidenceInput) {
  const title = titleOf(input).toLowerCase();
  const riskHint = text(input.riskHint).toLowerCase();
  const flags = Array.isArray(input.riskFlags) ? [...input.riskFlags] : [];
  const sourceUrl = safeUrl(input.sourceUrl);
  const failureReason = text(input.failureReason).toLowerCase();

  if (!sourceUrl && input.sourceType !== undefined) flags.push("missing_source_url");
  if (/battery|charger|power bank|usb|electric/.test(`${title} ${riskHint}`)) flags.push("battery");
  if (/baby|kids|children|infant/.test(`${title} ${riskHint}`)) flags.push("children_product");
  if (/brand|trademark|copyright|replica|dupe|knockoff/.test(`${title} ${riskHint}`)) flags.push("ip_risk");
  if (/login|required|sign in/.test(failureReason)) flags.push("login_required");
  if (/blocked|captcha|timeout|http_error/.test(failureReason)) flags.push("source_unavailable");
  if (input.priceText === "" || input.priceText === null) flags.push("missing_price");

  return unique(flags);
}

export function deriveCandidateDecision(input: CandidateEvidenceInput) {
  const score = calculateCandidateQualityScore(input);
  const flags = deriveCandidateRiskFlags(input);
  const rejected = isRejectedPage(input);
  const hasSourceUrl = Boolean(safeUrl(input.sourceUrl));
  const type = text(input.candidateType).toLowerCase();

  if (rejected) {
    return {
      decision: "rejected" as const,
      confidence: "high" as const,
      decisionReason: "The source looks like a non-product, blocked, login, sitemap, or error page.",
      nextAction: "Skip this candidate and use a specific public product page instead.",
    };
  }

  if (!hasSourceUrl || flags.includes("missing_price") || score < 70 || type === "trend_signal") {
    return {
      decision: "cautious" as const,
      confidence: hasSourceUrl ? "medium" as const : "low" as const,
      decisionReason: "The candidate has limited source evidence and needs manual confirmation.",
      nextAction: "manual verification required: check the product page, price, image, and compliance risk before analysis.",
    };
  }

  return {
    decision: "recommended" as const,
    confidence: score >= 80 && flags.length === 0 ? "high" as const : "medium" as const,
    decisionReason: "Specific product page with usable source evidence.",
    nextAction: "Continue to agent run after manual confirmation.",
  };
}

export function normalizeCandidateEvidence(input: CandidateEvidenceInput): CandidateEvidenceSnapshot {
  const sourceUrl = safeUrl(input.sourceUrl);
  const sourceType = text(input.sourceType, "unknown").slice(0, 40);
  const sourceName = text(input.sourceName, sourceUrl ? new URL(sourceUrl).hostname : "manual").slice(0, 120);
  const score = calculateCandidateQualityScore(input);
  const flags = deriveCandidateRiskFlags(input);
  const decision = deriveCandidateDecision(input);
  const evidenceItems = unique([
    text(input.candidateType) === "product_candidate" || /\/products?\/|\/item\/|\/detail\//i.test(sourceUrl) ? "product_page" : "",
    text(input.candidateType) === "category_hint" ? "category_or_collection_page" : "",
    sourceUrl ? "source_url_seen" : "",
    text(input.priceText) ? "price_seen" : "",
    input.hasImage ? "image_seen" : "",
  ]);
  const extractionSignals = unique([
    sourceUrl ? "url_available" : "manual_input",
    /\/products?\/|\/item\/|\/detail\//i.test(sourceUrl) ? "url_path_product" : "",
    text(input.failureReason) ? `failure:${text(input.failureReason).slice(0, 40)}` : "",
  ]);

  return {
    version: 1,
    sourceType,
    sourceName,
    ...(sourceUrl ? { sourceUrl } : {}),
    evidenceItems,
    extractionSignals,
    qualityScore: score,
    confidence: decision.confidence,
    riskFlags: flags,
    decision: decision.decision,
    decisionReason: decision.decisionReason,
    nextAction: decision.nextAction,
    generatedAt: text(input.generatedAt) || new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCandidateEvidenceSnapshot(value: unknown): CandidateEvidenceSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  return normalizeCandidateEvidence({
    sourceType: text(value.sourceType),
    sourceName: text(value.sourceName),
    sourceUrl: text(value.sourceUrl),
    score: boundedScore(value.qualityScore),
    riskFlags: Array.isArray(value.riskFlags) ? value.riskFlags.filter((item): item is string => typeof item === "string") : [],
    candidateType: Array.isArray(value.evidenceItems) && value.evidenceItems.includes("product_page") ? "product_candidate" : undefined,
    generatedAt: text(value.generatedAt),
  });
}

export function parseCandidateEvidenceParam(value: string | undefined) {
  if (!value) return null;
  try {
    return parseCandidateEvidenceSnapshot(JSON.parse(decodeURIComponent(value)));
  } catch {
    return null;
  }
}
