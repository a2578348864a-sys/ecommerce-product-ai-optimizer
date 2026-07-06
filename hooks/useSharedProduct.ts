"use client";

import { useCallback, useEffect, useState } from "react";
import { getAccessMode, getDemoAccessInfo } from "@/lib/client/accessToken";

const STORAGE_KEY_BASE = "qingxuan-current-product";

function getScopedStorageKey(): string {
  const mode = getAccessMode();
  if (mode === "demo") {
    const info = getDemoAccessInfo();
    return `demo:${info?.id || "unknown"}:${STORAGE_KEY_BASE}`;
  }
  return `owner:${STORAGE_KEY_BASE}`;
}

export type SharedProduct = {
  productName: string;
  category: string;
  targetPlatform: string;
  description: string;
  targetPrice: string;
  claims: string;
};

const EMPTY: SharedProduct = {
  productName: "",
  category: "",
  targetPlatform: "shopify",
  description: "",
  targetPrice: "",
  claims: "",
};

function readFromStorage(): SharedProduct {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(getScopedStorageKey());
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      productName: typeof parsed.productName === "string" ? parsed.productName : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
      targetPlatform: typeof parsed.targetPlatform === "string" ? parsed.targetPlatform : "shopify",
      description: typeof parsed.description === "string" ? parsed.description : "",
      targetPrice: typeof parsed.targetPrice === "string" ? parsed.targetPrice : "",
      claims: typeof parsed.claims === "string" ? parsed.claims : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeToStorage(value: SharedProduct) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getScopedStorageKey(), JSON.stringify(value));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Returns [sharedProduct, updateSharedProduct] — updateShared merges partial updates into localStorage */
export function useSharedProduct(): [SharedProduct, (patch: Partial<SharedProduct>) => void] {
  const [state, setState] = useState<SharedProduct>(EMPTY);

  // Hydrate from localStorage on mount (client only)
  useEffect(() => {
    setState(readFromStorage());
  }, []);

  const update = useCallback((patch: Partial<SharedProduct>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeToStorage(next);
      return next;
    });
  }, []);

  return [state, update];
}

/** Debounced version — waits `delayMs` before writing to localStorage.
 *  Returns [sharedProduct, updateImmediate, updateDebounced]
 *  - updateImmediate: updates React state immediately (for responsive UI)
 *  - updateDebounced: waits delayMs then syncs to localStorage
 */
export function useSharedProductDebounced(delayMs = 500): [
  SharedProduct,
  (patch: Partial<SharedProduct>) => void,
] {
  const [state, setState] = useState<SharedProduct>(EMPTY);

  useEffect(() => {
    setState(readFromStorage());
  }, []);

  const update = useCallback(
    (patch: Partial<SharedProduct>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        // Debounce the localStorage write
        const timer = setTimeout(() => writeToStorage(next), delayMs);
        // Store timer ref for cleanup
        return next;
      });
    },
    [delayMs],
  );

  return [state, update];
}
