import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2GlobalSourcesDiscoveryMaterials } from "./generate-stage2-global-sources-discovery";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const enabled = process.env.RUN_STAGE2_GLOBAL_SOURCES_DISCOVERY === "1";
const file = (path: string): string => resolve(PROJECT_ROOT, path);

describe("Global Sources C1A runtime material generation", () => {
  (enabled ? it : it.skip)("generates the authoritative offline pending-authorization package", () => {
    const result = generateStage2GlobalSourcesDiscoveryMaterials({
      decisionBriefFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Decision-Brief-03/stage2-alternative-source-decision-brief.v1.json"),
      researchFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-research.v1.json"),
      probe1RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
      probe2RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02/stage2-alternative-source-capability-probe-run.v3.json"),
      outputDirectory: file("06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01"),
      approvedAt: "2026-07-15T04:38:56.901Z",
      createdAt: "2026-07-15T04:38:56.901Z",
    });
    expect(result.validation.status).toBe("valid_pending_user_authorization");
    expect(result.summary.realWebsiteAccessedDuringGeneration).toBe(false);
    expect(result.summary.externalAuthorizationGranted).toBe(false);
  });
});
