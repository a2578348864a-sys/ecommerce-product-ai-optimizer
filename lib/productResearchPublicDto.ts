export const PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function researchHashFingerprint(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return null;
  return value.slice(0, PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH);
}

function sanitizeDecisionEvent(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { researchHash, ...safe } = value;
  const fingerprint = researchHashFingerprint(researchHash);
  return {
    ...safe,
    ...(fingerprint ? { researchHashFingerprint: fingerprint } : {}),
  };
}

export function toResearchHashFingerprint(value: unknown): string | null {
  return researchHashFingerprint(value);
}

export function sanitizeProductResearchRecordForBrowser(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { researchHash, latestDecision, decisionEvents, ...safe } = value;
  const fingerprint = researchHashFingerprint(researchHash);
  return {
    ...safe,
    ...(fingerprint ? { researchHashFingerprint: fingerprint } : {}),
    ...(latestDecision === undefined ? {} : { latestDecision: sanitizeDecisionEvent(latestDecision) }),
    ...(Array.isArray(decisionEvents)
      ? { decisionEvents: decisionEvents.map(sanitizeDecisionEvent) }
      : decisionEvents === undefined ? {} : { decisionEvents }),
  };
}

export function sanitizeProductResearchResultForBrowser(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (!Object.prototype.hasOwnProperty.call(value, "researchRecord")) return value;
  return {
    ...value,
    researchRecord: sanitizeProductResearchRecordForBrowser(value.researchRecord),
  };
}
