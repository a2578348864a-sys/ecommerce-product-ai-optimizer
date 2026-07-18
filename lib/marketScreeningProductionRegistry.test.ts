import { describe, expect, it } from "vitest";
import {
  ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID,
  getActiveProductionMarketScreeningRegistration,
  resolveProductionMarketScreeningRegistration,
} from "@/lib/marketScreeningProductionRegistry";

describe("production market screening registry", () => {
  it("pins one reviewed production manifest by identity, path, and hash", () => {
    expect(ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID).toBe(
      "production-registration-20260717-01",
    );
    expect(getActiveProductionMarketScreeningRegistration()).toEqual({
      registrationId: "production-registration-20260717-01",
      manifestId: "phase0-market-screening-production-20260717-01",
      manifestRelativePath: "06_测试与验证/2026-07-17-Phase0-Market-Screening-Frozen-Batch-01/market-screening-production-manifest.v1.json",
      manifestSha256: "01c6b5e599915f65db60e6db74a405429873ec777fdc8c041ef63bbbede806ca",
    });
  });

  it("fails closed for a disabled or unknown active registration", () => {
    expect(resolveProductionMarketScreeningRegistration(null)).toBeNull();
    expect(resolveProductionMarketScreeningRegistration("unknown-registration")).toBeNull();
  });
});
