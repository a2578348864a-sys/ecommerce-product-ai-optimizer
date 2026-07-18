import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  evaluateStage15ShadowDetailAccessPreflight,
  type Stage15ShadowDetailAccessAuthorization,
  type Stage15ShadowDetailAccessLogEntry,
  type Stage15ShadowDetailAccessRequest,
} from "./stage15-shadow-detail-access";

const batchDirectory = process.env.SHADOW_DETAIL_STOP_BATCH_DIR;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(batchDirectory!, relativePath), "utf8")) as T;
}

function sha256(relativePath: string): string {
  return createHash("sha256").update(readFileSync(join(batchDirectory!, relativePath))).digest("hex");
}

function without<T extends Record<string, unknown>>(value: T, key: keyof T): Omit<T, keyof T> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

describe("Stage 1.5 real Batch C detail access stop runtime", () => {
  it.runIf(Boolean(batchDirectory))(
    "proves one login-wall attempt blocks the remaining 19 targets without admitting partial detail evidence",
    () => {
      const request = readJson<Stage15ShadowDetailAccessRequest>("stage15-shadow-detail-access-request.v1.json");
      const authorization = readJson<Stage15ShadowDetailAccessAuthorization>("stage15-shadow-detail-access-authorization.v1.json");
      const accessLog = readJson<{ entries: Stage15ShadowDetailAccessLogEntry[] }>("stage15-shadow-detail-access-log.v1.json");
      const preflight = readJson<Record<string, unknown>>("stage15-shadow-detail-access-preflight.v1.json");
      const stopEvidence = readJson<Record<string, unknown>>("stage15-shadow-detail-access-stop-evidence.v1.json");
      const startGate = readJson<Record<string, unknown>>("stage15-shadow-human-evaluation-start-gate.detail-stop.v1.json");

      expect(evaluateStage15ShadowDetailAccessPreflight({ request, authorization, accessLog: accessLog.entries }))
        .toEqual(preflight);
      expect(accessLog.entries).toEqual([expect.objectContaining({
        productKey: request.targets[0].productKey,
        sourceUrl: request.targets[0].sourceUrl,
        attempt: 1,
        outcome: "login_wall",
      })]);
      expect(stopEvidence).toMatchObject({
        accessOutcome: "login_wall",
        continuation: { allowed: false, unvisitedTargetCount: 19 },
        rawVisibleDiagnostics: { admissionStatus: "not_admitted_due_stop_condition" },
      });
      expect(startGate).toMatchObject({
        status: "hold_detail_access_stopped_login_wall",
        humanEvaluationAllowed: false,
        policyCandidateCanFreeze: false,
        boundary: { detailPagesAttempted: 1, automaticRetries: 0, unvisitedDetailPages: 19 },
      });
      expect(sha256("detail-captures/B0044UP39U.md")).toBe(
        (stopEvidence.capture as { fileSha256: string }).fileSha256,
      );
      expect(stableHash(without(stopEvidence, "evidenceHash"))).toBe(stopEvidence.evidenceHash);
      expect(stableHash(without(startGate, "gateHash"))).toBe(startGate.gateHash);
      expect(existsSync(join(batchDirectory!, "detail-enriched-evaluation-v1"))).toBe(false);
    },
  );
});
