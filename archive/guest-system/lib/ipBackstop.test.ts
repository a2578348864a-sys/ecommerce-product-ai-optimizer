import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { normalizeClientIp, resolveClientIp, consumeIpBackstop, resetIpBackstopForTests } from "@/lib/server/ipBackstop";

function req(remote: string | undefined, xff: string | undefined): NextRequest {
  const headers: Record<string, string> = {};
  if (remote) headers["x-remote-addr"] = remote;
  if (xff) headers["x-forwarded-for"] = xff;
  return new NextRequest("http://127.0.0.1:3010/api/x", { method: "POST", headers });
}

beforeEach(() => {
  resetIpBackstopForTests();
});

afterEach(() => {
  delete process.env.QX_IP_GUEST_START_LIMIT_15M;
  delete process.env.QX_IP_TEXT_PROVIDER_LIMIT_15M;
  delete process.env.QX_IP_IMAGE_PROVIDER_LIMIT_15M;
  delete process.env.QX_TRUSTED_PROXY_IPS;
  delete process.env.ACCESS_PASSWORD;
});

describe("IP 归一化（§31）", () => {
  it("IP_NORMALIZATION_IPV4", () => {
    expect(normalizeClientIp(" 198.51.100.7 ")).toBe("198.51.100.7");
  });
  it("IP_NORMALIZATION_IPV6", () => {
    expect(normalizeClientIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeClientIp("2001:db8::1%eth0")).toBe("2001:db8::1");
  });
  it("IP_NORMALIZATION_MAPPED_IPV4", () => {
    expect(normalizeClientIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });
});

describe("可信代理边界（§32）", () => {
  it("SPOOFED_XFF_NOT_TRUSTED：不可信远端 + 伪造 XFF → 忽略 XFF，使用远端地址", () => {
    const r = resolveClientIp(req("203.0.113.5", "1.2.3.4"));
    expect(r).toBe("203.0.113.5");
  });
  it("可信远端（回环代理）→ 信任 X-Forwarded-For 最后一项（nginx 追加的真实客户端）", () => {
    const r = resolveClientIp(req("127.0.0.1", "198.51.100.7"));
    expect(r).toBe("198.51.100.7");
    const spoofed = resolveClientIp(req("127.0.0.1", "1.2.3.4, 198.51.100.7"));
    expect(spoofed).toBe("198.51.100.7");
  });
  it("可信远端 + 无 XFF → 使用远端地址", () => {
    const r = resolveClientIp(req("127.0.0.1", undefined));
    expect(r).toBe("127.0.0.1");
  });
  it("自定义信任列表（QX_TRUSTED_PROXY_IPS）", () => {
    process.env.QX_TRUSTED_PROXY_IPS = "10.0.0.2";
    expect(resolveClientIp(req("10.0.0.2", "198.51.100.7"))).toBe("198.51.100.7");
    expect(resolveClientIp(req("203.0.113.5", "198.51.100.7"))).toBe("203.0.113.5");
  });
});

describe("IP Abuse Backstop（§30 / §33 / §34）", () => {
  it("NORMAL_NAT_USE_PASS：正常少量动作不触发（阈值宽松）", () => {
    process.env.ACCESS_PASSWORD = "test-secret";
    for (let index = 0; index < 5; index += 1) {
      const r = consumeIpBackstop(req("203.0.113.9", undefined), "guest_start");
      expect(r.limited).toBe(false);
    }
  });
  it("ABUSE_BURST_BLOCK：明显 flood → limited（且不递增计数）", () => {
    process.env.ACCESS_PASSWORD = "test-secret";
    process.env.QX_IP_GUEST_START_LIMIT_15M = "3";
    for (let index = 0; index < 3; index += 1) {
      expect(consumeIpBackstop(req("203.0.113.9", undefined), "guest_start").limited).toBe(false);
    }
    const blocked = consumeIpBackstop(req("203.0.113.9", undefined), "guest_start");
    expect(blocked.limited).toBe(true);
    expect(blocked.count).toBe(3);
  });
  it("不同 IP 互不影响（bucket 按 IP 隔离）", () => {
    process.env.ACCESS_PASSWORD = "test-secret";
    process.env.QX_IP_GUEST_START_LIMIT_15M = "2";
    consumeIpBackstop(req("203.0.113.9", undefined), "guest_start");
    consumeIpBackstop(req("203.0.113.9", undefined), "guest_start");
    expect(consumeIpBackstop(req("203.0.113.10", undefined), "guest_start").limited).toBe(false);
  });
  it("不同 kind 独立限额", () => {
    process.env.ACCESS_PASSWORD = "test-secret";
    process.env.QX_IP_GUEST_START_LIMIT_15M = "1";
    consumeIpBackstop(req("203.0.113.9", undefined), "guest_start");
    expect(consumeIpBackstop(req("203.0.113.9", undefined), "text").limited).toBe(false);
  });
});