import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const OUTPUT = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-Authorization-02");
const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(OUTPUT, name), "utf8")) as Record<string, unknown>;

describe("authoritative Capability-Probe-02 pending package", () => {
  it("keeps every JSON hash-valid, evidence-bound, non-authorizing, and free of local paths", () => {
    const request = read("stage2-alternative-source-capability-probe-authorization-request.v2.json");
    const validation = read("stage2-alternative-source-capability-probe-authorization-validation.v2.json");
    const summary = read("generation-summary.stage2-alternative-source-probe-reauthorization.v1.json");
    const { requestHash, ...requestBody } = request;
    const { inputHash, ...validationBody } = validation;
    const { evidenceHash, ...summaryBody } = summary;
    expect(requestHash).toBe(stableHash(requestBody));
    expect(inputHash).toBe(stableHash(validationBody));
    expect(evidenceHash).toBe(stableHash(summaryBody));
    expect(request).toMatchObject({
      status: "pending_user_authorization",
      authorization: { status: "not_granted", authorizedAt: null, authorizedBy: null },
      priorRunEvidenceHash: summary.priorRunEvidenceHash,
      unknownPageDiagnosticValidationEvidenceHash: summary.unknownPageDiagnosticValidationEvidenceHash,
    });
    expect(validation).toMatchObject({ status: "valid_pending_user_authorization", reasonCodes: [] });
    for (const name of summary.files as string[]) {
      const content = readFileSync(resolve(OUTPUT, name), "utf8");
      expect(content).not.toContain("C:\\Users\\");
      expect(content).not.toMatch(/Bearer\s+\S+|AKIA[0-9A-Z]{16}|password\s*[:=]|token\s*[:=]/i);
    }
  });
});
