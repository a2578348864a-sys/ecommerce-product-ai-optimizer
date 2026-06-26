/**
 * Phase Direction-Recovery.4.2 — Agent Run Result Cache
 *
 * Lightweight sessionStorage cache so that a completed /agent/run analysis
 * survives a browser refresh within the same tab. Uses sessionStorage only
 * (refresh persists, tab close clears).
 *
 * Does NOT store:
 * - accessToken / password / secrets
 * - API keys
 * - sensitive personal data
 *
 * TTL: 2 hours (avoids stale results lingering indefinitely)
 */

// ── Types ───────────────────────────────────────

/** Lightweight source meta (avoids circular import from AgentRunClient) */
export type CachedSourceMeta = {
  source?: string;
  from?: string;
  entry?: string;
  opportunityTitle?: string;
  candidateId?: string;
  sourceTitle?: string;
  importedAt?: string;
};

export type CachedAgentRun = {
  version: 1;
  savedAt: number;
  ttlMs: number;
  productName: string;
  sourceMeta: CachedSourceMeta | null;
  phase: string;
  stepStatuses: Record<string, string>;
  result: unknown | null;
  profitSnapshot: unknown;
  riskReviewSnapshot: unknown;
  manualChecked: Record<string, boolean>;
  savedTaskId: string;
};

// ── Constants ───────────────────────────────────

const CACHE_PREFIX = "agent-run:v1";
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Helpers ─────────────────────────────────────

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function buildCacheKey(productName: string, candidateId?: string | null): string {
  const normalized = (productName || "unknown").trim().slice(0, 80);
  if (candidateId) {
    return `${CACHE_PREFIX}:${candidateId}`;
  }
  return `${CACHE_PREFIX}:product:${normalized}`;
}

// ── Public API ──────────────────────────────────

/** Build the cache key from current context */
export function getAgentRunCacheKey(
  productName: string,
  sourceMeta?: CachedSourceMeta | null,
): string {
  return buildCacheKey(productName, sourceMeta?.candidateId || null);
}

/** Write the current run state to sessionStorage */
export function saveAgentRunCache(
  productName: string,
  sourceMeta: CachedSourceMeta | null,
  data: Omit<CachedAgentRun, "version" | "savedAt" | "ttlMs" | "productName" | "sourceMeta">,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = buildCacheKey(productName, sourceMeta?.candidateId || null);
    const cache: CachedAgentRun = {
      version: 1,
      savedAt: Date.now(),
      ttlMs: DEFAULT_TTL_MS,
      productName,
      sourceMeta,
      ...data,
    };
    storage.setItem(key, JSON.stringify(cache));
  } catch {
    // sessionStorage full or unavailable — silently skip
  }
}

/** Try to load a cached run from sessionStorage. Returns null if missing/expired/mismatched. */
export function loadAgentRunCache(
  productName: string,
  sourceMeta?: CachedSourceMeta | null,
): CachedAgentRun | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const key = buildCacheKey(productName, sourceMeta?.candidateId || null);
    const raw = storage.getItem(key);
    if (!raw) return null;

    const cache = JSON.parse(raw) as CachedAgentRun;
    if (!cache || cache.version !== 1) return null;

    // TTL check
    if (Date.now() - cache.savedAt > (cache.ttlMs || DEFAULT_TTL_MS)) {
      storage.removeItem(key);
      return null;
    }

    // Product name match (prevent cross-contamination)
    if (cache.productName !== productName) {
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

/** Clear the cached run for the current context */
export function clearAgentRunCache(
  productName: string,
  sourceMeta?: CachedSourceMeta | null,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = buildCacheKey(productName, sourceMeta?.candidateId || null);
    storage.removeItem(key);
  } catch {
    // ignore
  }
}
