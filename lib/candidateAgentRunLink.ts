export type CandidateAgentRunLinkInput = {
  candidateId?: string | null;
  name?: string | null;
  rawInput?: string | null;
  analyzedName?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  source?: string | null;
  score?: number | null;
  keyword?: string | null;
};

function cleanText(value: string | null | undefined, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : "";
}

function boundedScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Math.min(100, Math.max(0, Math.round(value))));
}

export function buildCandidateAgentRunHref(input: CandidateAgentRunLinkInput) {
  const productName = cleanText(input.analyzedName, 120)
    || cleanText(input.name, 120)
    || cleanText(input.rawInput, 120);
  const sourceTitle = cleanText(input.sourceTitle, 160)
    || cleanText(input.name, 160)
    || cleanText(input.rawInput, 160)
    || productName;

  const params = new URLSearchParams({
    source: "opportunity",
    from: "opportunity",
    entry: "candidate_to_workflow",
  });

  if (productName) params.set("productName", productName);
  if (sourceTitle) params.set("sourceTitle", sourceTitle);

  const candidateId = cleanText(input.candidateId, 80);
  const sourceUrl = cleanText(input.sourceUrl, 500);
  const source = cleanText(input.source, 180);
  const score = boundedScore(input.score);
  const keyword = cleanText(input.keyword, 80);
  const rawInput = cleanText(input.rawInput, 200);
  const analyzedName = cleanText(input.analyzedName, 120);

  if (candidateId) params.set("candidateId", candidateId);
  if (sourceUrl) params.set("sourceUrl", sourceUrl);
  if (source) params.set("opportunitySource", source);
  if (score) params.set("opportunityScore", score);
  if (keyword) params.set("keyword", keyword);
  if (rawInput) params.set("originalName", rawInput);
  if (analyzedName) params.set("analyzedName", analyzedName);

  return `/workflow?${params.toString()}`;
}
