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
  isActive: boolean;
  quotaMetric: "product_journeys_v1";
  maxProducts: number;
  usedProducts: number;
  reservedProducts: number;
  remainingProducts: number;
  migrationStatus: "migrated";
  standaloneListingLimit?: number;
  standaloneListingUsed?: number;
  standaloneListingReserved?: number;
  standaloneListingRemaining?: number;
  standaloneImageUnitLimit?: number;
  standaloneImageUnitsUsed?: number;
  standaloneImageUnitsReserved?: number;
  standaloneImageUnitsRemaining?: number;
  /** Legacy-only fields retained for older isolated Studio responses. */
  maxAiCalls?: number;
  usedAiCalls?: number;
  remainingAiCalls?: number;
  maxAiJobs?: number;
  usedAiJobs?: number;
  remainingAiJobs?: number;
  /** V3.1 Phase 1：显式凭据判别（契约 02 / §9）；anonymous 时 UI 隐藏无消费路径的研究额度（契约 04-4 / §25）。 */
  credentialKind?: "password" | "anonymous";
  /** V3.1 Phase 2：全局 Provider 日硬上限状态（§39：与 guest quota 区分）。 */
  globalCapExhausted?: { text: boolean; image: boolean };
}

const TOKEN_KEY = "qx:access-token:session:v1";
const MODE_KEY = "qx:access-mode:session:v1";
const DEMO_ACCESS_KEY = "qx:demo-access:session:v1";
export const DEMO_ACCESS_UPDATED_EVENT = "qx:demo-access-updated";
const ACCESS_TOKEN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
    storage.setItem("qx:access-expires:session:v2", String(Date.now() + ACCESS_TOKEN_SESSION_TTL_MS));
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
 * Update Visitor access info in sessionStorage from a server-authoritative snapshot.
 */
export function updateDemoAccessInfo(update: Partial<DemoAccessInfo>): void {
  const current = getDemoAccessInfo();
  if (!current) return;
  updateDemoAccessSnapshot({
    ...current,
    ...update,
    id: current.id,
  });
}

/**
 * Apply a server-authoritative Visitor quota snapshot and notify current-page consumers.
 * Committed product usage is monotonic. Reserved capacity may be restored after
 * an explicit release, so it is taken from the latest authoritative response.
 */
export function updateDemoAccessSnapshot(snapshot: DemoAccessInfo): void {
  const current = getDemoAccessInfo();
  if (!current || snapshot.id !== current.id) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    const usedProducts = Math.max(current.usedProducts, snapshot.usedProducts);
    const reservedProducts = snapshot.usedProducts < current.usedProducts
      ? current.reservedProducts
      : snapshot.reservedProducts;
    const remainingProducts = Math.max(
      0,
      snapshot.maxProducts - Math.min(snapshot.maxProducts, usedProducts + reservedProducts),
    );
    const merged: DemoAccessInfo = {
      ...current,
      ...snapshot,
      quotaMetric: "product_journeys_v1",
      usedProducts,
      reservedProducts,
      remainingProducts,
    };
    storage.setItem(DEMO_ACCESS_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent<DemoAccessInfo>(DEMO_ACCESS_UPDATED_EVENT, {
      detail: merged,
    }));
  } catch {
    // ignore
  }
}

/**
 * V3.1 Phase 1：Guest 模式标记。
 * Anonymous Guest 的 token 只在 HttpOnly Cookie（契约 09），sessionStorage 永无 token（§17 / §18）；
 * 因此 mode=demo 且无 sessionStorage token 即 guest 会话（与遗留 visitor 的 mode=demo+token 明确区分）。
 */
export function isGuestMode(): boolean {
  return getAccessMode() === "demo" && !getAccessToken();
}

/**
 * Guest 铸造成功后保存「轻量会话标记」（不含 token）。
 * 只存 mode=demo + 服务端权威 demoAccess 快照；token 由浏览器自动随 Cookie 发送。
 */
export function saveGuestAccess(demoAccess: DemoAccessInfo): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(MODE_KEY, "demo");
    storage.setItem(DEMO_ACCESS_KEY, JSON.stringify(demoAccess));
    storage.removeItem(TOKEN_KEY);
    storage.removeItem("qx:access-password:session:v2");
    storage.removeItem("qx:access-expires:session:v2");
    storage.removeItem("qx:access-password:v1");
  } catch {
    // ignore
  }
}

/** V3.1 local_owner（显式）：无认证回环信任的客户端会话标记（服务端始终为权威）。 */
const NO_AUTH_OWNER_KEY = "qx:no-auth-owner:v1";

export function isNoAuthOwnerMode(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(NO_AUTH_OWNER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNoAuthOwnerMode(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(NO_AUTH_OWNER_KEY, "1");
  } catch {
    // ignore
  }
}

export function isAuthenticated(): boolean {
  return !!getAccessToken() || isGuestMode() || isNoAuthOwnerMode();
}

/**
 * Build unified auth headers for API requests.
 * Sends both x-access-token and x-access-password with the token
 * for maximum backward compatibility with both new and old API routes.
 */
export function buildAccessHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (!token) return {};
  return {
    "x-access-token": token,
    "x-access-password": token,
  };
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