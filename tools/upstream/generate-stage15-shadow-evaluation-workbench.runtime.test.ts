import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage15ShadowEvaluationWorkbench } from "./generate-stage15-shadow-evaluation-workbench";

const directory = process.env.SHADOW_EVALUATION_BATCH_DIR;
const role = process.env.SHADOW_EVALUATION_BATCH_ROLE as "calibration" | "validation" | undefined;
const createdAt = process.env.SHADOW_EVALUATION_CREATED_AT;

function readJson(name: string) {
  return JSON.parse(readFileSync(join(directory!, name), "utf8"));
}

describe("Stage 1.5 evaluation workbench runtime", () => {
  it.runIf(Boolean(directory && role && createdAt))("generates the explicit batch supplement idempotently", () => {
    const sourceManifestText = readFileSync(join(directory!, "stage15-shadow-upstream-manifest.v1.json"), "utf8");
    const sourceManifestFileSha256 = createHash("sha256").update(sourceManifestText, "utf8").digest("hex");
    const result = generateStage15ShadowEvaluationWorkbench({
      packet: readJson("stage15-shadow-combined-human-evaluation-packet.v1.json"),
      resultTemplate: readJson("stage15-shadow-combined-human-evaluation-result-template.v1.json"),
      sourceManifest: JSON.parse(sourceManifestText),
      sourceManifestFileSha256,
      accessBudget: readJson("stage15-shadow-access-budget.v1.json"),
      role: role!,
      outputDirectory: directory!,
      createdAt: createdAt!,
    });
    expect(result.supplement.status).toBe(role === "calibration"
      ? "ready_for_human_evaluation"
      : "locked_pending_calibration_policy");
    expect(result.supplement.policyCandidateFeasibility)
      .toBe("blocked_by_exact_variant_review_coverage_0_of_10");
  });
});
