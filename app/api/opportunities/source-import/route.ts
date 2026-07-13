/**
 * Phase 4-B — POST /api/opportunities/source-import
 * 来源导入器 MVP：接收 URL 列表 → 爬取 → 清洗 → 评分 → 返回候选项。
 * 不写数据库，不调用 AI。用户确认后再由前端调用候选池 API 入池。
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { crawlUrls } from "@/lib/server/radarCrawler";
import { normalizeResults, type CandidateItem } from "@/lib/server/radarNormalize";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";
import { normalizeCandidateEvidence, type CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeEvidenceUrl,
  normalizeSourceEvidenceV2,
  type RuleAssessmentV1,
  type SourceEvidenceSourceType,
  type SourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import {
  buildSourceProofSubject,
  createSourceProof,
} from "@/lib/server/sourceProof";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_URLS = 5;
const REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

type SourceImportCandidate = {
  title: string;
  sourceUrl: string;
  sourceType: string;
  sourceHost: string;
  categoryHint: string;
  keyword: string;
  riskHint: string;
  riskLevel: string;
  summaryLabel: string;
  score: number;
  demandSignalScore: number;
  supplyEaseScore: number;
  riskScore: number;
  beginnerFitScore: number;
  /** Phase 4-D.7: candidate quality classification */
  candidateType?: "product_candidate" | "category_hint" | "trend_signal" | "rejected";
  evidenceSnapshot?: CandidateEvidenceSnapshot;
  sourceEvidence: SourceEvidenceV2;
  ruleAssessment: RuleAssessmentV1;
  sourceProof: string;
};

type SourceImportResult = {
  ok: true;
  candidates: SourceImportCandidate[];
  summary: {
    totalUrls: number;
    okUrls: number;
    failedUrls: number;
    totalCandidates: number;
  };
  warnings: string[];
};

type SourceImportError = {
  ok: false;
  error: { code: string; message: string };
};

function json(body: SourceImportResult | SourceImportError, status = 200) {
  return NextResponse.json(body, { status });
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function riskLevelFromScore(riskScore: number): string {
  if (riskScore >= 70) return "red";
  if (riskScore >= 40) return "yellow";
  return "green";
}

function summaryLabel(score: number, riskLevel: string): string {
  if (riskLevel === "red") return "风险较高，建议人工判断后再入池";
  if (score >= 80) return "高分候选，建议优先评估";
  if (score >= 60) return "中等分数，可入池观察";
  return "分数偏低，可入池备用";
}

class SourceContractFatalError extends Error {}

function sourceTypeOf(value: CandidateItem["sourceType"]): SourceEvidenceSourceType | null {
  return value === "html" || value === "rss" || value === "sitemap" || value === "json"
    ? value
    : null;
}

function buildSignedCandidate(
  item: CandidateItem,
  subject: string,
  computedAt: string,
): SourceImportCandidate {
  const sourceType = sourceTypeOf(item.sourceType);
  if (!sourceType || !item.provenance) throw new Error("SOURCE_CANDIDATE_PROVENANCE_INVALID");
  const normalizedDocumentUrl = normalizeEvidenceUrl(item.provenance.documentUrl, "document_url");
  const normalizedFinalUrl = normalizeEvidenceUrl(item.provenance.crawl.finalUrl, "final_url");
  if (!normalizedDocumentUrl || normalizedDocumentUrl !== normalizedFinalUrl) {
    throw new Error("SOURCE_DOCUMENT_URL_MISMATCH");
  }

  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: `source-${randomUUID()}`,
    origin: "public_url",
    capturedAt: item.provenance.crawl.capturedAt,
    submittedUrl: item.provenance.crawl.submittedUrl,
    finalUrl: item.provenance.crawl.finalUrl,
    candidateUrl: item.provenance.candidateUrl,
    sourceRelation: item.provenance.sourceRelation,
    sourceHost: item.sourceHost,
    sourceType,
    transportSecurity: item.provenance.crawl.transportSecurity,
    retrieval: {
      status: "retrieved",
      httpStatus: item.provenance.crawl.httpStatus,
      contentType: item.provenance.crawl.contentType,
      robots: item.provenance.crawl.robots,
      redirectCount: item.provenance.crawl.redirectCount,
    },
    observations: {
      title: item.title,
      categoryHint: item.categoryHint,
      signalText: item.signalText,
      priceText: null,
      hasImage: null,
    },
    extractionSignals: item.provenance.extractionSignals,
  });
  const evidenceHash = createEvidenceHash(sourceEvidence);
  const ruleAssessment = assessSourceEvidenceV2(sourceEvidence, computedAt);
  const assessmentHash = createAssessmentHash(ruleAssessment);
  const candidateType = ruleAssessment.candidateType as NonNullable<SourceImportCandidate["candidateType"]>;
  const riskFlags = ruleAssessment.riskFlags;
  const riskHint = riskFlags.join("、") || "未发现明显规则风险";
  const scores = ruleAssessment.scores;

  let sourceProof: string;
  try {
    sourceProof = createSourceProof({
      subject,
      evidenceHash,
      assessmentHash,
      sourceType,
    });
  } catch {
    throw new SourceContractFatalError("SOURCE_PROOF_CREATION_FAILED");
  }

  return {
    title: item.title,
    sourceUrl: item.sourceUrl,
    sourceType: item.sourceType,
    sourceHost: item.sourceHost,
    categoryHint: item.categoryHint || "日用百货",
    keyword: item.categoryHint || "",
    riskHint,
    riskLevel: riskLevelFromScore(scores.risk),
    summaryLabel: summaryLabel(scores.final, riskLevelFromScore(scores.risk)),
    score: scores.final,
    demandSignalScore: scores.demandSignal,
    supplyEaseScore: scores.supplyEase,
    riskScore: scores.risk,
    beginnerFitScore: scores.beginnerFit,
    candidateType,
    evidenceSnapshot: normalizeCandidateEvidence({
      title: item.title,
      sourceType: item.sourceType,
      sourceName: item.sourceHost,
      sourceUrl: item.sourceUrl,
      candidateType,
      score: scores.final,
      demandSignalScore: scores.demandSignal,
      supplyEaseScore: scores.supplyEase,
      riskScore: scores.risk,
      beginnerFitScore: scores.beginnerFit,
      riskHint,
    }),
    sourceEvidence,
    ruleAssessment,
    sourceProof,
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return json({ ok: false, error: { code: "body_too_large", message: "请求体过大。" } }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }

  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  const authResult = requireAuthenticated(request, body);
  if (!authResult.ok) return NextResponse.json(
    { ok: false, error: { code: authResult.code, message: authResult.message } },
    { status: authResult.status },
  );

  // Parse URLs
  const rawInput = asString(body.input) || asString(body.urls);
  if (!rawInput) {
    return json({ ok: false, error: { code: "missing_input", message: "请提供至少一个公开 URL。" } }, 400);
  }
  if (new TextEncoder().encode(rawInput).length > REQUEST_BODY_LIMIT_BYTES) {
    return json({ ok: false, error: { code: "body_too_large", message: "请求体过大。" } }, 413);
  }

  const rawUrls = rawInput
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter((line) => line && /^https?:\/\//i.test(line));

  if (!rawUrls.length) {
    return json({ ok: false, error: { code: "no_valid_urls", message: "未检测到有效 URL（需以 http:// 或 https:// 开头）。" } }, 400);
  }

  if (rawUrls.length > MAX_URLS) {
    return json({
      ok: false,
      error: { code: "too_many_urls", message: `单次最多 ${MAX_URLS} 个 URL，当前提供 ${rawUrls.length} 个。` },
    }, 400);
  }

  try {
    // Crawl
    const { results: crawlResults, warnings: crawlWarnings } = await crawlUrls(rawUrls);

    // Normalize
    const { items, warnings: normWarnings } = normalizeResults(crawlResults, { includeRejected: true });

    // Collect warnings with machine-readable failure reasons
    const allWarnings = [...crawlWarnings, ...normWarnings];
    for (const cr of crawlResults) {
      if (cr.status !== "ok" && cr.error) {
        const reasonTag = cr.failureReason ? ` [${cr.failureReason}]` : "";
        allWarnings.push(`${cr.url}: ${cr.error}${reasonTag}`);
      }
    }

    let subject: string;
    try {
      subject = buildSourceProofSubject(authResult.context);
    } catch {
      throw new SourceContractFatalError("SOURCE_SUBJECT_INVALID");
    }
    const computedAt = new Date().toISOString();
    const candidates: SourceImportCandidate[] = [];
    let rejectedContractCandidates = 0;
    for (const item of items) {
      try {
        candidates.push(buildSignedCandidate(item, subject, computedAt));
      } catch (error) {
        if (error instanceof SourceContractFatalError) throw error;
        rejectedContractCandidates += 1;
      }
    }
    if (rejectedContractCandidates > 0) {
      allWarnings.push(`忽略 ${rejectedContractCandidates} 条无法建立可信来源契约的候选`);
    }
    candidates.sort((a, b) => b.score - a.score);

    const okCount = crawlResults.filter((r) => r.status === "ok").length;

    return json({
      ok: true,
      candidates,
      summary: {
        totalUrls: rawUrls.length,
        okUrls: okCount,
        failedUrls: rawUrls.length - okCount,
        totalCandidates: candidates.length,
      },
      warnings: allWarnings,
    });
  } catch (error) {
    if (error instanceof SourceContractFatalError) {
      return json({
        ok: false,
        error: {
          code: "source_contract_failed",
          message: "来源证明暂时无法生成，请稍后重试。",
        },
      }, 500);
    }
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: "来源导入失败，请稍后重试。",
      },
    }, 500);
  }
}
