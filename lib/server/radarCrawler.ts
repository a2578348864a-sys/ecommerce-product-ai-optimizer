/**
 * Phase 1E — Radar Crawler MVP
 * 低频公开源抓取，SSRF 防护，robots.txt 检查。
 * 不绕验证码、不模拟登录、不使用 Cookie/代理池。
 *
 * SSRF 防护覆盖：
 * - 协议限制（仅 http/https）
 * - hostname 黑名单
 * - HTTP 重定向目标重新校验
 * - DNS 解析后内网 IP 检测
 */

import { isValidTargetUrl } from "@/lib/server/ssrfGuard";

const USER_AGENT = "QingxuanAgent-Radar-MVP/0.1";
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_SIZE = 1_048_576; // 1MB
const MAX_URLS_PER_REQUEST = 5;

export type CrawlResult = {
  url: string;
  status: "ok" | "blocked" | "timeout" | "error" | "too_large" | "invalid";
  statusCode?: number;
  contentType?: string;
  body?: string;
  error?: string;
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
    return { url: rawUrl, status: "invalid", error: "无法解析 URL" };
  }

  // ── Initial URL validation (unified SSRF guard) ──

  try {
    const isValid = await isValidTargetUrl(url);
    if (!isValid) {
      return { url: rawUrl, status: "blocked", error: `不安全的请求地址：${url.hostname}` };
    }
  } catch {
    return { url: rawUrl, status: "blocked", error: `URL 安全校验失败：${url.hostname}` };
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
        return { url: rawUrl, status: "blocked", error: "robots.txt 不允许抓取该路径" };
      }
    }
  } catch {
    // If robots.txt fetch fails, proceed cautiously
  }

  // ── Fetch with manual redirect handling ──

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
        return { url: rawUrl, status: "error", error: "重定向目标 URL 无效" };
      }

      currentUrl = redirectUrl.toString();

      // Re-validate redirect target
      const redirectValid = await isValidTargetUrl(redirectUrl);
      if (!redirectValid) {
        clearTimeout(timer);
        return { url: rawUrl, status: "blocked", error: `重定向到禁止地址已阻止：${redirectUrl.hostname}` };
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

    // Read up to MAX_RESPONSE_SIZE
    const reader = response.body?.getReader();
    if (!reader) {
      return { url: rawUrl, status: "error", error: "无法读取响应体" };
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > MAX_RESPONSE_SIZE) {
        reader.cancel();
        return { url: rawUrl, status: "too_large", error: `响应超过 ${MAX_RESPONSE_SIZE} 字节限制`, contentType };
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const body = decoder.decode(Buffer.concat(chunks));

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
      return { url: rawUrl, status: "timeout", error: `请求超时 (${TIMEOUT_MS / 1000}s)` };
    }
    return { url: rawUrl, status: "error", error: message };
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
    // Small delay between requests
    if (results.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const result = await crawlSingleUrl(url);
    results.push(result);
  }

  return { results, warnings };
}
