import "server-only";

import dns from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { validateAiImageBytes } from "@/lib/server/aiImageDraftStorage";

export const AI_IMAGE_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const AI_IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;
export const AI_IMAGE_MAX_REDIRECTS = 1;

export class ImageUrlFetchError extends Error {
  constructor(
    public readonly code:
      | "image_provider_untrusted_result_url"
      | "image_provider_result_dns_rejected"
      | "image_provider_result_redirect_rejected"
      | "image_provider_result_download_failed"
      | "image_provider_result_timeout"
      | "image_provider_result_too_large"
      | "image_provider_result_invalid_mime"
      | "image_provider_result_invalid_image",
    message: string,
  ) {
    super(message);
  }
}

export type ImageUrlFetchResult = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
};

export type ValidatedImageAddress = {
  address: string;
  family: 4 | 6;
};

export type PinnedImageRequest = (
  url: URL,
  address: ValidatedImageAddress,
  signal: AbortSignal,
) => Promise<Response>;

export type ImageMimeAuditEvent = {
  event: "image_mime_normalized";
  headerMime: string;
  actualMime: ImageUrlFetchResult["mimeType"];
  fileSize: number;
  requestId: string;
  elapsedMs: number;
};

export type ImageDownloadAuditOptions = {
  requestId?: string;
  logger?: (event: ImageMimeAuditEvent) => void;
};

/* ── hostname whitelist ─────────────────────────────────── */

export function getImageResultHostWhitelist(): Set<string> {
  const raw = (process.env.OPENAI_IMAGE_RESULT_HOSTS || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/* ── URL validation ─────────────────────────────────────── */

export function validateImageResultUrl(raw: string, whitelist: Set<string>): URL {
  if (!raw || typeof raw !== "string") {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址格式无效。",
    );
  }

  // reject backslash-based URL confusion
  if (raw.includes("\\")) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址包含非法字符。",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址无法解析。",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果必须使用 HTTPS 协议。",
    );
  }

  if (parsed.username || parsed.password) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址不得包含凭据。",
    );
  }

  if (parsed.port && parsed.port !== "443") {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址端口无效。",
    );
  }

  if (parsed.hash) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址不得包含 fragment。",
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // reject unicode confusable hostnames (punycode-encoded)
  if (hostname.startsWith("xn--")) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果域名不在允许列表中。",
    );
  }

  // reject trailing dot in hostname (dns root confusion)
  if (hostname.endsWith(".")) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果域名格式无效。",
    );
  }

  // reject IP address literals
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址必须使用域名，不允许 IP 地址。",
    );
  }

  // reject IPv6 literals (bracketed)
  if (hostname.startsWith("[")) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果地址必须使用域名，不允许 IP 地址。",
    );
  }

  if (whitelist.size === 0) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果域名白名单尚未配置。",
    );
  }

  if (!whitelist.has(hostname)) {
    throw new ImageUrlFetchError(
      "image_provider_untrusted_result_url",
      "图片结果域名不在允许列表中。",
    );
  }

  return parsed;
}

/* ── DNS / IP safety ───────────────────────────────────── */

function isPublicIPv4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return false;
  // 10.0.0.0/8 — private
  if (a === 10) return false;
  // 127.0.0.0/8 — loopback
  if (a === 127) return false;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return false;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return false;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return false;
  // 240.0.0.0/4 — reserved (includes broadcast)
  if (a >= 240) return false;
  // 100.64.0.0/10 — CGNAT (RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

function isPublicIPv6(addr: string): boolean {
  const normalized = addr.toLowerCase();
  // :: (unspecified)
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return false;
  // ::1 (loopback)
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return false;
  // ff00::/8 — multicast
  if (/^ff/i.test(normalized)) return false;
  // fe80::/10 — link-local
  if (/^fe[89ab]/i.test(normalized)) return false;
  // fc00::/7 — unique local (ULA)
  if (/^f[c-d]/i.test(normalized)) return false;
  // IPv4-mapped IPv6 can otherwise hide a private or loopback IPv4 address.
  if (normalized.startsWith("::ffff:")) return false;
  return true;
}

export async function validateImageResultDns(hostname: string): Promise<ValidatedImageAddress[]> {
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ImageUrlFetchError(
      "image_provider_result_dns_rejected",
      "图片结果域名 DNS 解析失败。",
    );
  }

  const addresses = [...new Map(
    resolved.map((entry) => [`${entry.family}:${entry.address}`, entry]),
  ).values()];
  if (addresses.length === 0) {
    throw new ImageUrlFetchError(
      "image_provider_result_dns_rejected",
      "图片结果域名 DNS 解析失败。",
    );
  }

  for (const entry of addresses) {
    const family = entry.family === 6 ? 6 : entry.family === 4 ? 4 : 0;
    const actualFamily = isIP(entry.address);
    const isPublic = family === 4
      ? actualFamily === 4 && isPublicIPv4(entry.address)
      : family === 6 && actualFamily === 6 && isPublicIPv6(entry.address);
    if (!isPublic) {
      throw new ImageUrlFetchError(
        "image_provider_result_dns_rejected",
        "图片结果域名解析到非公网地址。",
      );
    }
  }

  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));
}

export function createPinnedHttpsRequestOptions(
  url: URL,
  address: ValidatedImageAddress,
): RequestOptions {
  return {
    protocol: "https:",
    hostname: url.hostname,
    port: 443,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    servername: url.hostname,
    rejectUnauthorized: true,
    family: address.family,
    headers: { Host: url.hostname },
    lookup: (_hostname, options, callback) => {
      if (typeof options === "object" && options.all) {
        (callback as (error: NodeJS.ErrnoException | null, addresses: ValidatedImageAddress[]) => void)(null, [address]);
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

export async function requestPinnedHttpsResponse(
  url: URL,
  address: ValidatedImageAddress,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let responseStream: import("node:http").IncomingMessage | null = null;
    const abortError = () => new DOMException("The operation was aborted.", "AbortError");
    const request = httpsRequest(createPinnedHttpsRequestOptions(url, address), (incoming) => {
      responseStream = incoming;
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, String(value));
        }
      }
      const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(body, {
        status: incoming.statusCode || 502,
        statusText: incoming.statusMessage,
        headers,
      }));
    });

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

/* ── supported MIME ───────────────────────────────────── */

const AUXILIARY_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/octet-stream",
  "binary/octet-stream",
]);

function normalizeHeaderMime(header: string | null): string {
  const mime = (header || "").split(";")[0]?.trim().toLowerCase() || "missing";
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function isAllowedAuxiliaryContentType(headerMime: string): boolean {
  return headerMime === "missing" || AUXILIARY_IMAGE_MIME_TYPES.has(headerMime);
}

/* ── download ──────────────────────────────────────────── */

async function requestFromValidatedAddresses(
  url: URL,
  addresses: ValidatedImageAddress[],
  signal: AbortSignal,
  requestFn: PinnedImageRequest,
): Promise<Response> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await requestFn(url, address, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("PINNED_IMAGE_CONNECTION_FAILED");
}

export async function downloadImageFromUrl(
  rawUrl: string,
  whitelist: Set<string>,
  requestFn: PinnedImageRequest = requestPinnedHttpsResponse,
  audit: ImageDownloadAuditOptions = {},
): Promise<ImageUrlFetchResult> {
  const startedAt = Date.now();
  let currentUrl = rawUrl;
  let redirects = 0;

  for (;;) {
    const parsed = validateImageResultUrl(currentUrl, whitelist);
    const addresses = await validateImageResultDns(parsed.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_IMAGE_DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
      response = await requestFromValidatedAddresses(parsed, addresses, controller.signal, requestFn);
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new ImageUrlFetchError(
          "image_provider_result_timeout",
          "图片下载超时。",
        );
      }
      throw new ImageUrlFetchError(
        "image_provider_result_download_failed",
        "图片下载失败。",
      );
    }
    clearTimeout(timer);

    // Handle redirect (3xx)
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= AI_IMAGE_MAX_REDIRECTS) {
        throw new ImageUrlFetchError(
          "image_provider_result_redirect_rejected",
          "图片地址重定向次数过多。",
        );
      }
      const location = response.headers.get("location");
      if (!location || !location.trim()) {
        throw new ImageUrlFetchError(
          "image_provider_result_download_failed",
          "图片地址返回了无效的重定向。",
        );
      }
      // Resolve relative URL against current
      try {
        currentUrl = new URL(location.trim(), currentUrl).toString();
      } catch {
        throw new ImageUrlFetchError(
          "image_provider_result_download_failed",
          "图片地址返回了无效的重定向目标。",
        );
      }
      redirects += 1;
      // Loop back: re-validate protocol, hostname whitelist, DNS/IP for the new target
      // Also close the body to release resources
      await response.body?.cancel().catch(() => undefined);
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageUrlFetchError(
        "image_provider_result_download_failed",
        "图片下载失败。",
      );
    }

    const headerMime = normalizeHeaderMime(response.headers.get("content-type"));
    if (!isAllowedAuxiliaryContentType(headerMime)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageUrlFetchError(
        "image_provider_result_invalid_mime",
        "下载内容不是受支持的图片格式。",
      );
    }

    // Check Content-Length early
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const size = Number(contentLength);
      if (Number.isFinite(size) && size > AI_IMAGE_DOWNLOAD_MAX_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImageUrlFetchError(
          "image_provider_result_too_large",
          "图片文件过大。",
        );
      }
    }

    // Stream read with size cap
    const reader = response.body?.getReader();
    if (!reader) {
      throw new ImageUrlFetchError(
        "image_provider_result_download_failed",
        "图片下载失败。",
      );
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.length;
        if (totalSize > AI_IMAGE_DOWNLOAD_MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new ImageUrlFetchError(
            "image_provider_result_too_large",
            "图片文件过大。",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof ImageUrlFetchError) throw error;
      throw new ImageUrlFetchError(
        "image_provider_result_download_failed",
        "图片下载失败。",
      );
    } finally {
      // Ensure reader is released
      try { await reader.cancel().catch(() => undefined); } catch { /* ignore */ }
    }

    const buffer = Buffer.concat(chunks);

    // Re-validate with existing storage validator (magic numbers, dimensions, pixels)
    let validated;
    try {
      validated = await validateAiImageBytes(buffer);
    } catch (storageError) {
      const msg = storageError instanceof Error ? storageError.message : "";
      if (msg.includes("TOO_LARGE")) {
        throw new ImageUrlFetchError("image_provider_result_too_large", "图片文件过大。");
      }
      throw new ImageUrlFetchError(
        "image_provider_result_invalid_image",
        "下载的文件不是有效图片。",
      );
    }

    if (headerMime !== validated.mimeType) {
      const event: ImageMimeAuditEvent = {
        event: "image_mime_normalized",
        headerMime,
        actualMime: validated.mimeType,
        fileSize: validated.bytes.length,
        requestId: audit.requestId || "unavailable",
        elapsedMs: Math.max(0, Date.now() - startedAt),
      };
      (audit.logger || console.info)(event);
    }

    return {
      bytes: validated.bytes,
      mimeType: validated.mimeType,
      sha256: validated.sha256,
    };
  }
}
