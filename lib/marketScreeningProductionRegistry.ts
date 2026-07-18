import type { ProductionBatchRegistration } from "@/lib/marketScreeningBatchManifest";

export const ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID =
  "production-registration-20260717-01";

const PRODUCTION_MARKET_SCREENING_REGISTRATIONS = [
  {
    registrationId: "production-registration-20260717-01",
    manifestId: "phase0-market-screening-production-20260717-01",
    manifestRelativePath:
      "06_测试与验证/2026-07-17-Phase0-Market-Screening-Frozen-Batch-01/market-screening-production-manifest.v1.json",
    manifestSha256: "01c6b5e599915f65db60e6db74a405429873ec777fdc8c041ef63bbbede806ca",
  },
] as const satisfies readonly ProductionBatchRegistration[];

export function resolveProductionMarketScreeningRegistration(
  registrationId: string | null,
): ProductionBatchRegistration | null {
  if (registrationId === null) return null;
  return PRODUCTION_MARKET_SCREENING_REGISTRATIONS.find(
    (registration) => registration.registrationId === registrationId,
  ) ?? null;
}

export function getActiveProductionMarketScreeningRegistration(): ProductionBatchRegistration | null {
  return resolveProductionMarketScreeningRegistration(
    ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID,
  );
}
