import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceMaterials } from "./generate-stage2-alternative-source-brief";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const runRuntime = process.env.RUN_STAGE2_ALTERNATIVE_SOURCE_BRIEF === "1";

describe("Stage 2 alternative source material runtime", () => {
  (runRuntime ? it : it.skip)("generates the pending-authorization Made-in-China brief", () => {
    const result = generateStage2AlternativeSourceMaterials({
      originalBriefFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/08-Stage2-high-01取证授权材料/stage2-evidence-collection-brief.v1.json"),
      failedRevalidationResultFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Public-Revalidation-01/stage2-public-revalidation-result.v1.json"),
      outputDirectory: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative"),
      createdAt: "2026-07-14T17:30:00.000Z",
    });

    expect(result.validation).toMatchObject({
      status: "valid_pending_authorization",
      reasonCodes: [],
    });
    expect(result.summary).toMatchObject({
      authorizationGranted: false,
      realWebsiteAccessedDuringGeneration: false,
      realProductEvidenceCollected: false,
    });
  });
});
