/**
 * V3.1 Phase 2 — IP Abuse Backstop（§30-34）
 *
 * IP Guard 不是 Product Quota（§30）：只限制明显异常（Guest 创建 flood / Provider burst），
 * 阈值宽松并留 NAT headroom（§33），禁止误杀正常 Guest。
 *
 * IP 标识：HMAC( normalized client IP, server secret )（§31），不长期存 raw IP。
 * 可信代理边界（§32）：仅当远端地址 ∈ QX_TRUSTED_PROXY_IPS（缺省回环）时信任 X-Forwarded-For 最后一项；
 * 否则完全忽略 XFF（客户端伪造 XFF 无法控制 bucket）。
 *
 * 阈值（ENV CONFIGURABLE）：QX_IP_GUEST_START_LIMIT_15M（缺省 120）、
 * QX_IP_TEXT_PROVIDER_LIMIT_15M（缺省 120）、QX_IP_IMAGE_PROVIDER_LIMIT_15M（缺省 60）。
 */
import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

const BUCKET_WINDOW_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 10000;
const buckets = new Map<string, number>();

/** 仅供测试：清空内存 bucket（避免跨用例计数残留）。 */
export function resetIpBackstopForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_IP_BACKSTOP_RESET");
  buckets.clear();
}

export type IpBackstopKind = "guest_start" | "text" | "image";

function getSecret(): string {
  const raw = (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
  if (raw) return raw;
  const boot = (globalThis as { __qxIpBackstopSecret?: string }).__qxIpBackstopSecret;
  if (boot) return boot;
  const fresh = randomBytes(24).toString("hex");
  (globalThis as { __qxIpBackstopSecret?: string }).__qxIpBackstopSecret = fresh;
  return fresh;
}

/** IPv4 / IPv6 / IPv4-mapped IPv6 归一化（§31）。 */
export function normalizeClientIp(ip: string): string {
  let value = (ip || "").trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  return value.toLowerCase();
}

function readTrustedProxyIps(): string[] {
  const raw = (process.env.QX_TRUSTED_PROXY_IPS || "127.0.0.1,::1").split(",")
    .map((v) => normalizeClientIp(v)).filter(Boolean);
  return raw.length ? raw : ["127.0.0.1", "::1"];
}

function getRemoteAddress(request: NextRequest): string {
  // NextRequest 平台远端地址（next start 下为 socket peer；测试可注入 x-remote-addr 头）。
  const viaHeader = (request.headers?.get("x-remote-addr") || "").trim();
  if (viaHeader) return viaHeader;
  const ip = (request as { ip?: string }).ip;
  return ip || "";
}

/**
 * 解析客户端 IP（可信代理边界，§32）。
 * 远端可信 → 信任 X-Forwarded-For 最后一项（nginx $proxy_add_x_forwarded_for 追加真实客户端 IP）；
 * 远端不可信/未知 → 忽略 XFF，直接使用远端地址（伪造 XFF 无法控制 bucket）。
 */
export function resolveClientIp(request: NextRequest): string {
  const remote = normalizeClientIp(getRemoteAddress(request));
  const trusted = readTrustedProxyIps();
  const remoteTrusted = !remote || trusted.includes(remote);
  const xff = (request.headers?.get("x-forwarded-for") || "")
    .split(",").map((v) => normalizeClientIp(v)).filter(Boolean);
  if (remoteTrusted && xff.length > 0) {
    // 最后一项由可信代理追加 = 真实客户端；客户端注入的前缀项被忽略（§32 spoof 测试）。
    return xff[xff.length - 1];
  }
  return remote || (xff.length ? xff[0] : "");
}

export function getIpBackstopLimit(kind: IpBackstopKind): number {
  const envName = kind === "guest_start"
    ? "QX_IP_GUEST_START_LIMIT_15M"
    : kind === "text" ? "QX_IP_TEXT_PROVIDER_LIMIT_15M" : "QX_IP_IMAGE_PROVIDER_LIMIT_15M";
  const raw = (process.env[envName] || "").trim();
  const fallback = kind === "image" ? 60 : 120;
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export interface IpBackstopResult {
  limited: boolean;
  bucketKey: string;
  count: number;
}

/**
 * 消耗一次 bucket 计数；超限返回 limited（不递增）。
 * 内存 LRU-ish：超上限时清空最旧一个条目（宽松防滥用，非精确统计）。
 */
export function consumeIpBackstop(request: NextRequest, kind: IpBackstopKind, count = 1): IpBackstopResult {
  const ip = normalizeClientIp(resolveClientIp(request));
  const windowIndex = Math.floor(Date.now() / BUCKET_WINDOW_MS);
  const bucketKey = createHmac("sha256", getSecret())
    .update(`${ip}:${kind}:${windowIndex}`)
    .digest("hex");
  const previous = buckets.get(bucketKey) || 0;
  const next = previous + count;
  if (next > getIpBackstopLimit(kind)) {
    return { limited: true, bucketKey, count: previous };
  }
  buckets.set(bucketKey, next);
  if (buckets.size > MAX_BUCKETS) {
    for (const key of buckets.keys()) { buckets.delete(key); break; }
  }
  return { limited: false, bucketKey, count: next };
}