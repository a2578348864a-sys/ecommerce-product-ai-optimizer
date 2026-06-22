import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as dns } from "dns";

/**
 * lib/server/ssrfGuard SSRF 防护测试
 *
 * 测试 IP 范围、hostname 模式、协议限制、DNS 解析后拦截。
 * 不发起真实网络请求。
 */

let guard: typeof import("./ssrfGuard");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default: both DNS methods reject, so tests that don't mock them won't hit the network
  vi.spyOn(dns, "resolve4").mockRejectedValue(new Error("not mocked"));
  vi.spyOn(dns, "resolve6").mockRejectedValue(new Error("not mocked"));
  guard = await import("./ssrfGuard");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── isPrivateIPv4 ──

describe("isPrivateIPv4", () => {
  it("127.0.0.1 → true (loopback)", () => {
    expect(guard.isPrivateIPv4("127.0.0.1")).toBe(true);
  });

  it("127.255.255.255 → true (loopback)", () => {
    expect(guard.isPrivateIPv4("127.255.255.255")).toBe(true);
  });

  it("10.0.0.1 → true (private)", () => {
    expect(guard.isPrivateIPv4("10.0.0.1")).toBe(true);
  });

  it("10.255.255.255 → true (private)", () => {
    expect(guard.isPrivateIPv4("10.255.255.255")).toBe(true);
  });

  it("172.16.0.1 → true (private)", () => {
    expect(guard.isPrivateIPv4("172.16.0.1")).toBe(true);
  });

  it("172.31.255.255 → true (private)", () => {
    expect(guard.isPrivateIPv4("172.31.255.255")).toBe(true);
  });

  it("172.32.0.1 → false (not in 172.16/12)", () => {
    expect(guard.isPrivateIPv4("172.32.0.1")).toBe(false);
  });

  it("192.168.0.1 → true (private)", () => {
    expect(guard.isPrivateIPv4("192.168.0.1")).toBe(true);
  });

  it("192.168.255.255 → true (private)", () => {
    expect(guard.isPrivateIPv4("192.168.255.255")).toBe(true);
  });

  it("169.254.0.1 → true (link-local)", () => {
    expect(guard.isPrivateIPv4("169.254.0.1")).toBe(true);
  });

  it("169.254.255.255 → true (link-local)", () => {
    expect(guard.isPrivateIPv4("169.254.255.255")).toBe(true);
  });

  it("0.0.0.0 → true (current network)", () => {
    expect(guard.isPrivateIPv4("0.0.0.0")).toBe(true);
  });

  it("8.8.8.8 → false (public)", () => {
    expect(guard.isPrivateIPv4("8.8.8.8")).toBe(false);
  });

  it("1.1.1.1 → false (public)", () => {
    expect(guard.isPrivateIPv4("1.1.1.1")).toBe(false);
  });

  it("93.184.216.34 → false (public)", () => {
    expect(guard.isPrivateIPv4("93.184.216.34")).toBe(false);
  });

  it("malformed → true (block)", () => {
    expect(guard.isPrivateIPv4("not.an.ip")).toBe(true);
  });
});

// ── isPrivateIPv6 ──

describe("isPrivateIPv6", () => {
  it("::1 → true (loopback)", () => {
    expect(guard.isPrivateIPv6("::1")).toBe(true);
  });

  it("0:0:0:0:0:0:0:1 → true (loopback)", () => {
    expect(guard.isPrivateIPv6("0:0:0:0:0:0:0:1")).toBe(true);
  });

  it("fe80::1 → true (link-local)", () => {
    expect(guard.isPrivateIPv6("fe80::1")).toBe(true);
  });

  it("feb0::1 → true (link-local fe80::/10)", () => {
    expect(guard.isPrivateIPv6("feb0::1")).toBe(true);
  });

  it("fc00::1 → true (unique local)", () => {
    expect(guard.isPrivateIPv6("fc00::1")).toBe(true);
  });

  it("fdff::1 → true (unique local)", () => {
    expect(guard.isPrivateIPv6("fdff::1")).toBe(true);
  });

  it("2001:4860:4860::8888 → false (public)", () => {
    expect(guard.isPrivateIPv6("2001:4860:4860::8888")).toBe(false);
  });
});

// ── isBlockedHostname ──

describe("isBlockedHostname", () => {
  it("localhost → true", () => {
    expect(guard.isBlockedHostname("localhost")).toBe(true);
  });

  it("LOCALHOST → true (case insensitive)", () => {
    expect(guard.isBlockedHostname("LOCALHOST")).toBe(true);
  });

  it("127.0.0.1 → true", () => {
    expect(guard.isBlockedHostname("127.0.0.1")).toBe(true);
  });

  it("10.0.0.1 → true", () => {
    expect(guard.isBlockedHostname("10.0.0.1")).toBe(true);
  });

  it("172.16.0.1 → true", () => {
    expect(guard.isBlockedHostname("172.16.0.1")).toBe(true);
  });

  it("172.31.0.1 → true", () => {
    expect(guard.isBlockedHostname("172.31.0.1")).toBe(true);
  });

  it("192.168.0.1 → true", () => {
    expect(guard.isBlockedHostname("192.168.0.1")).toBe(true);
  });

  it("169.254.0.1 → true", () => {
    expect(guard.isBlockedHostname("169.254.0.1")).toBe(true);
  });

  it("::1 → true", () => {
    expect(guard.isBlockedHostname("::1")).toBe(true);
  });

  it("[::1] → true", () => {
    expect(guard.isBlockedHostname("[::1]")).toBe(true);
  });

  it("example.com → false", () => {
    expect(guard.isBlockedHostname("example.com")).toBe(false);
  });

  it("alibaba.com → false", () => {
    expect(guard.isBlockedHostname("alibaba.com")).toBe(false);
  });
});

// ── isAllowedProtocol ──

describe("isAllowedProtocol", () => {
  it("http → true", () => expect(guard.isAllowedProtocol("http")).toBe(true));
  it("https → true", () => expect(guard.isAllowedProtocol("https")).toBe(true));
  it("http: → true (with colon)", () => expect(guard.isAllowedProtocol("http:")).toBe(true));
  it("https: → true (with colon)", () => expect(guard.isAllowedProtocol("https:")).toBe(true));
  it("HTTPS → true (case insensitive)", () => expect(guard.isAllowedProtocol("HTTPS")).toBe(true));
  it("file → false", () => expect(guard.isAllowedProtocol("file")).toBe(false));
  it("ftp → false", () => expect(guard.isAllowedProtocol("ftp")).toBe(false));
  it("gopher → false", () => expect(guard.isAllowedProtocol("gopher")).toBe(false));
  it("javascript → false", () => expect(guard.isAllowedProtocol("javascript")).toBe(false));
  it("data → false", () => expect(guard.isAllowedProtocol("data")).toBe(false));
});

// ── resolveToPublicIp ──

describe("resolveToPublicIp", () => {
  it("公网域名解析到公网 IP → 返回 IP", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["8.8.8.8"]);
    const result = await guard.resolveToPublicIp("example.com");
    expect(result).toBe("8.8.8.8");
  });

  it("域名解析到 127.0.0.1 → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["127.0.0.1"]);
    const result = await guard.resolveToPublicIp("evil.internal");
    expect(result).toBeNull();
  });

  it("域名解析到 10.x → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["10.0.0.5"]);
    const result = await guard.resolveToPublicIp("internal.example");
    expect(result).toBeNull();
  });

  it("域名解析到 192.168.x → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["192.168.1.1"]);
    const result = await guard.resolveToPublicIp("local.example");
    expect(result).toBeNull();
  });

  it("域名解析到 172.16.x → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["172.16.0.1"]);
    const result = await guard.resolveToPublicIp("private.example");
    expect(result).toBeNull();
  });

  it("域名解析到 169.254.x → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["169.254.1.1"]);
    const result = await guard.resolveToPublicIp("link-local.example");
    expect(result).toBeNull();
  });

  it("v4 解析失败，v6 解析到公网 → 返回 v6 地址", async () => {
    vi.spyOn(dns, "resolve4").mockRejectedValueOnce(new Error("no v4"));
    vi.spyOn(dns, "resolve6").mockResolvedValueOnce(["2001:4860:4860::8888"]);
    const result = await guard.resolveToPublicIp("ipv6-only.example");
    expect(result).toBe("2001:4860:4860::8888");
  });

  it("v4 解析失败，v6 解析到 fe80:: → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockRejectedValueOnce(new Error("no v4"));
    vi.spyOn(dns, "resolve6").mockResolvedValueOnce(["fe80::1"]);
    const result = await guard.resolveToPublicIp("ipv6-local.example");
    expect(result).toBeNull();
  });

  it("所有 DNS 解析都失败 → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockRejectedValueOnce(new Error("ENOTFOUND"));
    vi.spyOn(dns, "resolve6").mockRejectedValueOnce(new Error("ENOTFOUND"));
    const result = await guard.resolveToPublicIp("nonexistent.example");
    expect(result).toBeNull();
  });

  it("多个公网 v4 IP → 返回第一个", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["8.8.8.8", "1.1.1.1"]);
    const result = await guard.resolveToPublicIp("multi-public.example");
    expect(result).toBe("8.8.8.8");
  });

  it("公网 + 内网混合 (v4) → 返回 null（任一内网即拒绝）", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["10.0.0.1", "8.8.8.8"]);
    const result = await guard.resolveToPublicIp("rebind.example");
    expect(result).toBeNull();
  });

  it("公网 + 内网混合 (v4) — 内网在前 → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["8.8.8.8", "192.168.1.1"]);
    const result = await guard.resolveToPublicIp("rebind2.example");
    expect(result).toBeNull();
  });

  it("多个内网 v4 → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["10.0.0.1", "192.168.1.1"]);
    const result = await guard.resolveToPublicIp("all-internal.example");
    expect(result).toBeNull();
  });

  it("v4 公网 + v6 私网混合 → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["8.8.8.8"]);
    vi.spyOn(dns, "resolve6").mockResolvedValueOnce(["fe80::1"]);
    const result = await guard.resolveToPublicIp("v4pub-v6priv.example");
    expect(result).toBeNull();
  });

  it("v4 私网 + v6 公网混合 → 返回 null", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["10.0.0.1"]);
    vi.spyOn(dns, "resolve6").mockResolvedValueOnce(["2001:4860:4860::8888"]);
    const result = await guard.resolveToPublicIp("v4priv-v6pub.example");
    expect(result).toBeNull();
  });

  it("v4 公网 + v6 公网 → 返回 v4 公网 IP", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["8.8.8.8"]);
    vi.spyOn(dns, "resolve6").mockResolvedValueOnce(["2001:4860:4860::8888"]);
    const result = await guard.resolveToPublicIp("dual-stack.example");
    expect(result).toBe("8.8.8.8");
  });
});

// ── isValidTargetUrl ──

describe("isValidTargetUrl", () => {
  it("https 公网域名，DNS 解析到公网 → true", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["93.184.216.34"]);
    const url = new URL("https://example.com/path");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(true);
  });

  it("http 公网域名，DNS 解析到公网 → true", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["1.1.1.1"]);
    const url = new URL("http://alibaba.com");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(true);
  });

  it("file:// 协议 → false", async () => {
    const url = new URL("file:///etc/passwd");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("ftp:// 协议 → false", async () => {
    const url = new URL("ftp://example.com");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("localhost hostname → false", async () => {
    const url = new URL("http://localhost:8080");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("127.0.0.1 hostname → false (no DNS needed)", async () => {
    const url = new URL("http://127.0.0.1:3000");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("10.0.0.1 hostname → false (no DNS needed)", async () => {
    const url = new URL("http://10.0.0.1");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("172.16.0.1 hostname → false (no DNS needed)", async () => {
    const url = new URL("http://172.16.0.1");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("192.168.0.1 hostname → false (no DNS needed)", async () => {
    const url = new URL("http://192.168.0.1");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("169.254.0.1 hostname → false (no DNS needed)", async () => {
    const url = new URL("http://169.254.0.1");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("DNS 解析到 127.0.0.1 → false", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["127.0.0.1"]);
    const url = new URL("https://evil-redirect.example");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("DNS 解析到 10.x → false", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["10.0.0.5"]);
    const url = new URL("https://internal.example");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("DNS 解析到 192.168.x → false", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["192.168.1.1"]);
    const url = new URL("https://local.example");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("DNS 解析到 172.16.x → false", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["172.16.0.1"]);
    const url = new URL("https://private.example");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("DNS 解析到 169.254.x → false", async () => {
    vi.spyOn(dns, "resolve4").mockResolvedValueOnce(["169.254.1.1"]);
    const url = new URL("https://link-local.example");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("DNS 解析失败 → false", async () => {
    vi.spyOn(dns, "resolve4").mockRejectedValueOnce(new Error("ENOTFOUND"));
    vi.spyOn(dns, "resolve6").mockRejectedValueOnce(new Error("ENOTFOUND"));
    const url = new URL("https://nonexistent.example");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("::1 hostname → false", async () => {
    const url = new URL("http://[::1]:3000");
    const result = await guard.isValidTargetUrl(url);
    expect(result).toBe(false);
  });

  it("empty hostname → false", async () => {
    // URL constructor would throw with empty host, but test the edge case
    const result = await guard.isValidTargetUrl({ hostname: "", protocol: "https:" } as URL);
    expect(result).toBe(false);
  });
});
