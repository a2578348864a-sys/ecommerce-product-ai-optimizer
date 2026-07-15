import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceProbeAuthorizationMaterials } from "./generate-stage2-alternative-source-probe-authorization";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const runRuntime = process.env.RUN_STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION === "1";

describe("Stage 2 alternative source capability probe authorization material runtime", () => {
  (runRuntime ? it : it.skip)("generates the pending-user-authorization handoff package", () => {
    const result = generateStage2AlternativeSourceProbeAuthorizationMaterials({
      briefFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      offlineValidationFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json"),
      outputDirectory: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-Authorization-01"),
      createdAt: "2026-07-15T03:00:00.000Z",
    });

    expect(result.validation.status).toBe("valid_pending_user_authorization");
    expect(result.request.authorization.status).toBe("not_granted");
    expect(result.summary.realWebsiteAccessedDuringGeneration).toBe(false);
    expect(result.summary.runtimeProbeExecuted).toBe(false);
  });
});
