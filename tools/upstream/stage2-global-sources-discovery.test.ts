import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage2AlternativeSourceSelection,
  buildStage2GlobalSourcesDiscoveryBrief,
  validateStage2GlobalSourcesDiscoveryPackage,
} from "./stage2-global-sources-discovery";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const file = (path: string): string => resolve(PROJECT_ROOT, path);
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file(path), "utf8")) as Record<string, unknown>;

function evidence() {
  return {
    decisionBrief: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Decision-Brief-03/stage2-alternative-source-decision-brief.v1.json"),
    research: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-research.v1.json"),
    probe1Run: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
    probe2Run: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02/stage2-alternative-source-capability-probe-run.v3.json"),
  };
}

function buildPackage() {
  const inputs = evidence();
  const selection = buildStage2AlternativeSourceSelection({
    ...inputs,
    approvedAt: "2026-07-15T04:38:56.901Z",
    approvedBy: "project_owner",
  });
  const discoveryBrief = buildStage2GlobalSourcesDiscoveryBrief({
    selection,
    createdAt: "2026-07-15T04:38:56.901Z",
  });
  return { ...inputs, selection, discoveryBrief };
}

describe("Global Sources C1A offline source discovery", () => {
  it("records user choice C/C1A without rewriting the historical pending decision", () => {
    const before = readFileSync(file(
      "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Decision-Brief-03/stage2-alternative-source-decision-brief.v1.json",
    ), "utf8");
    const pkg = buildPackage();
    const after = readFileSync(file(
      "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Decision-Brief-03/stage2-alternative-source-decision-brief.v1.json",
    ), "utf8");

    expect(pkg.selection).toMatchObject({
      schemaVersion: "stage2-alternative-source-selection.v1",
      status: "selected_pending_source_discovery",
      selectedOption: "select_different_public_source",
      selectedApproach: "global_sources_minimal_discovery",
      selectedPlatform: "global_sources",
      userSelection: "C",
      sourceCapabilityValidated: false,
      realWebsiteAccessedDuringSelection: false,
    });
    expect(pkg.selection.sourceEvidence).toEqual({
      decisionBriefEvidenceHash: pkg.decisionBrief.evidenceHash,
      researchEvidenceHash: pkg.research.evidenceHash,
      probe1RunEvidenceHash: pkg.probe1Run.evidenceHash,
      probe2RunEvidenceHash: pkg.probe2Run.evidenceHash,
    });
    expect(pkg.decisionBrief.selectedOption).toBeNull();
    expect(before).toBe(after);
    expect(validateStage2GlobalSourcesDiscoveryPackage(pkg)).toMatchObject({
      status: "valid_pending_user_authorization",
      reasonCodes: [],
    });
  });

  it("freezes exact discovery targets and a zero-product zero-supplier budget", () => {
    const { discoveryBrief } = buildPackage();
    expect(discoveryBrief).toMatchObject({
      schemaVersion: "stage2-global-sources-discovery-brief.v1",
      status: "pending_user_authorization",
      authorization: { status: "not_granted" },
      policyPreflight: {
        robotsUrl: "https://www.globalsources.com/robots.txt",
        robotsStatus: "unknown_pending_runtime_check",
      },
      requestedScope: {
        maxRobotsRequests: 1,
        maxBrowserNavigations: 2,
        maxTotalExternalRequests: 3,
        maxProductPageNavigations: 0,
        maxSupplierFields: 0,
        automaticRetryCount: 0,
      },
    });
    expect(discoveryBrief.navigationTargets).toEqual([
      {
        purpose: "primary_homepage_capability",
        origin: "https://www.globalsources.com",
        path: "/",
        url: "https://www.globalsources.com/",
      },
      {
        purpose: "official_supplier_search_help_reference",
        origin: "https://s.globalsources.com",
        path: "/HELP/GSOLHELP/SUPPTIP.HTM",
        url: "https://s.globalsources.com/HELP/GSOLHELP/SUPPTIP.HTM",
      },
    ]);
    expect(discoveryBrief.outputPolicy.maxCandidateSearchPaths).toBe(5);
    expect(discoveryBrief.boundary).toMatchObject({
      thisBriefIsNotAuthorization: true,
      noProductPageNavigation: true,
      noSupplierFieldCollection: true,
      noFullHtmlOrBodyStorage: true,
      noDatabaseWrite: true,
      noCandidateCreation: true,
    });
  });

  it("fails closed when a critical scope is widened even if the hash is recomputed", () => {
    const pkg = buildPackage();
    const discoveryBrief = structuredClone(pkg.discoveryBrief);
    discoveryBrief.requestedScope.maxProductPageNavigations = 1 as 0;
    const { briefHash: _oldHash, ...body } = discoveryBrief;
    discoveryBrief.briefHash = stableHash(body);

    const result = validateStage2GlobalSourcesDiscoveryPackage({ ...pkg, discoveryBrief });
    expect(result.status).toBe("invalid");
    expect(result.reasonCodes).toContain("discovery_scope_invalid");
  });

  it("fails closed on hash tampering and evidence binding drift", () => {
    const pkg = buildPackage();
    const tamperedBrief = structuredClone(pkg.discoveryBrief);
    tamperedBrief.navigationTargets[0].origin = "https://example.com" as "https://www.globalsources.com";
    const tamperedResult = validateStage2GlobalSourcesDiscoveryPackage({ ...pkg, discoveryBrief: tamperedBrief });
    expect(tamperedResult.status).toBe("invalid");
    expect(tamperedResult.reasonCodes).toEqual(expect.arrayContaining([
      "discovery_brief_hash_invalid",
      "discovery_targets_invalid",
    ]));

    const changedResearch = { ...pkg.research, evidenceHash: "0".repeat(64) };
    const bindingResult = validateStage2GlobalSourcesDiscoveryPackage({ ...pkg, research: changedResearch });
    expect(bindingResult.status).toBe("invalid");
    expect(bindingResult.reasonCodes).toContain("source_evidence_invalid");
  });
});
