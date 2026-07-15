import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceProbeOfflineEvidence } from "./generate-stage2-alternative-source-probe-offline";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const runRuntime = process.env.RUN_STAGE2_ALTERNATIVE_SOURCE_PROBE_OFFLINE === "1";

describe("Stage 2 alternative source offline probe evidence runtime", () => {
  (runRuntime ? it : it.skip)("generates the authoritative offline-only validation package", () => {
    const result = generateStage2AlternativeSourceProbeOfflineEvidence({
      briefFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      fixtureFile: resolve(import.meta.dirname, "fixtures/stage2-alternative-source-probe.v1.json"),
      outputDirectory: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01"),
      createdAt: "2026-07-15T02:30:00.000Z",
    });

    expect(result.validation.status).toBe("offline_validation_passed");
    expect(result.validation.realWebsiteAccessed).toBe(false);
    expect(result.validation.runtimeProbeExecuted).toBe(false);
  });
});
