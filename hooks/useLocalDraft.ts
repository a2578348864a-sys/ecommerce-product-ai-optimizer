"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_DRAFT_VERSION = 1;

type StoredLocalDraft<T> = {
  version: number;
  updatedAt: number;
  value: T;
};

type DraftOptions = {
  ttlMs?: number;
  version?: number;
};

type ReadLocalDraftResult<T> = {
  value: T;
  restored: boolean;
  updatedAt: number | null;
};

type UseLocalDraftOptions<T> = DraftOptions & {
  storageKey: string;
  initialValue: T;
};

type UseLocalDraftResult<T> = {
  draftValue: T;
  setDraftValue: (value: T | ((prev: T) => T)) => void;
  clearDraft: () => void;
  hydrated: boolean;
  restored: boolean;
  updatedAt: number | null;
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
    // Ignore browser storage errors.
  }
}

function getVersion(options?: DraftOptions) {
  return options?.version ?? DEFAULT_DRAFT_VERSION;
}

function getTtlMs(options?: DraftOptions) {
  return options?.ttlMs ?? DEFAULT_DRAFT_TTL_MS;
}

function isStoredDraft<T>(value: unknown, version: number): value is StoredLocalDraft<T> {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return source.version === version
    && typeof source.updatedAt === "number"
    && Number.isFinite(source.updatedAt)
    && "value" in source;
}

export function readLocalDraft<T>(
  storageKey: string,
  initialValue: T,
  options?: DraftOptions,
): ReadLocalDraftResult<T> {
  const storage = getStorage();
  if (!storage) return { value: initialValue, restored: false, updatedAt: null };

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return { value: initialValue, restored: false, updatedAt: null };

    const version = getVersion(options);
    const ttlMs = getTtlMs(options);
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredDraft<T>(parsed, version)) {
      safeRemove(storage, storageKey);
      return { value: initialValue, restored: false, updatedAt: null };
    }

    if (Date.now() - parsed.updatedAt > ttlMs) {
      safeRemove(storage, storageKey);
      return { value: initialValue, restored: false, updatedAt: null };
    }

    return { value: parsed.value, restored: true, updatedAt: parsed.updatedAt };
  } catch {
    safeRemove(storage, storageKey);
    return { value: initialValue, restored: false, updatedAt: null };
  }
}

export function writeLocalDraft<T>(
  storageKey: string,
  value: T,
  options?: DraftOptions,
): number | null {
  const storage = getStorage();
  if (!storage) return null;

  const updatedAt = Date.now();
  const payload: StoredLocalDraft<T> = {
    version: getVersion(options),
    updatedAt,
    value,
  };

  try {
    storage.setItem(storageKey, JSON.stringify(payload));
    return updatedAt;
  } catch {
    return null;
  }
}

export function clearLocalDraft(storageKey: string): void {
  const storage = getStorage();
  if (!storage) return;
  safeRemove(storage, storageKey);
}

export function useLocalDraft<T>({
  storageKey,
  initialValue,
  ttlMs = DEFAULT_DRAFT_TTL_MS,
  version = DEFAULT_DRAFT_VERSION,
}: UseLocalDraftOptions<T>): UseLocalDraftResult<T> {
  const initialValueRef = useRef(initialValue);
  const [draftValue, setDraftValueState] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const result = readLocalDraft(storageKey, initialValueRef.current, { ttlMs, version });
    setDraftValueState(result.value);
    setRestored(result.restored);
    setUpdatedAt(result.updatedAt);
    setHydrated(true);
  }, [storageKey, ttlMs, version]);

  const setDraftValue = useCallback((value: T | ((prev: T) => T)) => {
    setDraftValueState((prev) => {
      const next = typeof value === "function" ? (value as (current: T) => T)(prev) : value;
      const nextUpdatedAt = writeLocalDraft(storageKey, next, { ttlMs, version });
      setUpdatedAt(nextUpdatedAt);
      return next;
    });
  }, [storageKey, ttlMs, version]);

  const clearDraft = useCallback(() => {
    clearLocalDraft(storageKey);
    setDraftValueState(initialValueRef.current);
    setRestored(false);
    setUpdatedAt(null);
    setHydrated(true);
  }, [storageKey]);

  return { draftValue, setDraftValue, clearDraft, hydrated, restored, updatedAt };
}
