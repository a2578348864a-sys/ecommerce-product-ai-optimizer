/**
 * Phase 2-A.0 — controlled public URL crawler.
 *
 * User-submitted public URLs only. No autonomous search, login simulation,
 * cookies, captcha bypass, proxy pool, or JavaScript rendering.
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  validateTargetUrlForRequest,
  type ValidatedTarget,
  type ValidatedTargetAddress,
} from "@/lib/server/ssrfGuard";

const USER_AGENT = "QingxuanAgent-Radar-MVP/0.2";

export const SOURCE_IMPORT_FETCH_TIMEOUT_MS = 12_000;
export const SOURCE_IMPORT_BATCH_TIMEOUT_MS = 50_000;
export const SOURCE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const SOURCE_IMPORT_ROBOTS_MAX_BYTES = 256 * 1024;
export const SOURCE_IMPORT_MAX_REDIRECTS = 3;
export const SOURCE_IMPORT_MAX_URLS = 5;
export const SOURCE_IMPORT_INTER_REQUEST_DELAY_MS = 500;

export type CrawlFailureReason =
  | "timeout"
  | "batch_timeout"
  | "response_too_large"
  | "fetch_failed"
  | "http_error"
  | "unsupported_content_type"
  | "unsupported_content_encoding"
  | "robots_disallowed"
  | "robots_unavailable"
  | "ssrf_blocked"
  | "js_rendered_source_not_supported"
  | "anti_bot_challenge"
  | "invalid_url"
  | "redirect_invalid"
  | "unknown";

export type CrawlProvenance = {
  submittedUrl: string;
  finalUrl: string;
  redirectCount: number;
  robots: "allowed" | "not_present";
  transportSecurity: "https" | "http";
  httpStatus: number;
  contentType: string;
  capturedAt: string;
};

export type CrawlResult = {
  url: string;
  status: "ok" | "blocked" | "timeout" | "error" | "too_large" | "invalid";
  statusCode?: number;
  contentType?: string;
  body?: string;
  error?: string;
  failureReason?: CrawlFailureReason;
  provenance?: CrawlProvenance;
};

export type PinnedRadarRequest = (
  url: URL,
  address: ValidatedTargetAddress,
  signal: AbortSignal,
) => Promise<Response>;

export type RadarCrawlerOptions = {
  request?: PinnedRadarRequest;
  timeoutMs?: number;
  batchTimeoutMs?: number;
  perUrlTimeoutMs?: number;
  interRequestDelayMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

class RadarRequestError extends Error {
  constructor(
    readonly reason: CrawlFailureReason,
    message: string,
  ) {
    super(message);
  }
}

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
      const disallowMatch = line.match(/^Disallow:\s*(.*)/i);
      if (disallowMatch) {
        const rule = disallowMatch[1].trim();
        if (rule === "/") return false;
        if (rule) disallowed.push(rule);
      }
    }
  }

  return !disallowed.some((rule) => (
    rule.endsWith("*")
      ? targetPath.startsWith(rule.slice(0, -1))
      : targetPath === rule || targetPath.startsWith(rule)
  ));
}

export function createPinnedRadarRequestOptions(url: URL, address: ValidatedTargetAddress): RequestOptions {
  const isHttps = url.protocol === "https:";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  return {
    protocol: url.protocol,
    hostname,
    port,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    ...(isHttps ? {
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
      rejectUnauthorized: true,
    } : {}),
    family: address.family,
    headers: {
      Host: url.host,
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,application/atom+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
      "Accept-Encoding": "identity",
      Connection: "close",
    },
    lookup: (_hostname, options, callback) => {
      if (typeof options === "object" && options.all) {
        (callback as (error: NodeJS.ErrnoException | null, addresses: ValidatedTargetAddress[]) => void)(null, [address]);
        return;
      }
      (callback as (error: NodeJS.ErrnoException | null, selectedAddress: string, family: number) => void)(
        null,
        address.address,
        address.family,
      );
    },
  };
}

function responseFromIncoming(incoming: IncomingMessage): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  return new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
    status: incoming.statusCode || 502,
    statusText: incoming.statusMessage,
    headers,
  });
}

export async function requestPinnedRadarResponse(
  url: URL,
  address: ValidatedTargetAddress,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let responseStream: IncomingMessage | null = null;
    const requestFactory = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestFactory(createPinnedRadarRequestOptions(url, address), (incoming) => {
      responseStream = incoming;
      resolve(responseFromIncoming(incoming));
    });

    const abortError = () => new DOMException("The operation was aborted.", "AbortError");
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      const error = abortError();
      responseStream?.destroy(error);
      request.destroy(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.once("error", (error) => {
      cleanup();
      reject(error);
    });
    request.once("close", () => {
      if (!responseStream || responseStream.complete) cleanup();
    });
    if (signal.aborted) onAbort();
    else request.end();
  });
}

async function requestFromAddresses(
  target: ValidatedTarget,
  signal: AbortSignal,
  request: PinnedRadarRequest,
): Promise<Response> {
  let lastError: unknown;
  for (const address of target.addresses) {
    try {
      return await request(target.url, address, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("PINNED_RADAR_CONNECTION_FAILED");
}

function headerMime(response: Response): string {
  return (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isSupportedTextMime(mime: string): boolean {
  return mime.startsWith("text/") || new Set([
    "application/json",
    "application/xml",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",
  ]).has(mime);
}

async function readTextBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RadarRequestError("response_too_large", `响应超过 ${maxBytes} 字节限制`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new RadarRequestError("fetch_failed", "无法读取响应体");

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > maxBytes) {
        throw new RadarRequestError("response_too_large", `响应超过 ${maxBytes} 字节限制`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

async function validateTarget(url: URL, signal: AbortSignal): Promise<ValidatedTarget> {
  if (signal.aborted) throw new RadarRequestError("timeout", "请求超时");
  return new Promise<ValidatedTarget>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new RadarRequestError("timeout", "请求超时"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void validateTargetUrlForRequest(url).then((target) => {
      signal.removeEventListener("abort", onAbort);
      if (!target) reject(new RadarRequestError("ssrf_blocked", "URL 安全校验失败"));
      else resolve(target);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

async function checkRobots(
  target: ValidatedTarget,
  signal: AbortSignal,
  request: PinnedRadarRequest,
): Promise<{ allowed: boolean; status: CrawlProvenance["robots"] }> {
  const robotsUrl = new URL("/robots.txt", target.url.origin);
  const robotsTarget: ValidatedTarget = { url: robotsUrl, addresses: target.addresses };
  try {
    const response = await requestFromAddresses(robotsTarget, signal, request);
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      return { allowed: true, status: "not_present" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RadarRequestError("robots_unavailable", "robots.txt 返回异常状态");
    }
    const mime = headerMime(response);
    const encoding = (response.headers.get("content-encoding") || "identity").trim().toLowerCase();
    if (encoding && encoding !== "identity") {
      await response.body?.cancel().catch(() => undefined);
      throw new RadarRequestError("robots_unavailable", "robots.txt 压缩格式不受支持");
    }
    if (!mime || !mime.startsWith("text/")) {
      await response.body?.cancel().catch(() => undefined);
      throw new RadarRequestError("robots_unavailable", "robots.txt 内容类型不受支持");
    }
    const body = await readTextBody(response, SOURCE_IMPORT_ROBOTS_MAX_BYTES);
    return {
      allowed: parseRobotsTxt(body, target.url.pathname + target.url.search),
      status: "allowed",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof RadarRequestError && error.reason === "robots_unavailable") throw error;
    throw new RadarRequestError("robots_unavailable", "无法可靠读取 robots.txt");
  }
}

function errorResult(rawUrl: string, error: unknown, statusCode?: number, contentType?: string): CrawlResult {
  const reason = error instanceof RadarRequestError ? error.reason : "fetch_failed";
  if (reason === "timeout" || reason === "batch_timeout") {
    return { url: rawUrl, status: "timeout", error: "请求超时", failureReason: reason };
  }
  if (reason === "ssrf_blocked" || reason === "robots_disallowed" || reason === "robots_unavailable") {
    return { url: rawUrl, status: "blocked", error: "公开 URL 安全检查未通过", failureReason: reason };
  }
  if (reason === "response_too_large") {
    return { url: rawUrl, status: "too_large", error: "响应内容过大", contentType, failureReason: reason };
  }
  if (reason === "unsupported_content_type" || reason === "unsupported_content_encoding" || reason === "invalid_url") {
    return { url: rawUrl, status: "invalid", error: "响应内容不受支持", contentType, failureReason: reason };
  }
  return {
    url: rawUrl,
    status: "error",
    ...(statusCode ? { statusCode } : {}),
    ...(contentType ? { contentType } : {}),
    error: error instanceof Error ? error.message : "抓取失败",
    failureReason: reason,
  };
}

export async function crawlSingleUrl(
  rawUrl: string,
  options: RadarCrawlerOptions = {},
): Promise<CrawlResult> {
  if (!rawUrl || rawUrl.includes("\\")) {
    return errorResult(rawUrl, new RadarRequestError("invalid_url", "URL 格式无效"));
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return errorResult(rawUrl, new RadarRequestError("invalid_url", "无法解析 URL"));
  }

  const request = options.request || requestPinnedRadarResponse;
  const timeoutMs = Math.max(1, options.timeoutMs ?? SOURCE_IMPORT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let statusCode: number | undefined;
  let contentType = "";

  try {
    let target = await validateTarget(parsed, controller.signal);
    if (controller.signal.aborted) throw new RadarRequestError("timeout", "请求超时");

    let robotsResult = await checkRobots(target, controller.signal, request);
    if (!robotsResult.allowed) throw new RadarRequestError("robots_disallowed", "robots.txt 不允许抓取该路径");

    let redirects = 0;
    let transportSecurity: CrawlProvenance["transportSecurity"] = parsed.protocol === "http:" ? "http" : "https";
    for (;;) {
      if (controller.signal.aborted) throw new RadarRequestError("timeout", "请求超时");
      let response: Response;
      try {
        response = await requestFromAddresses(target, controller.signal, request);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new RadarRequestError("timeout", "请求超时");
        }
        throw new RadarRequestError("fetch_failed", "公开 URL 请求失败");
      }

      statusCode = response.status;
      contentType = headerMime(response);

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        if (redirects >= SOURCE_IMPORT_MAX_REDIRECTS) {
          throw new RadarRequestError("redirect_invalid", "重定向次数过多");
        }
        const location = response.headers.get("location");
        if (!location) throw new RadarRequestError("redirect_invalid", "重定向目标缺失");
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, target.url);
        } catch {
          throw new RadarRequestError("redirect_invalid", "重定向目标无效");
        }
        if (redirectUrl.protocol === "http:") transportSecurity = "http";
        target = await validateTarget(redirectUrl, controller.signal);
        robotsResult = await checkRobots(target, controller.signal, request);
        if (!robotsResult.allowed) {
          throw new RadarRequestError("robots_disallowed", "robots.txt 不允许抓取重定向后的路径");
        }
        redirects += 1;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RadarRequestError("http_error", `公开 URL 返回 HTTP ${response.status}`);
      }

      const encoding = (response.headers.get("content-encoding") || "identity").trim().toLowerCase();
      if (encoding && encoding !== "identity") {
        await response.body?.cancel().catch(() => undefined);
        throw new RadarRequestError("unsupported_content_encoding", "响应压缩格式不受支持");
      }
      if (!contentType || !isSupportedTextMime(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new RadarRequestError("unsupported_content_type", "响应不是受支持的文本内容");
      }

      const body = await readTextBody(response, SOURCE_IMPORT_MAX_BYTES);
      const sample = body.slice(0, 2000);
      if (/cloudflare|cf-challenge|cf-browser-verification|Just a moment/i.test(sample)
          && /challenge|verification|security check/i.test(sample)) {
        return {
          url: rawUrl,
          status: "blocked",
          statusCode,
          contentType,
          error: "检测到反爬/安全验证页面，当前不支持绕过",
          failureReason: "anti_bot_challenge",
        };
      }

      const textContent = body
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (textContent.length < 100 && body.length > 500) {
        return {
          url: rawUrl,
          status: "blocked",
          statusCode,
          contentType,
          error: "页面主要为 JavaScript 渲染内容，当前不支持 JS 渲染抓取",
          failureReason: "js_rendered_source_not_supported",
        };
      }

      return {
        url: rawUrl,
        status: "ok",
        statusCode,
        contentType,
        body,
        provenance: {
          submittedUrl: parsed.toString(),
          finalUrl: target.url.toString(),
          redirectCount: redirects,
          robots: robotsResult.status,
          transportSecurity,
          httpStatus: statusCode,
          contentType,
          capturedAt: new Date().toISOString(),
        },
      };
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return errorResult(rawUrl, new RadarRequestError("timeout", "请求超时"));
    }
    return errorResult(rawUrl, error, statusCode, contentType);
  } finally {
    clearTimeout(timer);
  }
}

export async function crawlUrls(
  rawUrls: string[],
  options: RadarCrawlerOptions = {},
): Promise<{ results: CrawlResult[]; warnings: string[] }> {
  const uniqueUrls = [...new Set(rawUrls.map((item) => item.trim()).filter(Boolean))];
  const warnings: string[] = [];
  if (uniqueUrls.length > SOURCE_IMPORT_MAX_URLS) {
    warnings.push(`单次最多 ${SOURCE_IMPORT_MAX_URLS} 个 URL，已截断`);
  }

  const urls = uniqueUrls.slice(0, SOURCE_IMPORT_MAX_URLS);
  const now = options.now || Date.now;
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const batchTimeoutMs = Math.max(1, options.batchTimeoutMs ?? SOURCE_IMPORT_BATCH_TIMEOUT_MS);
  const perUrlTimeoutMs = Math.max(1, options.perUrlTimeoutMs ?? SOURCE_IMPORT_FETCH_TIMEOUT_MS);
  const delayMs = Math.max(0, options.interRequestDelayMs ?? SOURCE_IMPORT_INTER_REQUEST_DELAY_MS);
  const startedAt = now();
  const results: CrawlResult[] = [];

  for (const url of urls) {
    let remaining = batchTimeoutMs - Math.max(0, now() - startedAt);
    if (remaining <= 0) {
      results.push(errorResult(url, new RadarRequestError("batch_timeout", "批次抓取时间预算已用尽")));
      continue;
    }
    if (results.length > 0 && delayMs > 0) {
      await sleep(Math.min(delayMs, remaining));
      remaining = batchTimeoutMs - Math.max(0, now() - startedAt);
      if (remaining <= 0) {
        results.push(errorResult(url, new RadarRequestError("batch_timeout", "批次抓取时间预算已用尽")));
        continue;
      }
    }
    results.push(await crawlSingleUrl(url, {
      request: options.request,
      timeoutMs: Math.min(perUrlTimeoutMs, remaining),
    }));
  }

  return { results, warnings };
}
