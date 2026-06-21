/**
 * Phase 1E — Radar Crawler MVP
 * 低频公开源抓取，SSRF 防护，robots.txt 检查。
 * 不绕验证码、不模拟登录、不使用 Cookie/代理池。
 */

const USER_AGENT = "QingxuanAgent-Radar-MVP/0.1";
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_SIZE = 1_048_576; // 1MB
const MAX_URLS_PER_REQUEST = 5;

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/i,
  /^::1$/i,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
];

export type CrawlResult = {
  url: string;
  status: "ok" | "blocked" | "timeout" | "error" | "too_large" | "invalid";
  statusCode?: number;
  contentType?: string;
  body?: string;
  error?: string;
};

function isPrivateHost(hostname: string): boolean {
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

function parseRobotsTxt(body: string, targetPath: string): boolean {
  const lines = body.split(/\r?\n/);
  let currentAgent = "*";
  let disallowed: string[] = [];

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
    // Simple prefix/path matching
    if (rule.endsWith("*")) {
      return targetPath.startsWith(rule.slice(0, -1));
    }
    return targetPath === rule || targetPath.startsWith(rule);
  });
}

/**
 * Fetch a single URL with safety checks.
 * Returns a CrawlResult — never throws.
 */
export async function crawlSingleUrl(rawUrl: string): Promise<CrawlResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { url: rawUrl, status: "invalid", error: "无法解析 URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { url: rawUrl, status: "blocked", error: `不支持的协议：${url.protocol}` };
  }

  if (isPrivateHost(url.hostname)) {
    return { url: rawUrl, status: "blocked", error: `内网地址已阻止：${url.hostname}` };
  }

  // Check robots.txt
  try {
    const robotsUrl = `${url.protocol}//${url.hostname}/robots.txt`;
    const robotsRes = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
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

  // Fetch the actual page
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    clearTimeout(timer);

    const contentType = res.headers.get("content-type") || "";

    // Read up to MAX_RESPONSE_SIZE
    const reader = res.body?.getReader();
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
      statusCode: res.status,
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
