import "server-only";

const MAX_REQUESTS_PER_MINUTE = 6;
const MAX_IN_FLIGHT_PER_SUBJECT = 1;

type RateLimitRecord = {
  windowStartedAt: number;
  requestCount: number;
  inFlight: number;
};

const rateLimits = new Map<string, RateLimitRecord>();

export function reserveSellerSpritePreviewRequest(
  subject: string,
): { ok: true; release: () => void } | { ok: false } {
  const now = Date.now();
  const existing = rateLimits.get(subject);
  const record = !existing || now - existing.windowStartedAt >= 60_000
    ? { windowStartedAt: now, requestCount: 0, inFlight: 0 }
    : existing;
  rateLimits.set(subject, record);
  if (record.requestCount >= MAX_REQUESTS_PER_MINUTE || record.inFlight >= MAX_IN_FLIGHT_PER_SUBJECT) {
    return { ok: false };
  }
  record.requestCount += 1;
  record.inFlight += 1;
  return {
    ok: true,
    release: () => {
      record.inFlight = Math.max(0, record.inFlight - 1);
    },
  };
}

export function resetSellerSpritePreviewRateLimitForTest(): void {
  rateLimits.clear();
}
