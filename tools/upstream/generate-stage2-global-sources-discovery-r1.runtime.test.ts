import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2GlobalSourcesDiscoveryR1Materials } from "./generate-stage2-global-sources-discovery-r1";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");

describe("Global Sources C1A-R1 explicit offline generation", () => {
  it.skipIf(process.env.RUN_GLOBAL_SOURCES_R1_OFFLINE_GENERATION !== "1")(
    "writes the authoritative offline package without external access",
    () => {
      const result = generateStage2GlobalSourcesDiscoveryR1Materials({
        selectionFile: resolve(PROJECT_ROOT,
          "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-alternative-source-selection.v1.json"),
        historicalBriefFile: resolve(PROJECT_ROOT,
          "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-global-sources-discovery-brief.v1.json"),
        fixtureFile: resolve(PROJECT_ROOT,
          "电商工具/tools/upstream/fixtures/stage2-global-sources-discovery-r1.v1.json"),
        outputDirectory: resolve(PROJECT_ROOT,
          "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-R1-Offline-03"),
        createdAt: "2026-07-15T06:30:00.000Z",
      });
      expect(result.offlineValidation.status).toBe("offline_validation_passed");
      expect(result.summary.realWebsiteAccessedDuringGeneration).toBe(false);
    },
  );
});
