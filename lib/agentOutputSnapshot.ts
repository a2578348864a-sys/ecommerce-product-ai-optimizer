export type SnapshotConfidence = "low" | "medium" | "high";

export type CandidateEvidenceRef = {
  sourceType?: string;
  sourceName?: string;
  sourceUrl?: string;
  qualityScore?: number;
  confidence?: SnapshotConfidence;
  riskFlags?: string[];
  decision?: "recommended" | "cautious" | "rejected";
  decisionReason?: string;
};

export type SourcingSnapshot = {
  supplierConclusion: string;
  sourceSignals: string[];
  priceSignals: string[];
  availabilitySignals: string[];
  assumptions: string[];
  missingInfo: string[];
  confidence: SnapshotConfidence;
};

export type RiskSnapshot = {
  riskLevel: "low" | "medium" | "high" | "unknown";
  riskFlags: string[];
  complianceConcerns: string[];
  ipConcerns: string[];
  logisticsConcerns: string[];
  safetyConcerns: string[];
  riskReason: string;
  needsManualReview: boolean;
};

export type SummarySnapshot = {
  decision: "recommended" | "cautious" | "not_recommended" | "unknown";
  decisionReason: string;
  targetUser: string;
  sellingPoints: string[];
  concerns: string[];
  confidence: SnapshotConfidence;
};

export type ListingSnapshot = {
  titleDraft: string;
  bulletDrafts: string[];
  keywordHints: string[];
  descriptionDraft?: string;
  imageIdeas: string[];
  complianceNotes: string[];
  missingInputs: string[];
};

export type NextActionSnapshot = {
  primaryAction:
    | "verify_supplier"
    | "check_compliance"
    | "prepare_listing"
    | "small_batch_test"
    | "watch"
    | "abandon"
    | "manual_review"
    | "unknown";
  actionLabel: string;
  checklist: string[];
  blockingIssues: string[];
  suggestedOwnerStep: string;
};

export type HumanReviewSnapshot = {
  required: boolean;
  reasons: string[];
  reviewFocus: string[];
  defaultStatus: "pending" | "not_required" | "needs_review";
};

export type AgentOutputSnapshot = {
  version: "agent-output-v1";
  generatedAt: string;
  candidateEvidence?: CandidateEvidenceRef | null;
  sourcingSnapshot: SourcingSnapshot;
  riskSnapshot: RiskSnapshot;
  summarySnapshot: SummarySnapshot;
  listingSnapshot: ListingSnapshot;
  nextActionSnapshot: NextActionSnapshot;
  humanReviewSnapshot: HumanReviewSnapshot;
  rawReportSummary?: string;
  fallbackUsed: boolean;
  warnings: string[];
};

export type ValidationResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

const SENSITIVE_KEYS = [
  "token",
  "access_token",
  "api_key",
  "key",
  "secret",
  "password",
  "cookie",
  "session",
  "authorization",
  "bearer",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
}

function sanitizeUrl(value: string) {
  try {
    const parsed = new URL(value);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lowered = key.toLowerCase();
      if (SENSITIVE_KEYS.some((sensitive) => lowered.includes(sensitive))) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function sanitizeText(value: unknown, fallback = "", limit = 180) {
  if (typeof value !== "string") return fallback;
  let output = value.trim();
  output = output.replace(/https?:\/\/[^\s<>"')]+/gi, (url) => sanitizeUrl(url));
  output = output.replace(
    /\b(token|access_token|api_key|key|secret|password|cookie|session|authorization|bearer)\b\s*[:=]\s*[^\s&;,]+/gi,
    "$1=[redacted]",
  );
  output = output.replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, "bearer [redacted]");
  return truncate(output, limit);
}

function stringArray(value: unknown, limit = 6, itemLimit = 160) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const sanitized = sanitizeText(item, "", itemLimit);
    if (!sanitized || seen.has(sanitized)) continue;
    seen.add(sanitized);
    result.push(sanitized);
    if (result.length >= limit) break;
  }
  return result;
}

function confidence(value: unknown): SnapshotConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function boundedNumber(value: unknown, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function mapRiskLevel(value: unknown): RiskSnapshot["riskLevel"] {
  const raw = sanitizeText(value, "", 40).toLowerCase();
  if (raw === "green" || raw === "low" || raw.includes("低")) return "low";
  if (raw === "yellow" || raw === "medium" || raw === "mid" || raw.includes("中") || raw.includes("黄")) return "medium";
  if (raw === "red" || raw === "high" || raw.includes("高") || raw.includes("红")) return "high";
  return "unknown";
}

function mapDecision(value: unknown, riskLevel: RiskSnapshot["riskLevel"]): SummarySnapshot["decision"] {
  const raw = sanitizeText(value, "", 120).toLowerCase();
  if (/不建议|放弃|淘汰|直接排除|not[_\s-]?recommended|reject|abandon/.test(raw)) return "not_recommended";
  if (/谨慎|观察|暂缓|cautious|watch/.test(raw)) return "cautious";
  if (/推荐|建议|可以继续|小单测试|recommended|continue/.test(raw)) return "recommended";
  if (riskLevel === "high") return "not_recommended";
  return "unknown";
}

function buildCandidateEvidence(sourceMeta: Record<string, unknown>): CandidateEvidenceRef | null {
  const evidence = record(sourceMeta.evidenceSnapshot);
  if (!Object.keys(evidence).length) return null;
  const url = sanitizeText(evidence.sourceUrl, "", 500);
  const decision = sanitizeText(evidence.decision, "", 40);
  return {
    ...(sanitizeText(evidence.sourceType, "", 40) ? { sourceType: sanitizeText(evidence.sourceType, "", 40) } : {}),
    ...(sanitizeText(evidence.sourceName, "", 80) ? { sourceName: sanitizeText(evidence.sourceName, "", 80) } : {}),
    ...(url ? { sourceUrl: url } : {}),
    ...(boundedNumber(evidence.qualityScore, 0, 100) !== undefined ? { qualityScore: boundedNumber(evidence.qualityScore, 0, 100) } : {}),
    confidence: confidence(evidence.confidence),
    riskFlags: stringArray(evidence.riskFlags, 8, 60),
    ...(decision === "recommended" || decision === "cautious" || decision === "rejected" ? { decision } : {}),
    ...(sanitizeText(evidence.decisionReason, "", 180) ? { decisionReason: sanitizeText(evidence.decisionReason, "", 180) } : {}),
  };
}

export function normalizeAgentOutputSnapshot(input: {
  workflowResult?: unknown;
  sourceMeta?: unknown;
  riskReviewSnapshot?: unknown;
  profitSnapshot?: unknown;
} = {}): AgentOutputSnapshot {
  const warnings: string[] = [];
  const wr = record(input.workflowResult);
  const finalReport = record(wr.finalReport);
  const sourcing = record(wr.sourcing);
  const risk = firstRecord(wr.risk, input.riskReviewSnapshot);
  const summary = record(wr.summary);
  const listing = record(wr.listing);
  const sourceMeta = record(input.sourceMeta || wr.sourceMeta);

  const productName = sanitizeText(wr.productName, "待分析商品", 120);
  const finalVerdict = sanitizeText(finalReport.finalVerdict, "", 180);
  const finalRiskLevel = mapRiskLevel(finalReport.riskLevel);
  const riskLevel = mapRiskLevel(
    risk.overallLevel ||
    risk.overallPrecheckLevel ||
    risk.riskLevel ||
    finalReport.riskLevel,
  );
  const effectiveRiskLevel = riskLevel === "unknown" ? finalRiskLevel : riskLevel;
  const fallbackUsed = !Object.keys(sourcing).length || !Object.keys(risk).length || !Object.keys(summary).length || !Object.keys(listing).length;

  if (!Object.keys(sourcing).length) warnings.push("sourcingSnapshot fallback used");
  if (!Object.keys(risk).length) warnings.push("riskSnapshot fallback used");
  if (!Object.keys(summary).length) warnings.push("summarySnapshot fallback used");
  if (!Object.keys(listing).length) warnings.push("listingSnapshot fallback used");
  if (!Object.keys(finalReport).length) warnings.push("finalReport missing");

  const riskFlags = stringArray(risk.riskFlags || sourceMeta.evidenceSnapshot && record(sourceMeta.evidenceSnapshot).riskFlags, 10, 80);
  const nextSteps = stringArray(finalReport.nextSteps, 6, 160);
  const manualChecklist = stringArray(finalReport.manualReviewChecklist, 8, 160);
  const complianceConcerns = stringArray(risk.complianceConcerns || risk.complianceWarnings, 8, 160);
  const ipConcerns = stringArray(risk.ipConcerns || risk.ipWarnings, 8, 160);
  const logisticsConcerns = stringArray(risk.logisticsConcerns, 8, 160);
  const safetyConcerns = stringArray(risk.safetyConcerns, 8, 160);
  const decision = mapDecision(summary.decision || finalVerdict, effectiveRiskLevel);

  const riskSnapshot: RiskSnapshot = {
    riskLevel: effectiveRiskLevel,
    riskFlags,
    complianceConcerns,
    ipConcerns,
    logisticsConcerns,
    safetyConcerns,
    riskReason: sanitizeText(risk.summary || risk.reason || finalReport.riskLevel || "风险信息不足，需人工复核。", "风险信息不足，需人工复核。", 220),
    needsManualReview: effectiveRiskLevel !== "low" || riskFlags.length > 0 || complianceConcerns.length > 0 || ipConcerns.length > 0,
  };

  const listingTitle = sanitizeText(listing.title || listing.titleDraft, productName, 140);
  const listingBullets = stringArray(listing.bullets || listing.bulletDrafts || listing.sellingPoints, 5, 180);
  const listingKeywords = stringArray(listing.keywords || listing.keywordHints, 8, 80);
  const missingInputs = [
    ...(listingTitle ? [] : ["Listing title"]),
    ...(listingBullets.length ? [] : ["Listing bullets"]),
    ...(listingKeywords.length ? [] : ["Listing keywords"]),
  ];

  let primaryAction: NextActionSnapshot["primaryAction"] = "manual_review";
  if (effectiveRiskLevel === "high") primaryAction = "check_compliance";
  else if (decision === "not_recommended") primaryAction = "abandon";
  else if (finalReport.canTestSmallBatch === true) primaryAction = "small_batch_test";
  else if (listingTitle && listingBullets.length) primaryAction = "prepare_listing";
  else if (nextSteps.some((step) => /供应商|报价|MOQ/i.test(step))) primaryAction = "verify_supplier";

  const actionLabels: Record<NextActionSnapshot["primaryAction"], string> = {
    verify_supplier: "复核供应商",
    check_compliance: "先查合规风险",
    prepare_listing: "准备 Listing",
    small_batch_test: "小单测试前复核",
    watch: "继续观察",
    abandon: "暂不继续",
    manual_review: "人工复核",
    unknown: "待判断",
  };

  const humanReviewRequired = riskSnapshot.needsManualReview || manualChecklist.length > 0 || missingInputs.length > 0;

  return {
    version: "agent-output-v1",
    generatedAt: new Date().toISOString(),
    candidateEvidence: buildCandidateEvidence(sourceMeta),
    sourcingSnapshot: {
      supplierConclusion: sanitizeText(sourcing.conclusion || sourcing.summary || sourcing.supplierConclusion || "货源信息不足，需人工确认供应商、MOQ、报价和发货周期。", "货源信息不足，需人工确认供应商、MOQ、报价和发货周期。", 220),
      sourceSignals: stringArray(sourcing.sourceSignals || sourcing.suppliers || sourcing.signals, 6, 120),
      priceSignals: stringArray(sourcing.priceSignals || sourcing.priceRange || sourcing.priceNotes, 6, 120),
      availabilitySignals: stringArray(sourcing.availabilitySignals || sourcing.availability || sourcing.moqSignals, 6, 120),
      assumptions: stringArray(sourcing.assumptions, 6, 140),
      missingInfo: stringArray(sourcing.missingInfo, 6, 120),
      confidence: confidence(sourcing.confidence),
    },
    riskSnapshot,
    summarySnapshot: {
      decision,
      decisionReason: sanitizeText(summary.decisionReason || finalVerdict || "AI 结论不足，需人工判断。", "AI 结论不足，需人工判断。", 220),
      targetUser: sanitizeText(summary.targetUser || finalReport.targetUser || "", "", 120),
      sellingPoints: stringArray(summary.sellingPoints || finalReport.sellingPoints, 6, 140),
      concerns: stringArray(summary.concerns || riskFlags, 6, 140),
      confidence: confidence(summary.confidence),
    },
    listingSnapshot: {
      titleDraft: listingTitle,
      bulletDrafts: listingBullets.length ? listingBullets : ["待补充核心卖点、材质尺寸、使用场景和注意事项。"],
      keywordHints: listingKeywords,
      ...(sanitizeText(listing.description || listing.descriptionDraft, "", 300) ? { descriptionDraft: sanitizeText(listing.description || listing.descriptionDraft, "", 300) } : {}),
      imageIdeas: stringArray(listing.imageIdeas, 6, 120),
      complianceNotes: stringArray(listing.complianceNotes, 6, 140),
      missingInputs,
    },
    nextActionSnapshot: {
      primaryAction,
      actionLabel: actionLabels[primaryAction],
      checklist: nextSteps.length ? nextSteps : ["复核供应商、风险、利润和 Listing 草稿后再决定。"],
      blockingIssues: [...riskFlags, ...missingInputs].slice(0, 8),
      suggestedOwnerStep: sanitizeText(nextSteps[0], actionLabels[primaryAction], 160),
    },
    humanReviewSnapshot: {
      required: humanReviewRequired,
      reasons: [
        ...(riskSnapshot.needsManualReview ? ["风险或合规信息需要人工确认"] : []),
        ...(missingInputs.length ? ["Listing 输入不完整"] : []),
        ...manualChecklist.slice(0, 4),
      ].slice(0, 8),
      reviewFocus: manualChecklist.length ? manualChecklist : ["供应商报价", "合规/侵权", "利润测算", "Listing 草稿"],
      defaultStatus: humanReviewRequired ? "needs_review" : "not_required",
    },
    ...(finalVerdict ? { rawReportSummary: finalVerdict } : {}),
    fallbackUsed,
    warnings,
  };
}

export function validateAgentOutputSnapshot(snapshot: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(snapshot)) {
    return { ok: false, warnings, errors: ["snapshot must be object"] };
  }
  if (snapshot.version !== "agent-output-v1") errors.push("version must be agent-output-v1");
  for (const key of ["sourcingSnapshot", "riskSnapshot", "summarySnapshot", "listingSnapshot", "nextActionSnapshot", "humanReviewSnapshot"]) {
    if (!isRecord(snapshot[key])) errors.push(`${key} must be object`);
  }
  if (!Array.isArray(snapshot.warnings)) warnings.push("warnings should be an array");
  return { ok: errors.length === 0, warnings, errors };
}

export function extractAgentOutputSnapshotFromTask(task: unknown): AgentOutputSnapshot | null {
  let result = task;
  if (typeof task === "string") {
    try {
      result = JSON.parse(task);
    } catch {
      return null;
    }
  }
  const parsed = record(result);
  const snapshot = parsed.agentOutputSnapshot;
  const validation = validateAgentOutputSnapshot(snapshot);
  return validation.ok ? snapshot as AgentOutputSnapshot : null;
}

export function createFallbackAgentOutputSnapshot(input: unknown): AgentOutputSnapshot {
  return normalizeAgentOutputSnapshot({ workflowResult: isRecord(input) ? input : {} });
}
