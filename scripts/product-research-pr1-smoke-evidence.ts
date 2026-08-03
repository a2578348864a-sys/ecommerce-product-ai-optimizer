export type SmokeEvidenceStatus = "verified_zero" | "not_applicable" | "unverified";

function verifiedZero(value: number, source: string) {
  if (!Number.isSafeInteger(value) || value !== 0) {
    throw new Error("SMOKE_EVIDENCE_EXPECTED_ZERO");
  }
  return { status: "verified_zero" as const, value, source };
}

export function buildSmokeProviderEvidence(input: {
  browserAiRouteRequests: number;
  driverAiRouteRequests: number;
  providerPathInScope: boolean;
}) {
  return {
    browserAiRouteRequests: verifiedZero(input.browserAiRouteRequests, "browser_cdp"),
    driverAiRouteRequests: verifiedZero(input.driverAiRouteRequests, "driver_url_instrumentation"),
    providerInvocation: input.providerPathInScope
      ? {
          status: "unverified" as const,
          reason: "provider_path_entered_without_provider_observation",
        }
      : {
          status: "not_applicable" as const,
          reason: "provider_path_not_entered",
        },
    runtimeAllOutboundNetwork: {
      status: "unverified" as const,
      reason: "no_process_or_os_level_observation",
    },
  };
}
