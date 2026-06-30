/**
 * Phase 4-B — POST /api/opportunities/source-import
 * 来源导入器 MVP：接收 URL 列表 → 爬取 → 清洗 → 评分 → 返回候选项。
 * 不写数据库，不调用 AI。用户确认后再由前端调用候选池 API 入池。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { crawlUrls } from "@/lib/server/radarCrawler";
import { normalizeResults } from "@/lib/server/radarNormalize";
import { scoreCandidates } from "@/lib/server/radarScore";
import { normalizeCandidateEvidence, type CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_URLS = 5;

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

function riskLabel(riskScore: number): string {
  if (riskScore >= 70) return "高风险";
  if (riskScore >= 40) return "需注意";
  return "低风险";
}

function summaryLabel(score: number, riskLevel: string): string {
  if (riskLevel === "red") return "风险较高，建议人工判断后再入池";
  if (score >= 80) return "高分候选，建议优先评估";
  if (score >= 60) return "中等分数，可入池观察";
  return "分数偏低，可入池备用";
}

export async function POST(request: NextRequest) {
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
    const { items, warnings: normWarnings } = normalizeResults(crawlResults);

    // Score
    const scored = scoreCandidates(items);

    // Collect warnings with machine-readable failure reasons
    const allWarnings = [...crawlWarnings, ...normWarnings];
    const failureReasons: string[] = [];
    for (const cr of crawlResults) {
      if (cr.status !== "ok" && cr.error) {
        const reasonTag = cr.failureReason ? ` [${cr.failureReason}]` : "";
        allWarnings.push(`${cr.url}: ${cr.error}${reasonTag}`);
        if (cr.failureReason) failureReasons.push(cr.failureReason);
      }
    }

    // Map to candidate format (Phase 4-D.7: include candidateType)
    const candidates: SourceImportCandidate[] = scored.map((item) => ({
      title: item.title,
      sourceUrl: item.sourceUrl,
      sourceType: item.sourceType,
      sourceHost: item.sourceHost,
      categoryHint: item.categoryHint || "日用百货",
      keyword: item.categoryHint || "",
      riskHint: item.riskHint || "",
      riskLevel: riskLevelFromScore(item.scores.riskScore),
      summaryLabel: summaryLabel(item.scores.finalScore, riskLevelFromScore(item.scores.riskScore)),
      score: item.scores.finalScore,
      demandSignalScore: item.scores.demandSignalScore,
      supplyEaseScore: item.scores.supplyEaseScore,
      riskScore: item.scores.riskScore,
      beginnerFitScore: item.scores.beginnerFitScore,
      // Phase 4-D.7: candidate quality classification
      candidateType: (item.candidateType as SourceImportCandidate["candidateType"]) || "product_candidate",
      evidenceSnapshot: normalizeCandidateEvidence({
        title: item.title,
        sourceType: item.sourceType,
        sourceName: item.sourceHost,
        sourceUrl: item.sourceUrl,
        candidateType: (item.candidateType as SourceImportCandidate["candidateType"]) || "product_candidate",
        score: item.scores.finalScore,
        demandSignalScore: item.scores.demandSignalScore,
        supplyEaseScore: item.scores.supplyEaseScore,
        riskScore: item.scores.riskScore,
        beginnerFitScore: item.scores.beginnerFitScore,
        riskHint: item.riskHint,
      }),
    }));

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
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error ? error.message : "来源导入失败，请稍后重试。",
      },
    }, 500);
  }
}
