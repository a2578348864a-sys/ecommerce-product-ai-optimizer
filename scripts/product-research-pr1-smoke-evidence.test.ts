import { describe, expect, it } from "vitest";
import { buildSmokeProviderEvidence } from "./product-research-pr1-smoke-evidence";

describe("product research Smoke provider evidence", () => {
  it("keeps browser and driver counts verified while leaving unobserved runtime traffic unverified", () => {
    expect(buildSmokeProviderEvidence({
      browserAiRouteRequests: 0,
      driverAiRouteRequests: 0,
      providerPathInScope: false,
    })).toEqual({
      browserAiRouteRequests: {
        status: "verified_zero",
        value: 0,
        source: "browser_cdp",
      },
      driverAiRouteRequests: {
        status: "verified_zero",
        value: 0,
        source: "driver_url_instrumentation",
      },
      providerInvocation: {
        status: "not_applicable",
        reason: "provider_path_not_entered",
      },
      runtimeAllOutboundNetwork: {
        status: "unverified",
        reason: "no_process_or_os_level_observation",
      },
    });
  });

  it("never upgrades an entered provider path to verified_zero without provider observation", () => {
    const evidence = buildSmokeProviderEvidence({
      browserAiRouteRequests: 0,
      driverAiRouteRequests: 0,
      providerPathInScope: true,
    });
    expect(evidence.providerInvocation).toEqual({
      status: "unverified",
      reason: "provider_path_entered_without_provider_observation",
    });
    expect(evidence.runtimeAllOutboundNetwork.status).toBe("unverified");
  });
});
