import { describe, expect, it } from "vitest";
import { generateStage15ShadowEvaluationBridge } from "./generate-stage15-shadow-evaluation-bridge";

const batchDirectory = process.env.SHADOW_EVALUATION_BRIDGE_BATCH_DIR;
const role = process.env.SHADOW_EVALUATION_BRIDGE_BATCH_ROLE as "calibration" | "validation" | undefined;
const createdAt = process.env.SHADOW_EVALUATION_BRIDGE_CREATED_AT;

describe("Stage 1.5 evaluation bridge runtime", () => {
  it.runIf(Boolean(batchDirectory && role && createdAt))("replays explicit source artifacts and freezes the private bridge", () => {
    const result = generateStage15ShadowEvaluationBridge({
      batchDirectory: batchDirectory!,
      role: role!,
      createdAt: createdAt!,
    });
    expect(result.bridge.marketEvidence.candidates).toHaveLength(20);
    expect(result.bridge.boundary).toMatchObject({ humanAnswersPresent: false, databaseWritten: false });
  });
});
