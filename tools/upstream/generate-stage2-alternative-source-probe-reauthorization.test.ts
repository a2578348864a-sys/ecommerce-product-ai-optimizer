import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceProbeReauthorizationMaterials } from "./generate-stage2-alternative-source-probe-reauthorization";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
const file = (path: string): string => resolve(PROJECT_ROOT, path);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Capability-Probe-02 authorization handoff generation", () => {
  it("writes an idempotent non-authorizing package bound to all authoritative evidence", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-probe-reauth-"));
    roots.push(outputDirectory);
    const input = {
      briefFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      baselineOfflineValidationFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json"),
      priorAuthorizationFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-authorization.v1.json"),
      priorRunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
      unknownPageDiagnosticValidationFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Unknown-Page-Diagnostic-Offline-01/stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1.json"),
      outputDirectory,
      createdAt: "2026-07-15T04:30:00.000Z",
    };
    const first = generateStage2AlternativeSourceProbeReauthorizationMaterials(input);
    const second = generateStage2AlternativeSourceProbeReauthorizationMaterials(input);
    expect(first.request).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v2",
      status: "pending_user_authorization",
      authorization: { status: "not_granted" },
    });
    expect(first.validation).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization-validation.v2",
      status: "valid_pending_user_authorization",
      reasonCodes: [],
    });
    expect(first.summary).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-reauthorization-generation-summary.v1",
      authorizationGranted: false,
      realWebsiteAccessedDuringGeneration: false,
      runtimeProbeExecuted: false,
    });
    expect(second.artifactWrite).toEqual({ written: [], unchanged: first.summary.files });
    const handoff = readFileSync(resolve(outputDirectory, "01-用户授权交接.md"), "utf8");
    expect(handoff).toContain("Capability-Probe-02");
    expect(handoff).toContain(first.request.authorizationPhrase);
    expect(handoff).toContain(first.request.priorRunEvidenceHash);
    expect(handoff).toContain(first.request.unknownPageDiagnosticValidationEvidenceHash);
    expect(handoff).toContain("材料存在不代表已授权");
    for (const name of first.summary.files.filter((value) => value.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(resolve(outputDirectory, name), "utf8"))).not.toThrow();
    }
  });
});
