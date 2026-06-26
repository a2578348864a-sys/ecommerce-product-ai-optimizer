/**
 * Phase Demo-Login.1-B — Client-side Access Token Helpers
 *
 * Stores access token + mode + demoAccess info in sessionStorage.
 * Does NOT store plain-text passwords.
 *
 * Session storage keys:
 *   qx:access-token:session:v1   — access token string
 *   qx:access-mode:session:v1    — "owner" | "demo"
 *   qx:demo-access:session:v1    — JSON of demoAccess info (demo only)
 */

"use client";

import type { SessionMode } from "@/lib/server/accessSession";

export interface DemoAccessInfo {
  id: string;
  label: string;
  expiresAt: string | null;
  maxAiCalls: number;
  usedAiCalls: number;
  remainingAiCalls: number;
}

const TOKEN_KEY = "qx:access-token:session:v1";
const MODE_KEY = "qx:access-mode:session:v1";
const DEMO_ACCESS_KEY = "qx:demo-access:session:v1";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// ── Save ────────────────────────────────────────

export function saveAccessToken(
  token: string,
  mode: SessionMode,
  demoAccess?: DemoAccessInfo,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(TOKEN_KEY, token);
    storage.setItem(MODE_KEY, mode);
    if (demoAccess) {
      storage.setItem(DEMO_ACCESS_KEY, JSON.stringify(demoAccess));
    } else {
      storage.removeItem(DEMO_ACCESS_KEY);
    }

    // Backward compat: also set the old password key so existing
    // useAccessPassword() hook sees a non-empty value.
    storage.setItem("qx:access-password:session:v2", token);
    storage.setItem("qx:access-expires:session:v2", String(Date.now() + 24 * 60 * 60 * 1000));
  } catch {
    // ignore
  }
}

// ── Read ────────────────────────────────────────

export function getAccessToken(): string {
  const storage = getStorage();
  if (!storage) return "";
  try {
    return storage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function getAccessMode(): SessionMode | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const mode = storage.getItem(MODE_KEY);
    if (mode === "owner" || mode === "demo") return mode;
    return null;
  } catch {
    return null;
  }
}

export function getDemoAccessInfo(): DemoAccessInfo | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEMO_ACCESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DemoAccessInfo;
  } catch {
    return null;
  }
}

/**
 * Update demo access info in sessionStorage (after AI calls update remaining quota).
 */
export function updateDemoAccessInfo(update: Partial<DemoAccessInfo>): void {
  const current = getDemoAccessInfo();
  if (!current) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    const merged = { ...current, ...update };
    storage.setItem(DEMO_ACCESS_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

// ── Clear ───────────────────────────────────────

export function clearAccessSession(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(MODE_KEY);
    storage.removeItem(DEMO_ACCESS_KEY);
    storage.removeItem("qx:access-password:session:v2");
    storage.removeItem("qx:access-expires:session:v2");
  } catch {
    // ignore
  }
}
