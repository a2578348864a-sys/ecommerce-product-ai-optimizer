import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const OUTPUT = resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02");
const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(OUTPUT, name), "utf8")) as Record<string, unknown>;

function expectHash(value: Record<string, unknown>, field: "evidenceHash" | "inputHash") {
  const actual = value[field];
  const body = { ...value };
  delete body[field];
  expect(actual).toBe(stableHash(body));
}

describe("authoritative Capability-Probe-02 runtime artifacts", () => {
  it("preserves the single-use budget, fail-closed diagnostic, and complete cleanup", () => {
    const authorization = read("stage2-alternative-source-capability-probe-authorization.v2.json");
    const policyRequest = read("stage2-alternative-source-robots-request.v1.json");
    const policyPreflight = read("stage2-alternative-source-policy-preflight.v1.json");
    const run = read("stage2-alternative-source-capability-probe-run.v3.json");
    const summary = read("generation-summary.stage2-alternative-source-capability-probe.v2.json");
    expectHash(authorization, "evidenceHash");
    expectHash(policyRequest, "inputHash");
    expectHash(policyPreflight, "inputHash");
    expectHash(run, "evidenceHash");
    expectHash(summary, "evidenceHash");

    expect(authorization).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization.v2",
      consumption: { status: "consumed", runId: run.runId },
    });
    expect(policyRequest).toMatchObject({ httpStatus: 200, errorCode: null, responseBodyStored: false });
    expect(run).toMatchObject({
      status: "failed_closed",
      errorCode: "unknown_page",
      reasonCodes: ["search_container_marker_missing"],
      navigationBudget: { maximum: 1, used: 1, productPageNavigations: 0, automaticRetryCount: 0 },
      allowedProductUrls: [],
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
      externalAiOrPaidApiCalled: false,
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      },
    });
    const page = run.page as Record<string, unknown>;
    const diagnostic = run.unknownPageDiagnostic as Record<string, unknown>;
    expectHash(page, "inputHash");
    expectHash(diagnostic, "inputHash");
    expect(page).toMatchObject({
      classification: "unknown_page",
      finalOrigin: "https://www.made-in-china.com",
      httpStatus: 200,
      readyState: "complete",
    });
    expect(diagnostic).toMatchObject({
      status: "diagnostic_evidence_present",
      failClosedRequired: true,
      allowsCollection: false,
      fullHtmlStored: false,
      pageBodyTextStored: false,
      structureCounts: {
        mainElementCount: 0,
        genericProductClassElementCount: expect.any(Number),
        exactAllowedProductPathCount: 0,
        looseSameOriginProductPathCount: expect.any(Number),
        supplierSubdomainProductPathCount: expect.any(Number),
      },
    });
    expect(diagnostic.reasonCodes).toEqual(expect.arrayContaining([
      "generic_product_class_elements_present",
      "exact_allowed_product_paths_absent",
      "loose_same_origin_product_paths_present",
      "supplier_subdomain_product_paths_present",
      "unsafe_supplier_subdomain_paths_observed",
    ]));
    for (const path of diagnostic.safeSameOriginPathSamples as string[]) {
      expect(path).toMatch(/^\//);
      expect(path).not.toMatch(/[?#]/);
    }
  });

  it("contains no private path, credential pattern, full HTML, or stored robots body", () => {
    for (const name of [
      "stage2-alternative-source-capability-probe-authorization.v2.json",
      "stage2-alternative-source-robots-request.v1.json",
      "stage2-alternative-source-policy-preflight.v1.json",
      "stage2-alternative-source-capability-probe-run.v3.json",
      "generation-summary.stage2-alternative-source-capability-probe.v2.json",
    ]) {
      const content = readFileSync(resolve(OUTPUT, name), "utf8");
      expect(content).not.toContain("C:\\Users\\");
      expect(content).not.toMatch(/Bearer\s+\S+|AKIA[0-9A-Z]{16}|password\s*[:=]|token\s*[:=]/i);
      expect(content).not.toMatch(/<html|<!doctype/i);
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });
});
