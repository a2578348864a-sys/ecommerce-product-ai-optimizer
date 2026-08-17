/**
 * V3 Evidence → Creative Context Bridge（唯一桥，TARGETED CORE WORKFLOW CORRECTION）
 *
 * 目标：让商品研究阶段已保存的 Evidence（browserEvidence / reviewEvidence / vocAnalysis /
 * aiEvidenceSummary / sourcingEvidence / competitorEvidence / keywordEvidence）按语义分层
 * 进入 Listing / Image 创作上下文，同时严格维持：
 *
 *   Evidence ≠ Fact
 *   VOC ≠ Fact
 *   AI Summary ≠ Fact
 *   Competitor Evidence ≠ Product Fact
 *   Sourcing Evidence ≠ Amazon Product Fact
 *   Keyword Evidence ≠ Product Fact
 *
 * 只有 contract 明确允许的 deterministic source fact candidate + Human Confirmation
 * 才能进入 confirmedFacts（确认链由 Creative Handoff persistence 负责，本模块不写库）。
 *
 * 本模块是纯函数投影层（runtime projection，无 DB / 无网络 / 无 Date.now / 无随机）：
 * - 输入：任务 resultJson（含 researchRecord + Evidence namespaces）+ 解析好的可选对象；
 * - 输出：typed creative-context.v1（bounded、deterministic、evidenceRef 可追溯）；
 * - 不复制 Evidence 原文（只投影结构化引用 / 摘要 / top-N / 必要字段）；
 * - 不创建第二套 Research 模型；不触碰 candidateAnalysisContext / agentOutputSnapshot。
 *
 * 安全边界：
 * - 所有外部文本（review / competitor / sourcing / browser）视为 UNTRUSTED：
 *   仅 bounded excerpt（≤200 字符）+ NFC 规范化 + 结构化字段进入输出；
 * - prompt-injection isolation：外部文本永不作为指令注入（调用方拼接 prompt 时须保持隔离）；
 * - token bounding：各层 top-N + 长度上限。
 */

import { createHash } from "node:crypto";

export const CREATIVE_CONTEXT_SCHEMA = "creative-context.v1" as const;
export const CREATIVE_CONTEXT_VERSION = 1 as const;

// ─── 输出类型 ─────────────────────────────────────────────

export type CreativeContextEvidenceRef = {
  /** 可追溯引用（如 ev:browser:B08CVT84C9:2026-08-16T16:17:00.328Z） */
  evidenceRef: string;
  /** 来源类型（amazon_browser / voc_review / voc_theme / ai_summary / sourcing / competitor / keyword） */
  sourceType: string;
  /** 观察/捕获时间（ISO） */
  observedAt: string;
};

export type CreativeContextConfirmableFactCandidate = {
  selectionKey: string;
  field: string;
  label: string;
  value: string | number | boolean;
  /** 确定性分类：product_fact（可确认进 Listing/Image）| market_signal（仅内部参考） */
  factCategory: "product_fact" | "market_signal";
  stabilityRule: "identity_only" | "routing_only" | "human_confirmation_required_for_claim";
  allowedUsageScopes: Array<"listing" | "image" | "internal">;
  sourceKind: string;
  capturedAt: string;
  provenance: CreativeContextEvidenceRef;
  /** 实体绑定：证明该观察属于当前目标商品 */
  entityBinding: {
    bound: boolean;
    targetAsin: string | null;
    observedAsin: string | null;
    proof: string[];
  };
  /** Observed Price 专用语义（仅 Amazon 页面观察价，非采购成本/建议售价） */
  observedPrice?: {
    currency: string;
    marketplace: string;
  };
};

export type CreativeContextVocInsight = {
  insightId: string;
  theme: string;
  summary: string;
  evidenceRefs: string[];
  reviewCount: number;
  coverage: number;
  strength: "isolated" | "weak" | "recurring";
  sourceType: string;
  provenance: CreativeContextEvidenceRef;
};

export type CreativeContextKeywordCandidate = {
  keyword: string;
  reportType: string;
  rowNumber: number;
  evidenceRef: string;
  observedAt: string;
  provenance: CreativeContextEvidenceRef;
};

export type CreativeContextCompetitiveInsight = {
  asin: string;
  note: string;
  addedAt: string;
  evidenceRef: string;
  provenance: CreativeContextEvidenceRef;
};

export type CreativeContextSourcingEntry = {
  offerId: string;
  method: string;
  title: string;
  displayedPrice: string;
  displayedMoq: string;
  imageUrl: string;
  confirmed: boolean;
  evidenceRef: string;
  observedAt: string;
  provenance: CreativeContextEvidenceRef;
};

export type CreativeContextAiReference = {
  referenceId: string;
  field: string;
  summary: string;
  allowedUse: "tone" | "layout" | "composition" | "non_factual_angle";
  sourceType: string;
  evidenceRef: string;
  provenance: CreativeContextEvidenceRef;
};

export type CreativeContextMissingConflict = {
  kind: "missing" | "conflict";
  summary: string;
  sourceType: string;
  evidenceRef: string;
  provenance: CreativeContextEvidenceRef;
};

export type CreativeContextCounts = {
  confirmedFacts: number;
  confirmableCandidates: number;
  vocInsights: number;
  keywordCandidates: number;
  competitiveInsights: number;
  sourcingEntries: number;
  aiReferences: number;
  missingConflicts: number;
};

export type CreativeContextV1 = {
  schema: typeof CREATIVE_CONTEXT_SCHEMA;
  version: typeof CREATIVE_CONTEXT_VERSION;
  generatedAt: string;
  source: {
    researchRevision: number;
    candidateId: string;
  };
  /** 事实层：仅当前正式 human-confirmed facts（从现有 creativeHandoff 权威读取） */
  confirmedFacts: Array<{ field: string; label: string; value: string; usageScopes: string[]; sourceKind: string }>;
  /** 可人工确认候选（candidateAnalysisContext stable facts + browserEvidence 确定性字段） */
  confirmableFactCandidates: CreativeContextConfirmableFactCandidate[];
  /** VOC / Review 洞察（非事实；仅语言/场景/需求参考） */
  vocInsights: CreativeContextVocInsight[];
  /** 关键词候选（观察/搜索证据；人工确认后才进 listingKeywordBrief） */
  keywordCandidates: CreativeContextKeywordCandidate[];
  /** 竞品上下文（参考 only；禁止复制为目标商品属性） */
  competitiveContext: CreativeContextCompetitiveInsight[];
  /** 供应上下文（参考 only；displayedPrice ≠ purchaseCost；Similar ≠ Exact） */
  sourcingContext: CreativeContextSourcingEntry[];
  /** AI 参考（aiEvidenceSummary + agentOutputSnapshot；AI_REFERENCE_NOT_FACT） */
  aiReferences: CreativeContextAiReference[];
  /** 缺失/冲突（不得推断补全） */
  missingConflicts: CreativeContextMissingConflict[];
  counts: CreativeContextCounts;
};

// ─── 内部工具 ─────────────────────────────────────────────

const MAX_EXCERPT = 200;
const MAX_THEMES = 12;
const MAX_KEYWORDS = 20;
const MAX_COMPETITORS = 5;
const MAX_SOURCING = 5;
const MAX_AI_REFS = 10;
const MAX_MISSING = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanExcerpt(value: unknown, maxLength = MAX_EXCERPT): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function deterministicId(seed: string, salt: string): string {
  return sha256(`${salt}:${seed}`).slice(0, 32);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asIso(value: unknown): string {
  const text = asString(value);
  if (!text || Number.isNaN(Date.parse(text))) return "";
  return new Date(text).toISOString();
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ─── Evidence 解析（fail-soft：结构非法 → null）───────────

function parseBrowserEvidenceNamespace(value: unknown): {
  candidateId: string | null;
  targetAsin: string | null;
  snapshots: Array<Record<string, unknown>>;
} | null {
  if (!isRecord(value)) return null;
  const snapshots = Array.isArray(value.snapshots) ? value.snapshots.filter(isRecord) : [];
  return {
    candidateId: asString(value.candidateId) || null,
    targetAsin: asString(value.targetAsin) || null,
    snapshots,
  };
}

function parseVocNamespace(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseAiSummaryNamespace(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseKeywordNamespace(value: unknown): {
  reportType: string;
  capturedAt: string;
  rows: Array<Record<string, unknown>>;
} | null {
  if (!isRecord(value)) return null;
  const rows = Array.isArray(value.rows) ? value.rows.filter(isRecord) : [];
  return {
    reportType: asString(value.reportType),
    capturedAt: asIso(value.capturedAt),
    rows,
  };
}

function parseCompetitorNamespace(value: unknown): {
  asins: Array<Record<string, unknown>>;
} | null {
  if (!isRecord(value)) return null;
  const asins = Array.isArray(value.asins) ? value.asins.filter(isRecord) : [];
  return { asins };
}

function parseSourcingNamespace(value: unknown): {
  capturedAt: string;
  method: string;
  candidates: Array<Record<string, unknown>>;
  humanConfirmed: Array<Record<string, unknown>>;
} | null {
  if (!isRecord(value)) return null;
  const candidates = Array.isArray(value.candidates) ? value.candidates.filter(isRecord) : [];
  const humanConfirmed = Array.isArray(value.humanConfirmed) ? value.humanConfirmed.filter(isRecord) : [];
  return {
    capturedAt: asIso(value.capturedAt),
    method: asString(value.acquisition && isRecord(value.acquisition) ? value.acquisition.method : ""),
    candidates,
    humanConfirmed,
  };
}

function parseHandoffConfirmedFacts(value: unknown): CreativeContextV1["confirmedFacts"] {
  if (!isRecord(value)) return [];
  const versions = Array.isArray(value.versions) ? value.versions : [];
  const last = versions[versions.length - 1];
  if (!isRecord(last)) return [];
  const facts = Array.isArray(last.confirmedFacts) ? last.confirmedFacts.filter(isRecord) : [];
  return facts.map((f) => ({
    field: asString(f.field).slice(0, 120),
    label: asString(f.label).slice(0, 120),
    value: (typeof f.value === "string" ? f.value : String(f.value ?? "")).slice(0, 500),
    usageScopes: Array.isArray(f.usageScopes) ? f.usageScopes.filter((s): s is string => typeof s === "string") : [],
    sourceKind: asString(f.sourceRef && isRecord(f.sourceRef) ? f.sourceRef.sourceKind : ""),
  }));
}

function parseAgentOutputReferences(value: unknown): CreativeContextAiReference[] {
  if (!isRecord(value) || !isRecord(value.agentOutputSnapshot)) return [];
  const agent = value.agentOutputSnapshot as Record<string, unknown>;
  const out: CreativeContextAiReference[] = [];
  const listing = isRecord(agent.listingSnapshot) ? agent.listingSnapshot : null;
  const summary = isRecord(agent.summarySnapshot) ? agent.summarySnapshot : null;
  if (listing) {
    const titleDraft = cleanExcerpt(listing.titleDraft, 300);
    if (titleDraft) {
      out.push({
        referenceId: deterministicId(`agent:title:${titleDraft}`, "ai-ref"),
        field: "listing_title_idea",
        summary: titleDraft,
        allowedUse: "composition",
        sourceType: "agent_output_snapshot",
        evidenceRef: `ev:agent:listing_title`,
        provenance: { evidenceRef: `ev:agent:listing_title`, sourceType: "agent_output_snapshot", observedAt: "" },
      });
    }
    const bullets = Array.isArray(listing.bulletDrafts)
      ? listing.bulletDrafts.filter((b): b is string => typeof b === "string").slice(0, 3)
      : [];
    for (const bullet of bullets) {
      const text = cleanExcerpt(bullet, 200);
      if (!text) continue;
      out.push({
        referenceId: deterministicId(`agent:bullet:${text}`, "ai-ref"),
        field: "bullet_idea",
        summary: text,
        allowedUse: "non_factual_angle",
        sourceType: "agent_output_snapshot",
        evidenceRef: `ev:agent:bullet`,
        provenance: { evidenceRef: `ev:agent:bullet`, sourceType: "agent_output_snapshot", observedAt: "" },
      });
    }
  }
  if (summary) {
    const points = Array.isArray(summary.sellingPoints)
      ? summary.sellingPoints.filter((p): p is string => typeof p === "string").slice(0, 3)
      : [];
    for (const point of points) {
      const text = cleanExcerpt(point, 200);
      if (!text) continue;
      out.push({
        referenceId: deterministicId(`agent:sp:${text}`, "ai-ref"),
        field: "selling_point_idea",
        summary: text,
        allowedUse: "non_factual_angle",
        sourceType: "agent_output_snapshot",
        evidenceRef: `ev:agent:selling_point`,
        provenance: { evidenceRef: `ev:agent:selling_point`, sourceType: "agent_output_snapshot", observedAt: "" },
      });
    }
  }
  return out.slice(0, MAX_AI_REFS);
}

// ─── 核心 Builder ─────────────────────────────────────────

export type CreativeContextBuilderInput = {
  resultJson: Record<string, unknown>;
  /** researchRevision（来自 researchRecord，可选：无则 0） */
  researchRevision?: number;
  candidateId?: string;
};

export function buildCreativeContextFromResearch(input: CreativeContextBuilderInput): CreativeContextV1 {
  const result = input.resultJson;
  const researchRevision = input.researchRevision ?? 0;
  const candidateId = input.candidateId ?? "";

  const browser = parseBrowserEvidenceNamespace(result.browserEvidence);
  const voc = parseVocNamespace(result.vocAnalysis);
  const aiSummary = parseAiSummaryNamespace(result.aiEvidenceSummary);
  const keyword = parseKeywordNamespace(result.keywordEvidence);
  const competitor = parseCompetitorNamespace(result.competitorEvidence);
  const sourcing = parseSourcingNamespace(result.sourcingEvidence);

  const confirmedFacts = parseHandoffConfirmedFacts(result.creativeHandoff);

  // ── confirmableFactCandidates ──
  const confirmableFactCandidates: CreativeContextConfirmableFactCandidate[] = [];

  // (a) candidateAnalysisContext stable facts → 由 preview/persistence 既有链产生，
  //     本模块只补充 browser evidence 投影；但为让 Studio 展示统一，这里也接收既有 stable facts 摘要。
  //     实际 stable→candidate 转换仍在 Creative Handoff 链内（buildConfirmableCandidates），
  //     本模块的 candidates 为 browser evidence 专属 + 汇总计数。

  // (b) Amazon Browser Evidence 确定性字段 → confirmable candidates（§33 逐字段规则）
  if (browser) {
    const targetAsin = browser.targetAsin;
    for (const snap of browser.snapshots) {
      const entityBinding = isRecord(snap.entityBinding) ? snap.entityBinding : null;
      const bound = entityBinding?.bound === true;
      const urlAsin = asString(entityBinding?.urlAsin) || null;
      const pageAsin = asString(entityBinding?.pageAsin) || null;
      const observedAsin = urlAsin ?? pageAsin;
      const proof = [
        entityBinding?.urlMatchesExpected === true ? "urlMatchesExpected" : "",
        entityBinding?.pageAnchorMatchesExpected === true ? "pageAnchorMatchesExpected" : "",
        entityBinding?.productContainerFound === true ? "productContainerFound" : "",
      ].filter(Boolean);
      const capturedAt = asIso(snap.capturedAt);
      if (!capturedAt) continue;
      const fields = isRecord(snap.fields) ? snap.fields : {};
      const fieldVal = (name: string) => (isRecord(fields[name]) ? fields[name].value : null);
      const fieldStatus = (name: string) => (isRecord(fields[name]) ? fields[name].status : null);
      const observedAsinForRef = observedAsin ?? targetAsin ?? "unknown";
      const marketplace = asString(snap.marketplace) || "Amazon US";
      const currency = asString(snap.currency) || "";
      const provenanceBase = `ev:browser:${observedAsinForRef}:${capturedAt}`;

      // entity binding 不成立 → 不投影任何 fact candidate（wrong entity 保护，§67）
      if (!bound || (targetAsin && observedAsin && observedAsin !== targetAsin)) {
        continue;
      }

      // ASIN：identity_only（不是可声明的商品属性，仅身份绑定）
      const asinValue = asString(fieldVal("asin"));
      if (asinValue && fieldStatus("asin") === "correct") {
        confirmableFactCandidates.push({
          selectionKey: deterministicId(`browser:asin:${observedAsinForRef}:${asinValue}:${capturedAt}`, "cc-candidate"),
          field: "asin",
          label: "ASIN",
          value: asinValue,
          factCategory: "product_fact",
          stabilityRule: "identity_only",
          allowedUsageScopes: ["internal"],
          sourceKind: "amazon_browser",
          capturedAt,
          provenance: { evidenceRef: provenanceBase, sourceType: "amazon_browser", observedAt: capturedAt },
          entityBinding: { bound, targetAsin, observedAsin, proof },
        });
      }

      // 标题：routing_only（可作身份/路由参考，不能确认进 Listing 事实）
      const titleValue = asString(fieldVal("title"));
      if (titleValue && fieldStatus("title") === "correct") {
        confirmableFactCandidates.push({
          selectionKey: deterministicId(`browser:title:${observedAsinForRef}:${titleValue.slice(0, 80)}:${capturedAt}`, "cc-candidate"),
          field: "title",
          label: "商品标题",
          value: titleValue.slice(0, 240),
          factCategory: "product_fact",
          stabilityRule: "routing_only",
          allowedUsageScopes: ["internal"],
          sourceKind: "amazon_browser",
          capturedAt,
          provenance: { evidenceRef: provenanceBase, sourceType: "amazon_browser", observedAt: capturedAt },
          entityBinding: { bound, targetAsin, observedAsin, proof },
        });
      }

      // Observed Price：market_signal（Observed Amazon Page Price，非采购成本/建议售价，§7）
      const priceValue = asNumber(fieldVal("price"));
      if (priceValue !== null && fieldStatus("price") === "correct") {
        confirmableFactCandidates.push({
          selectionKey: deterministicId(`browser:price:${observedAsinForRef}:${priceValue}:${capturedAt}`, "cc-candidate"),
          field: "price_usd",
          label: "Observed Amazon Page Price",
          value: priceValue,
          factCategory: "market_signal",
          stabilityRule: "human_confirmation_required_for_claim",
          allowedUsageScopes: ["internal"],
          sourceKind: "amazon_browser",
          capturedAt,
          provenance: { evidenceRef: provenanceBase, sourceType: "amazon_browser", observedAt: capturedAt },
          entityBinding: { bound, targetAsin, observedAsin, proof },
          observedPrice: { currency, marketplace },
        });
      }

      // BSR：market_signal
      const bsrValue = asNumber(fieldVal("bsr"));
      if (bsrValue !== null && fieldStatus("bsr") === "correct") {
        confirmableFactCandidates.push({
          selectionKey: deterministicId(`browser:bsr:${observedAsinForRef}:${bsrValue}:${capturedAt}`, "cc-candidate"),
          field: "bsr",
          label: "BSR",
          value: bsrValue,
          factCategory: "market_signal",
          stabilityRule: "human_confirmation_required_for_claim",
          allowedUsageScopes: ["internal"],
          sourceKind: "amazon_browser",
          capturedAt,
          provenance: { evidenceRef: provenanceBase, sourceType: "amazon_browser", observedAt: capturedAt },
          entityBinding: { bound, targetAsin, observedAsin, proof },
        });
      }

      // Rating：market_signal
      const ratingValue = asNumber(fieldVal("rating"));
      if (ratingValue !== null && fieldStatus("rating") === "correct") {
        confirmableFactCandidates.push({
          selectionKey: deterministicId(`browser:rating:${observedAsinForRef}:${ratingValue}:${capturedAt}`, "cc-candidate"),
          field: "rating",
          label: "评分",
          value: ratingValue,
          factCategory: "market_signal",
          stabilityRule: "human_confirmation_required_for_claim",
          allowedUsageScopes: ["internal"],
          sourceKind: "amazon_browser",
          capturedAt,
          provenance: { evidenceRef: provenanceBase, sourceType: "amazon_browser", observedAt: capturedAt },
          entityBinding: { bound, targetAsin, observedAsin, proof },
        });
      }

      // Review Count：market_signal
      const reviewCountValue = asNumber(fieldVal("reviewCount"));
      if (reviewCountValue !== null && fieldStatus("reviewCount") === "correct") {
        confirmableFactCandidates.push({
          selectionKey: deterministicId(`browser:review_count:${observedAsinForRef}:${reviewCountValue}:${capturedAt}`, "cc-candidate"),
          field: "review_count",
          label: "评论数",
          value: reviewCountValue,
          factCategory: "market_signal",
          stabilityRule: "human_confirmation_required_for_claim",
          allowedUsageScopes: ["internal"],
          sourceKind: "amazon_browser",
          capturedAt,
          provenance: { evidenceRef: provenanceBase, sourceType: "amazon_browser", observedAt: capturedAt },
          entityBinding: { bound, targetAsin, observedAsin, proof },
        });
      }
    }
  }

  // ── vocInsights（§8-9：VOC ≠ Fact）──
  const vocInsights: CreativeContextVocInsight[] = [];
  if (voc) {
    const themes = isRecord(voc.themes) ? voc.themes : {};
    const themeGroups: Array<[string, unknown]> = Object.entries(themes).filter(([key]) =>
      ["positiveThemes", "painPointThemes", "usageScenarios", "recurringRequests", "weakSignals"].includes(key));
    for (const [, groupRaw] of themeGroups) {
      if (!Array.isArray(groupRaw)) continue;
      for (const themeRaw of groupRaw) {
        if (!isRecord(themeRaw)) continue;
        const label = cleanExcerpt(themeRaw.label, 120);
        const summary = cleanExcerpt(themeRaw.summary, 200);
        if (!label && !summary) continue;
        const evidenceRefs = Array.isArray(themeRaw.evidenceRefs)
          ? themeRaw.evidenceRefs.filter((r): r is string => typeof r === "string").slice(0, 5)
          : [];
        const reviewCount = asNumber(themeRaw.reviewCount) ?? 0;
        const coverage = asNumber(themeRaw.coverage) ?? 0;
        const strengthRaw = asString(themeRaw.strength);
        const strength = strengthRaw === "weak" || strengthRaw === "recurring" ? strengthRaw : "isolated";
        const themeId = asString(themeRaw.themeId) || deterministicId(`voc:${label}:${summary}`, "voc");
        vocInsights.push({
          insightId: themeId,
          theme: label,
          summary: summary || label,
          evidenceRefs,
          reviewCount,
          coverage,
          strength,
          sourceType: "voc_theme",
          provenance: {
            evidenceRef: evidenceRefs[0] ? `ev:voc:${evidenceRefs[0]}` : `ev:voc:theme:${themeId}`,
            sourceType: "voc_theme",
            observedAt: "",
          },
        });
      }
    }
    // conflicts → conflict insights（保留证据引用）
    const conflicts = Array.isArray(themes.conflicts) ? themes.conflicts.filter(isRecord) : [];
    for (const conflict of conflicts) {
      const label = cleanExcerpt(conflict.label, 120);
      const summary = cleanExcerpt(conflict.summary, 200);
      if (!summary && !label) continue;
      const positive = isRecord(conflict.positive) ? conflict.positive : null;
      const negative = isRecord(conflict.negative) ? conflict.negative : null;
      const refs = [
        ...(Array.isArray(positive?.evidenceRefs) ? positive.evidenceRefs : []),
        ...(Array.isArray(negative?.evidenceRefs) ? negative.evidenceRefs : []),
      ].filter((r): r is string => typeof r === "string").slice(0, 5);
      vocInsights.push({
        insightId: deterministicId(`voc:conflict:${label}:${summary}`, "voc"),
        theme: `冲突：${label}`,
        summary: summary || label,
        evidenceRefs: refs,
        reviewCount: (asNumber(positive?.reviewCount) ?? 0) + (asNumber(negative?.reviewCount) ?? 0),
        coverage: 0,
        strength: "isolated",
        sourceType: "voc_conflict",
        provenance: {
          evidenceRef: refs[0] ? `ev:voc:${refs[0]}` : `ev:voc:conflict`,
          sourceType: "voc_conflict",
          observedAt: "",
        },
      });
    }
  }
  vocInsights.sort((a, b) => b.reviewCount - a.reviewCount);
  vocInsights.splice(MAX_THEMES);

  // ── keywordCandidates（§12-14：observed/search evidence，人工确认后才进 brief）──
  const keywordCandidates: CreativeContextKeywordCandidate[] = [];
  if (keyword) {
    for (const row of keyword.rows) {
      const kw = cleanExcerpt(row.keyword, 120);
      if (!kw) continue;
      const rowNumber = asNumber(row.rowNumber) ?? 0;
      const capturedAt = keyword.capturedAt;
      keywordCandidates.push({
        keyword: kw,
        reportType: keyword.reportType,
        rowNumber,
        evidenceRef: `ev:keyword:${keyword.reportType}:${kw}`,
        observedAt: capturedAt,
        provenance: {
          evidenceRef: `ev:keyword:${keyword.reportType}:${kw}`,
          sourceType: "keyword_evidence",
          observedAt: capturedAt,
        },
      });
    }
    keywordCandidates.sort((a, b) => a.rowNumber - b.rowNumber);
    keywordCandidates.splice(MAX_KEYWORDS);
  }

  // ── competitiveContext（§15-16：reference-only，禁止复制为目标商品属性）──
  const competitiveContext: CreativeContextCompetitiveInsight[] = [];
  if (competitor) {
    for (const entry of competitor.asins.slice(0, MAX_COMPETITORS)) {
      const asin = asString(entry.asin);
      if (!asin) continue;
      competitiveContext.push({
        asin,
        note: cleanExcerpt(entry.note, 160),
        addedAt: asIso(entry.addedAt),
        evidenceRef: `ev:competitor:${asin}`,
        provenance: {
          evidenceRef: `ev:competitor:${asin}`,
          sourceType: "competitor_evidence",
          observedAt: asIso(entry.addedAt),
        },
      });
    }
  }

  // ── sourcingContext（§17-18：displayedPrice ≠ purchaseCost；Similar ≠ Exact）──
  const sourcingContext: CreativeContextSourcingEntry[] = [];
  if (sourcing) {
    const entries = sourcing.humanConfirmed.length > 0 ? sourcing.humanConfirmed : sourcing.candidates;
    for (const entry of entries.slice(0, MAX_SOURCING)) {
      const offerId = asString(entry.offerId);
      if (!offerId) continue;
      sourcingContext.push({
        offerId,
        method: sourcing.method,
        title: cleanExcerpt(entry.title, 160),
        displayedPrice: cleanExcerpt(entry.displayedPrice ?? entry.priceText, 80),
        displayedMoq: cleanExcerpt(entry.displayedMoq ?? entry.moqText, 80),
        imageUrl: cleanExcerpt(entry.imageUrl, 300),
        confirmed: sourcing.humanConfirmed.length > 0,
        evidenceRef: `ev:sourcing:${offerId}`,
        observedAt: sourcing.capturedAt,
        provenance: {
          evidenceRef: `ev:sourcing:${offerId}`,
          sourceType: "sourcing_evidence",
          observedAt: sourcing.capturedAt,
        },
      });
    }
  }

  // ── aiReferences（§10-11：AI_REFERENCE_NOT_FACT）──
  const aiReferences: CreativeContextAiReference[] = [];
  if (aiSummary && isRecord(aiSummary.summary)) {
    const s = aiSummary.summary as Record<string, unknown>;
    const pushSection = (key: string, field: string, allowedUse: CreativeContextAiReference["allowedUse"]) => {
      const items = Array.isArray(s[key]) ? s[key].filter(isRecord) : [];
      for (const item of items.slice(0, 4)) {
        const text = cleanExcerpt(item.text, 200);
        if (!text) continue;
        const id = asString(item.id) || deterministicId(`ai:${key}:${text}`, "ai-ref");
        const refs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs.filter((r): r is string => typeof r === "string") : [];
        aiReferences.push({
          referenceId: id,
          field,
          summary: text,
          allowedUse,
          sourceType: "ai_evidence_summary",
          evidenceRef: refs[0] ?? `ev:ai:${key}:${id}`,
          provenance: {
            evidenceRef: refs[0] ?? `ev:ai:${key}:${id}`,
            sourceType: "ai_evidence_summary",
            observedAt: asIso(aiSummary.finishedAt ?? aiSummary.updatedAt),
          },
        });
      }
    };
    pushSection("facts", "ai_summary_fact", "non_factual_angle");
    pushSection("signals", "ai_summary_signal", "non_factual_angle");
    pushSection("risks", "ai_summary_risk", "tone");
    pushSection("estimates", "ai_summary_estimate", "non_factual_angle");
  }
  // agentOutputSnapshot 仍作 aiReference（§47：保留，不高过 Evidence 事实权限）
  aiReferences.push(...parseAgentOutputReferences(result));
  aiReferences.splice(MAX_AI_REFS);

  // ── missing / conflicts（§20：不得推断补全）──
  const missingConflicts: CreativeContextMissingConflict[] = [];
  if (aiSummary && isRecord(aiSummary.summary)) {
    const s = aiSummary.summary as Record<string, unknown>;
    const pushMissing = (key: string, kind: "missing" | "conflict") => {
      const items = Array.isArray(s[key]) ? s[key].filter(isRecord) : [];
      for (const item of items.slice(0, 6)) {
        const text = cleanExcerpt(item.text, 200);
        if (!text) continue;
        const id = asString(item.id) || deterministicId(`ai:${key}:${text}`, "issue");
        missingConflicts.push({
          kind,
          summary: text,
          sourceType: `ai_evidence_summary:${key}`,
          evidenceRef: `ev:ai:${key}:${id}`,
          provenance: { evidenceRef: `ev:ai:${key}:${id}`, sourceType: `ai_evidence_summary:${key}`, observedAt: asIso(aiSummary.finishedAt ?? aiSummary.updatedAt) },
        });
      }
    };
    pushMissing("missing", "missing");
    pushMissing("conflicts", "conflict");
  }
  if (voc) {
    const unknowns = Array.isArray(voc.unknowns) ? voc.unknowns.filter((u): u is string => typeof u === "string") : [];
    for (const u of unknowns.slice(0, 4)) {
      const text = cleanExcerpt(u, 200);
      if (!text) continue;
      missingConflicts.push({
        kind: "missing",
        summary: text,
        sourceType: "voc_unknowns",
        evidenceRef: "ev:voc:unknowns",
        provenance: { evidenceRef: "ev:voc:unknowns", sourceType: "voc_unknowns", observedAt: "" },
      });
    }
  }
  missingConflicts.splice(MAX_MISSING);

  const counts: CreativeContextCounts = {
    confirmedFacts: confirmedFacts.length,
    confirmableCandidates: confirmableFactCandidates.length,
    vocInsights: vocInsights.length,
    keywordCandidates: keywordCandidates.length,
    competitiveInsights: competitiveContext.length,
    sourcingEntries: sourcingContext.length,
    aiReferences: aiReferences.length,
    missingConflicts: missingConflicts.length,
  };

  return {
    schema: CREATIVE_CONTEXT_SCHEMA,
    version: CREATIVE_CONTEXT_VERSION,
    generatedAt: "",
    source: { researchRevision, candidateId },
    confirmedFacts,
    confirmableFactCandidates,
    vocInsights,
    keywordCandidates,
    competitiveContext,
    sourcingContext,
    aiReferences,
    missingConflicts,
    counts,
  };
}

/** 浏览器安全摘要（不暴露内部字段；仅计数 + 分层摘要） */
export function summarizeCreativeContext(context: CreativeContextV1) {
  return {
    schema: context.schema,
    counts: context.counts,
    confirmedFactFields: context.confirmedFacts.map((f) => f.field),
    confirmableCandidateFields: context.confirmableFactCandidates.map((c) => c.field),
    vocThemeLabels: context.vocInsights.slice(0, 5).map((v) => v.theme),
    keywordSamples: context.keywordCandidates.slice(0, 5).map((k) => k.keyword),
    competitorAsins: context.competitiveContext.map((c) => c.asin),
    sourcingOfferIds: context.sourcingContext.map((s) => s.offerId),
    aiReferenceCount: context.aiReferences.length,
    missingConflictCount: context.missingConflicts.length,
  };
}

/** Prompt 注入隔离标记：所有参考层都不得作为事实声明 */
export const AI_REFERENCE_NOT_FACT = "AI_REFERENCE_NOT_FACT";
