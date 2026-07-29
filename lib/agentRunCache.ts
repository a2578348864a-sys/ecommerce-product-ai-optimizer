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
  contextHash?: string;
  sourceTitle?: string;
  importedAt?: string;
};

export type CachedAgentRun = {
  version: 2;
  accessScope: string;
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
  manualDecisionStatus?: string;
  manualDecisionReason?: string;
  manualDecisionNextAction?: string;
  savedTaskId: string;
};

// ── Constants ───────────────────────────────────

const CACHE_PREFIX = "agent-run:v2";
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function scopePrefix(scope?: string | null): string {
  if (!scope || scope === "owner") return "owner:";
  return `demo:${scope}:`; // scope = demoAccessId for demo users
}

function normalizedScope(scope?: string | null): string {
  return !scope || scope === "owner" ? "owner" : `demo:${scope}`;
}

// ── Helpers ─────────────────────────────────────

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function buildCacheKey(
  productName: string,
  candidateId?: string | null,
  contextHash?: string | null,
  scope?: string | null,
): string {
  const sp = scopePrefix(scope);
  const normalized = (productName || "unknown").trim().slice(0, 80);
  if (candidateId) {
    if (!contextHash || !/^[a-f0-9]{64}$/i.test(contextHash)) return "";
    return `${CACHE_PREFIX}:${sp}candidate:${candidateId}:${contextHash.toLowerCase()}`;
  }
  return `${CACHE_PREFIX}:${sp}product:${normalized}`;
}

function parseCachedRun(raw: string | null): CachedAgentRun | null {
  if (!raw) return null;
  const cache = JSON.parse(raw) as CachedAgentRun;
  if (!cache || cache.version !== 2 || typeof cache.accessScope !== "string") return null;
  if (Date.now() - cache.savedAt > (cache.ttlMs || DEFAULT_TTL_MS)) return null;
  if (typeof cache.productName !== "string" || !cache.productName.trim()) return null;
  return cache;
}

// ── Public API ──────────────────────────────────

/** Build the cache key from current context */
export function getAgentRunCacheKey(
  productName: string,
  sourceMeta?: CachedSourceMeta | null,
  scope?: string | null,
): string {
  return buildCacheKey(
    productName,
    sourceMeta?.candidateId || null,
    sourceMeta?.contextHash || null,
    scope,
  );
}

/** Write the current run state to sessionStorage */
export function saveAgentRunCache(
  productName: string,
  sourceMeta: CachedSourceMeta | null,
  data: Omit<
    CachedAgentRun,
    "version" | "accessScope" | "savedAt" | "ttlMs" | "productName" | "sourceMeta"
  >,
  scope?: string | null,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = buildCacheKey(
      productName,
      sourceMeta?.candidateId || null,
      sourceMeta?.contextHash || null,
      scope,
    );
    if (!key) return;
    const cache: CachedAgentRun = {
      version: 2,
      accessScope: normalizedScope(scope),
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
  scope?: string | null,
): CachedAgentRun | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const key = buildCacheKey(
      productName,
      sourceMeta?.candidateId || null,
      sourceMeta?.contextHash || null,
      scope,
    );
    if (!key) return null;
    const raw = storage.getItem(key);
    if (!raw) return null;

    const cache = parseCachedRun(raw);
    if (!cache) {
      storage.removeItem(key);
      return null;
    }

    if (cache.accessScope !== normalizedScope(scope)) return null;
    if (sourceMeta?.candidateId) {
      if (cache.sourceMeta?.candidateId !== sourceMeta.candidateId
        || cache.sourceMeta?.contextHash !== sourceMeta.contextHash) return null;
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

/**
 * Load the most recent cached run in this tab within the given scope.
 * Used only as a recovery fallback for bare /agent/run where there is no
 * product query to build an exact cache key.
 */
export function loadLatestAgentRunCache(
  sourceMeta?: CachedSourceMeta | null,
  scope?: string | null,
): CachedAgentRun | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const sp = scopePrefix(scope);
    const prefix = `${CACHE_PREFIX}:${sp}`;
    const candidateId = sourceMeta?.candidateId || null;
    const matches: CachedAgentRun[] = [];
    const expiredKeys: string[] = [];

    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;

      const raw = storage.getItem(key);
      const cache = parseCachedRun(raw);
      if (!cache) {
        expiredKeys.push(key);
        continue;
      }

      if (cache.accessScope !== normalizedScope(scope)) continue;
      if (candidateId && (
        cache.sourceMeta?.candidateId !== candidateId
        || !sourceMeta?.contextHash
        || cache.sourceMeta?.contextHash !== sourceMeta.contextHash
      )) continue;
      matches.push(cache);
    }

    expiredKeys.forEach((key) => storage.removeItem(key));
    matches.sort((a, b) => b.savedAt - a.savedAt);
    return matches[0] || null;
  } catch {
    return null;
  }
}

/** Clear the cached run for the current context */
export function clearAgentRunCache(
  productName: string,
  sourceMeta?: CachedSourceMeta | null,
  scope?: string | null,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = buildCacheKey(
      productName,
      sourceMeta?.candidateId || null,
      sourceMeta?.contextHash || null,
      scope,
    );
    if (key) storage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Clear all v2 cache entries for one Candidate within the current authenticated identity. */
export function clearAgentRunCandidateCaches(
  candidateId: string,
  scope?: string | null,
): void {
  const storage = getStorage();
  if (!storage || !candidateId.trim()) return;
  try {
    const prefix = `${CACHE_PREFIX}:${scopePrefix(scope)}candidate:${candidateId.trim()}:`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // ignore
  }
}
