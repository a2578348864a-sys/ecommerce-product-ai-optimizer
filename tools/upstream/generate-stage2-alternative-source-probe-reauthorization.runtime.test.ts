import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceProbeReauthorizationMaterials } from "./generate-stage2-alternative-source-probe-reauthorization";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const enabled = process.env.RUN_STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION === "1";
const file = (path: string): string => resolve(PROJECT_ROOT, path);

describe("Capability-Probe-02 authorization package runtime", () => {
  (enabled ? it : it.skip)("generates the authoritative pending package without network access", () => {
    const result = generateStage2AlternativeSourceProbeReauthorizationMaterials({
      briefFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      baselineOfflineValidationFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json"),
      priorAuthorizationFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-authorization.v1.json"),
      priorRunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
      unknownPageDiagnosticValidationFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Unknown-Page-Diagnostic-Offline-01/stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1.json"),
      outputDirectory: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-Authorization-02"),
      createdAt: "2026-07-15T04:30:00.000Z",
    });
    expect(result.request.authorization.status).toBe("not_granted");
    expect(result.summary.realWebsiteAccessedDuringGeneration).toBe(false);
  });
});
