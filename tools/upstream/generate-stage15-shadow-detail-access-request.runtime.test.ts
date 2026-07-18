import { describe, expect, it } from "vitest";
import { generateStage15ShadowDetailAccessRequest } from "./generate-stage15-shadow-detail-access-request";

const batchDirectory = process.env.SHADOW_DETAIL_REQUEST_BATCH_DIR;
const createdAt = process.env.SHADOW_DETAIL_REQUEST_CREATED_AT;

describe("Stage 1.5 real Batch C detail access request runtime", () => {
  it.runIf(Boolean(batchDirectory && createdAt))(
    "generates and idempotently replays the explicit pending request",
    () => {
      const input = { batchDirectory: batchDirectory!, createdAt: createdAt! };
      const first = generateStage15ShadowDetailAccessRequest(input);
      const second = generateStage15ShadowDetailAccessRequest(input);
      expect(first.artifactWrite.written).toHaveLength(4);
      expect(second.artifactWrite.unchanged).toEqual(first.files);
      expect(first.request).toMatchObject({ authorizationStatus: "pending_user_approval", executionAllowed: false });
      expect(first.startGate).toMatchObject({ status: "hold_pending_detail_access_decision", humanEvaluationAllowed: false });
    },
  );
});
