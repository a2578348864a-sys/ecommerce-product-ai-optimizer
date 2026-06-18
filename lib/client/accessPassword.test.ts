import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * accessPassword client 工具测试
 *
 * 由于 Node 环境无 localStorage，使用 mock 模拟浏览器行为。
 * 不引入 jsdom 依赖。
 */

// Mock localStorage
const store = new Map<string, string>();

const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
};

// 在模块加载前 mock global 对象（代码内部使用 window.localStorage）
vi.stubGlobal("window", { localStorage: mockLocalStorage });
vi.stubGlobal("localStorage", mockLocalStorage);

// 延迟导入以在 mock 之后加载
const accessPassword = await import("@/lib/client/accessPassword");

beforeEach(() => {
  store.clear();
});

describe("accessPassword client tools", () => {
  // ── getStoredAccessPassword ──

  it("getStoredAccessPassword: 未保存时返回空字符串", () => {
    expect(accessPassword.getStoredAccessPassword()).toBe("");
  });

  it("getStoredAccessPassword: 保存后能读取", () => {
    accessPassword.setStoredAccessPassword("test-password-123");
    expect(accessPassword.getStoredAccessPassword()).toBe("test-password-123");
  });

  it("getStoredAccessPassword: 过期后返回空字符串", () => {
    // 保存一个已过期的密码（TTL=-1ms）
    accessPassword.setStoredAccessPassword("old-password", -1);
    const result = accessPassword.getStoredAccessPassword();
    expect(result).toBe("");
  });

  // ── isAccessPasswordExpired ──

  it("isAccessPasswordExpired: 未保存时返回 true", () => {
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
  });

  it("isAccessPasswordExpired: 有效期内返回 false", () => {
    // 默认 TTL 12 小时
    accessPassword.setStoredAccessPassword("valid-pwd");
    expect(accessPassword.isAccessPasswordExpired()).toBe(false);
  });

  it("isAccessPasswordExpired: 已过期返回 true", () => {
    accessPassword.setStoredAccessPassword("expired-pwd", -1);
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
  });

  // ── clearStoredAccessPassword ──

  it("clearStoredAccessPassword: 清除后返回空", () => {
    accessPassword.setStoredAccessPassword("to-be-cleared");
    expect(accessPassword.getStoredAccessPassword()).toBe("to-be-cleared");

    accessPassword.clearStoredAccessPassword();
    expect(accessPassword.getStoredAccessPassword()).toBe("");
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
  });

  it("clearStoredAccessPassword: 清除空存储不报错", () => {
    expect(() => accessPassword.clearStoredAccessPassword()).not.toThrow();
  });

  // ── 无效存储内容不崩溃 ──

  it("getStoredAccessPassword: 过期的过期时间值为非数字时不崩溃", () => {
    // 模拟写入无效的过期时间
    accessPassword.setStoredAccessPassword("test", 12 * 60 * 60 * 1000);
    // 直接 mock 修改 expiresAt 为非法值
    store.set("qingxuan-pwd-expires", "not-a-number");
    const result = accessPassword.getStoredAccessPassword();
    // 应该能正常返回（不过期，向后兼容）
    expect(typeof result).toBe("string");
  });

  it("getStoredAccessPassword: 空字符串密码正常返回", () => {
    accessPassword.setStoredAccessPassword("");
    const result = accessPassword.getStoredAccessPassword();
    expect(result).toBe("");
  });

  // ── setStoredAccessPassword 多次写入 ──

  it("setStoredAccessPassword: 多次写入只保留最后一次", () => {
    accessPassword.setStoredAccessPassword("first");
    accessPassword.setStoredAccessPassword("second");
    expect(accessPassword.getStoredAccessPassword()).toBe("second");
  });

  // ── ACCESS_PASSWORD_STORAGE_KEY 常量 ──

  it("ACCESS_PASSWORD_STORAGE_KEY 为 qingxuan-pwd", () => {
    expect(accessPassword.ACCESS_PASSWORD_STORAGE_KEY).toBe("qingxuan-pwd");
  });
});
