import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceDecisionBriefMaterials } from "./generate-stage2-alternative-source-decision-brief";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const enabled = process.env.RUN_STAGE2_ALTERNATIVE_SOURCE_DECISION_BRIEF === "1";
const file = (path: string): string => resolve(PROJECT_ROOT, path);

describe("Stage 2 alternative-source decision brief runtime", () => {
  (enabled ? it : it.skip)("generates the authoritative offline pending-decision package", () => {
    const result = generateStage2AlternativeSourceDecisionBriefMaterials({
      briefFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      probe1RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
      probe2RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02/stage2-alternative-source-capability-probe-run.v3.json"),
      outputDirectory: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Decision-Brief-03"),
      createdAt: "2026-07-15T04:10:00.000Z",
    });
    expect(result.decisionBrief.status).toBe("pending_user_decision");
    expect(result.decisionBrief.selectedOption).toBeNull();
    expect(result.summary.realWebsiteAccessedDuringGeneration).toBe(false);
  });
});
