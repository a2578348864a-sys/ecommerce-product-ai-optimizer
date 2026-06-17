import { NextRequest, NextResponse } from "next/server";
import { platformLabels } from "@/lib/types";
import type { LinkType, Platform } from "@/lib/types";

export const runtime = "nodejs";

const MAX_LINKS = 10;

function isRadarEnabled() {
  return process.env.NODE_ENV !== "production";
}

function radarNotFoundResponse() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host") || "";
  return host.startsWith("localhost:")
    || host.startsWith("127.0.0.1:")
    || host.startsWith("[::1]:");
}

function normalizeUrlCandidate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host === "0.0.0.0"
    || host.startsWith("127.")
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function detectPlatform(hostname: string): Platform | "unknown" {
  const host = hostname.toLowerCase();
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "amazon.com" || host.endsWith(".amazon.com") || host.endsWith(".amazon.co.uk") || host.endsWith(".amazon.de") || host.endsWith(".amazon.co.jp")) return "amazon";
  if (host === "etsy.com" || host.endsWith(".etsy.com")) return "etsy";
  if (host === "shopify.com" || host.endsWith(".shopify.com") || host.endsWith(".myshopify.com")) return "shopify";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "pinterest.com" || host.endsWith(".pinterest.com")) return "pinterest";
  if (host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube_shorts";
  if (host === "ebay.com" || host.endsWith(".ebay.com")) return "other";
  if (host === "alibaba.com" || host.endsWith(".alibaba.com")) return "other";
  return "unknown";
}

function detectLinkType(url: URL, platform: Platform | "unknown"): LinkType {
  const value = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  if (platform === "instagram" || platform === "pinterest") return "note";
  if (/item|product|detail|goods|listing|dp\//.test(value)) return "product";
  if (/rank|top|best.seller|榜/.test(value)) return "ranking";
  if (/search|keyword|q=|wd=|s=|k=/.test(value)) return "search";
  return "unknown";
}

function cleanSupportedUrl(rawUrl: string) {
  const normalized = normalizeUrlCandidate(rawUrl);
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, originalUrl: rawUrl, error: "该链接协议不支持，已阻止打开。" };
    }
    if (isPrivateHost(url.hostname)) {
      return { ok: false, originalUrl: rawUrl, error: "该链接指向本地或内网地址，已阻止打开。" };
    }

    const platform = detectPlatform(url.hostname);
    if (platform === "unknown") {
      return { ok: false, originalUrl: rawUrl, error: "该链接不在安全白名单内，已阻止打开。" };
    }

    const trackingKeys = ["utm", "spm", "share", "invite", "tracking", "track", "from", "refer"];
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (trackingKeys.some((prefix) => lower.startsWith(prefix) || lower.includes(prefix))) {
        url.searchParams.delete(key);
      }
    }

    return {
      ok: true,
      originalUrl: rawUrl,
      cleanedUrl: url.toString(),
      platform,
      platformLabel: platformLabels[platform],
      linkType: detectLinkType(url, platform),
      message: "链接已通过安全白名单和基础清洗。V1 不自动抓取页面，请补充可见信息或上传截图。",
    };
  } catch {
    return { ok: false, originalUrl: rawUrl, error: "链接格式无法识别，请检查后重试。" };
  }
}

export async function POST(request: NextRequest) {
  if (!isRadarEnabled()) {
    return radarNotFoundResponse();
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "链接识别接口只允许在 localhost 使用。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
  }

  const links = Array.isArray((body as { links?: unknown })?.links)
    ? (body as { links: unknown[] }).links.filter((item): item is string => typeof item === "string").slice(0, MAX_LINKS)
    : [];

  return NextResponse.json({
    results: links.map(cleanSupportedUrl),
    maxLinks: MAX_LINKS,
  });
}
