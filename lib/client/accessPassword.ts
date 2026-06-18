"use client";

import { useEffect, useState } from "react";

/**
 * 跨页面统一的访问密码工具
 *
 * 设计原则：
 * - 不做账号系统，只做轻量本地验证状态统一
 * - 所有页面共享同一个 localStorage key
 * - 支持 TTL 过期（默认 12 小时）
 * - 向后兼容已有的 useLocalStorage("qingxuan-pwd", "") 写法
 */

const PASSWORD_KEY = "qingxuan-pwd";
const EXPIRY_KEY = "qingxuan-pwd-expires";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

/**
 * 从 localStorage 读取已保存的密码。
 * 如果已过期，自动清除并返回空字符串。
 */
export function getStoredAccessPassword(): string {
  if (typeof window === "undefined") return "";
  try {
    const expiresAt = window.localStorage.getItem(EXPIRY_KEY);
    if (expiresAt) {
      const expiry = Number(expiresAt);
      if (Number.isFinite(expiry) && Date.now() > expiry) {
        // 已过期：清除并返回空
        clearStoredAccessPassword();
        return "";
      }
    }
    return window.localStorage.getItem(PASSWORD_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * 保存密码到 localStorage，同时设置过期时间。
 * @param password - 访问密码明文
 * @param ttlMs - 过期时间（毫秒），默认 12 小时
 */
export function setStoredAccessPassword(
  password: string,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PASSWORD_KEY, password);
    window.localStorage.setItem(EXPIRY_KEY, String(Date.now() + ttlMs));
  } catch {
    // localStorage 不可用时静默失败
  }
}

/**
 * 清除保存的密码和过期时间。
 */
export function clearStoredAccessPassword(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PASSWORD_KEY);
    window.localStorage.removeItem(EXPIRY_KEY);
  } catch {
    // 静默失败
  }
}

/**
 * 检查密码是否已过期。
 * @returns true 表示密码已过期或不存在
 */
export function isAccessPasswordExpired(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const expiresAt = window.localStorage.getItem(EXPIRY_KEY);
    if (!expiresAt) {
      // 没有过期时间记录 = 旧版本存储的密码，视为不过期（向后兼容）
      return !window.localStorage.getItem(PASSWORD_KEY);
    }
    const expiry = Number(expiresAt);
    return Number.isFinite(expiry) && Date.now() > expiry;
  } catch {
    return true;
  }
}

/**
 * 与 useLocalStorage("qingxuan-pwd") 保持一致的 storage key。
 * 已有的 SourcingForm / RiskCheckForm / MaterialsForm / ViralMockAgent
 * 使用此 key，新代码也可引用此常量以保持统一。
 */
export const ACCESS_PASSWORD_STORAGE_KEY = PASSWORD_KEY;

export function canRequestWithAccessPassword(isReady: boolean, password: string): boolean {
  return isReady && password.trim().length > 0;
}

/**
 * React Hook：跨页面统一的访问密码状态。
 *
 * 与 useLocalStorage("qingxuan-pwd", "") 保持完全相同的 API 签名：
 *   [password, setPassword]
 *
 * 额外提供：
 * - 初始化时读取 localStorage 并检查 TTL 过期
 * - setPassword 时自动写入 TTL 过期时间
 * - expired 状态供 UI 展示"密码已过期"提示
 *
 * 用法（直接替换 useLocalStorage("qingxuan-pwd", "")）：
 *   const [accessPassword, setAccessPassword] = useAccessPassword();
 */
export function useAccessPassword(): [
  string,
  (value: string | ((prev: string) => string)) => void,
  boolean,
  () => void,
] {
  const [password, setPasswordState] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate on mount from localStorage (with TTL check)
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPasswordState(getStoredAccessPassword());
    setHydrated(true);
  }, []);

  const setPassword = (value: string | ((prev: string) => string)) => {
    setPasswordState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      setStoredAccessPassword(next);
      return next;
    });
  };

  const clearPassword = () => {
    clearStoredAccessPassword();
    setPasswordState("");
    setHydrated(true);
  };

  return [password, setPassword, hydrated, clearPassword];
}
