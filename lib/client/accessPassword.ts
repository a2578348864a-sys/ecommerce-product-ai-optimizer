"use client";

import { useEffect, useState } from "react";

export const ACCESS_PASSWORD_STORAGE_KEY = "qx:access-password:v1";
export const LEGACY_ACCESS_PASSWORD_STORAGE_KEY = "qingxuan-pwd";
export const LEGACY_ACCESS_PASSWORD_EXPIRY_KEY = "qingxuan-pwd-expires";
export const DEFAULT_ACCESS_PASSWORD_TTL_MS = 12 * 60 * 60 * 1000;

type StoredAccessPassword = {
  version: 1;
  value: string;
  updatedAt: number;
  expiresAt: number;
};

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

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // localStorage unavailable/full/security errors should not break UI.
  }
}

function clearLegacyAccessPassword(storage: Storage) {
  safeRemove(storage, LEGACY_ACCESS_PASSWORD_STORAGE_KEY);
  safeRemove(storage, LEGACY_ACCESS_PASSWORD_EXPIRY_KEY);
}

function isStoredAccessPassword(value: unknown): value is StoredAccessPassword {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return source.version === 1
    && typeof source.value === "string"
    && typeof source.updatedAt === "number"
    && typeof source.expiresAt === "number"
    && Number.isFinite(source.updatedAt)
    && Number.isFinite(source.expiresAt);
}

function writeAccessPasswordPayload(storage: Storage, value: string, ttlMs = DEFAULT_ACCESS_PASSWORD_TTL_MS) {
  const trimmed = value.trim();
  if (!trimmed) {
    clearAccessPassword();
    return;
  }

  const now = Date.now();
  const payload: StoredAccessPassword = {
    version: 1,
    value: trimmed,
    updatedAt: now,
    expiresAt: now + ttlMs,
  };

  try {
    storage.setItem(ACCESS_PASSWORD_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 不可用时静默失败，页面仍可继续使用当前 React state。
  }
}

function readLegacyAccessPassword(storage: Storage): string {
  try {
    const value = (storage.getItem(LEGACY_ACCESS_PASSWORD_STORAGE_KEY) || "").trim();
    const expiresAtRaw = storage.getItem(LEGACY_ACCESS_PASSWORD_EXPIRY_KEY);

    if (!value) {
      clearLegacyAccessPassword(storage);
      return "";
    }

    if (expiresAtRaw) {
      const expiresAt = Number(expiresAtRaw);
      if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
        clearLegacyAccessPassword(storage);
        return "";
      }
    }

    writeAccessPasswordPayload(storage, value);
    clearLegacyAccessPassword(storage);
    return value;
  } catch {
    return "";
  }
}

export function getAccessPasswordExpiresAt(): number | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(ACCESS_PASSWORD_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredAccessPassword(parsed)) {
      safeRemove(storage, ACCESS_PASSWORD_STORAGE_KEY);
      return null;
    }
    return parsed.expiresAt;
  } catch {
    safeRemove(storage, ACCESS_PASSWORD_STORAGE_KEY);
    return null;
  }
}

export function getValidAccessPassword(): string {
  const storage = getStorage();
  if (!storage) return "";

  try {
    const raw = storage.getItem(ACCESS_PASSWORD_STORAGE_KEY);
    if (!raw) return readLegacyAccessPassword(storage);

    const parsed: unknown = JSON.parse(raw);
    if (!isStoredAccessPassword(parsed)) {
      safeRemove(storage, ACCESS_PASSWORD_STORAGE_KEY);
      return readLegacyAccessPassword(storage);
    }

    const trimmed = parsed.value.trim();
    if (!trimmed || Date.now() > parsed.expiresAt) {
      clearAccessPassword();
      return "";
    }

    return trimmed;
  } catch {
    safeRemove(storage, ACCESS_PASSWORD_STORAGE_KEY);
    return readLegacyAccessPassword(storage);
  }
}

export function saveAccessPassword(password: string, ttlMs = DEFAULT_ACCESS_PASSWORD_TTL_MS): void {
  const storage = getStorage();
  if (!storage) return;
  writeAccessPasswordPayload(storage, password, ttlMs);
}

export function clearAccessPassword(): void {
  const storage = getStorage();
  if (!storage) return;
  safeRemove(storage, ACCESS_PASSWORD_STORAGE_KEY);
  clearLegacyAccessPassword(storage);
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

export function useAccessPassword(): UseAccessPasswordResult {
  const [password, setPasswordState] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
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
