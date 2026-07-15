import { stableHash } from "../../../lib/upstream/pipeline";
import type { AmazonEnvironmentGateResult } from "./environment-gate";
import type { AmazonEnvironmentStep } from "./browser-control";
import type { buildAmazonPageDiagnostic } from "./page-diagnostics";

export type AmazonEnvironmentEvidenceInput = {
  capturedAt: string;
  browser: "chrome" | "edge";
  browserVersion: string | null;
  profileIsolation: "system_temp";
  debugTransport: "loopback_cdp_dynamic_port";
  homepageNavigationCount: number;
  preferencesNavigationCount: number;
  searchPageAccessCount: number;
  searchStarted: boolean;
  collectionRunGenerated: boolean;
  gate: AmazonEnvironmentGateResult;
  steps: AmazonEnvironmentStep[];
  pageDiagnostics: Array<ReturnType<typeof buildAmazonPageDiagnostic>>;
  cleanup: {
    pageClosed: boolean;
    browserClosed: boolean;
    forcedTerminationUsed: boolean;
    debugPortReleased: boolean;
    profileRemoved: boolean;
    browserProcessBaselineCount: number;
    browserProcessFinalCount: number;
    browserProcessBaselineRestored: boolean;
  };
};

export function buildAmazonEnvironmentSetupEvidence(input: AmazonEnvironmentEvidenceInput) {
  const core = {
    schemaVersion: "amazon-environment-setup-evidence.v2" as const,
    capturedAt: input.capturedAt,
    requested: {
      marketplace: "amazon.com" as const,
      market: "US" as const,
      deliveryRegion: "New York 10001" as const,
      language: "en-us" as const,
      currency: "USD" as const,
    },
    observed: { ...input.gate.observed },
    observedEvidence: {
      marketplace: { ...input.gate.observedEvidence.marketplace },
      market: { ...input.gate.observedEvidence.market },
      deliveryRegion: { ...input.gate.observedEvidence.deliveryRegion },
      language: { ...input.gate.observedEvidence.language },
      currency: { ...input.gate.observedEvidence.currency },
    },
    environmentGate: {
      ...input.gate,
      errorCodes: [...input.gate.errorCodes],
      observed: { ...input.gate.observed },
      observedEvidence: {
        marketplace: { ...input.gate.observedEvidence.marketplace },
        market: { ...input.gate.observedEvidence.market },
        deliveryRegion: { ...input.gate.observedEvidence.deliveryRegion },
        language: { ...input.gate.observedEvidence.language },
        currency: { ...input.gate.observedEvidence.currency },
      },
    },
    steps: input.steps.map((step) => ({ ...step })),
    pageDiagnostics: input.pageDiagnostics.map((diagnostic) => ({
      ...diagnostic,
      requestedUrl: { ...diagnostic.requestedUrl },
      finalUrl: { ...diagnostic.finalUrl },
      redirectOrigins: [...diagnostic.redirectOrigins],
      markerSources: { ...diagnostic.markerSources },
      privacyPrompt: { ...diagnostic.privacyPrompt, reasonCodes: [...diagnostic.privacyPrompt.reasonCodes] },
      loginWall: { ...diagnostic.loginWall, reasonCodes: [...diagnostic.loginWall.reasonCodes] },
      classificationReasonCodes: [...diagnostic.classificationReasonCodes],
    })),
    homepageNavigationCount: input.homepageNavigationCount,
    preferencesNavigationCount: input.preferencesNavigationCount,
    searchPageAccessCount: input.searchPageAccessCount,
    searchStarted: input.searchStarted,
    collectionRunGenerated: input.collectionRunGenerated,
    browser: input.browser,
    browserVersion: input.browserVersion,
    profileIsolation: input.profileIsolation,
    debugTransport: input.debugTransport,
    cleanup: { ...input.cleanup },
  };
  return { ...core, evidenceHash: stableHash(core) };
}
