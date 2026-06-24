"use client";

import { useEffect, useState } from "react";

export const ACCESS_PASSWORD_STORAGE_KEY = "qx:access-password:v1";
export const DEFAULT_ACCESS_PASSWORD_TTL_MS = 12 * 60 * 60 * 1000;

// ── Session storage (survives refresh, clears on tab close) ──
// Phase 3-B.1.6 P0 Fix v2: sessionStorage — not localStorage, not in-memory.
// - Refresh within same tab → password survives
// - Close tab / close browser → password cleared
// - New incognito window → fresh session

const SESSION_PASSWORD_KEY = "qx:access-password:session:v2";
const SESSION_EXPIRES_KEY = "qx:access-expires:session:v2";

// Legacy localStorage keys to clean up (do NOT read as unlock authority)
const LEGACY_CLEANUP_KEYS = [
  "qx:access-password:v1",
  "qingxuan-pwd",
  "qingxuan-pwd-expires",
];

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safeRemove(storage: Storage | null, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

type AccessPasswordSetter = (value: string | ((prev: string) => string)) => void;

export type UseAccessPasswordResult = [
  string,
  AccessPasswordSetter,
  boolean,
  () => void,
] & {
  accessPassword: string;
  setAccessPassword: AccessPasswordSetter;
  isReady: boolean;
  clearAccessPassword: () => void;
  hasAccessPassword: boolean;
  isExpired: boolean;
  expiresAt: number | null;
  saveAccessPassword: (value: string) => void;
  getValidAccessPassword: () => string;
};

// ── Public getters / setters (sessionStorage only) ──

export function getAccessPasswordExpiresAt(): number | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_EXPIRES_KEY);
    if (!raw) return null;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      safeRemove(storage, SESSION_PASSWORD_KEY);
      safeRemove(storage, SESSION_EXPIRES_KEY);
      return null;
    }
    return expiresAt;
  } catch {
    return null;
  }
}

export function getValidAccessPassword(): string {
  const storage = getSessionStorage();
  if (!storage) return "";
  try {
    const password = (storage.getItem(SESSION_PASSWORD_KEY) || "").trim();
    if (!password) return "";

    const expiresAt = getAccessPasswordExpiresAt();
    if (expiresAt === null) return "";

    return password;
  } catch {
    return "";
  }
}

export function saveAccessPassword(password: string, ttlMs = DEFAULT_ACCESS_PASSWORD_TTL_MS): void {
  const trimmed = password.trim();
  if (!trimmed) {
    clearAccessPassword();
    return;
  }

  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(SESSION_PASSWORD_KEY, trimmed);
    storage.setItem(SESSION_EXPIRES_KEY, String(Date.now() + ttlMs));
  } catch {
    // sessionStorage unavailable — silently fail
  }
}

export function clearAccessPassword(): void {
  const storage = getSessionStorage();
  if (storage) {
    safeRemove(storage, SESSION_PASSWORD_KEY);
    safeRemove(storage, SESSION_EXPIRES_KEY);
  }

  // Also clean up legacy localStorage keys so old versions don't interfere
  if (typeof window !== "undefined") {
    try {
      const ls = window.localStorage;
      for (const key of LEGACY_CLEANUP_KEYS) {
        try { ls.removeItem(key); } catch { /* ignore */ }
      }
    } catch {
      // localStorage unavailable
    }
  }
}

export function isAccessPasswordExpired(): boolean {
  return !getValidAccessPassword();
}

export function getStoredAccessPassword(): string {
  return getValidAccessPassword();
}

export function setStoredAccessPassword(password: string, ttlMs = DEFAULT_ACCESS_PASSWORD_TTL_MS): void {
  saveAccessPassword(password, ttlMs);
}

export function clearStoredAccessPassword(): void {
  clearAccessPassword();
}

export function canRequestWithAccessPassword(isReady: boolean, password: string): boolean {
  return isReady && password.trim().length > 0;
}

// ── React hook ──

export function useAccessPassword(): UseAccessPasswordResult {
  const [password, setPasswordState] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    // Hydrate from sessionStorage — survives refresh within same tab.
    setPasswordState(getValidAccessPassword());
    setExpiresAt(getAccessPasswordExpiresAt());
    setHydrated(true);
  }, []);

  const setPassword: AccessPasswordSetter = (value) => {
    setPasswordState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      saveAccessPassword(next);
      setExpiresAt(getAccessPasswordExpiresAt());
      return next.trim();
    });
  };

  const clearPassword = () => {
    clearAccessPassword();
    setPasswordState("");
    setExpiresAt(null);
    setHydrated(true);
  };

  const current = getValidAccessPassword();
  const isExpired = hydrated && !current;
  const result = [
    password,
    setPassword,
    hydrated,
    clearPassword,
  ] as UseAccessPasswordResult;

  result.accessPassword = password;
  result.setAccessPassword = setPassword;
  result.isReady = hydrated;
  result.clearAccessPassword = clearPassword;
  result.hasAccessPassword = hydrated && password.trim().length > 0;
  result.isExpired = isExpired;
  result.expiresAt = expiresAt;
  result.saveAccessPassword = setPassword;
  result.getValidAccessPassword = getValidAccessPassword;

  return result;
}
