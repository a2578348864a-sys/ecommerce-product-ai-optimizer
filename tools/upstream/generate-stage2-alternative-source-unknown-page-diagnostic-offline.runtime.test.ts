import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceUnknownPageDiagnosticOfflineEvidence } from "./generate-stage2-alternative-source-unknown-page-diagnostic-offline";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const enabled = process.env.RUN_STAGE2_ALTERNATIVE_SOURCE_UNKNOWN_PAGE_DIAGNOSTIC_OFFLINE === "1";

describe("Stage 2 alternative-source unknown-page diagnostic runtime", () => {
  (enabled ? it : it.skip)("generates the authoritative offline package", () => {
    const result = generateStage2AlternativeSourceUnknownPageDiagnosticOfflineEvidence({
      briefFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      fixtureFile: resolve(import.meta.dirname,
        "fixtures/stage2-alternative-source-unknown-page-diagnostic.v1.json"),
      outputDirectory: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Unknown-Page-Diagnostic-Offline-01"),
      createdAt: "2026-07-15T03:40:00.000Z",
    });
    expect(result.validation.status).toBe("offline_validation_passed");
    expect(result.validation.realWebsiteAccessed).toBe(false);
  });
});
