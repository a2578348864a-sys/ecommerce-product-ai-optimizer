/**
 * SSRF Guard — URL/IP 安全校验模块
 *
 * 用于 radarCrawler 及未来任何需要抓取外部 URL 的模块。
 * 覆盖：协议限制、hostname 黑名单、DNS 解析后内网 IP 检测。
 *
 * 规则：
 * - 只允许 http/https
 * - 禁止 localhost / loopback / private / link-local IP
 * - DNS 解析后禁止落到内网地址
 */

import { promises as dns } from "dns";
import { isIP } from "node:net";

export type ValidatedTargetAddress = {
  address: string;
  family: 4 | 6;
};

export type TargetDnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export type ValidatedTarget = {
  url: URL;
  addresses: ValidatedTargetAddress[];
};

// ── IPv4 helpers ──

function isIPv4(ip: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip);
}

function ipv4ToOctets(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  return parts;
}

/**
 * 判断 IPv4 地址是否在私有/环回/链路本地范围内。
 */
export function isPrivateIPv4(ip: string): boolean {
  const octets = ipv4ToOctets(ip);
  if (!octets) return true; // malformed → block

  const [a, b, c] = octets;

  // 0.0.0.0/8 — current network (block 0.0.0.0 specifically)
  if (a === 0) return true;

  // 10.0.0.0/8 — private
  if (a === 10) return true;

  // 127.0.0.0/8 — loopback
  if (a === 127) return true;

  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;

  // Non-global special-use and documentation ranges.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;

  // 100.64.0.0/10 — carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  if (a >= 224) return true;

  return false;
}

// ── IPv6 helpers ──

/**
 * 判断 IPv6 地址是否在私有/环回/链路本地范围内。
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // ::1 — loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // :: — unspecified
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // ff00::/8 — multicast
  if (normalized.startsWith("ff")) return true;

  // fe80::/10 — link-local
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;

  // fc00::/7 — unique local (fc00:: to fdff:...)
  if (/^f[c-d]/.test(normalized)) return true;

  // fec0::/10 — deprecated site-local, never a global destination.
  if (/^fe[c-f]/.test(normalized)) return true;

  // IPv4-mapped IPv6 must not bypass IPv4 range checks.
  if (normalized.startsWith("::ffff:")) return true;

  return false;
}

// ── Hostname patterns ──

const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
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

/**
 * 通过 hostname 字符串模式判断是否为内网地址。
 */
export function isBlockedHostname(hostname: string): boolean {
  const cleaned = hostname.replace(/^\[|\]$/g, "");
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(cleaned));
}

// ── Protocol check ──

/**
 * 只允许 http 和 https 协议。
 */
export function isAllowedProtocol(protocol: string): boolean {
  const p = protocol.toLowerCase().replace(/:$/, "");
  return p === "http" || p === "https";
}

// ── DNS resolution ──

/**
 * 将 hostname 解析为 IP 地址。
 * 同时查询 IPv4（A 记录）和 IPv6（AAAA 记录），收集所有解析结果。
 * 只要任意一个解析结果是内网/loopback/link-local/保留地址，立即拒绝。
 * 全部公网且有至少一个解析结果时，返回第一个公网 IP。
 *
 * 保守策略：DNS rebinding 攻击中，攻击者域名可能同时返回公网和内网 IP。
 * 必须确保"无一内网"才放行。
 *
 * @param hostname — 不含方括号的纯 hostname
 * @returns 解析到的公网 IP 地址，或 null（解析失败 / 任一内网 IP / 无结果）
 * @deprecated 只保留旧测试/兼容用途。发起网络连接必须使用
 * validateTargetUrlForRequest() 返回的全部地址并固定 socket lookup。
 */
export async function resolveToPublicIp(hostname: string): Promise<string | null> {
  const allAddresses: string[] = [];

  // Collect IPv4 addresses
  try {
    const v4 = await dns.resolve4(hostname);
    allAddresses.push(...v4);
  } catch {
    // v4 resolution failed — continue to v6
  }

  // Collect IPv6 addresses
  try {
    const v6 = await dns.resolve6(hostname);
    allAddresses.push(...v6);
  } catch {
    // v6 resolution failed
  }

  // Must have at least one resolved address
  if (allAddresses.length === 0) return null;

  // If ANY resolved address is private/loopback/link-local → reject
  for (const addr of allAddresses) {
    if (isIPv4(addr)) {
      if (isPrivateIPv4(addr)) return null;
    } else {
      if (isPrivateIPv6(addr)) return null;
    }
  }

  // All addresses are public — safe
  return allAddresses[0];
}

/**
 * Resolve and retain every public address that may be used by the actual
 * connection. Returning the addresses (instead of a boolean) lets callers pin
 * the socket lookup and closes DNS rebinding / validation-to-fetch TOCTOU.
 */
export async function validateTargetUrlForRequest(
  inputUrl: URL,
  lookup: TargetDnsLookup = dns.lookup.bind(dns) as TargetDnsLookup,
): Promise<ValidatedTarget | null> {
  if (!isAllowedProtocol(inputUrl.protocol)) return null;
  if (inputUrl.username || inputUrl.password) return null;

  const defaultPort = inputUrl.protocol === "https:" ? "443" : "80";
  if (inputUrl.port && inputUrl.port !== defaultPort) return null;

  const hostname = inputUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname.endsWith(".") || isBlockedHostname(hostname)) return null;

  const literalFamily = isIP(hostname);
  if (literalFamily === 4) {
    if (isPrivateIPv4(hostname)) return null;
    return { url: new URL(inputUrl.toString()), addresses: [{ address: hostname, family: 4 }] };
  }
  if (literalFamily === 6) {
    if (isPrivateIPv6(hostname)) return null;
    return { url: new URL(inputUrl.toString()), addresses: [{ address: hostname, family: 6 }] };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }

  const unique = [...new Map(
    resolved.map((entry) => [`${entry.family}:${entry.address}`, entry]),
  ).values()];
  if (unique.length === 0) return null;

  const addresses: ValidatedTargetAddress[] = [];
  for (const entry of unique) {
    const actualFamily = isIP(entry.address);
    if (entry.family === 4 && actualFamily === 4 && !isPrivateIPv4(entry.address)) {
      addresses.push({ address: entry.address, family: 4 });
      continue;
    }
    if (entry.family === 6 && actualFamily === 6 && !isPrivateIPv6(entry.address)) {
      addresses.push({ address: entry.address, family: 6 });
      continue;
    }
    return null;
  }

  return { url: new URL(inputUrl.toString()), addresses };
}

// ── Combined validation ──

/**
 * 综合校验：协议 + hostname + DNS 解析。
 *
 * @param url — 要校验的 URL 对象
 * @returns true 表示安全可访问，false 表示应阻止
 * @deprecated 布尔结果无法关闭 DNS validation-to-fetch TOCTOU。
 * 网络请求必须使用 validateTargetUrlForRequest() 并固定连接地址。
 */
export async function isValidTargetUrl(url: URL): Promise<boolean> {
  // 1. Protocol check
  if (!isAllowedProtocol(url.protocol)) return false;

  // 2. Hostname check
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) return false;

  // 3. Blocked hostname pattern check
  if (isBlockedHostname(hostname)) return false;

  // 4. If hostname looks like an IP, validate directly
  if (isIPv4(hostname)) {
    return !isPrivateIPv4(hostname);
  }

  // 5. DNS resolution check
  const resolved = await resolveToPublicIp(hostname);
  if (!resolved) return false;

  return true;
}
