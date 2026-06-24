/**
 * Phase 4-D.7 — Radar Crawler (improved limits + failure reasons)
 * 低频公开源抓取，SSRF 防护，robots.txt 检查。
 * 不绕验证码、不模拟登录、不使用 Cookie/代理池。
 *
 * SSRF 防护覆盖：
 * - 协议限制（仅 http/https）
 * - hostname 黑名单
 * - HTTP 重定向目标重新校验
 * - DNS 解析后内网 IP 检测
 *
 * Phase 4-D.7 changes:
 * - timeout 10s → 30s (SOURCE_IMPORT_FETCH_TIMEOUT_MS)
 * - max response 1MB → 5MB (SOURCE_IMPORT_MAX_BYTES)
 * - all constants are now named, not magic numbers
 * - added machine-readable failureReason to every CrawlResult
 */

import { isValidTargetUrl } from "@/lib/server/ssrfGuard";

const USER_AGENT = "QingxuanAgent-Radar-MVP/0.1";

/**
 * Source import fetch limits.
 * Kept as named constants — not magic numbers — for auditability and tuning.
 */
const SOURCE_IMPORT_FETCH_TIMEOUT_MS = 30_000;   // 30s (was 10s) — allows China→global connections
const SOURCE_IMPORT_MAX_BYTES = 5 * 1024 * 1024; // 5MB (was 1MB) — handles modern pages
const MAX_REDIRECTS = 3;
const MAX_URLS_PER_REQUEST = 5;
const INTER_REQUEST_DELAY_MS = 500;

export type CrawlResult = {
  url: string;
  status: "ok" | "blocked" | "timeout" | "error" | "too_large" | "invalid";
  statusCode?: number;
  contentType?: string;
  body?: string;
  error?: string;
  /** Machine-readable failure reason for client-side handling */
  failureReason?: "timeout" | "response_too_large" | "fetch_failed" | "robots_disallowed" | "ssrf_blocked" | "js_rendered_source_not_supported" | "anti_bot_challenge" | "invalid_url" | "redirect_invalid" | "unknown";
};

function parseRobotsTxt(body: string, targetPath: string): boolean {
  const lines = body.split(/\r?\n/);
  let currentAgent = "*";
  const disallowed: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const agentMatch = line.match(/^User-agent:\s*(.+)/i);
    if (agentMatch) {
      currentAgent = agentMatch[1].trim().toLowerCase();
      continue;
    }

    if (currentAgent === "*" || currentAgent === "qingxuanagent-radar-mvp" || currentAgent === "qingxuanagent") {
      const disallowMatch = line.match(/^Disallow:\s*(.+)/i);
      if (disallowMatch) {
        const rule = disallowMatch[1].trim();
        if (rule === "/") return false; // entire site disallowed
        disallowed.push(rule);
      }
    }
  }

  return !disallowed.some((rule) => {
    if (!rule) return false;
    if (rule.endsWith("*")) {
      return targetPath.startsWith(rule.slice(0, -1));
    }
    return targetPath === rule || targetPath.startsWith(rule);
  });
}

/**
 * Fetch a single URL with SSRF protection.
 * - Validates initial URL (protocol, hostname, DNS)
 * - Manually follows redirects, re-validating each target
 * - Returns a CrawlResult — never throws.
 */
export async function crawlSingleUrl(rawUrl: string): Promise<CrawlResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { url: rawUrl, status: "invalid", error: "无法解析 URL", failureReason: "invalid_url" };
  }

  // ── Initial URL validation (unified SSRF guard) ──

  try {
    const isValid = await isValidTargetUrl(url);
    if (!isValid) {
      return { url: rawUrl, status: "blocked", error: `不安全的请求地址：${url.hostname}`, failureReason: "ssrf_blocked" };
    }
  } catch {
    return { url: rawUrl, status: "blocked", error: `URL 安全校验失败：${url.hostname}`, failureReason: "ssrf_blocked" };
  }

  // ── Robots.txt check ──

  try {
    const robotsUrl = `${url.protocol}//${url.hostname}/robots.txt`;
    const robotsRes = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });
    if (robotsRes.ok) {
      const robotsBody = await robotsRes.text();
      if (!parseRobotsTxt(robotsBody, url.pathname + url.search)) {
        return { url: rawUrl, status: "blocked", error: "robots.txt 不允许抓取该路径", failureReason: "robots_disallowed" };
      }
    }
  } catch {
    // If robots.txt fetch fails, proceed cautiously
  }

  // ── Fetch with manual redirect handling ──

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_IMPORT_FETCH_TIMEOUT_MS);

    let currentUrl = url.toString();
    let response = await fetch(currentUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });

    // Follow redirects manually, re-validating each target
    let redirectCount = 0;
    while (
      redirectCount < MAX_REDIRECTS &&
      (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308)
    ) {
      const location = response.headers.get("location");
      if (!location) break;

      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, currentUrl);
      } catch {
        clearTimeout(timer);
        return { url: rawUrl, status: "error", error: "重定向目标 URL 无效", failureReason: "redirect_invalid" };
      }

      currentUrl = redirectUrl.toString();

      // Re-validate redirect target
      const redirectValid = await isValidTargetUrl(redirectUrl);
      if (!redirectValid) {
        clearTimeout(timer);
        return { url: rawUrl, status: "blocked", error: `重定向到禁止地址已阻止：${redirectUrl.hostname}`, failureReason: "ssrf_blocked" };
      }

      redirectCount++;
      response = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
        redirect: "manual",
      });
    }

    clearTimeout(timer);

    const contentType = response.headers.get("content-type") || "";

    // Read up to SOURCE_IMPORT_MAX_BYTES
    const reader = response.body?.getReader();
    if (!reader) {
      return { url: rawUrl, status: "error", error: "无法读取响应体", failureReason: "fetch_failed" };
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > SOURCE_IMPORT_MAX_BYTES) {
        reader.cancel();
        return { url: rawUrl, status: "too_large", error: `响应超过 ${SOURCE_IMPORT_MAX_BYTES} 字节限制`, contentType, failureReason: "response_too_large" };
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const body = decoder.decode(Buffer.concat(chunks));

    // Phase 4-D.7: Detect anti-bot challenges and JS-rendered pages in the response body
    if (/cloudflare|cf-challenge|cf-browser-verification|Just a moment/i.test(body.slice(0, 2000)) &&
        /challenge|verification|security check/i.test(body.slice(0, 2000))) {
      return {
        url: rawUrl,
        status: "blocked",
        statusCode: response.status,
        contentType,
        error: "检测到反爬/安全验证页面（Cloudflare 等），当前不支持绕过",
        failureReason: "anti_bot_challenge",
      };
    }

    // Detect JS-only pages (no meaningful text content, mostly script tags)
    const textContent = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (textContent.length < 100 && body.length > 500) {
      return {
        url: rawUrl,
        status: "blocked",
        statusCode: response.status,
        contentType,
        error: "页面主要为 JavaScript 渲染内容，当前不支持 JS 渲染抓取",
        failureReason: "js_rendered_source_not_supported",
      };
    }

    return {
      url: rawUrl,
      status: "ok",
      statusCode: response.status,
      contentType,
      body,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort") || message.includes("timeout")) {
      return { url: rawUrl, status: "timeout", error: `请求超时 (${SOURCE_IMPORT_FETCH_TIMEOUT_MS / 1000}s)`, failureReason: "timeout" };
    }
    return { url: rawUrl, status: "error", error: message, failureReason: "fetch_failed" };
  }
}

/**
 * Crawl multiple URLs, respecting limits.
 */
export async function crawlUrls(rawUrls: string[]): Promise<{
  results: CrawlResult[];
  warnings: string[];
}> {
  const uniqueUrls = [...new Set(rawUrls.map((u) => u.trim()).filter(Boolean))];
  const warnings: string[] = [];

  if (uniqueUrls.length > MAX_URLS_PER_REQUEST) {
    warnings.push(`单次最多 ${MAX_URLS_PER_REQUEST} 个 URL，已截断`);
  }

  const urlsToFetch = uniqueUrls.slice(0, MAX_URLS_PER_REQUEST);

  // Fetch sequentially to be polite
  const results: CrawlResult[] = [];
  for (const url of urlsToFetch) {
    if (results.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
    }
    const result = await crawlSingleUrl(url);
    results.push(result);
  }

  return { results, warnings };
}
