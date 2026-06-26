/**
 * Phase 1E — POST /api/opportunities/crawl
 * 公开源抓取 → 清洗 → 去重 → 评分 → 机会池展示。
 * 不调 AI，不写数据库，不保存任务记录。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { crawlUrls } from "@/lib/server/radarCrawler";
import { normalizeResults } from "@/lib/server/radarNormalize";
import { scoreCandidates } from "@/lib/server/radarScore";

export const runtime = "nodejs";
export const maxDuration = 60;

const REQUEST_BODY_LIMIT_BYTES = 32 * 1024;
const MAX_URLS = 5;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: NextRequest) {
  // Body size check
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({ ok: false, error: { code: "body_too_large", message: "请求体过大。" } }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  const bodyObj = body as Record<string, unknown>;

  // Auth: use unified signed token (same as /tasks, /agent/run, etc.)
  const auth = requireAuthenticated(request, bodyObj);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }

  // Input extraction
  const input = asString(bodyObj.input) || asString(bodyObj.urls) || asString(bodyObj.rawText);
  if (!input) {
    return jsonResponse({ ok: false, error: { code: "missing_input", message: "请提供 URL、RSS 或 sitemap 地址。" } }, 400);
  }

  // Parse URLs from input (one per line)
  const rawUrls = input
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter((line) => line && /^https?:\/\//i.test(line));

  if (!rawUrls.length) {
    return jsonResponse({ ok: false, error: { code: "no_valid_urls", message: "未检测到有效 URL（需以 http:// 或 https:// 开头）。" } }, 400);
  }

  if (rawUrls.length > MAX_URLS) {
    return jsonResponse({
      ok: false,
      error: { code: "too_many_urls", message: `单次最多 ${MAX_URLS} 个 URL，当前提供 ${rawUrls.length} 个。` },
    }, 400);
  }

  // Crawl
  const { results: crawlResults, warnings: crawlWarnings } = await crawlUrls(rawUrls);

  // Normalize
  const { items, warnings: normWarnings } = normalizeResults(crawlResults);

  // Score
  const scored = scoreCandidates(items);

  // Collect all warnings
  const allWarnings = [...crawlWarnings, ...normWarnings];
  for (const cr of crawlResults) {
    if (cr.status !== "ok" && cr.error) {
      allWarnings.push(`${cr.url}: ${cr.error}`);
    }
  }

  return jsonResponse({
    ok: true,
    items: scored.map((item) => ({
      title: item.title,
      sourceUrl: item.sourceUrl,
      sourceType: item.sourceType,
      sourceHost: item.sourceHost,
      categoryHint: item.categoryHint,
      signalText: item.signalText,
      riskHint: item.riskHint,
      scores: item.scores,
    })),
    totalCrawled: crawlResults.length,
    totalOk: crawlResults.filter((r) => r.status === "ok").length,
    totalCandidates: scored.length,
    warnings: allWarnings,
  });
}
