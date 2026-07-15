import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceProbeAuthorizationMaterials } from "./generate-stage2-alternative-source-probe-authorization";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Stage 2 alternative source capability probe authorization material generation", () => {
  it("writes an idempotent, parseable and explicitly non-authorizing handoff package", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-probe-auth-"));
    roots.push(outputDirectory);
    const input = {
      briefFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      offlineValidationFile: resolve(PROJECT_ROOT,
        "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json"),
      outputDirectory,
      createdAt: "2026-07-15T03:00:00.000Z",
    };

    const first = generateStage2AlternativeSourceProbeAuthorizationMaterials(input);
    const second = generateStage2AlternativeSourceProbeAuthorizationMaterials(input);

    expect(first.validation).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-validation.v1",
      status: "valid_pending_user_authorization",
      authorizationRequestId: first.request.authorizationRequestId,
      requestHash: first.request.requestHash,
      reasonCodes: [],
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(first.summary).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-generation-summary.v1",
      status: "pending_user_authorization",
      authorizationGranted: false,
      realWebsiteAccessedDuringGeneration: false,
      runtimeProbeExecuted: false,
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
    });
    expect(second.artifactWrite).toEqual({ written: [], unchanged: first.summary.files });

    const request = JSON.parse(readFileSync(resolve(outputDirectory,
      "stage2-alternative-source-capability-probe-authorization-request.v1.json"), "utf8"));
    expect(request.authorization.status).toBe("not_granted");
    expect(request.browserScope.maximumProductPageNavigations).toBe(0);
    expect(request.maximumTotalExternalRequests).toBe(2);

    const handoff = readFileSync(resolve(outputDirectory, "01-用户授权交接.md"), "utf8");
    expect(handoff).toContain("材料存在不代表已授权");
    expect(handoff).toContain(request.authorizationPhrase);
    expect(handoff).toContain("不采集供应商字段");
    expect(handoff).not.toMatch(/[ \t]+$/m);

    for (const file of first.summary.files.filter((name) => name.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(resolve(outputDirectory, file), "utf8"))).not.toThrow();
    }
  });
});
